/* Datacenter locations, editable in Admin › زیرساخت. Stored in kv "locations"; every read also refreshes the
   shared catalog list (setLocs) so pricing and validation in this process use the saved locations. */
import "server-only";
import { eq } from "drizzle-orm";
import { DEFAULT_LOCS, setLocs, type Loc } from "@/lib/catalog";
import type { DB, Tx } from "./db/client";
import { kv } from "./db/schema";

export async function getLocations(db: DB | Tx): Promise<Loc[]> {
  const [row] = await db.select().from(kv).where(eq(kv.key, "locations"));
  const list = Array.isArray(row?.value) && row.value.length ? (row.value as Loc[]) : DEFAULT_LOCS.map((l) => ({ ...l }));
  setLocs(list);
  return list;
}

export async function saveLocations(db: DB | Tx, list: Loc[]) {
  await db.insert(kv).values({ key: "locations", value: list }).onConflictDoUpdate({ target: kv.key, set: { value: list } });
  setLocs(list);
}

/** the Virtualizor server group a new VPS of this kind goes to; "" when the location has none configured */
export const locationGroup = (l: Loc | undefined, kind: "cloud" | "metal") => (kind === "metal" ? l?.groupMetal || l?.groupCloud : l?.groupCloud) || "";

/** public view: no Virtualizor group names */
export const publicLocations = (list: Loc[]) => list.map(({ groupCloud: _c, groupMetal: _m, ...l }) => ({ ...l, active: l.active !== false }));
