/* Logs and metrics history of apps.
   Logs are stored in Postgres (paas_logs): the worker copies new lines from the driver every 5
   minutes, search is a time-range scan of the (app_id, at) index with an ILIKE filter, and the daily
   job deletes lines older than the plan's log_days. That needs no extra service, is backed up with
   the database and is plenty for a panel's search; a busy app is capped per collection
   (LOG_BATCH) so one noisy app cannot flood the table. */
import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { logLevel, METRIC_RANGES, type LogLevel, type MetricRange } from "@/lib/paas-tools";
import type { DB, Tx } from "../db/client";
import { paasAppTools, paasApps, paasLogs, paasMetrics, paasMetricsHourly, paasNetSamples, paasPlans } from "../db/schema";
import { paas } from "./driver";
import { appSpec } from "./service";
import { paasTools } from "./tools";

export const LOG_BATCH = 5000;
type AppRow = typeof paasApps.$inferSelect;

/** copies new log lines of running apps into paas_logs */
export async function collectLogs(db: DB, apps: AppRow[]) {
  const t = paasTools();
  for (const app of apps) {
    if (!app.liveDeployment) continue;
    const [row] = await db.select({ cursor: paasAppTools.logsCursor }).from(paasAppTools).where(eq(paasAppTools.appId, app.id));
    // first collection: the last 10 minutes
    const since = row?.cursor ?? new Date(Date.now() - 10 * 60_000);
    let lines;
    try { lines = await t.logsSince(await appSpec(db, app), since, LOG_BATCH); } catch { continue; }
    if (lines.length) {
      for (let i = 0; i < lines.length; i += 500) {
        await db.insert(paasLogs).values(lines.slice(i, i + 500).map((l) => ({ appId: app.id, at: l.at, level: logLevel(l.line), instance: l.instance.slice(-40), line: l.line.slice(0, 8000) })));
      }
    }
    const cursor = lines.length ? lines[lines.length - 1].at : since;
    await db.insert(paasAppTools).values({ appId: app.id, logsCursor: cursor }).onConflictDoUpdate({ target: paasAppTools.appId, set: { logsCursor: cursor } });
  }
}

/** deletes log lines past each app plan's retention */
export async function pruneLogs(db: DB) {
  const plans = await db.select({ id: paasPlans.id, days: paasPlans.logDays }).from(paasPlans).where(eq(paasPlans.kind, "app"));
  for (const p of plans) {
    const ids = (await db.select({ id: paasApps.id }).from(paasApps).where(eq(paasApps.planId, p.id))).map((a) => a.id);
    if (ids.length) await db.delete(paasLogs).where(and(inArray(paasLogs.appId, ids), lt(paasLogs.at, new Date(Date.now() - Math.max(1, p.days) * 86400_000))));
  }
}

export type LogQuery = { q?: string; levels?: LogLevel[]; from?: Date; to?: Date; before?: number; limit: number };
const like = (q: string) => "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
/** newest first; `before` pages to older lines */
export function searchLogs(db: DB | Tx, appId: string, o: LogQuery) {
  const conds = [eq(paasLogs.appId, appId)];
  if (o.from) conds.push(gte(paasLogs.at, o.from));
  if (o.to) conds.push(lte(paasLogs.at, o.to));
  if (o.levels?.length && o.levels.length < 4) conds.push(inArray(paasLogs.level, o.levels));
  if (o.q) conds.push(sql`${paasLogs.line} ilike ${like(o.q)}`);
  if (o.before) conds.push(lt(paasLogs.id, o.before));
  return db.select().from(paasLogs).where(and(...conds)).orderBy(desc(paasLogs.at), desc(paasLogs.id)).limit(o.limit);
}

