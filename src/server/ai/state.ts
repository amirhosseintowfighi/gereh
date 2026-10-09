/* AI slice of /api/state: the price list, the customer's keys (never the key itself), recent requests
   and spend; staff see every request and the upstream driver. */
import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { faDate, faDateTime } from "@/lib/jalali";
import type { AiState } from "@/lib/types";
import type { DB } from "../db/client";
import { aiKeys, aiModels, aiUsage } from "../db/schema";
import { tehranStarts } from "./service";
import { aiUpstream } from "./upstream";

export const aiEndpoint = () => (process.env.AI_API_BASE || "https://api.gereh.dev").replace(/\/$/, "");
export const EMPTY_AI: AiState = { models: [], keys: [], usage: [], stats: { todayCount: 0, todaySpend: 0, monthCount: 0, monthSpend: 0, daily: [], byModel: [] }, endpoint: "", upstream: "" };

export async function aiState(db: DB, o: { uid: string; admin: boolean }): Promise<AiState> {
  const { day, month } = tehranStarts();
  const since30 = new Date(day.getTime() - 29 * 86400_000);
  const mine = o.admin ? undefined : eq(aiUsage.userId, o.uid);
  const [models, keys, usage, daily, byModel, [today], [mon], keySpend] = await Promise.all([
    db.select().from(aiModels).where(o.admin ? undefined : eq(aiModels.active, true)).orderBy(asc(aiModels.position)),
    o.admin ? [] : db.select().from(aiKeys).where(eq(aiKeys.userId, o.uid)).orderBy(desc(aiKeys.createdAt)),
    db.select({ u: aiUsage, keyName: aiKeys.name }).from(aiUsage).leftJoin(aiKeys, eq(aiKeys.id, aiUsage.keyId)).where(mine).orderBy(desc(aiUsage.createdAt)).limit(o.admin ? 200 : 100),
    db.select({ day: sql<string>`to_char(${aiUsage.createdAt} at time zone 'Asia/Tehran', 'YYYY-MM-DD')`, count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
      .from(aiUsage).where(and(mine, gte(aiUsage.createdAt, since30))).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ model: aiUsage.model, count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
      .from(aiUsage).where(and(mine, gte(aiUsage.createdAt, month))).groupBy(aiUsage.model).orderBy(sql`3 desc`).limit(12),
    db.select({ count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` }).from(aiUsage).where(and(mine, gte(aiUsage.createdAt, day))),
    db.select({ count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` }).from(aiUsage).where(and(mine, gte(aiUsage.createdAt, month))),
    o.admin ? [] : db.select({ keyId: aiUsage.keyId, today: sql<number>`coalesce(sum(${aiUsage.charged}) filter (where ${aiUsage.createdAt} >= ${day.toISOString()}::timestamptz),0)::bigint`, month: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
      .from(aiUsage).where(and(eq(aiUsage.userId, o.uid), gte(aiUsage.createdAt, month))).groupBy(aiUsage.keyId),
  ]);
  return {
    models: models.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, inPrice: m.inPrice, outPrice: m.outPrice, context: m.context, vision: m.vision, active: m.active, refIn: o.admin ? m.refIn : 0, refOut: o.admin ? m.refOut : 0, upstream: o.admin ? m.upstream : "" })),
    keys: keys.map((k) => {
      const s = keySpend.find((x) => x.keyId === k.id);
      return { id: k.id, name: k.name, prefix: k.prefix, models: k.models, dailyCap: k.dailyCap, monthlyCap: k.monthlyCap, rpm: k.rpm, status: k.status, expires: k.expiresAt ? faDate(k.expiresAt) : "", lastUsed: k.lastUsedAt ? faDateTime(k.lastUsedAt) : "", created: faDate(k.createdAt), spentToday: Number(s?.today ?? 0), spentMonth: Number(s?.month ?? 0) };
    }),
    usage: usage.map(({ u, keyName }) => ({ id: u.id, userId: o.admin ? u.userId : "", keyName: keyName ?? (u.format === "panel" ? "پنل" : ""), model: u.model, format: u.format, stream: u.stream, status: u.status, inTokens: u.inTokens, outTokens: u.outTokens, charged: u.charged, estimated: u.estimated, latencyMs: u.latencyMs, error: o.admin ? u.error : "", at: faDateTime(u.createdAt) })),
    stats: {
      todayCount: today?.count ?? 0, todaySpend: Number(today?.spend ?? 0), monthCount: mon?.count ?? 0, monthSpend: Number(mon?.spend ?? 0),
      daily: daily.map((d) => ({ day: faDate(new Date(d.day + "T12:00:00")), count: d.count, spend: Number(d.spend) })),
      byModel: byModel.map((b) => ({ model: b.model, count: b.count, spend: Number(b.spend) })),
    },
    endpoint: aiEndpoint(),
    upstream: o.admin ? aiUpstream().name : "",
  };
}
