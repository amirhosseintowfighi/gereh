/* Gereh Apps background jobs. Builds and rollouts are started once and then polled with short
   follow-up jobs, so a long build never blocks the worker. */
import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { faDate } from "@/lib/jalali";
import { hourlyOf } from "@/lib/paas";
import type { DB } from "../db/client";
import { paasApps, paasDbBackups, paasDbs, paasDeployments, paasDomains, paasJobs, paasLinks, paasMetrics, paasPlans, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { type ComposeService, ComposeError, composeFromZip } from "../paas/compose";
import { paas, type AppSpec, type PaasDriver } from "../paas/driver";
import { applyManifest, manifestFromZip, parseManifest } from "../paas/manifest";
import { appHourly, appSpec, dbHourly, dbSpec, previewSpec, redeployConfig, signSource } from "../paas/service";
import { notify, rid } from "../util";
import { ZipError } from "../unzip";

const MAX_LOG = 200_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
const ROLLOUT_TIMEOUT_MS = 10 * 60_000;
const pollMs = () => Number(process.env.PAAS_POLL_MS ?? 3000);
const later = (ms: number) => new Date(Date.now() + ms);

async function fail(db: DB, depId: string, appId: string, log: string) {
  const [dep] = await db.update(paasDeployments).set({ status: "failed", log: log.slice(-MAX_LOG), finishedAt: new Date() }).where(eq(paasDeployments.id, depId)).returning();
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, appId));
  if (!app) return;
  const preview = dep?.target === "preview";
  // an app that was live keeps serving the previous deployment; a failed preview never touches production
  if (!preview) await db.update(paasApps).set({ status: app.liveDeployment ? "running" : "failed" }).where(eq(paasApps.id, appId));
  const what = preview ? "پیش‌نمایش " + app.name : "استقرار " + app.name;
  await notify(db, app.userId, "circle-alert", what + " ناموفق بود");
  await enqueue(db, "notify.send", { userId: app.userId, kind: "service", subject: what + " ناموفق بود", text: "بیلد یا اجرای نسخه جدید اپ " + app.name + " با خطا متوقف شد؛ نسخه قبلی (اگر بود) همچنان فعال است. لاگ کامل در پنل گره › اپ‌ها." });
}

/** the spec a deployment runs with: production, or the preview workload built from its branch */
async function specFor(db: DB, app: typeof paasApps.$inferSelect, dep: typeof paasDeployments.$inferSelect) {
  const spec = await appSpec(db, app);
  return dep.target === "preview" ? previewSpec(spec, dep.branch) : spec;
}

/** release command as a one-off job, then the rollout (phase "release" of paasPoll) */
async function startRelease(db: DB, d: PaasDriver, spec: AppSpec, app: typeof paasApps.$inferSelect, dep: typeof paasDeployments.$inferSelect, image: string, log: string, ref?: string) {
  const jobId = rid("job");
  await db.insert(paasJobs).values({ id: jobId, appId: app.id, kind: "release", command: spec.releaseCommand, deploymentId: dep.id });
  await db.update(paasDeployments).set({ status: "deploying", image, ref: ref ?? dep.ref, log: (log + "\n==> Release command: " + spec.releaseCommand).slice(-MAX_LOG) }).where(eq(paasDeployments.id, dep.id));
  try { await d.runJob(spec, image, jobId, spec.releaseCommand); }
  catch (e) { await db.update(paasJobs).set({ status: "failed", output: (e as Error).message, finishedAt: new Date() }).where(eq(paasJobs.id, jobId)); return fail(db, dep.id, app.id, log + "\nERROR: release command could not start: " + (e as Error).message); }
  await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "release", jobId, image, since: Date.now() }, { runAt: later(pollMs()) });
}