/* ---------- metrics history ---------- */
/** traffic samples and the hourly rollup (every 5 minutes, with paas.collect's samples) */
export async function collectMetrics(db: DB, apps: AppRow[]) {
  if (apps.length) {
    const bytes = await (await paas()).traffic(apps.map((a) => ({ id: a.id, owner: a.userId, name: a.name }))).catch(() => new Map<string, number>());
    const rows = apps.filter((a) => bytes.has(a.id)).map((a) => ({ appId: a.id, bytes: Math.round(bytes.get(a.id)!) }));
    if (rows.length) await db.insert(paasNetSamples).values(rows);
  }
  // averages of the last two complete hours (re-run safe); 30-day charts read these
  const hour = new Date(Math.floor(Date.now() / 3600_000) * 3600_000);
  for (const h of [new Date(hour.getTime() - 7200_000), new Date(hour.getTime() - 3600_000)]) {
    const end = new Date(h.getTime() + 3600_000);
    const m = await db.select({ target: paasMetrics.target, cpu: sql<number>`avg(${paasMetrics.cpu})`, ramMb: sql<number>`avg(${paasMetrics.ramMb})`, rpm: sql<number>`avg(${paasMetrics.rpm})` })
      .from(paasMetrics).where(and(gte(paasMetrics.createdAt, h), lt(paasMetrics.createdAt, end))).groupBy(paasMetrics.target);
    const net = new Map((await db.select({ appId: paasNetSamples.appId, bytes: sql<number>`sum(${paasNetSamples.bytes})` }).from(paasNetSamples)
      .where(and(gte(paasNetSamples.createdAt, h), lt(paasNetSamples.createdAt, end))).groupBy(paasNetSamples.appId)).map((x) => [x.appId, Number(x.bytes)]));
    if (m.length) await db.insert(paasMetricsHourly).values(m.map((x) => ({ target: x.target, hour: h, cpu: Number(x.cpu), ramMb: Number(x.ramMb), rpm: Number(x.rpm), netBytes: net.get(x.target) ?? 0 })))
      .onConflictDoUpdate({ target: [paasMetricsHourly.target, paasMetricsHourly.hour], set: { cpu: sql`excluded.cpu`, ramMb: sql`excluded.ram_mb`, rpm: sql`excluded.rpm`, netBytes: sql`excluded.net_bytes` } });
  }
  await db.delete(paasNetSamples).where(lt(paasNetSamples.createdAt, new Date(Date.now() - 8 * 86400_000)));
  await db.delete(paasMetricsHourly).where(lt(paasMetricsHourly.hour, new Date(Date.now() - 31 * 86400_000)));
}

export type MetricPoint = { t: number; cpu: number; ramMb: number; rpm: number; netBytes: number };
/** chart points of one app: bucketed averages (CPU, RAM, requests/min) and summed traffic */
export async function metricSeries(db: DB | Tx, appId: string, range: MetricRange): Promise<MetricPoint[]> {
  const r = METRIC_RANGES[range], since = new Date(Date.now() - r.ms), n = r.bucketSec;
  const bucket = (col: unknown) => sql<number>`floor(extract(epoch from ${col}) / ${sql.raw(String(n))}) * ${sql.raw(String(n))}`;
  const points = new Map<number, MetricPoint>();
  const at = (t: number) => points.get(t) ?? points.set(t, { t: t * 1000, cpu: 0, ramMb: 0, rpm: 0, netBytes: 0 }).get(t)!;
  if (r.hourly) {
    const b = bucket(paasMetricsHourly.hour);
    for (const x of await db.select({ b, cpu: sql<number>`avg(${paasMetricsHourly.cpu})`, ram: sql<number>`avg(${paasMetricsHourly.ramMb})`, rpm: sql<number>`avg(${paasMetricsHourly.rpm})`, net: sql<number>`sum(${paasMetricsHourly.netBytes})` })
      .from(paasMetricsHourly).where(and(eq(paasMetricsHourly.target, appId), gte(paasMetricsHourly.hour, since))).groupBy(b).orderBy(asc(b))) Object.assign(at(Number(x.b)), { cpu: Number(x.cpu), ramMb: Number(x.ram), rpm: Number(x.rpm), netBytes: Number(x.net) });
  } else {
    const b = bucket(paasMetrics.createdAt);
    for (const x of await db.select({ b, cpu: sql<number>`avg(${paasMetrics.cpu})`, ram: sql<number>`avg(${paasMetrics.ramMb})`, rpm: sql<number>`avg(${paasMetrics.rpm})` })
      .from(paasMetrics).where(and(eq(paasMetrics.target, appId), gte(paasMetrics.createdAt, since))).groupBy(b).orderBy(asc(b))) Object.assign(at(Number(x.b)), { cpu: Number(x.cpu), ramMb: Number(x.ram), rpm: Number(x.rpm) });
    const nb = bucket(paasNetSamples.createdAt);
    for (const x of await db.select({ b: nb, net: sql<number>`sum(${paasNetSamples.bytes})` }).from(paasNetSamples).where(and(eq(paasNetSamples.appId, appId), gte(paasNetSamples.createdAt, since))).groupBy(nb)) at(Number(x.b)).netBytes = Number(x.net);
  }
  return [...points.values()].sort((a, b) => a.t - b.t).map((p) => ({ ...p, cpu: Math.round(p.cpu * 10) / 10, ramMb: Math.round(p.ramMb), rpm: Math.round(p.rpm * 10) / 10 }));
}
