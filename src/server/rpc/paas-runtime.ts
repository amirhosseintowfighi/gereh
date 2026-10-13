/* Gereh Apps build and runtime options, events, usage and budgets, domain redirects and moves, and
   cloning an app. The panel reads everything for one app with paas.runtime. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { faDateTime } from "@/lib/jalali";
import { appMonthly } from "@/lib/paas";
import {
  MAX_CONF_BYTES, MAX_DNS, NGINX_STACKS, PHP_STACKS, authPathError, buildArgsError, dayKey, dnsError, dockerfileError, healthCodesError, monthKey, nginxConfError, phpIniError, timezoneError,
} from "@/lib/paas-runtime";
import { actor, method, needStaff, needUser } from "../ctx";
import { paasApps, paasCrons, paasDeployments, paasDomainRedirects, paasDomains, paasEnv, paasEvents, paasPlans, paasProcesses, paasRuntime, paasSpend, paasTraffic } from "../db/schema";
import { paas } from "../paas/driver";
import { egressIps, htpasswdLine, loadRuntime, saveRuntime } from "../paas/runtime";
import { copyDisks } from "../paas/disks";
import { appSpec, queueDeployment, redeployConfig } from "../paas/service";
import { fail, logActivity, logAudit, rid } from "../util";
import { checkName, needCredit, ownApp } from "./paas";

const id = z.string().max(40);
const hook = z.string().max(1000).refine((s) => !s.includes("\0"), "invalid");
const runtimePatch = z.object({
  preBuild: hook, postBuild: hook, preStart: hook,
  healthType: z.enum(["http", "command", "tcp"]), healthCommand: z.string().trim().max(500), healthCodes: z.string().trim().max(100),
  healthInterval: z.number().int().min(1).max(300), healthTimeout: z.number().int().min(1).max(120), healthRetries: z.number().int().min(1).max(20), healthStartPeriod: z.number().int().min(0).max(1800),
  zeroDowntime: z.boolean(), buildCache: z.boolean(), mirror: z.boolean(),
  buildArgs: z.record(z.string().max(128), z.string().max(4096)), dockerfile: z.string().trim().max(200),
  timezone: z.string().trim().max(64), readOnlyFs: z.boolean(), dnsServers: z.array(z.string().trim().max(45)).max(MAX_DNS),
  nginxConf: z.string().max(MAX_CONF_BYTES), phpIni: z.string().max(MAX_CONF_BYTES),
  defaultDomain: z.boolean(),
  budget: z.number().int().min(0).max(1e10), budgetAlertPct: z.number().int().min(10).max(100), budgetStop: z.boolean(), trafficAlertGb: z.number().int().min(0).max(100_000),
}).partial().strict();
type Patch = z.infer<typeof runtimePatch>;

const BUILD_KEYS = ["preBuild", "postBuild", "buildCache", "mirror", "buildArgs", "dockerfile"] as const;
const RUN_KEYS = ["preStart", "healthType", "healthCommand", "healthCodes", "healthInterval", "healthTimeout", "healthRetries", "healthStartPeriod", "zeroDowntime", "timezone", "readOnlyFs", "dnsServers", "nginxConf", "phpIni"] as const;
const URL_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[\w./~%+-]*)?$/i;

/** active custom domains that still serve the app (not redirects) */
async function servingDomains(db: Parameters<typeof loadRuntime>[0], appId: string) {
  return db.select({ id: paasDomains.id, host: paasDomains.host }).from(paasDomains).leftJoin(paasDomainRedirects, eq(paasDomainRedirects.domainId, paasDomains.id))
    .where(and(eq(paasDomains.appId, appId), eq(paasDomains.status, "active"), isNull(paasDomainRedirects.domainId)));
}
/** routing changes apply to a live app without a restart */
async function reroute(db: Parameters<typeof loadRuntime>[0], app: typeof paasApps.$inferSelect) {
  if (app.liveDeployment && app.status === "running") await (await paas()).updateRouting(await appSpec(db, app));
}