/** step 1: start the build (or, for rollback/config/promote, release an existing image directly) */
export async function paasBuild(db: DB, p: { deploymentId: string }) {
  const [dep] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, p.deploymentId));
  if (!dep || dep.status !== "queued") return;
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, dep.appId));
  if (!app || app.status === "suspended") { await db.update(paasDeployments).set({ status: "cancelled", finishedAt: new Date() }).where(eq(paasDeployments.id, dep.id)); return; }
  const d = await paas();
  const spec = await specFor(db, app, dep);
  await db.update(paasDeployments).set({ status: dep.image ? "deploying" : "building", startedAt: new Date() }).where(eq(paasDeployments.id, dep.id));
  if (!app.liveDeployment && dep.target === "production") await db.update(paasApps).set({ status: "building" }).where(eq(paasApps.id, app.id));
  if (dep.image) {
    // a promoted preview has not run the release command against production data yet
    if (dep.trigger === "promote" && spec.releaseCommand.trim() && !dep.image.startsWith("compose:")) return startRelease(db, d, spec, app, dep, dep.image, dep.log);
    await d.release(spec, dep.image, dep.id);
    await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "rollout", since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  let sourceUrl: string | undefined;
  if (dep.uploadPath) {
    const { exp, sig } = signSource(dep.id);
    sourceUrl = (process.env.PAAS_SOURCE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000") + "/api/paas/source/" + dep.id + "?exp=" + exp + "&sig=" + sig;
  }
  let compose: ComposeService[] | undefined, notes: string[] = [];
  if (app.source === "compose" && dep.uploadPath) {
    try { ({ services: compose, warnings: notes } = await composeFromZip(dep.uploadPath, app.rootDir)); }
    catch (e) { if (e instanceof ComposeError || e instanceof ZipError) return fail(db, dep.id, app.id, "ERROR: " + e.message); throw e; }
    notes = [compose.map((s) => (s.public ? "* " : "  ") + s.name + (s.build ? " (build " + s.build.context + ")" : " (" + s.image + ")") + (s.port ? " :" + s.port : "")).join("\n"), ...notes.map((w) => "WARN " + w)];
  }
  let handle: string;
  try { handle = await d.startBuild(spec, dep.id, sourceUrl, compose); }
  catch (e) { return fail(db, dep.id, app.id, "ERROR: " + (e as Error).message); }
  await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "build", handle, since: Date.now(), notes: notes.join("\n") }, { runAt: later(pollMs()) });
}

