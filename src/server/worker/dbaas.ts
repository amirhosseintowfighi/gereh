/* Managed database extras in the background: first-run setup (engine init, extensions, restoring a
   backup into a new database), dump imports and the expiry of temporary admin panels. */
import "server-only";
import { rm } from "node:fs/promises";
import { and, eq, lte } from "drizzle-orm";
import type { DB } from "../db/client";
import { paasDbImports, paasDbPanels, paasDbs } from "../db/schema";
import { enqueue } from "../jobs";
import { dbaas } from "../paas/dbaas";
import { configOf, dbEvent, saveConfig } from "../paas/dbaas-service";
import { paas } from "../paas/driver";
import { dbSpec, signSource } from "../paas/service";
import { notify } from "../util";

const pollMs = () => Number(process.env.PAAS_POLL_MS ?? 3000);
const later = (ms: number) => new Date(Date.now() + ms);
const SETUP_TIMEOUT_MS = 20 * 60_000;

/** waits for the database, then runs what a new (or changed) database still needs */
export async function dbaasInit(db: DB, p: { dbId: string; since: number }) {
  const [row] = await db.select().from(paasDbs).where(eq(paasDbs.id, p.dbId));
  if (!row || row.status === "failed" || row.status === "suspended") return;
  const conf = await configOf(db, row.id);
  const d = await paas();
  const spec = await dbSpec(db, row);
  if (row.status !== "running" || !(await d.dbReady(spec))) {
    if (Date.now() - p.since < SETUP_TIMEOUT_MS) await enqueue(db, "dbaas.init", p, { runAt: later(pollMs()) });
    else await dbEvent(db, row.id, "راه‌اندازی اولیه انجام نشد: پایگاه داده آماده نشد", "error");
    return;
  }
  const x = dbaas();
  try {
    if (!conf.initialized) {
      await x.init(spec);
      await saveConfig(db, row.id, { initialized: true });
      await dbEvent(db, row.id, "پایگاه داده آماده شد");
    }
    if (conf.extensions.length) await x.applyExtensions(spec, conf.extensions, []);
  } catch (e) {
    // the server may still be warming up (JVM engines, SQL Server): try again until the deadline
    if (Date.now() - p.since < SETUP_TIMEOUT_MS) { await enqueue(db, "dbaas.init", p, { runAt: later(pollMs() * 5) }); return; }
    await dbEvent(db, row.id, "راه‌اندازی اولیه ناموفق بود: " + (e as Error).message, "error");
    return;
  }
  if (conf.seed?.status === "pending") {
    try {
      await d.restoreDb(spec, conf.seed.location);
      await saveConfig(db, row.id, { seed: { ...conf.seed, status: "done" } });
      await dbEvent(db, row.id, "پشتیبان «" + conf.seed.from + "» در این پایگاه داده بازگردانی شد");
      await notify(db, row.userId, "database-backup", "پشتیبان " + conf.seed.from + " در پایگاه داده جدید " + row.name + " بازگردانی شد");
    } catch (e) {
      await saveConfig(db, row.id, { seed: { ...conf.seed, status: "failed", detail: (e as Error).message.slice(0, 300) } });
      await dbEvent(db, row.id, "بازگردانی پشتیبان ناموفق بود: " + (e as Error).message, "error");
      await notify(db, row.userId, "circle-alert", "بازگردانی پشتیبان در " + row.name + " انجام نشد");
    }
  }
}

/** loads an uploaded dump; the file is deleted afterwards either way */
export async function dbaasImport(db: DB, p: { importId: string }) {
  const [imp] = await db.select().from(paasDbImports).where(eq(paasDbImports.id, p.importId));
  if (!imp || imp.status !== "queued") return;
  const [row] = await db.select().from(paasDbs).where(eq(paasDbs.id, imp.dbId));
  if (!row) return;
  await db.update(paasDbImports).set({ status: "running" }).where(eq(paasDbImports.id, imp.id));
  const { exp, sig } = signSource(imp.id, 3 * 3600);
  const url = (process.env.PAAS_SOURCE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000") + "/api/dbaas/import/" + imp.id + "?exp=" + exp + "&sig=" + sig;
  let ok = true, output: string;
  try { output = await dbaas().importDump(await dbSpec(db, row), { id: imp.id, format: imp.format as never, url, path: imp.filePath, sizeBytes: imp.sizeBytes }); }
  catch (e) { ok = false; output = (e as Error).message; }
  await db.update(paasDbImports).set({ status: ok ? "succeeded" : "failed", output: output.slice(-20_000), finishedAt: new Date() }).where(eq(paasDbImports.id, imp.id));
  await rm(imp.filePath, { force: true });
  await dbEvent(db, row.id, ok ? "فایل پشتیبان بارگذاری‌شده وارد شد" : "ورود فایل پشتیبان ناموفق بود", ok ? "info" : "error");
  await notify(db, row.userId, ok ? "upload" : "circle-alert", (ok ? "ورود داده به " : "ورود داده ناموفق بود: ") + row.name);
}

/** every 5 minutes: remove admin panels whose time is up */
export async function dbaasExpire(db: DB) {
  const due = await db.select({ p: paasDbPanels, d: paasDbs }).from(paasDbPanels).innerJoin(paasDbs, eq(paasDbs.id, paasDbPanels.dbId))
    .where(and(eq(paasDbPanels.status, "ready"), lte(paasDbPanels.expiresAt, new Date())));
  const x = dbaas();
  for (const { p, d } of due) {
    await x.closePanel(await dbSpec(db, d), { id: p.id, tool: p.tool });
    await db.update(paasDbPanels).set({ status: "expired" }).where(eq(paasDbPanels.id, p.id));
    await dbEvent(db, d.id, "پنل مدیریت " + p.tool + " منقضی و حذف شد");
  }
  return due.length;
}
