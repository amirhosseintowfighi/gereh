/* Object Storage: shared server logic for RPC handlers, the public API and the worker. */
import "server-only";
import { resolveCname } from "node:dns/promises";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { hourlyOf } from "@/lib/paas";
import { GB, STORAGE_PLAN_DEFAULTS } from "@/lib/storage";
import type { DB, Tx } from "../db/client";
import { storageBuckets, storageDomains, storageKeys, storagePlans, storageUsage, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { open } from "../secrets";
import { notify, rid } from "../util";
import { cnameTarget, storage, type BucketConfig } from "./driver";

export type BucketRow = typeof storageBuckets.$inferSelect;
export type KeyRow = typeof storageKeys.$inferSelect;

export const seedStoragePlans = (db: DB | Tx) => db.insert(storagePlans).values(STORAGE_PLAN_DEFAULTS.map((p, i) => ({ ...p, position: i }))).onConflictDoNothing();
export const loadStoragePlans = (db: DB | Tx) => db.select().from(storagePlans).orderBy(asc(storagePlans.position));

export const bucketHourly = (plan: { price: number } | undefined) => (plan ? hourlyOf(plan.price) : 0);

export async function bucketConfig(db: DB | Tx, b: BucketRow): Promise<BucketConfig> {
  const [plan] = await db.select().from(storagePlans).where(eq(storagePlans.id, b.planId));
  return { name: b.name, quotaBytes: (plan?.sizeGb ?? 20) * GB, access: b.access, versioning: b.versioning, cors: b.cors, lifecycle: b.lifecycle, suspended: b.status === "suspended" };
}
export const applyBucket = async (db: DB | Tx, b: BucketRow) => (await storage()).applyBucket(await bucketConfig(db, b));

/** pushes a key's secret and bucket scope to the backend (grants for deleted buckets are dropped) */
export async function syncKey(db: DB | Tx, k: KeyRow) {
  const ids = k.grants.map((g) => g.bucketId);
  const rows = ids.length ? await db.select({ id: storageBuckets.id, name: storageBuckets.name }).from(storageBuckets).where(and(inArray(storageBuckets.id, ids), eq(storageBuckets.userId, k.userId))) : [];
  const names = new Map(rows.map((r) => [r.id, r.name]));
  await (await storage()).upsertKey({ accessKey: k.accessKey, secretKey: open(k.secretEnc) ?? "", grants: k.grants.filter((g) => names.has(g.bucketId)).map((g) => ({ bucket: names.get(g.bucketId)!, perm: g.perm })) });
}

/* ---------- hourly billing ---------- */
/** charges every active bucket's hour; a customer out of credit has all buckets suspended
    (reads and writes denied, data kept) until the wallet holds 24 hours of their cost */
export async function storageBilling(db: DB) {
  const plans = new Map((await db.select().from(storagePlans)).map((p) => [p.id, p]));
  const active = await db.select().from(storageBuckets).where(eq(storageBuckets.status, "active"));
  const charges = new Map<string, { amount: number; names: string[] }>();
  for (const b of active) {
    const c = charges.get(b.userId) ?? { amount: 0, names: [] };
    c.amount += bucketHourly(plans.get(b.planId)); c.names.push(b.name);
    charges.set(b.userId, c);
  }
  for (const [uid, c] of charges) {
    if (c.amount <= 0) continue;
    const ok = await db.transaction(async (tx) => {
      const [u] = await tx.update(users).set({ balance: sql`${users.balance} - ${c.amount}` }).where(and(eq(users.id, uid), sql`${users.balance} >= ${c.amount}`)).returning({ id: users.id });
      if (!u) return false;
      await tx.insert(transactions).values({ id: rid("TX"), userId: uid, type: "usage", amount: -c.amount, method: "کیف پول", desc: "مصرف ساعتی فضای ذخیره‌سازی: " + c.names.slice(0, 4).join("، ") + (c.names.length > 4 ? " و…" : "") });
      return true;
    });
    if (ok) continue;
    for (const b of active.filter((x) => x.userId === uid)) {
      const [next] = await db.update(storageBuckets).set({ status: "suspended", suspendedAt: new Date(), suspendReason: "billing" }).where(eq(storageBuckets.id, b.id)).returning();
      await applyBucket(db, next).catch((e) => console.error("[storage] suspend " + b.name, e));
    }
    await notify(db, uid, "wallet", "موجودی کیف پول تمام شد؛ باکت‌های فضای ذخیره‌سازی معلق شدند");
    await enqueue(db, "notify.send", { userId: uid, kind: "billing", subject: "اتمام موجودی فضای ذخیره‌سازی", text: "موجودی کیف پول برای هزینه ساعتی باکت‌ها کافی نیست و دسترسی به آن‌ها (خواندن و نوشتن) متوقف شد؛ فایل‌ها حفظ شده‌اند. پس از شارژ کیف پول، باکت‌ها خودکار فعال می‌شوند." });
  }
  await resumeStorage(db, plans);
}

async function resumeStorage(db: DB, plans: Map<string, typeof storagePlans.$inferSelect>) {
  // only buckets suspended for credit; staff suspensions are lifted by staff
  const suspended = await db.select().from(storageBuckets).where(and(eq(storageBuckets.status, "suspended"), eq(storageBuckets.suspendReason, "billing")));
  for (const uid of new Set(suspended.map((b) => b.userId))) {
    const mine = suspended.filter((b) => b.userId === uid);
    const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
    const need = mine.reduce((s, b) => s + 24 * bucketHourly(plans.get(b.planId)), 0);
    if (!u || u.balance < need) continue;
    for (const b of mine) {
      const [next] = await db.update(storageBuckets).set({ status: "active", suspendedAt: null, suspendReason: "" }).where(eq(storageBuckets.id, b.id)).returning();
      await applyBucket(db, next).catch((e) => console.error("[storage] resume " + b.name, e));
    }
    await notify(db, uid, "play", "باکت‌های فضای ذخیره‌سازی دوباره فعال شدند");
  }
}

/* ---------- usage + custom domains (hourly) ---------- */
const today = () => new Date().toISOString().slice(0, 10);
const delta = (now: number, last: number) => (now >= last ? now - last : now); // counters reset on restart

export async function storageCollect(db: DB) {
  const buckets = await db.select().from(storageBuckets);
  const d = await storage();
  if (buckets.length) {
    const usage = new Map((await d.usage(buckets.map((b) => b.name))).map((u) => [u.name, u]));
    const day = today();
    for (const b of buckets) {
      const u = usage.get(b.name);
      if (!u) continue;
      const add = { requests: delta(u.requests, b.counters.requests), bytesIn: delta(u.bytesIn, b.counters.bytesIn), bytesOut: delta(u.bytesOut, b.counters.bytesOut) };
      await db.update(storageBuckets).set({ usedBytes: u.size, objects: u.objects, counters: { requests: u.requests, bytesIn: u.bytesIn, bytesOut: u.bytesOut }, usageAt: new Date() }).where(eq(storageBuckets.id, b.id));
      await db.insert(storageUsage).values({ bucketId: b.id, day, sizeBytes: u.size, objects: u.objects, ...add }).onConflictDoUpdate({
        target: [storageUsage.bucketId, storageUsage.day],
        set: { sizeBytes: sql`greatest(${storageUsage.sizeBytes}, ${u.size})`, objects: u.objects, requests: sql`${storageUsage.requests} + ${add.requests}`, bytesIn: sql`${storageUsage.bytesIn} + ${add.bytesIn}`, bytesOut: sql`${storageUsage.bytesOut} + ${add.bytesOut}` },
      });
    }
  }
  await db.delete(storageUsage).where(lt(storageUsage.day, new Date(Date.now() - 35 * 86400_000).toISOString().slice(0, 10)));

  // custom domains: pending ones are re-checked for 72 hours, then certificates are followed until issued
  const doms = await db.select({ dm: storageDomains, b: storageBuckets }).from(storageDomains).innerJoin(storageBuckets, eq(storageBuckets.id, storageDomains.bucketId))
    .where(inArray(storageDomains.status, ["pending", "active"]));
  for (const { dm, b } of doms) {
    if (dm.status === "pending" && Date.now() - dm.createdAt.getTime() > 72 * 3600_000) { await db.update(storageDomains).set({ status: "failed", checkedAt: new Date() }).where(eq(storageDomains.id, dm.id)); continue; }
    if (dm.status === "pending" || dm.ssl === "pending") await verifyDomain(db, dm, b);
  }
}

let cnameLookup: (host: string) => Promise<string[]> = resolveCname;
/** tests swap the DNS lookup */
export const setCnameResolver = (f: (host: string) => Promise<string[]>) => { cnameLookup = f; };

/** CNAME check, then the certificate (issued by the ingress once the CNAME resolves) */
export async function verifyDomain(db: DB | Tx, dm: typeof storageDomains.$inferSelect, b: Pick<BucketRow, "name" | "userId">) {
  const want = cnameTarget(b.name).toLowerCase();
  let ok = false;
  try { ok = (await cnameLookup(dm.host)).some((c) => c.toLowerCase().replace(/\.$/, "") === want); } catch { ok = false; }
  const ssl = ok ? await (await storage()).certStatus(dm.host) : dm.ssl;
  const [next] = await db.update(storageDomains).set({ status: ok ? "active" : dm.status === "active" ? "failed" : dm.status, ssl, checkedAt: new Date() }).where(eq(storageDomains.id, dm.id)).returning();
  if (ok && dm.status !== "active") await notify(db, b.userId, "globe", "دامنه " + dm.host + " به باکت " + b.name + " متصل شد");
  return next;
}
