/* Public status: component health from nodes + open incidents, and 90-day uptime from incident history. */
import "server-only";
import { desc, gte, inArray } from "drizzle-orm";
import { COMPONENTS } from "@/lib/status";
export { COMPONENTS };
import type { DB } from "./db/client";
import { incidents, incidentUpdates, nodes } from "./db/schema";

export type Health = "operational" | "maintenance" | "degraded" | "outage";
const RANK: Record<Health, number> = { operational: 0, maintenance: 1, degraded: 2, outage: 3 };
const fromSeverity = (s: string): Health => (s === "critical" ? "outage" : s === "major" ? "degraded" : s === "maintenance" ? "maintenance" : "degraded");

export async function statusReport(db: DB) {
  const since = new Date(Date.now() - 90 * 86400_000);
  const [nodeRows, recent] = await Promise.all([db.select().from(nodes), db.select().from(incidents).where(gte(incidents.createdAt, since)).orderBy(desc(incidents.createdAt))]);
  const updates = recent.length ? await db.select().from(incidentUpdates).where(inArray(incidentUpdates.incidentId, recent.map((i) => i.id))).orderBy(desc(incidentUpdates.createdAt)) : [];
  const open = recent.filter((i) => i.status !== "resolved" && !(i.status === "scheduled" && i.createdAt > new Date()));
  const components = COMPONENTS.map((c) => {
    let h: Health = "operational";
    const locNodes = nodeRows.filter((n) => n.loc === c.id);
    if (locNodes.length && locNodes.every((n) => n.status !== "online")) h = "maintenance";
    for (const i of open) if (i.components.includes(c.id) && RANK[fromSeverity(i.severity)] > RANK[h]) h = fromSeverity(i.severity);
    // 90 daily buckets: worst severity seen that day; uptime counts major/critical minutes as downtime
    const days = Array.from({ length: 90 }, () => "operational" as Health);
    let downMs = 0;
    for (const i of recent) {
      if (!i.components.includes(c.id) || i.severity === "maintenance") continue;
      const end = (i.resolvedAt ?? new Date()).getTime();
      if (i.severity !== "minor") downMs += Math.max(0, end - Math.max(i.createdAt.getTime(), since.getTime()));
      for (let t = Math.max(i.createdAt.getTime(), since.getTime()); t <= end; t += 86400_000) {
        const d = Math.min(89, Math.floor((t - since.getTime()) / 86400_000));
        const sev = fromSeverity(i.severity);
        if (RANK[sev] > RANK[days[d]]) days[d] = sev;
      }
    }
    const uptime = Math.max(0, 100 - (downMs / (90 * 86400_000)) * 100);
    return { ...c, health: h, uptime, days };
  });
  const overall: Health = components.reduce<Health>((w, c) => (RANK[c.health] > RANK[w] ? c.health : w), "operational");
  return {
    overall, components,
    incidents: recent.map((i) => ({ ...i, updates: updates.filter((u) => u.incidentId === i.id) })),
  };
}
