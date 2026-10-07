import "server-only";
import type { PaasPlan } from "@/lib/paas";
import { db } from "../ctx";
import { DEFAULT_PLANS, loadPlans } from "./service";

/** plans for the public pages; falls back to the defaults if the database is unreachable */
export async function publicPlans(): Promise<PaasPlan[]> {
  try {
    const rows = await loadPlans(await db());
    return rows.length ? rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, cpu: r.cpu, ramMb: r.ramMb, diskGb: r.diskGb, price: r.price, active: r.active })) : DEFAULT_PLANS;
  } catch {
    return DEFAULT_PLANS;
  }
}
