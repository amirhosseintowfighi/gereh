/* Object Storage slice of /api/state: a customer gets their buckets (with 7 days of usage) and
   access keys (never secrets); staff get every bucket and the driver name. */
import "server-only";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { faDate, faDateTime } from "@/lib/jalali";
import type { StorageState } from "@/lib/types";
import type { DB } from "../db/client";
import { storageBuckets, storageDomains, storageKeys, storagePlans, storageUsage } from "../db/schema";
import { cnameTarget, storage, storageEndpoint, storageRegion } from "./driver";
import { bucketHourly } from "./service";

export const EMPTY_STORAGE: StorageState = { plans: [], buckets: [], keys: [], endpoint: "", region: "", driver: "" };

export async function storageState(db: DB, o: { uid: string; admin: boolean }): Promise<StorageState> {
  const [plans, buckets, keys] = await Promise.all([
    db.select().from(storagePlans).orderBy(asc(storagePlans.position)),
    o.admin ? db.select().from(storageBuckets).orderBy(desc(storageBuckets.createdAt)).limit(500) : db.select().from(storageBuckets).where(eq(storageBuckets.userId, o.uid)).orderBy(asc(storageBuckets.createdAt)),
    o.admin ? [] : db.select().from(storageKeys).where(eq(storageKeys.userId, o.uid)).orderBy(asc(storageKeys.createdAt)),
  ]);
  const ids = buckets.map((b) => b.id);
  const since = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  const [domains, usage] = await Promise.all([
    ids.length ? db.select().from(storageDomains).where(inArray(storageDomains.bucketId, ids)).orderBy(asc(storageDomains.createdAt)) : [],
    ids.length && !o.admin ? db.select().from(storageUsage).where(and(inArray(storageUsage.bucketId, ids), gte(storageUsage.day, since))).orderBy(asc(storageUsage.day)) : [],
  ]);
  const planMap = new Map(plans.map((p) => [p.id, p]));
  const d = await storage();
  return {
    plans: plans.filter((p) => o.admin || p.active).map((p) => ({ id: p.id, name: p.name, sizeGb: p.sizeGb, price: p.price, active: p.active })),
    buckets: buckets.map((b) => ({
      id: b.id, userId: b.userId, name: b.name, planId: b.planId, access: b.access, status: b.status, suspendReason: b.suspendReason, versioning: b.versioning, cors: b.cors, lifecycle: b.lifecycle,
      usedBytes: b.usedBytes, objects: b.objects, hourly: bucketHourly(planMap.get(b.planId)), at: faDate(b.createdAt), usageAt: b.usageAt ? faDateTime(b.usageAt) : "",
      publicBase: d.publicUrl(b.name, ""), cname: cnameTarget(b.name),
      domains: domains.filter((x) => x.bucketId === b.id).map((x) => ({ id: x.id, host: x.host, status: x.status, ssl: x.ssl, checked: x.checkedAt ? faDateTime(x.checkedAt) : "" })),
      usage: usage.filter((u) => u.bucketId === b.id).map((u) => ({ day: u.day, sizeBytes: u.sizeBytes, objects: u.objects, requests: u.requests, bytesIn: u.bytesIn, bytesOut: u.bytesOut })),
    })),
    keys: keys.map((k) => ({ id: k.id, name: k.name, accessKey: k.accessKey, grants: k.grants.filter((g) => ids.includes(g.bucketId)), at: faDate(k.createdAt), rotated: k.rotatedAt ? faDateTime(k.rotatedAt) : "" })),
    endpoint: storageEndpoint(), region: storageRegion(),
    driver: o.admin ? d.name : "",
  };
}
