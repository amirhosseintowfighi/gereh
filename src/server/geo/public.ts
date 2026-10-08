import "server-only";
import { asc, eq } from "drizzle-orm";
import { GEO_PLAN_DEFAULTS } from "@/lib/geo";
import { db } from "../ctx";
import { geoPlans } from "../db/schema";

export async function publicGeoPlans() {
  try {
    return (await (await db()).select().from(geoPlans).where(eq(geoPlans.active, true)).orderBy(asc(geoPlans.position)))
      .map((p) => ({ id: p.id, name: p.name, price: p.price, records: p.records, healthChecks: p.healthChecks, sync: p.sync }));
  } catch {
    return GEO_PLAN_DEFAULTS;
  }
}