/** step 2: poll the build, then the release command, then the rollout */
export async function paasPoll(db: DB, p: { deploymentId: string; phase: "build" | "release" | "rollout"; handle?: string; since: number; notes?: string; jobId?: string; image?: string }) {
  const [dep] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, p.deploymentId));
  if (!dep || !["building", "deploying"].includes(dep.status)) return;
  let [app] = await db.select().from(paasApps).where(eq(paasApps.id, dep.appId));
  if (!app) return;
  const d = await paas();
  let spec = await specFor(db, app, dep);
  const preview = dep.target === "preview";
  if (p.phase === "build") {
    const b = await d.buildStatus(spec, p.handle!);
    if (p.notes) b.log = "==> Compose services\n" + p.notes + "\n" + b.log;
    if (b.state === "running") {
      if (Date.now() - p.since > BUILD_TIMEOUT_MS) return fail(db, dep.id, app.id, b.log + "\nERROR: build timed out after 30 minutes");
      await db.update(paasDeployments).set({ log: b.log.slice(-MAX_LOG) }).where(eq(paasDeployments.id, dep.id));
      await enqueue(db, "paas.poll", p, { runAt: later(pollMs()) });
      return;
    }
    if (b.state === "failed") return fail(db, dep.id, app.id, b.log);
    // gereh.json in the source: the repository decides how production runs
    const text = b.manifest ?? (dep.uploadPath ? await manifestFromZip(dep.uploadPath, app.rootDir).catch(() => undefined) : undefined);
    if (text && !preview) {
      const m = parseManifest(text);
      if (m.error) return fail(db, dep.id, app.id, b.log + "\nERROR: " + m.error);
      const changes = await applyManifest(db, app, m.manifest!);
      b.log += "\n==> gereh.json" + (changes.length ? "\n" + changes.map((c) => "    " + c).join("\n") : " (no changes)");
      [app] = await db.select().from(paasApps).where(eq(paasApps.id, app.id));
      spec = await specFor(db, app, dep);
    }
    // release command (migrations…): a one-off container from the new image, before any traffic moves
    if (spec.releaseCommand.trim() && !b.image!.startsWith("compose:")) return startRelease(db, d, spec, app, dep, b.image!, b.log, b.ref);
    await db.update(paasDeployments).set({ status: "deploying", image: b.image!, ref: b.ref ?? dep.ref, log: (b.log + "\n==> Releasing " + spec.instances + " instance(s)" + (preview ? " at https://" + spec.hosts[0] : "")).slice(-MAX_LOG) }).where(eq(paasDeployments.id, dep.id));
    await d.release(spec, b.image!, dep.id);
    await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "rollout", since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  if (p.phase === "release") {
    const j = await d.jobStatus(spec, p.jobId!);
    const out = j.output.split("\n").map((l) => "  │ " + l).join("\n");
    if (j.state === "running" && Date.now() - p.since < BUILD_TIMEOUT_MS) { await enqueue(db, "paas.poll", p, { runAt: later(pollMs()) }); return; }
    const ok = j.state === "succeeded";
    await db.update(paasJobs).set({ status: ok ? "succeeded" : "failed", output: j.output.slice(-MAX_LOG), finishedAt: new Date() }).where(eq(paasJobs.id, p.jobId!));
    if (!ok) return fail(db, dep.id, app.id, dep.log + "\n" + out + "\nERROR: release command " + (j.state === "running" ? "timed out" : "failed") + "; the previous version keeps serving");
    await db.update(paasDeployments).set({ log: (dep.log + "\n" + out + "\n==> Releasing " + spec.instances + " instance(s)").slice(-MAX_LOG) }).where(eq(paasDeployments.id, dep.id));
    await d.release(spec, p.image!, dep.id);
    await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "rollout", since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  if (!(await d.rolloutReady(spec))) {
    if (Date.now() - p.since > ROLLOUT_TIMEOUT_MS) return fail(db, dep.id, app.id, dep.log + "\nERROR: the new version did not become healthy on " + app.healthPath + " within 10 minutes");
    await enqueue(db, "paas.poll", p, { runAt: later(pollMs()) });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(paasDeployments).set({ status: "superseded" }).where(and(eq(paasDeployments.appId, app.id), eq(paasDeployments.status, "live"), eq(paasDeployments.target, dep.target)));
    await tx.update(paasDeployments).set({ status: "live", finishedAt: new Date(), log: dep.log + "\n==> Live" }).where(eq(paasDeployments.id, dep.id));
    await tx.update(paasApps).set(preview ? { previewDeployment: dep.id } : { status: "running", liveDeployment: dep.id }).where(eq(paasApps.id, app.id));
  });
  // scan freshly built images for known vulnerabilities (does not block the release)
  const [done] = await db.select({ image: paasDeployments.image }).from(paasDeployments).where(eq(paasDeployments.id, dep.id));
  if (done?.image && !done.image.startsWith("compose:") && !["config", "rollback", "promote"].includes(dep.trigger) && process.env.PAAS_SCAN !== "off") {
    await db.update(paasDeployments).set({ scanStatus: "running" }).where(eq(paasDeployments.id, dep.id));
    try { await d.startScan(spec, done.image, dep.id); await enqueue(db, "paas.scan", { deploymentId: dep.id, since: Date.now() }, { runAt: later(pollMs() * 5) }); }
    catch (e) { await db.update(paasDeployments).set({ scanStatus: "failed", scanReport: (e as Error).message }).where(eq(paasDeployments.id, dep.id)); }
  }
  if (preview) await notify(db, app.userId, "eye", "پیش‌نمایش " + app.name + " آماده است: " + spec.hosts[0]);
  else if (dep.trigger !== "config") await notify(db, app.userId, "rocket", "نسخه جدید " + app.name + " فعال شد");
}

/* ---------- image vulnerability scan ---------- */
export async function paasScan(db: DB, p: { deploymentId: string; since: number }) {
  const [dep] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, p.deploymentId));
  if (!dep || dep.scanStatus !== "running") return;
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, dep.appId));
  if (!app) return;
  const r = await (await paas()).scanStatus(await appSpec(db, app), dep.id);
  if (r.state === "running" && Date.now() - p.since < 40 * 60_000) { await enqueue(db, "paas.scan", p, { runAt: later(pollMs() * 5) }); return; }
  await db.update(paasDeployments).set({ scanStatus: r.state === "done" ? "done" : "failed", scanCritical: r.critical, scanHigh: r.high, scanReport: r.report.slice(0, 50_000) }).where(eq(paasDeployments.id, dep.id));
  if (r.critical > 0) await notify(db, app.userId, "shield-check", "در ایمیج " + app.name + " " + r.critical.toLocaleString("fa-IR") + " آسیب‌پذیری بحرانی پیدا شد؛ جزئیات در استقرارها");
}

