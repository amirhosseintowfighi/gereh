/* Gereh Apps background jobs. Builds and rollouts are started once and then polled with short
   follow-up jobs, so a long build never blocks the worker. */
import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { faDate } from "@/lib/jalali";
import { hourlyOf } from "@/lib/paas";
import type { DB } from "../db/client";
import { paasApps, paasDbBackups, paasDbs, paasDeployments, paasDomains, paasMetrics, paasPlans, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { paas } from "../paas/driver";
import { appHourly, appSpec, dbHourly, dbSpec, signSource } from "../paas/service";
import { notify, rid } from "../util";

const MAX_LOG = 200_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
const ROLLOUT_TIMEOUT_MS = 10 * 60_000;
const pollMs = () => Number(process.env.PAAS_POLL_MS ?? 3000);
const later = (ms: number) => new Date(Date.now() + ms);

async function fail(db: DB, depId: string, appId: string, log: string) {
  await db.update(paasDeployments).set({ status: "failed", log: log.slice(-MAX_LOG), finishedAt: new Date() }).where(eq(paasDeployments.id, depId));
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, appId));
  if (!app) return;
  // an app that was live keeps serving the previous deployment
  await db.update(paasApps).set({ status: app.liveDeployment ? "running" : "failed" }).where(eq(paasApps.id, appId));
  await notify(db, app.userId, "circle-alert", "استقرار " + app.name + " ناموفق بود");
  await enqueue(db, "notify.send", { userId: app.userId, kind: "service", subject: "استقرار " + app.name + " ناموفق بود", text: "بیلد یا اجرای نسخه جدید اپ " + app.name + " با خطا متوقف شد؛ نسخه قبلی (اگر بود) همچنان فعال است. لاگ کامل در پنل گره › اپ‌ها." });
}

/** step 1: start the build (or, for rollback/config, release an existing image directly) */
export async function paasBuild(db: DB, p: { deploymentId: string }) {
  const [dep] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, p.deploymentId));
  if (!dep || dep.status !== "queued") return;
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, dep.appId));
  if (!app || app.status === "suspended") { await db.update(paasDeployments).set({ status: "cancelled", finishedAt: new Date() }).where(eq(paasDeployments.id, dep.id)); return; }
  const d = await paas();
  const spec = await appSpec(db, app);
  await db.update(paasDeployments).set({ status: dep.image ? "deploying" : "building", startedAt: new Date() }).where(eq(paasDeployments.id, dep.id));
  if (!app.liveDeployment) await db.update(paasApps).set({ status: "building" }).where(eq(paasApps.id, app.id));
  if (dep.image) {
    await d.release(spec, dep.image, dep.id);
    await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "rollout", since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  let sourceUrl: string | undefined;
  if (dep.uploadPath) {
    const { exp, sig } = signSource(dep.id);
    sourceUrl = (process.env.PAAS_SOURCE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000") + "/api/paas/source/" + dep.id + "?exp=" + exp + "&sig=" + sig;
  }
  const handle = await d.startBuild(spec, dep.id, sourceUrl);
  await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "build", handle, since: Date.now() }, { runAt: later(pollMs()) });
}

/** step 2: poll the build, then the rollout */
export async function paasPoll(db: DB, p: { deploymentId: string; phase: "build" | "rollout"; handle?: string; since: number }) {
  const [dep] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, p.deploymentId));
  if (!dep || !["building", "deploying"].includes(dep.status)) return;
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, dep.appId));
  if (!app) return;
  const d = await paas();
  const spec = await appSpec(db, app);
  if (p.phase === "build") {
    const b = await d.buildStatus(spec, p.handle!);
    if (b.state === "running") {
      if (Date.now() - p.since > BUILD_TIMEOUT_MS) return fail(db, dep.id, app.id, b.log + "\nERROR: build timed out after 30 minutes");
      await db.update(paasDeployments).set({ log: b.log.slice(-MAX_LOG) }).where(eq(paasDeployments.id, dep.id));
      await enqueue(db, "paas.poll", p, { runAt: later(pollMs()) });
      return;
    }
    if (b.state === "failed") return fail(db, dep.id, app.id, b.log);
    await db.update(paasDeployments).set({ status: "deploying", image: b.image!, ref: b.ref ?? dep.ref, log: (b.log + "\n==> Releasing " + app.instances + " instance(s)").slice(-MAX_LOG) }).where(eq(paasDeployments.id, dep.id));
    await d.release(spec, b.image!, dep.id);
    await enqueue(db, "paas.poll", { deploymentId: dep.id, phase: "rollout", since: Date.now() }, { runAt: later(pollMs()) });
    return;
  }
  if (!(await d.rolloutReady(spec))) {
    if (Date.now() - p.since > ROLLOUT_TIMEOUT_MS) return fail(db, dep.id, app.id, dep.log + "\nERROR: the new version did not become healthy on " + app.healthPath + " within 10 minutes");
    await enqueue(db, "paas.poll", p, { runAt: later(pollMs()) });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.update(paasDeployments).set({ status: "superseded" }).where(and(eq(paasDeployments.appId, app.id), eq(paasDeployments.status, "live")));
    await tx.update(paasDeployments).set({ status: "live", finishedAt: new Date(), log: dep.log + "\n==> Live" }).where(eq(paasDeployments.id, dep.id));
    await tx.update(paasApps).set({ status: "running", liveDeployment: dep.id }).where(eq(paasApps.id, app.id));
  });
  if (dep.trigger !== "config") await notify(db, app.userId, "rocket", "نسخه جدید " + app.name + " فعال شد");
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
    for (const a of apps.filter((x) => x.userId === uid)) { await d.setState(await appSpec(db, a), "stop"); await db.update(paasApps).set({ status: "suspended", suspendedAt: new Date() }).where(eq(paasApps.id, a.id)); }
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
      await d.setState(await appSpec(db, a), "start");
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
