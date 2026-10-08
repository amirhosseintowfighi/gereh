/* Geo DNS slice of /api/state */
import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { faDate, faDateTime } from "@/lib/jalali";
import type { GeoState } from "@/lib/types";
import type { DB } from "../db/client";
import { geoPlans, geoRecords, geoZones } from "../db/schema";
import { geoDriver, nameservers } from "./driver";

export const EMPTY_GEO: GeoState = { plans: [], zones: [], nameservers: [], driver: "" };

export async function geoState(db: DB, o: { uid: string; admin: boolean }): Promise<GeoState> {
  const [plans, zones] = await Promise.all([
    db.select().from(geoPlans).orderBy(asc(geoPlans.position)),
    o.admin ? db.select().from(geoZones).orderBy(desc(geoZones.createdAt)).limit(500) : db.select().from(geoZones).where(eq(geoZones.userId, o.uid)).orderBy(desc(geoZones.createdAt)),
  ]);
  const recs = zones.length ? await db.select().from(geoRecords).where(inArray(geoRecords.zoneId, zones.map((z) => z.id))).orderBy(asc(geoRecords.id)) : [];
  return {
    plans: plans.filter((p) => o.admin || p.active).map((p) => ({ id: p.id, name: p.name, price: p.price, records: p.records, healthChecks: p.healthChecks, sync: p.sync, active: p.active })),
    zones: zones.map((z) => ({
      id: z.id, userId: z.userId, domain: z.domain, planId: z.planId, status: z.status, nsOk: z.nsOk, nsSeen: z.nsSeen, nsChecked: z.nsCheckedAt ? faDateTime(z.nsCheckedAt) : "",
      healthPath: z.healthPath, syncStatus: z.syncStatus, syncLagSec: z.syncLagSec, lastSync: z.lastSyncAt ? faDateTime(z.lastSyncAt) : "", paidUntil: faDate(z.paidUntil), autoRenew: z.autoRenew, at: faDate(z.createdAt),
      syncToken: o.admin ? z.syncToken : "",
      records: recs.filter((r) => r.zoneId === z.id).map((r) => ({ id: r.id, name: r.name, type: r.type, iran: r.iran, world: r.world, ttl: r.ttl, priority: r.priority, iranUp: r.iranUp, worldUp: r.worldUp, checked: r.checkedAt ? faDateTime(r.checkedAt) : "" })),
    })),
    nameservers: nameservers(),
    driver: o.admin ? geoDriver().name : "",
  };
}