export const paasRuntimeRpc = {
  /** everything the panel's runtime, usage, events and domain sections show for one app */
  "paas.runtime": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    const month = monthKey(), since = new Date(Date.now() - 31 * 86400_000);
    const [rt, events, spend, traffic, redirects, [plan], [today]] = await Promise.all([
      loadRuntime(ctx.db, app.id),
      ctx.db.select().from(paasEvents).where(eq(paasEvents.appId, app.id)).orderBy(desc(paasEvents.createdAt)).limit(100),
      ctx.db.select().from(paasSpend).where(eq(paasSpend.appId, app.id)).orderBy(desc(paasSpend.month)).limit(6),
      ctx.db.select().from(paasTraffic).where(and(eq(paasTraffic.appId, app.id), gte(paasTraffic.day, dayKey(since)))).orderBy(asc(paasTraffic.day)),
      ctx.db.select({ r: paasDomainRedirects }).from(paasDomainRedirects).innerJoin(paasDomains, eq(paasDomains.id, paasDomainRedirects.domainId)).where(eq(paasDomains.appId, app.id)),
      ctx.db.select().from(paasPlans).where(eq(paasPlans.id, app.planId)),
      ctx.db.select({ n: sql<number>`count(*)::int` }).from(paasDeployments).where(and(eq(paasDeployments.appId, app.id), inArray(paasDeployments.trigger, ["create", "manual", "git", "cli", "api"]), notInArray(paasDeployments.status, ["cancelled"]), gte(paasDeployments.createdAt, new Date(Date.now() - 86400_000)))),
    ]);
    const { authHtpasswd, ...config } = rt;
    const { monthTraffic } = await import("../worker/paas-runtime");
    return {
      config: { ...config, authOn: !!(rt.authPath && authHtpasswd) },
      events: events.map((e) => ({ id: e.id, kind: e.kind, message: e.message, at: faDateTime(e.createdAt) })),
      spend: { month, amount: spend.find((s) => s.month === month)?.amount ?? 0, history: spend.map((s) => ({ month: s.month, amount: s.amount })) },
      traffic: { monthBytes: (await monthTraffic(ctx.db, [app.id])).get(app.id) ?? 0, days: traffic.map((t) => ({ day: t.day, bytes: t.bytes })) },
      redirects: redirects.map(({ r }) => ({ domainId: r.domainId, target: r.target, code: r.code, keepPath: r.keepPath })),
      egressIps: egressIps(),
      limits: { deploysPerDay: plan?.deploysPerDay ?? 0, maxBuildMinutes: plan?.maxBuildMinutes ?? 30, deploysToday: today?.n ?? 0 },
    };
  }),

  "paas.setRuntime": method(z.tuple([id, runtimePatch]), async (ctx, [appId, p]) => {
    const { a, app } = await ownApp(ctx, appId);
    const cur = await loadRuntime(ctx.db, app.id);
    const next = { ...cur, ...p };
    const err = (e: string | null) => { if (e) fail(e); };
    const changed = (k: keyof Patch) => p[k] !== undefined && JSON.stringify(p[k]) !== JSON.stringify(cur[k]);
    if (app.source === "image" && BUILD_KEYS.some((k) => changed(k) && k !== "mirror")) fail("اپ‌های ایمیج Docker بیلد نمی‌شوند؛ هوک‌ها و تنظیمات بیلد برای آن‌ها کاربرد ندارد.");
    if (app.source === "compose" && (changed("preBuild") || changed("postBuild") || changed("preStart"))) fail("هوک‌ها برای اپ‌های Docker Compose پشتیبانی نمی‌شوند؛ در Dockerfile هر سرویس بنویسید.");
    err(healthCodesError(next.healthCodes));
    if (next.healthType === "command" && !next.healthCommand) fail("برای بررسی سلامت با دستور، دستور را بنویسید (مثل curl -f localhost:3000/health).");
    if (next.healthTimeout > next.healthInterval) fail("مهلت پاسخ بررسی سلامت نباید از فاصله بررسی‌ها بیشتر باشد.");
    err(buildArgsError(next.buildArgs));
    err(dockerfileError(next.dockerfile));
    err(timezoneError(next.timezone));
    err(dnsError(next.dnsServers));
    if (changed("nginxConf") && next.nginxConf && !NGINX_STACKS.has(app.stack)) fail("پیکربندی nginx فقط برای پشته‌های PHP، Laravel، WordPress و سایت استاتیک است.");
    if (changed("phpIni") && next.phpIni && !PHP_STACKS.has(app.stack)) fail("php.ini فقط برای پشته‌های PHP، Laravel و WordPress است.");
    if (next.nginxConf) err(nginxConfError(next.nginxConf));
    if (next.phpIni) err(phpIniError(next.phpIni));
    if (p.defaultDomain === false && !(await servingDomains(ctx.db, app.id)).length) fail("برای خاموش کردن زیردامنه پیش‌فرض، دست‌کم یک دامنه اختصاصی فعال (بدون ریدایرکت) لازم است.");
    const extra: Partial<typeof paasRuntime.$inferInsert> = {};
    if (changed("budget") || changed("budgetAlertPct")) extra.budgetNotified = "";
    if (changed("trafficAlertGb")) extra.trafficNotified = "";
    await saveRuntime(ctx.db, app.id, { ...p, ...(p.dnsServers ? { dnsServers: [...p.dnsServers] } : {}), ...extra });
    await logActivity(ctx.db, a.uid, "settings-2", "تغییر تنظیمات بیلد و اجرای " + app.name, ctx.ip);
    // build options apply on the next deploy; runtime options re-release the live image; routing applies now
    if (RUN_KEYS.some(changed)) return redeployConfig(ctx.db, app, "تغییر تنظیمات اجرا");
    if (changed("defaultDomain")) await reroute(ctx.db, app);
    return null;
  }),

  /** HTTP basic auth on a path prefix (null turns it off); the password is stored hashed only */
  "paas.setBasicAuth": method(z.tuple([id, z.object({ path: z.string().trim().max(200), user: z.string().trim().max(64), password: z.string().min(8).max(128) }).nullable()]), async (ctx, [appId, o]) => {
    const { a, app } = await ownApp(ctx, appId);
    if (o) {
      const e = authPathError(o.path);
      if (e) fail(e);
      if (!/^[\w.@-]{1,64}$/.test(o.user)) fail("نام کاربری فقط حروف انگلیسی، عدد و . _ - @");
      await saveRuntime(ctx.db, app.id, { authPath: o.path, authUser: o.user, authHtpasswd: htpasswdLine(o.user, o.password) });
    } else await saveRuntime(ctx.db, app.id, { authPath: "", authUser: "", authHtpasswd: "" });
    await reroute(ctx.db, app);
    await logActivity(ctx.db, a.uid, "lock", (o ? "رمز عبور روی مسیر " + o.path : "برداشتن رمز عبور مسیر") + " در " + app.name, ctx.ip);
  }),

  /** a custom domain answers with a 301/302 redirect instead of the app (null: serve the app again) */
  "paas.setRedirect": method(z.tuple([id, z.object({ target: z.string().trim().max(500), code: z.union([z.literal(301), z.literal(302)]), keepPath: z.boolean().default(true) }).nullable()]), async (ctx, [domId, o]) => {
    const a = needUser(ctx);
    const [row] = await ctx.db.select({ dm: paasDomains, app: paasApps }).from(paasDomains).innerJoin(paasApps, eq(paasApps.id, paasDomains.appId)).where(and(eq(paasDomains.id, domId), eq(paasApps.userId, a.uid)));
    if (!row) fail("دامنه پیدا نشد.", 404);
    const { dm, app } = row!;
    if (o) {
      if (!URL_RE.test(o.target)) fail("مقصد باید نشانی کامل باشد؛ مثل https://www.example.com");
      if (new URL(o.target).hostname === dm.host) fail("دامنه نمی‌تواند به خودش ریدایرکت شود.");
      const rt = await loadRuntime(ctx.db, app.id);
      if (!rt.defaultDomain && !(await servingDomains(ctx.db, app.id)).some((d) => d.id !== dm.id)) fail("این آخرین دامنه‌ای است که اپ را سرو می‌کند؛ اول زیردامنه پیش‌فرض را روشن کنید.");
      await ctx.db.insert(paasDomainRedirects).values({ domainId: dm.id, target: o.target, code: o.code, keepPath: o.keepPath })
        .onConflictDoUpdate({ target: paasDomainRedirects.domainId, set: { target: o.target, code: o.code, keepPath: o.keepPath } });
    } else await ctx.db.delete(paasDomainRedirects).where(eq(paasDomainRedirects.domainId, dm.id));
    await reroute(ctx.db, app);
    await logActivity(ctx.db, a.uid, "globe", (o ? "ریدایرکت " + o.code + " دامنه " + dm.host + " به " + o.target : "برداشتن ریدایرکت " + dm.host), ctx.ip);
  }),

  /** moves a custom domain (with its verification) to another app of the same customer */
  "paas.moveDomain": method(z.tuple([id, id]), async (ctx, [domId, toAppId]) => {
    const a = needUser(ctx);
    const [row] = await ctx.db.select({ dm: paasDomains, app: paasApps }).from(paasDomains).innerJoin(paasApps, eq(paasApps.id, paasDomains.appId)).where(and(eq(paasDomains.id, domId), eq(paasApps.userId, a.uid)));
    if (!row) fail("دامنه پیدا نشد.", 404);
    const { app: target } = await ownApp(ctx, toAppId);
    const { dm, app: from } = row!;
    if (target.id === from.id) fail("دامنه همین حالا به این اپ متصل است.");
    const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(paasDomains).where(eq(paasDomains.appId, target.id));
    if ((count?.n ?? 0) >= 20) fail("حداکثر ۲۰ دامنه برای هر اپ.");
    const rt = await loadRuntime(ctx.db, from.id);
    if (!rt.defaultDomain && !(await servingDomains(ctx.db, from.id)).some((d) => d.id !== dm.id)) fail("این آخرین دامنه‌ای است که اپ «" + from.name + "» را سرو می‌کند؛ اول زیردامنه پیش‌فرض آن را روشن کنید.");
    await ctx.db.update(paasDomains).set({ appId: target.id }).where(eq(paasDomains.id, dm.id));
    await reroute(ctx.db, from);
    // a new certificate is issued for the target app's Ingress
    await reroute(ctx.db, target);
    await logActivity(ctx.db, a.uid, "globe", "انتقال دامنه " + dm.host + " از " + from.name + " به " + target.name, ctx.ip);
  }),

  /** a new app with the same settings, variables, processes, crons and options; no data (empty disk, no databases) */
  "paas.cloneApp": method(z.tuple([id, z.string().trim().toLowerCase().max(30)]), async (ctx, [appId, name]) => {
    const { a, app } = await ownApp(ctx, appId);
    if (app.product !== "app") fail("سایت‌های وردپرس از بخش وردپرس ساخته می‌شوند.");
    checkName(name);
    const [taken] = await ctx.db.select({ id: paasApps.id }).from(paasApps).where(eq(paasApps.name, name));
    if (taken) fail("این نام قبلاً گرفته شده است؛ نام دیگری انتخاب کنید.");
    const [plan] = await ctx.db.select().from(paasPlans).where(eq(paasPlans.id, app.planId));
    if (!plan?.active) fail("پلن این اپ دیگر فروخته نمی‌شود؛ اول پلن را عوض کنید.");
    await needCredit(ctx, a.uid, appMonthly(plan!, app.instances + app.workerInstances, app.diskGb));
    let image = "";
    if (app.source === "zip" || app.source === "compose") {
      const [live] = app.liveDeployment ? await ctx.db.select({ image: paasDeployments.image }).from(paasDeployments).where(eq(paasDeployments.id, app.liveDeployment)) : [];
      if (!live?.image) fail("کپی اپ‌های ZIP و Compose از نسخه فعال ساخته می‌شود؛ اول یک استقرار موفق لازم است.");
      image = live!.image;
    }
    const newId = rid("app");
    const [env, procs, crons, [rt]] = await Promise.all([
      ctx.db.select().from(paasEnv).where(and(eq(paasEnv.appId, app.id), isNull(paasEnv.managedBy))),
      ctx.db.select().from(paasProcesses).where(eq(paasProcesses.appId, app.id)),
      ctx.db.select().from(paasCrons).where(eq(paasCrons.appId, app.id)),
      ctx.db.select().from(paasRuntime).where(eq(paasRuntime.appId, app.id)),
    ]);
    await ctx.db.transaction(async (tx) => {
      await tx.insert(paasApps).values({
        id: newId, userId: a.uid, name, stack: app.stack, source: app.source, gitUrl: app.gitUrl, gitBranch: app.gitBranch, image: app.image, rootDir: app.rootDir,
        buildCommand: app.buildCommand, startCommand: app.startCommand, port: app.port, healthPath: app.healthPath, planId: app.planId, instances: app.instances,
        autoscale: app.autoscale, maxInstances: app.maxInstances, autoscaleCpu: app.autoscaleCpu, diskGb: app.diskGb, diskMount: app.diskMount, region: app.region,
        autoDeploy: app.autoDeploy, cdn: app.cdn, releaseCommand: app.releaseCommand, workerInstances: app.workerInstances, hookToken: randomBytes(24).toString("base64url"),
      });
      // sealed values are copied as they are (same key)
      if (env.length) await tx.insert(paasEnv).values(env.map((e) => ({ appId: newId, key: e.key, valueEnc: e.valueEnc, secret: e.secret })));
      if (procs.length) await tx.insert(paasProcesses).values(procs.map((p) => ({ appId: newId, name: p.name, command: p.command, instances: p.instances })));
      if (crons.length) await tx.insert(paasCrons).values(crons.map((c) => ({ id: rid("cron"), appId: newId, name: c.name, schedule: c.schedule, command: c.command, enabled: c.enabled })));
      await copyDisks(tx, app, newId);
      if (rt) await tx.insert(paasRuntime).values({ ...rt, appId: newId, defaultDomain: true, budgetNotified: "", trafficNotified: "", updatedAt: new Date() });
      await queueDeployment(tx, { id: newId }, { trigger: "create", image: image || undefined, message: "کپی از " + app.name });
    });
    await logActivity(ctx.db, a.uid, "copy", "کپی اپ " + app.name + " به " + name, ctx.ip);
    return newId;
  }),

  /* ---------------- staff ---------------- */
  "paas.adminPlanLimits": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "products");
    return ctx.db.select({ id: paasPlans.id, name: paasPlans.name, deploysPerDay: paasPlans.deploysPerDay, maxBuildMinutes: paasPlans.maxBuildMinutes }).from(paasPlans).where(eq(paasPlans.kind, "app")).orderBy(asc(paasPlans.position));
  }),
  "paas.adminSetPlanLimits": method(z.tuple([id, z.object({ deploysPerDay: z.number().int().min(0).max(10_000), maxBuildMinutes: z.number().int().min(5).max(180) })]), async (ctx, [planId, l]) => {
    needStaff(ctx, "products");
    const r = await ctx.db.update(paasPlans).set(l).where(and(eq(paasPlans.id, planId), eq(paasPlans.kind, "app"))).returning({ id: paasPlans.id });
    if (!r.length) fail("پلن پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "محدودیت استقرار پلن گره اپ: " + l.deploysPerDay + " در روز، " + l.maxBuildMinutes + " دقیقه", planId, ctx.ip);
  }),
};