/* ---------- weekly: restore-test the latest backup of every database ---------- */
export async function paasVerifyBackups(db: DB) {
  const d = await paas();
  for (const row of await db.select().from(paasDbs).where(eq(paasDbs.status, "running"))) {
    const [b] = await db.select().from(paasDbBackups).where(and(eq(paasDbBackups.dbId, row.id), eq(paasDbBackups.status, "done"))).orderBy(sql`${paasDbBackups.createdAt} desc`).limit(1);
    if (!b || (b.verifiedAt && Date.now() - b.verifiedAt.getTime() < 6 * 86400_000)) continue;
    const r = await d.verifyBackup(await dbSpec(db, row), b.location).catch((e) => ({ ok: false, detail: (e as Error).message }));
    await db.update(paasDbBackups).set({ verified: r.ok, verifyDetail: r.detail.slice(0, 500), verifiedAt: new Date() }).where(eq(paasDbBackups.id, b.id));
    if (!r.ok) await notify(db, row.userId, "circle-alert", "آزمون بازگردانی پشتیبان " + row.name + " ناموفق بود؛ تیم فنی بررسی می‌کند");
  }
}

/* ---------- one-off jobs (panel, CLI, API, agents) ---------- */
export async function paasJobPoll(db: DB, p: { jobId: string; since: number }) {
  const [job] = await db.select().from(paasJobs).where(eq(paasJobs.id, p.jobId));
  if (!job || job.status !== "running") return;
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, job.appId));
  if (!app) return;
  const j = await (await paas()).jobStatus(await appSpec(db, app), job.id);
  if (j.state === "running" && Date.now() - p.since < 65 * 60_000) {
    await db.update(paasJobs).set({ output: j.output.slice(-MAX_LOG) }).where(eq(paasJobs.id, job.id));
    await enqueue(db, "paas.job", p, { runAt: later(pollMs()) });
    return;
  }
  await db.update(paasJobs).set({ status: j.state === "succeeded" ? "succeeded" : "failed", output: (j.output + (j.state === "running" ? "\nERROR: timed out" : "")).slice(-MAX_LOG), finishedAt: new Date() }).where(eq(paasJobs.id, job.id));
}

