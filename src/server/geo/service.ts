/* Geo DNS: zone → driver spec, wallet charges and nameserver delegation checks. */
import "server-only";
import { resolveNs } from "node:dns/promises";
import { and, asc, eq, sql } from "drizzle-orm";
import { GEO_PLAN_DEFAULTS } from "@/lib/geo";
import type { DB, Tx } from "../db/client";
import { geoPlans, geoRecords, geoZones, transactions, users } from "../db/schema";
import { rid } from "../util";
import { geoDriver, nameservers } from "./driver";

export const seedGeoPlans = (db: DB | Tx) => db.insert(geoPlans).values(GEO_PLAN_DEFAULTS.map((p, i) => ({ ...p, position: i }))).onConflictDoNothing();

export type ZoneRow = typeof geoZones.$inferSelect;
export const addMonth = (d: Date) => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; };

/** publishes the zone; unpaid zones are served without the geo split (plain answers) */
export async function syncZone(db: DB | Tx, z: ZoneRow) {
  const [plan] = await db.select().from(geoPlans).where(eq(geoPlans.id, z.planId));
  const records = await db.select().from(geoRecords).where(eq(geoRecords.zoneId, z.id)).orderBy(asc(geoRecords.id));
  await geoDriver().sync({ domain: z.domain, geo: z.status !== "suspended", failover: !!plan?.healthChecks, healthPath: z.healthPath, records });
}

/** debits the wallet (all or nothing) and records the transaction */
export async function charge(db: DB | Tx, userId: string, amount: number, desc: string) {
  if (amount <= 0) return true;
  const [u] = await db.update(users).set({ balance: sql`${users.balance} - ${amount}` }).where(and(eq(users.id, userId), sql`${users.balance} >= ${amount}`)).returning({ id: users.id });
  if (!u) return false;
  await db.insert(transactions).values({ id: rid("TX"), userId, type: "usage", amount: -amount, method: "کیف پول", desc });
  return true;
}

let resolver: (d: string) => Promise<string[]> = resolveNs;
/** tests swap the DNS lookup */
export const setNsResolver = (f: (d: string) => Promise<string[]>) => { resolver = f; };

/** our nameservers are authoritative for the domain at its registry */
export async function checkDelegation(domain: string) {
  const ours = nameservers().map((n) => n.toLowerCase().replace(/\.$/, ""));
  try {
    const seen = (await resolver(domain)).map((n) => n.toLowerCase().replace(/\.$/, "")).sort();
    return { ok: seen.length > 0 && seen.every((n) => ours.includes(n)), seen };
  } catch { return { ok: false, seen: [] as string[] }; }
}
