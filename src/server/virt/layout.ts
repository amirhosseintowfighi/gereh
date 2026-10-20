/* Disk layout: the disk GB a server's plan covers (its allowance) split into disks, e.g. 80 GB as sda 30 + sdb 50.
   The primary disk is servers.disk; the other disks of the layout are vps_disks rows with billed=false (never
   charged: the plan price covers the allowance). Disks bought separately (billed=true) are not part of it. */
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { servers, vpsDisks, vpsLayouts } from "../db/schema";
import { fail } from "../util";

type Server = typeof servers.$inferSelect;
export const MIN_PRIMARY_GB = 10, MIN_DISK_GB = 5;

/** the allowance and the current split; without a saved allowance it is what the server has now */
export async function layoutOf(db: DB, s: Server) {
  const [rows, [saved]] = await Promise.all([
    db.select().from(vpsDisks).where(and(eq(vpsDisks.serverId, s.id), isNull(vpsDisks.goneAt))).orderBy(asc(vpsDisks.slot), asc(vpsDisks.createdAt)),
    db.select().from(vpsLayouts).where(eq(vpsLayouts.serverId, s.id)),
  ]);
  const free = rows.filter((r) => !r.billed);
  const current = [s.disk, ...free.map((r) => r.sizeGb)];
  const used = current.reduce((a, b) => a + b, 0);
  return { allowance: saved?.allowanceGb ?? used, saved: !!saved, used, current, free, billed: rows.filter((r) => r.billed) };
}

/** "append": only new disks from unused allowance, nothing existing changes (no data is lost);
    "rebuild": any existing disk changes size or goes away, so the disks are recreated and the OS reinstalled */
export function planLayout(current: number[], sizes: number[], allowance: number, maxDisks: number): "append" | "rebuild" {
  if (!sizes.length) fail("دست‌کم یک دیسک لازم است.");
  if (sizes.length > maxDisks) fail("حداکثر " + maxDisks.toLocaleString("fa-IR") + " دیسک.");
  if (sizes.some((x) => !Number.isInteger(x))) fail("اندازه دیسک‌ها باید عدد صحیح (گیگابایت) باشد.");
  if (sizes[0] < MIN_PRIMARY_GB) fail("دیسک اصلی دست‌کم " + MIN_PRIMARY_GB.toLocaleString("fa-IR") + " گیگابایت است.");
  if (sizes.slice(1).some((x) => x < MIN_DISK_GB)) fail("هر دیسک دست‌کم " + MIN_DISK_GB.toLocaleString("fa-IR") + " گیگابایت است.");
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum !== allowance) fail("جمع دیسک‌ها (" + sum.toLocaleString("fa-IR") + ") باید برابر سهم دیسک سرور (" + allowance.toLocaleString("fa-IR") + " گیگابایت) باشد.");
  if (sizes.length === current.length && sizes.every((x, i) => x === current[i])) fail("چیدمان دیسک تغییری نکرده است.");
  return sizes.length > current.length && current.every((x, i) => sizes[i] === x) ? "append" : "rebuild";
}

/** after a plan change to `totalGb`: on a split server the primary takes the difference so the other layout disks
    stay as they are; otherwise (no saved layout) the primary is the plan's disk, as before */
export async function primaryFor(db: DB, s: Server, totalGb: number) {
  const l = await layoutOf(db, s);
  if (!l.saved) return { primary: totalGb, allowance: s.disk, split: false };
  const extra = l.used - s.disk;
  return { primary: Math.max(MIN_PRIMARY_GB, totalGb - extra), allowance: l.allowance, split: true };
}
export async function saveAllowance(db: DB, serverId: string, allowanceGb: number) {
  await db.insert(vpsLayouts).values({ serverId, allowanceGb }).onConflictDoUpdate({ target: vpsLayouts.serverId, set: { allowanceGb, updatedAt: new Date() } });
}
