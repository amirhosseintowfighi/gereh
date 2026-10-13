/* Request logs and usage reports for the panel, plus the periodic housekeeping: log retention and the
   low-balance alert. */
import "server-only";
import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { fa } from "@/lib/format";
import { faDate, faDateTime } from "@/lib/jalali";
import type { DB } from "../db/client";
import { aiBodies, aiKeys, aiProjects, aiSettings, aiUsage, users } from "../db/schema";
import { notify } from "../util";
import { tehranStarts } from "./service";

export type LogFilter = { keyId?: string; model?: string; status?: string; projectId?: string; days: number; q?: string; offset?: number };

export async function aiLogs(db: DB, userId: string, f: LogFilter) {
  const since = new Date(Date.now() - f.days * 86400_000);
  const conds: (SQL | undefined)[] = [eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)];
  if (f.keyId) conds.push(f.keyId === "panel" ? isNull(aiUsage.keyId) : eq(aiUsage.keyId, f.keyId));
  if (f.model) conds.push(eq(aiUsage.model, f.model));
  if (f.status) conds.push(eq(aiUsage.status, f.status as "success"));
  if (f.projectId) conds.push(eq(aiUsage.projectId, f.projectId));
  if (f.q) conds.push(or(ilike(aiUsage.id, f.q.replace(/[%_\\]/g, "\\$&") + "%"), ilike(aiUsage.error, "%" + f.q.replace(/[%_\\]/g, "\\$&") + "%")));
  const where = and(...conds);
  const [rows, [{ n }]] = await Promise.all([
    db.select({ u: aiUsage, keyName: aiKeys.name, body: aiBodies.id }).from(aiUsage).leftJoin(aiKeys, eq(aiKeys.id, aiUsage.keyId)).leftJoin(aiBodies, eq(aiBodies.id, aiUsage.id))
      .where(where).orderBy(desc(aiUsage.createdAt)).limit(100).offset(Math.max(0, f.offset ?? 0)),
    db.select({ n: sql<number>`count(*)::int` }).from(aiUsage).where(where),
  ]);
  return {
    total: n,
    rows: rows.map(({ u, keyName, body }) => ({
      id: u.id, keyId: u.keyId ?? "", keyName: keyName ?? (u.keyId ? "—" : "پنل"), model: u.model, format: u.format, stream: u.stream, status: u.status,
      inTokens: u.inTokens, outTokens: u.outTokens, units: u.units, charged: u.charged, estimated: u.estimated, latencyMs: u.latencyMs, finish: u.finish, error: u.error,
      hasBody: !!body, at: faDateTime(u.createdAt), iso: u.createdAt.toISOString(),
    })),
  };
}

export async function aiLogBody(db: DB, userId: string, id: string) {
  const [b] = await db.select().from(aiBodies).where(and(eq(aiBodies.id, id), eq(aiBodies.userId, userId)));
  return b ? { request: b.request, response: b.response } : null;
}

export async function aiReport(db: DB, userId: string, days: number) {
  const { day } = tehranStarts();
  const since = new Date(day.getTime() - (days - 1) * 86400_000);
  const mine = and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since));
  const agg = { count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint`, inTokens: sql<number>`coalesce(sum(${aiUsage.inTokens}),0)::bigint`, outTokens: sql<number>`coalesce(sum(${aiUsage.outTokens}),0)::bigint`, errors: sql<number>`(count(*) filter (where ${aiUsage.status} = 'error'))::int` };
  const [daily, byModel, byKey, byProject] = await Promise.all([
    db.select({ day: sql<string>`to_char(${aiUsage.createdAt} at time zone 'Asia/Tehran', 'YYYY-MM-DD')`, ...agg }).from(aiUsage).where(mine).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ model: aiUsage.model, ...agg }).from(aiUsage).where(mine).groupBy(aiUsage.model).orderBy(sql`3 desc`),
    db.select({ keyId: aiUsage.keyId, keyName: sql<string | null>`max(${aiKeys.name})`, ...agg }).from(aiUsage).leftJoin(aiKeys, eq(aiKeys.id, aiUsage.keyId)).where(mine).groupBy(aiUsage.keyId).orderBy(sql`4 desc`),
    db.select({ projectId: aiUsage.projectId, name: sql<string | null>`max(${aiProjects.name})`, ...agg }).from(aiUsage).leftJoin(aiProjects, eq(aiProjects.id, aiUsage.projectId)).where(mine).groupBy(aiUsage.projectId).orderBy(sql`4 desc`),
  ]);
  const num = <T extends { spend: number; inTokens: number; outTokens: number }>(r: T) => ({ ...r, spend: Number(r.spend), inTokens: Number(r.inTokens), outTokens: Number(r.outTokens) });
  return {
    days,
    daily: daily.map((d) => ({ ...num(d), label: faDate(new Date(d.day + "T12:00:00")) })),
    byModel: byModel.map(num),
    byKey: byKey.map((k) => ({ ...num(k), keyId: k.keyId ?? "", keyName: k.keyName ?? (k.keyId ? "کلید حذف‌شده" : "پنل") })),
    byProject: byProject.map((p) => ({ ...num(p), projectId: p.projectId ?? "", name: p.name ?? "بدون پروژه" })),
  };
}

/** deletes billed request logs (and stored bodies) older than each customer's retention; never this month's rows, which budgets still read */
export async function purgeAiLogs(db: DB) {
  const { month } = tehranStarts();
  const ret = sql`coalesce((select ${aiSettings.retentionDays} from ${aiSettings} where ${aiSettings.userId} = ${aiUsage.userId}), 30)`;
  await db.delete(aiUsage).where(and(eq(aiUsage.billed, true), lt(aiUsage.createdAt, month), sql`${aiUsage.createdAt} < now() - make_interval(days => ${ret})`));
  const retB = sql`coalesce((select ${aiSettings.retentionDays} from ${aiSettings} where ${aiSettings.userId} = ${aiBodies.userId}), 30)`;
  await db.delete(aiBodies).where(sql`${aiBodies.createdAt} < now() - make_interval(days => ${retB})`);
}

/** one notification when the wallet drops under the customer's AI threshold; re-armed once it is topped up */
export async function lowBalanceAlerts(db: DB) {
  const rows = await db.select({ userId: aiSettings.userId, threshold: aiSettings.lowBalance, alerted: aiSettings.lowAlertedAt, balance: users.balance })
    .from(aiSettings).innerJoin(users, eq(users.id, aiSettings.userId)).where(sql`${aiSettings.lowBalance} > 0`);
  for (const r of rows) {
    if (r.balance < r.threshold && !r.alerted) {
      await db.update(aiSettings).set({ lowAlertedAt: new Date() }).where(eq(aiSettings.userId, r.userId));
      await notify(db, r.userId, "wallet", "موجودی کیف پول (" + fa(r.balance) + " تومان) کمتر از حد هشدار API هوش مصنوعی (" + fa(r.threshold) + " تومان) است؛ برای قطع نشدن درخواست‌ها کیف پول را شارژ کنید.");
    } else if (r.balance >= r.threshold && r.alerted) {
      await db.update(aiSettings).set({ lowAlertedAt: null }).where(eq(aiSettings.userId, r.userId));
    }
  }
}
