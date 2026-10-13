/* Gereh Apps operator tools in the worker: log and traffic collection with the hourly metric rollup
   (every 5 minutes), daily disk backups (the last 3 automatic ones are kept) and log retention, and
   the disk backup / restore jobs. */
import "server-only";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { paasApps, paasDiskBackups, paasDisks } from "../db/schema";
import { enqueue } from "../jobs";
import { collectLogs, collectMetrics, pruneLogs } from "../paas/observe";
import { logEvent } from "../paas/runtime";
import { appSpec } from "../paas/service";
import { paasTools } from "../paas/tools";
import { notify, rid } from "../util";

export const AUTO_KEEP = 3;

export async function paasToolsCollect(db: DB) {
  const apps = await db.select().from(paasApps).where(eq(paasApps.status, "running"));
  await collectLogs(db, apps);
  await collectMetrics(db, apps);
}

export async function paasToolsDaily(db: DB) {
  await pruneLogs(db);
  const disks = await db.select({ d: paasDisks }).from(paasDisks).innerJoin(paasApps, eq(paasApps.id, paasDisks.appId))
    .where(and(eq(paasDisks.backups, true), eq(paasApps.status, "running")));
  for (const { d } of disks) {
    const [busy] = await db.select({ id: paasDiskBackups.id }).from(paasDiskBackups).where(and(eq(paasDiskBackups.diskId, d.id), inArray(paasDiskBackups.status, ["running", "restoring"])));
    if (busy) continue;
    const id = rid("dbk");
    await db.insert(paasDiskBackups).values({ id, diskId: d.id, kind: "auto" });
    await enqueue(db, "paas.diskBackup", { backupId: id });
  }
  // stuck jobs (worker restarted mid-way)
  await db.update(paasDiskBackups).set({ status: "failed", error: "interrupted" }).where(and(eq(paasDiskBackups.status, "running"), lt(paasDiskBackups.createdAt, new Date(Date.now() - 12 * 3600_000))));
}

/** backs up (or restores from) one disk backup */
export async function paasDiskBackup(db: DB, p: { backupId: string; restore?: boolean }) {
  const [row] = await db.select({ b: paasDiskBackups, d: paasDisks, a: paasApps }).from(paasDiskBackups)
    .innerJoin(paasDisks, eq(paasDisks.id, paasDiskBackups.diskId)).innerJoin(paasApps, eq(paasApps.id, paasDisks.appId)).where(eq(paasDiskBackups.id, p.backupId));
  if (!row) return;
  const { b, d, a } = row, t = paasTools(), spec = await appSpec(db, a), ref = { name: d.name, mount: d.mountPath };
  if (p.restore) {
    try {
      await t.restoreDisk(spec, ref, b.location);
      await db.update(paasDiskBackups).set({ status: "done" }).where(eq(paasDiskBackups.id, b.id));
      await logEvent(db, a.id, "restart", "بازگردانی دیسک " + d.name + " از پشتیبان");
      await notify(db, a.userId, "archive-restore", "دیسک " + d.name + " اپ " + a.name + " از پشتیبان بازگردانی شد");
    } catch (e) {
      await db.update(paasDiskBackups).set({ status: "done", error: "restore: " + (e as Error).message.slice(0, 300) }).where(eq(paasDiskBackups.id, b.id));
      await notify(db, a.userId, "circle-alert", "بازگردانی دیسک " + d.name + " اپ " + a.name + " ناموفق بود");
    }
    return;
  }
  try {
    const r = await t.backupDisk(spec, ref, b.id);
    await db.update(paasDiskBackups).set({ status: "done", sizeMb: r.sizeMb, location: r.location, error: "" }).where(eq(paasDiskBackups.id, b.id));
  } catch (e) {
    await db.update(paasDiskBackups).set({ status: "failed", error: (e as Error).message.slice(0, 300) }).where(eq(paasDiskBackups.id, b.id));
    if (b.kind === "manual") await notify(db, a.userId, "circle-alert", "پشتیبان‌گیری از دیسک " + d.name + " اپ " + a.name + " ناموفق بود");
    return;
  }
  if (b.kind === "auto") {
    const old = (await db.select().from(paasDiskBackups).where(and(eq(paasDiskBackups.diskId, d.id), eq(paasDiskBackups.kind, "auto"), eq(paasDiskBackups.status, "done"))).orderBy(desc(paasDiskBackups.createdAt))).slice(AUTO_KEEP);
    for (const o of old) {
      await t.deleteBackup(o.location).catch(() => undefined);
      await db.delete(paasDiskBackups).where(eq(paasDiskBackups.id, o.id));
    }
  }
}
