import "server-only";
import { asc, eq } from "drizzle-orm";
import { STORAGE_PLAN_DEFAULTS, type StoragePlan } from "@/lib/storage";
import { db } from "../ctx";
import { storagePlans } from "../db/schema";

/** plans for the public page; falls back to the defaults if the database is unreachable */
export async function publicStoragePlans(): Promise<StoragePlan[]> {
  try {
    const rows = await (await db()).select().from(storagePlans).where(eq(storagePlans.active, true)).orderBy(asc(storagePlans.position));
    return rows.length ? rows.map((p) => ({ id: p.id, name: p.name, sizeGb: p.sizeGb, price: p.price, active: p.active })) : STORAGE_PLAN_DEFAULTS;
  } catch {
    return STORAGE_PLAN_DEFAULTS;
  }
}