/* ---------- databases ---------- */
export async function paasDbCreate(db: DB, p: { dbId: string; since?: number }) {
  const [row] = await db.select().from(paasDbs).where(eq(paasDbs.id, p.dbId));
  if (!row || row.status !== "creating") return;
  const d = await paas();
  const spec = await dbSpec(db, row);
  if (!p.since) {
    const r = await d.createDb(spec);
    await db.update(paasDbs).set({ host: r.host, port: r.port, publicPort: r.publicPort ?? null }).where(eq(paasDbs.id, row.id));
    await enqueue(db, "paas.db", { dbId: row.id, since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  if (await d.dbReady(spec)) {
    await db.update(paasDbs).set({ status: "running" }).where(eq(paasDbs.id, row.id));
    await notify(db, row.userId, "database", "پایگاه داده " + row.name + " آماده است");
    // apps linked while the database was being created get its URL now
    for (const l of await db.select().from(paasLinks).where(eq(paasLinks.dbId, row.id))) {
      const [a] = await db.select().from(paasApps).where(eq(paasApps.id, l.appId));
      if (a) await redeployConfig(db, a, "پایگاه داده " + row.name + " آماده شد");
    }
  } else if (Date.now() - p.since > ROLLOUT_TIMEOUT_MS) {
    await db.update(paasDbs).set({ status: "failed" }).where(eq(paasDbs.id, row.id));
  } else await enqueue(db, "paas.db", p, { runAt: later(pollMs()) });
}

export async function paasBackup(db: DB, p: { backupId: string; restore?: boolean }) {
  const [b] = await db.select().from(paasDbBackups).where(eq(paasDbBackups.id, p.backupId));
  if (!b) return;
  const [row] = await db.select().from(paasDbs).where(eq(paasDbs.id, b.dbId));
  if (!row) return;
  const d = await paas();
  const spec = await dbSpec(db, row);
  if (p.restore) {
    try {
      await d.restoreDb(spec, b.location);
    } catch (e) {
      // never retried automatically: a restore overwrites data
      await notify(db, row.userId, "circle-alert", "بازگردانی پایگاه داده " + row.name + " انجام نشد: " + (e as Error).message.slice(0, 200));
      console.error("[paas.backup] restore", e);
      return;
    }
    await db.update(paasDbs).set({ status: "running" }).where(eq(paasDbs.id, row.id));
    await notify(db, row.userId, "database-backup", "پایگاه داده " + row.name + " از پشتیبان " + faDate(b.createdAt) + " بازگردانی شد");
    return;
  }
  try {
    const r = await d.backupDb(spec, b.id);
    await db.update(paasDbBackups).set({ status: "done", sizeMb: r.sizeMb, location: r.location }).where(eq(paasDbBackups.id, b.id));
  } catch (e) {
    await db.update(paasDbBackups).set({ status: "failed" }).where(eq(paasDbBackups.id, b.id));
    throw e;
  }
}

/** nightly: one automatic backup per running database, 7 kept */
export async function paasDaily(db: DB) {
  const list = await db.select().from(paasDbs).where(and(eq(paasDbs.status, "running"), eq(paasDbs.backups, true)));
  for (const row of list) {
    const id = rid("bk");
    await db.insert(paasDbBackups).values({ id, dbId: row.id, kind: "auto" });
    await enqueue(db, "paas.backup", { backupId: id });
    const old = await db.select({ id: paasDbBackups.id }).from(paasDbBackups).where(and(eq(paasDbBackups.dbId, row.id), eq(paasDbBackups.kind, "auto"))).orderBy(sql`${paasDbBackups.createdAt} desc`).offset(7);
    if (old.length) await db.delete(paasDbBackups).where(inArray(paasDbBackups.id, old.map((o) => o.id)));
  }
}

/* ---------- hourly billing (wallet, pay-as-you-go) ---------- */
export async function paasBilling(db: DB) {
  const plans = new Map((await db.select().from(paasPlans)).map((p) => [p.id, p]));
  const apps = await db.select().from(paasApps).where(inArray(paasApps.status, ["running", "building", "stopped", "failed"]));
  const dbs = await db.select().from(paasDbs).where(inArray(paasDbs.status, ["running", "stopped", "creating"]));
  const charges = new Map<string, { amount: number; items: string[] }>();
  const add = (uid: string, amount: number, item: string) => { if (amount <= 0) return; const c = charges.get(uid) ?? { amount: 0, items: [] }; c.amount += amount; c.items.push(item); charges.set(uid, c); };
  for (const a of apps) { const pl = plans.get(a.planId); if (pl) add(a.userId, appHourly(a, pl), a.name); }
  for (const x of dbs) { const pl = plans.get(x.planId); if (pl) add(x.userId, dbHourly(x, pl), x.name); }
  const d = await paas();
  for (const [uid, c] of charges) {
    const ok = await db.transaction(async (tx) => {
      const [u] = await tx.update(users).set({ balance: sql`${users.balance} - ${c.amount}` }).where(and(eq(users.id, uid), sql`${users.balance} >= ${c.amount}`)).returning({ id: users.id });
      if (!u) return false;
      await tx.insert(transactions).values({ id: rid("TX"), userId: uid, type: "usage", amount: -c.amount, method: "کیف پول", desc: "مصرف ساعتی گره اپ: " + c.items.slice(0, 4).join("، ") + (c.items.length > 4 ? " و…" : "") });
      return true;
    });
    if (ok) continue;
    // out of credit: stop everything this customer runs on the platform (data is kept)
    for (const a of apps.filter((x) => x.userId === uid)) { const sp = await appSpec(db, a); await d.setState(sp, "stop"); if (a.previewDeployment) await d.setState(previewSpec(sp), "stop"); await db.update(paasApps).set({ status: "suspended", suspendedAt: new Date() }).where(eq(paasApps.id, a.id)); }
    for (const x of dbs.filter((y) => y.userId === uid)) { await d.setDbState(await dbSpec(db, x), "stop"); await db.update(paasDbs).set({ status: "suspended", suspendedAt: new Date() }).where(eq(paasDbs.id, x.id)); }
    await notify(db, uid, "wallet", "موجودی کیف پول تمام شد؛ اپ‌ها و پایگاه‌های داده گره اپ متوقف شدند");
    await enqueue(db, "notify.send", { userId: uid, kind: "billing", subject: "اتمام موجودی گره اپ", text: "موجودی کیف پول برای هزینه ساعتی اپ‌ها و پایگاه‌های داده کافی نیست و آن‌ها متوقف شدند؛ داده‌ها حفظ شده‌اند. پس از شارژ کیف پول، سرویس‌ها خودکار دوباره روشن می‌شوند." });
  }
  // credit is back (at least 24h of usage): resume suspended resources
  const suspended = [...await db.select().from(paasApps).where(eq(paasApps.status, "suspended")), ...await db.select().from(paasDbs).where(eq(paasDbs.status, "suspended"))];
  for (const uid of new Set(suspended.map((s) => s.userId))) {
    const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
    const need = suspended.filter((s) => s.userId === uid).reduce((sum, s) => sum + 24 * hourlyOf(plans.get(s.planId)?.price ?? 0), 0);
    if (!u || u.balance < need) continue;
    for (const a of await db.select().from(paasApps).where(and(eq(paasApps.userId, uid), eq(paasApps.status, "suspended")))) {
      const sp = await appSpec(db, a);
      await d.setState(sp, "start");
      if (a.previewDeployment) await d.setState(previewSpec(sp), "start");
      await db.update(paasApps).set({ status: a.liveDeployment ? "running" : "failed", suspendedAt: null }).where(eq(paasApps.id, a.id));
    }
    for (const x of await db.select().from(paasDbs).where(and(eq(paasDbs.userId, uid), eq(paasDbs.status, "suspended")))) {
      await d.setDbState(await dbSpec(db, x), "start");
      await db.update(paasDbs).set({ status: "running", suspendedAt: null }).where(eq(paasDbs.id, x.id));
    }
    await notify(db, uid, "play", "اپ‌ها و پایگاه‌های داده گره اپ دوباره فعال شدند");
  }
}

/* ---------- every 5 minutes: metrics + custom domain checks ---------- */
export async function paasCollect(db: DB) {
  const plans = new Map((await db.select().from(paasPlans)).map((p) => [p.id, p]));
  const apps = await db.select().from(paasApps).where(eq(paasApps.status, "running"));
  const dbs = await db.select().from(paasDbs).where(eq(paasDbs.status, "running"));
  const d = await paas();
  const targets = [
    ...apps.map((a) => ({ id: a.id, kind: "app" as const, ramMb: (plans.get(a.planId)?.ramMb ?? 256) * a.instances, owner: a.userId, name: a.name })),
    ...dbs.map((x) => ({ id: x.id, kind: "db" as const, ramMb: plans.get(x.planId)?.ramMb ?? 512, owner: x.userId, name: x.name })),
  ];
  if (targets.length) {
    const m = await d.metrics(targets);
    if (m.length) await db.insert(paasMetrics).values(m.map((x) => ({ target: x.id, cpu: x.cpu, ramMb: x.ramMb, rpm: x.rpm })));
  }
  await db.delete(paasMetrics).where(lt(paasMetrics.createdAt, new Date(Date.now() - 8 * 86400_000)));

  // pending custom domains: re-check DNS for up to 72 hours
  const pending = await db.select({ dm: paasDomains, a: paasApps }).from(paasDomains).innerJoin(paasApps, eq(paasApps.id, paasDomains.appId))
    .where(and(eq(paasDomains.status, "pending"), gte(paasDomains.createdAt, new Date(Date.now() - 72 * 3600_000))));
  for (const { dm, a } of pending) await checkDomain(db, dm.id, a);
  await db.update(paasDomains).set({ status: "failed" }).where(and(eq(paasDomains.status, "pending"), lt(paasDomains.createdAt, new Date(Date.now() - 72 * 3600_000))));
}

export async function checkDomain(db: DB, domainId: string, app: typeof paasApps.$inferSelect) {
  const [dm] = await db.select().from(paasDomains).where(eq(paasDomains.id, domainId));
  if (!dm) return false;
  const d = await paas();
  const ok = await d.verifyDomain(dm.host, app.name);
  await db.update(paasDomains).set({ checkedAt: new Date(), ...(ok ? { status: "active" as const, ssl: "issued" as const } : {}) }).where(eq(paasDomains.id, dm.id));
  if (ok && dm.status !== "active") {
    // the ingress needs the new host
    if (app.liveDeployment && app.status === "running") {
      const [live] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, app.liveDeployment));
      if (live?.image) await d.release(await appSpec(db, app), live.image, live.id);
    }
    await notify(db, app.userId, "globe", "دامنه " + dm.host + " به " + app.name + " متصل شد");
  }
  return ok;
}
