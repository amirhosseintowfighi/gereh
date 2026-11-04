/* Public status: component health from nodes, health checks and open incidents; 90-day uptime from the
   recorded health checks only (statusChecks, written by the worker every 5 minutes). A component without
   enough checks shows «داده کافی نیست» (uptime null), never an assumed 100%. */
import "server-only";
import { and, desc, gte, inArray, lt } from "drizzle-orm";
import { COMPONENTS } from "@/lib/status";
export { COMPONENTS };
import type { DB } from "./db/client";
import { incidents, incidentUpdates, nodes, statusChecks } from "./db/schema";
import { virt } from "./virt/driver";

export type Health = "operational" | "maintenance" | "degraded" | "outage";
export type Day = Health | "nodata";
const RANK: Record<Day, number> = { nodata: -1, operational: 0, maintenance: 1, degraded: 2, outage: 3 };
const fromSeverity = (s: string): Health => (s === "critical" ? "outage" : s === "major" ? "degraded" : s === "maintenance" ? "maintenance" : "degraded");
const DAY = 86400_000;
/** fewer checks than this (one hour of 5-minute checks) is not enough to state an uptime */
export const MIN_CHECKS = 12;

export async function statusReport(db: DB, now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [nodeRows, recent, checks] = await Promise.all([
    db.select().from(nodes),
    db.select().from(incidents).where(gte(incidents.createdAt, since)).orderBy(desc(incidents.createdAt)),
    db.select({ component: statusChecks.component, ok: statusChecks.ok, at: statusChecks.createdAt }).from(statusChecks).where(gte(statusChecks.createdAt, since)),
  ]);
  const updates = recent.length ? await db.select().from(incidentUpdates).where(inArray(incidentUpdates.incidentId, recent.map((i) => i.id))).orderBy(desc(incidentUpdates.createdAt)) : [];
  const open = recent.filter((i) => i.status !== "resolved" && !(i.status === "scheduled" && i.createdAt > now));
  const bucket = (t: number) => Math.min(89, Math.max(0, Math.floor((t - since.getTime()) / DAY)));
  const components = COMPONENTS.map((c) => {
    let h: Health = "operational";
    const locNodes = nodeRows.filter((n) => n.loc === c.id);
    if (locNodes.length && locNodes.every((n) => n.status !== "online")) h = "maintenance";
    for (const i of open) if (i.components.includes(c.id) && RANK[fromSeverity(i.severity)] > RANK[h]) h = fromSeverity(i.severity);
    // 90 daily buckets from the checks: no check that day = no data; any failed check = degraded, all failed = outage
    const mine = checks.filter((k) => k.component === c.id);
    const tally = Array.from({ length: 90 }, () => ({ ok: 0, all: 0 }));
    for (const k of mine) { const d = tally[bucket(k.at.getTime())]; d.all++; if (k.ok) d.ok++; }
    const days: Day[] = tally.map((d) => (!d.all ? "nodata" : d.ok === d.all ? "operational" : d.ok === 0 ? "outage" : "degraded"));
    // incidents staff posted mark their days too (worst wins)
    for (const i of recent) {
      if (!i.components.includes(c.id) || i.severity === "maintenance") continue;
      const end = (i.resolvedAt ?? now).getTime();
      for (let t = Math.max(i.createdAt.getTime(), since.getTime()); t <= end; t += DAY) {
        const d = bucket(t), sev = fromSeverity(i.severity);
        if (RANK[sev] > RANK[days[d]]) days[d] = sev;
      }
    }
    const ok = mine.filter((k) => k.ok).length;
    const latest = mine.reduce<(typeof mine)[number] | null>((a, k) => (!a || k.at > a.at ? k : a), null);
    if (latest && !latest.ok && now.getTime() - latest.at.getTime() < 15 * 60_000 && RANK.degraded > RANK[h]) h = "degraded";
    return { ...c, health: h, checks: mine.length, uptime: mine.length >= MIN_CHECKS ? (ok / mine.length) * 100 : null, days };
  });
  const overall: Health = components.reduce<Health>((w, c) => (RANK[c.health] > RANK[w] ? c.health : w), "operational");
  return {
    overall, components,
    incidents: recent.map((i) => ({ ...i, updates: updates.filter((u) => u.incidentId === i.id) })),
  };
}

const PDNS_TIMEOUT = 5000;
/** worker, every 5 minutes: one real check per component that can be checked from here; a component with no
    way to check it (no credentials, no nodes) records nothing and its uptime stays «داده کافی نیست» */
export async function statusCheck(db: DB) {
  const rows: (typeof statusChecks.$inferInsert)[] = [];
  // the panel and API: this process and its database answered (an outage of the site itself leaves a gap: no data)
  rows.push({ component: "panel", ok: true, detail: "heartbeat" });
  // locations: Virtualizor answered its server list and this location's hypervisors are in it
  const v = await virt();
  const nodeRows = await db.select({ id: nodes.id, loc: nodes.loc }).from(nodes);
  if (v.name !== ("unconfigured" as string) && nodeRows.length) {
    let seen: Set<string> | null = null, why = "";
    try { seen = new Set((await v.servers()).map((s) => s.name)); } catch (e) { why = (e as Error).message.slice(0, 200); }
    for (const loc of new Set(nodeRows.map((n) => n.loc))) {
      if (!COMPONENTS.some((c) => c.id === loc)) continue;
      const mine = nodeRows.filter((n) => n.loc === loc);
      const up = seen ? mine.filter((n) => seen!.has(n.id)).length : 0;
      rows.push({ component: loc, ok: up > 0, detail: seen ? up + "/" + mine.length + " hypervisors" : "Virtualizor: " + why });
    }
  }
  // DNS: the PowerDNS API answers
  if (process.env.PDNS_URL && process.env.PDNS_API_KEY) {
    let ok = false, detail = "";
    try {
      const r = await fetch(process.env.PDNS_URL.replace(/\/$/, "") + "/api/v1/servers/localhost", { headers: { "X-API-Key": process.env.PDNS_API_KEY }, signal: AbortSignal.timeout(PDNS_TIMEOUT) });
      ok = r.ok; detail = "HTTP " + r.status;
    } catch (e) { detail = (e as Error).message.slice(0, 200); }
    rows.push({ component: "dns", ok, detail });
  }
  await db.insert(statusChecks).values(rows);
  await db.delete(statusChecks).where(and(lt(statusChecks.createdAt, new Date(Date.now() - 92 * DAY))));
}
