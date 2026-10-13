/* AI slice of /api/state: the price list, the customer's keys (never the key itself), projects,
   knowledge bases, settings, recent requests and spend; staff see every request and the upstream driver. */
import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { faDate, faDateTime } from "@/lib/jalali";
import type { AiState } from "@/lib/types";
import type { DB } from "../db/client";
import { aiKbDocs, aiKbs, aiKeys, aiModels, aiProjects, aiSettings, aiUsage } from "../db/schema";
import { tehranStarts } from "./service";
import { aiUpstream } from "./upstream";

export const aiEndpoint = () => (process.env.AI_API_BASE || "https://api.gereh.dev").replace(/\/$/, "");
export const EMPTY_AI: AiState = {
  models: [], keys: [], usage: [], projects: [], kbs: [], settings: { retentionDays: 30, logBodies: false, lowBalance: 0 },
  stats: { todayCount: 0, todaySpend: 0, monthCount: 0, monthSpend: 0, daily: [], byModel: [] }, endpoint: "", upstream: "",
};

export async function aiState(db: DB, o: { uid: string; admin: boolean }): Promise<AiState> {
  const { day, month } = tehranStarts();
  const since30 = new Date(day.getTime() - 29 * 86400_000);
  const mine = o.admin ? undefined : eq(aiUsage.userId, o.uid);
  const none = Promise.resolve([] as never[]);
  const [models, keys, usage, daily, byModel, [today], [mon], keySpend, projects, projSpend, kbs, [settings]] = await Promise.all([
    db.select().from(aiModels).where(o.admin ? undefined : eq(aiModels.active, true)).orderBy(asc(aiModels.position)),
    o.admin ? none : db.select().from(aiKeys).where(eq(aiKeys.userId, o.uid)).orderBy(desc(aiKeys.createdAt)),
    db.select({ u: aiUsage, keyName: aiKeys.name }).from(aiUsage).leftJoin(aiKeys, eq(aiKeys.id, aiUsage.keyId)).where(mine).orderBy(desc(aiUsage.createdAt)).limit(o.admin ? 200 : 100),
    db.select({ day: sql<string>`to_char(${aiUsage.createdAt} at time zone 'Asia/Tehran', 'YYYY-MM-DD')`, count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
      .from(aiUsage).where(and(mine, gte(aiUsage.createdAt, since30))).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ model: aiUsage.model, count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
      .from(aiUsage).where(and(mine, gte(aiUsage.createdAt, month))).groupBy(aiUsage.model).orderBy(sql`3 desc`).limit(12),
    db.select({ count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` }).from(aiUsage).where(and(mine, gte(aiUsage.createdAt, day))),
    db.select({ count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` }).from(aiUsage).where(and(mine, gte(aiUsage.createdAt, month))),
    o.admin ? none : db.select({ keyId: aiUsage.keyId, today: sql<number>`coalesce(sum(${aiUsage.charged}) filter (where ${aiUsage.createdAt} >= ${day.toISOString()}::timestamptz),0)::bigint`, month: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint`, n: sql<number>`count(*)::int` })
      .from(aiUsage).where(and(eq(aiUsage.userId, o.uid), gte(aiUsage.createdAt, month))).groupBy(aiUsage.keyId),
    o.admin ? none : db.select().from(aiProjects).where(eq(aiProjects.userId, o.uid)).orderBy(asc(aiProjects.createdAt)),
    o.admin ? none : db.select({ projectId: aiUsage.projectId, month: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
      .from(aiUsage).where(and(eq(aiUsage.userId, o.uid), gte(aiUsage.createdAt, month))).groupBy(aiUsage.projectId),
    o.admin ? none : db.select().from(aiKbs).where(eq(aiKbs.userId, o.uid)).orderBy(asc(aiKbs.createdAt)),
    o.admin ? none : db.select().from(aiSettings).where(eq(aiSettings.userId, o.uid)),
  ]);
  const docs = kbs.length ? await db.select().from(aiKbDocs).where(inArray(aiKbDocs.kbId, kbs.map((k) => k.id))).orderBy(asc(aiKbDocs.createdAt)) : [];
  return {
    models: models.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, inPrice: m.inPrice, outPrice: m.outPrice, unitPrice: m.unitPrice, context: m.context, vision: m.vision, active: m.active, refIn: o.admin ? m.refIn : 0, refOut: o.admin ? m.refOut : 0, upstream: o.admin ? m.upstream : "" })),
    keys: keys.map((k) => {
      const s = keySpend.find((x) => x.keyId === k.id);
      return {
        id: k.id, name: k.name, prefix: k.prefix, models: k.models, dailyCap: k.dailyCap, monthlyCap: k.monthlyCap, rpm: k.rpm, status: k.status,
        expires: k.expiresAt ? faDate(k.expiresAt) : "", expiresIn: k.expiresAt ? Math.max(1, Math.ceil((k.expiresAt.getTime() - Date.now()) / 86400_000)) : 0,
        lastUsed: k.lastUsedAt ? faDateTime(k.lastUsedAt) : "", created: faDate(k.createdAt), spentToday: Number(s?.today ?? 0), spentMonth: Number(s?.month ?? 0), requestsMonth: s?.n ?? 0,
        ips: k.ips, routing: (k.routing || "") as AiState["keys"][number]["routing"], projectId: k.projectId,
      };
    }),
    usage: usage.map(({ u, keyName }) => ({ id: u.id, userId: o.admin ? u.userId : "", keyName: keyName ?? (u.keyId ? "" : "پنل"), model: u.model, format: u.format, stream: u.stream, status: u.status, inTokens: u.inTokens, outTokens: u.outTokens, units: u.units, finish: u.finish, charged: u.charged, estimated: u.estimated, latencyMs: u.latencyMs, error: o.admin ? u.error : "", at: faDateTime(u.createdAt) })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, monthlyLimit: p.monthlyLimit, spentMonth: Number(projSpend.find((x) => x.projectId === p.id)?.month ?? 0), keys: keys.filter((k) => k.projectId === p.id && k.status !== "revoked").length })),
    kbs: kbs.map((k) => {
      const d = docs.filter((x) => x.kbId === k.id);
      return { id: k.id, name: k.name, model: k.model, chunks: d.reduce((n, x) => n + x.chunks, 0), chars: d.reduce((n, x) => n + x.chars, 0), docs: d.map((x) => ({ id: x.id, name: x.name, mime: x.mime, chars: x.chars, chunks: x.chunks, charged: x.charged, at: faDateTime(x.createdAt) })) };
    }),
    settings: { retentionDays: settings?.retentionDays === 60 ? 60 : 30, logBodies: !!settings?.logBodies, lowBalance: settings?.lowBalance ?? 0 },
    stats: {
      todayCount: today?.count ?? 0, todaySpend: Number(today?.spend ?? 0), monthCount: mon?.count ?? 0, monthSpend: Number(mon?.spend ?? 0),
      daily: daily.map((d) => ({ day: faDate(new Date(d.day + "T12:00:00")), count: d.count, spend: Number(d.spend) })),
      byModel: byModel.map((b) => ({ model: b.model, count: b.count, spend: Number(b.spend) })),
    },
    endpoint: aiEndpoint(),
    upstream: o.admin ? aiUpstream().name : "",
  };
}
