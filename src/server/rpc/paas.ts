import "server-only";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DB_ENGINES, ENV_KEY_RE, ENV_RESERVED, PAAS_NAME_RE, PAAS_RESERVED, STACKS, appMonthly, hourlyOf } from "@/lib/paas";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { paasApps, paasDbBackups, paasDbs, paasDeployments, paasDomains, paasEnv, paasLinks, paasPlans, users } from "../db/schema";
import { enqueue } from "../jobs";
import { paas } from "../paas/driver";
import { appSpec, appsDomain, connectionUrl, dbSpec, defaultEnvKey, queueDeployment, redeployConfig, setEnvValue, uploadPathFor } from "../paas/service";
import { open, seal } from "../secrets";
import { checkDomain } from "../worker/paas";
import { fail, logActivity, logAudit, rid } from "../util";

const id = z.string().max(40);
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const GIT_RE = /^(https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+?(\.git)?|git@[\w.-]+:[\w./~-]+?(\.git)?)$/;
const IMAGE_RE = /^[a-z0-9]+([._/-][a-z0-9]+)*(:[\w.-]{1,128})?(@sha256:[a-f0-9]{64})?$/;
const envItem = z.object({ key: z.string().max(128), value: z.string().max(32_768), secret: z.boolean().default(false) });

async function ownApp(ctx: Ctx, appId: string) {
  const a = needUser(ctx);
  const [app] = await ctx.db.select().from(paasApps).where(and(eq(paasApps.id, appId), eq(paasApps.userId, a.uid)));
  if (!app) fail("اپ پیدا نشد.", 404);
  if (app!.status === "suspended") fail("این اپ معلق است؛ کیف پول را شارژ کنید یا با پشتیبانی تماس بگیرید.", 403);
  return { a, app: app! };
}
async function ownDb(ctx: Ctx, dbId: string) {
  const a = needUser(ctx);
  const [row] = await ctx.db.select().from(paasDbs).where(and(eq(paasDbs.id, dbId), eq(paasDbs.userId, a.uid)));
  if (!row) fail("پایگاه داده پیدا نشد.", 404);
  if (row!.status === "suspended") fail("این پایگاه داده معلق است.", 403);
  return { a, row: row! };
}
async function plan(ctx: Ctx, planId: string, kind: "app" | "db") {
  const [p] = await ctx.db.select().from(paasPlans).where(and(eq(paasPlans.id, planId), eq(paasPlans.kind, kind)));
  if (!p || !p.active) fail("این پلن در دسترس نیست.");
  return p!;
}
/** creating or growing a resource needs 24 hours of its cost in the wallet */
async function needCredit(ctx: Ctx, uid: string, monthly: number) {
  const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
  const need = 24 * hourlyOf(monthly);
  if ((u?.balance ?? 0) < need) fail("موجودی کیف پول کافی نیست؛ برای شروع دست‌کم " + need.toLocaleString("fa-IR") + " تومان (هزینه ۲۴ ساعت) لازم است.", 402);
}
function checkName(name: string) {
  if (!PAAS_NAME_RE.test(name)) fail("نام فقط حروف کوچک انگلیسی، عدد و خط تیره؛ ۳ تا ۳۰ نویسه و با حرف شروع شود.");
  if (PAAS_RESERVED.has(name)) fail("این نام رزرو شده است.");
}
function checkEnv(vars: z.infer<typeof envItem>[]) {
  for (const v of vars) {
    if (!ENV_KEY_RE.test(v.key)) fail("نام متغیر «" + v.key + "» معتبر نیست (حروف انگلیسی، عدد و _).");
    if (ENV_RESERVED.has(v.key)) fail("متغیر " + v.key + " را پلتفرم تنظیم می‌کند.");
  }
  if (new Set(vars.map((v) => v.key)).size !== vars.length) fail("نام متغیرها تکراری است.");
}
async function uploaded(uid: string, uploadId?: string) {
  if (!uploadId) return undefined;
  const p = await uploadPathFor(uid, uploadId);
  if (!p) fail("فایل بارگذاری‌شده نامعتبر است.");
  try { await access(p!); } catch { fail("فایل بارگذاری‌شده پیدا نشد؛ دوباره بارگذاری کنید."); }
  return p!;
}

const appInput = z.object({
  name: z.string().trim().toLowerCase().max(30), stack: z.enum(STACKS.map((s) => s.id) as [string, ...string[]]),
  source: z.enum(["git", "zip", "image", "compose"]), gitUrl: z.string().trim().max(300).default(""), gitBranch: z.string().trim().max(100).default("main"),
  image: z.string().trim().max(300).default(""), uploadId: z.string().max(64).optional(), rootDir: z.string().trim().max(200).default(""),
  buildCommand: z.string().max(500).default(""), startCommand: z.string().max(500).default(""), port: z.number().int().min(1).max(65535),
  planId: id, instances: z.number().int().min(1).max(10).default(1), diskGb: z.number().int().min(0).max(500).default(0), env: z.array(envItem).max(100).default([]),
});

export const paasRpc = {
  /* ---------------- apps ---------------- */
  "paas.createApp": method(z.tuple([appInput]), async (ctx, [i]) => {
    const a = needUser(ctx);
    checkName(i.name);
    const p = await plan(ctx, i.planId, "app");
    if (i.source === "git" && !GIT_RE.test(i.gitUrl)) fail("نشانی مخزن گیت معتبر نیست؛ مثل https://github.com/user/repo.git");
    if (i.source === "git" && !/^[\w./-]{1,100}$/.test(i.gitBranch)) fail("نام شاخه معتبر نیست.");
    if (i.source === "image" && !IMAGE_RE.test(i.image)) fail("نام ایمیج معتبر نیست؛ مثل nginx:1.27 یا ghcr.io/user/app:latest");
    if ((i.source === "zip" || i.source === "compose") && !i.uploadId) fail("فایل پروژه را بارگذاری کنید.");
    if (i.rootDir && !/^[\w./-]+$/.test(i.rootDir) || i.rootDir.includes("..")) fail("پوشه ریشه معتبر نیست.");
    checkEnv(i.env);
    await needCredit(ctx, a.uid, appMonthly(p, i.instances, i.diskGb));
    const [taken] = await ctx.db.select({ id: paasApps.id }).from(paasApps).where(eq(paasApps.name, i.name));
    if (taken) fail("این نام قبلاً گرفته شده است؛ نام دیگری انتخاب کنید.");
    const uploadPath = await uploaded(a.uid, i.uploadId);
    const appId = rid("app");
    await ctx.db.transaction(async (tx) => {
      await tx.insert(paasApps).values({
        id: appId, userId: a.uid, name: i.name, stack: i.stack, source: i.source, gitUrl: i.gitUrl, gitBranch: i.gitBranch || "main", image: i.image, rootDir: i.rootDir,
        buildCommand: i.buildCommand, startCommand: i.startCommand, port: i.port, planId: p.id, instances: i.instances, diskGb: i.diskGb, hookToken: randomBytes(24).toString("base64url"),
      });
      for (const v of i.env) await setEnvValue(tx, appId, v.key, v.value, v.secret);
      await queueDeployment(tx, { id: appId }, { trigger: "create", uploadPath, message: "اولین استقرار" });
    });
    await logActivity(ctx.db, a.uid, "rocket", "ساخت اپ " + i.name, ctx.ip);
    return appId;
  }),

  "paas.deploy": method(z.tuple([id, z.object({ uploadId: z.string().max(64).optional(), message: z.string().max(200).optional(), via: z.enum(["manual", "api", "cli"]).optional() })]), async (ctx, [appId, o]) => {
    const { a, app } = await ownApp(ctx, appId);
    if (app.status === "stopped") fail("اپ متوقف است؛ اول آن را روشن کنید.");
    const uploadPath = await uploaded(a.uid, o.uploadId);
    if ((app.source === "zip" || app.source === "compose") && !uploadPath) fail("فایل نسخه جدید را بارگذاری کنید.");
    const [busy] = await ctx.db.select({ id: paasDeployments.id }).from(paasDeployments).where(and(eq(paasDeployments.appId, app.id), inArray(paasDeployments.status, ["queued", "building"])));
    if (busy) fail("یک استقرار در جریان است؛ تا پایان آن صبر کنید.");
    return queueDeployment(ctx.db, app, { trigger: o.via ?? "manual", uploadPath, message: o.message?.trim() || (o.via === "cli" ? "استقرار از CLI" : o.via === "api" ? "استقرار از API" : "استقرار دستی") });
  }),

  "paas.rollback": method(z.tuple([id, id]), async (ctx, [appId, depId]) => {
    const { app } = await ownApp(ctx, appId);
    const [dep] = await ctx.db.select().from(paasDeployments).where(and(eq(paasDeployments.id, depId), eq(paasDeployments.appId, app.id)));
    if (!dep?.image || !["live", "superseded"].includes(dep.status)) fail("فقط به نسخه‌ای که قبلاً موفق بوده می‌توان برگشت.");
    if (dep!.id === app.liveDeployment) fail("این نسخه هم‌اکنون فعال است.");
    return queueDeployment(ctx.db, app, { trigger: "rollback", image: dep!.image, ref: dep!.ref, message: "بازگشت به نسخه " + dep!.id });
  }),

  "paas.deployment": method(z.tuple([id]), async (ctx, [depId]) => {
    const a = needUser(ctx);
    const [row] = await ctx.db.select({ d: paasDeployments, userId: paasApps.userId }).from(paasDeployments).innerJoin(paasApps, eq(paasApps.id, paasDeployments.appId)).where(eq(paasDeployments.id, depId));
    if (!row || (row.userId !== a.uid && !(a.user.role === "admin"))) fail("استقرار پیدا نشد.", 404);
    return { status: row!.d.status, log: row!.d.log };
  }),

  "paas.logs": method(z.tuple([id, z.number().int().min(10).max(1000).default(200)]), async (ctx, [appId, tail]) => {
    const a = needUser(ctx);
    const [app] = await ctx.db.select().from(paasApps).where(eq(paasApps.id, appId));
    if (!app || (app.userId !== a.uid && a.user.role !== "admin")) fail("اپ پیدا نشد.", 404);
    if (!app!.liveDeployment || app!.status !== "running") return [] as string[];
    return (await paas()).logs(await appSpec(ctx.db, app!), tail);
  }),

  "paas.updateApp": method(z.tuple([id, z.object({
    gitUrl: z.string().trim().max(300).optional(), gitBranch: z.string().trim().max(100).optional(), image: z.string().trim().max(300).optional(), rootDir: z.string().trim().max(200).optional(),
    buildCommand: z.string().max(500).optional(), startCommand: z.string().max(500).optional(), port: z.number().int().min(1).max(65535).optional(),
    healthPath: z.string().max(200).regex(/^\/[\w./?=&%-]*$/).optional(), autoDeploy: z.boolean().optional(),
  })]), async (ctx, [appId, patch]) => {
    const { app } = await ownApp(ctx, appId);
    if (patch.gitUrl !== undefined && app.source === "git" && !GIT_RE.test(patch.gitUrl)) fail("نشانی مخزن گیت معتبر نیست.");
    if (patch.image !== undefined && app.source === "image" && !IMAGE_RE.test(patch.image)) fail("نام ایمیج معتبر نیست.");
    if (patch.rootDir && (!/^[\w./-]+$/.test(patch.rootDir) || patch.rootDir.includes(".."))) fail("پوشه ریشه معتبر نیست.");
    const [next] = await ctx.db.update(paasApps).set(patch).where(eq(paasApps.id, app.id)).returning();
    // runtime settings apply to the running image; build settings apply on the next deploy
    if (patch.port !== undefined || patch.startCommand !== undefined || patch.healthPath !== undefined) await redeployConfig(ctx.db, next, "تغییر تنظیمات اجرا");
    if (app.source === "image" && patch.image && patch.image !== app.image) await queueDeployment(ctx.db, next, { trigger: "manual", message: "ایمیج جدید " + patch.image });
  }),

  "paas.setEnv": method(z.tuple([id, z.array(envItem).max(100), z.array(z.string().max(128)).max(100)]), async (ctx, [appId, set, remove]) => {
    const { app } = await ownApp(ctx, appId);
    checkEnv(set);
    const linked = await ctx.db.select({ key: paasLinks.envKey }).from(paasLinks).where(eq(paasLinks.appId, app.id));
    const locked = new Set(linked.map((m) => m.key));
    if ([...set.map((v) => v.key), ...remove].some((k) => locked.has(k))) fail("این متغیر را اتصال پایگاه داده مدیریت می‌کند؛ از بخش پایگاه داده جدا کنید.");
    await ctx.db.transaction(async (tx) => {
      for (const v of set) {
        // an empty value on an existing secret means "keep the current value"
        if (v.secret && v.value === "") continue;
        await setEnvValue(tx, app.id, v.key, v.value, v.secret);
      }
      if (remove.length) await tx.delete(paasEnv).where(and(eq(paasEnv.appId, app.id), inArray(paasEnv.key, remove)));
    });
    return redeployConfig(ctx.db, app, "تغییر متغیرهای محیطی");
  }),

  "paas.scale": method(z.tuple([id, z.object({ planId: id, instances: z.number().int().min(1).max(10), autoscale: z.boolean(), maxInstances: z.number().int().min(1).max(20), diskGb: z.number().int().min(0).max(500) })]), async (ctx, [appId, s]) => {
    const { a, app } = await ownApp(ctx, appId);
    const p = await plan(ctx, s.planId, "app");
    if (s.diskGb < app.diskGb) fail("حجم دیسک دائمی را نمی‌توان کم کرد.");
    if (s.diskGb > 0 && s.instances > 1 && !s.autoscale) fail("اپ دارای دیسک دائمی فقط با یک نمونه اجرا می‌شود.");
    if (s.autoscale && s.maxInstances < s.instances) fail("حداکثر نمونه‌ها باید از تعداد فعلی بیشتر باشد.");
    const [cur] = await ctx.db.select().from(paasPlans).where(eq(paasPlans.id, app.planId));
    const grow = appMonthly(p, s.autoscale ? s.maxInstances : s.instances, s.diskGb) - appMonthly(cur ?? p, app.instances, app.diskGb);
    if (grow > 0) await needCredit(ctx, a.uid, grow);
    const [next] = await ctx.db.update(paasApps).set({ planId: p.id, instances: s.instances, autoscale: s.autoscale, maxInstances: s.maxInstances, diskGb: s.diskGb }).where(eq(paasApps.id, app.id)).returning();
    await logActivity(ctx.db, a.uid, "sliders-horizontal", "تغییر منابع " + app.name + " به " + p.name + " × " + s.instances, ctx.ip);
    return redeployConfig(ctx.db, next, "تغییر منابع");
  }),

  "paas.power": method(z.tuple([id, z.enum(["start", "stop", "restart"])]), async (ctx, [appId, action]) => {
    const { a, app } = await ownApp(ctx, appId);
    if (!app.liveDeployment) fail("این اپ هنوز نسخه فعالی ندارد.");
    if (action === "start") {
      const [p] = await ctx.db.select().from(paasPlans).where(eq(paasPlans.id, app.planId));
      await needCredit(ctx, a.uid, appMonthly(p!, app.instances, app.diskGb));
    }
    await (await paas()).setState(await appSpec(ctx.db, app), action);
    await ctx.db.update(paasApps).set({ status: action === "stop" ? "stopped" : "running" }).where(eq(paasApps.id, app.id));
    await logActivity(ctx.db, a.uid, "power", ({ start: "روشن کردن", stop: "خاموش کردن", restart: "راه‌اندازی مجدد" })[action] + " اپ " + app.name, ctx.ip);
  }),

  "paas.deleteApp": method(z.tuple([id, z.string().max(30)]), async (ctx, [appId, confirm]) => {
    const { a, app } = await ownApp(ctx, appId);
    if (confirm !== app.name) fail("برای حذف، نام اپ را دقیق وارد کنید.");
    await (await paas()).remove(await appSpec(ctx.db, app));
    await ctx.db.delete(paasApps).where(eq(paasApps.id, app.id));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف اپ " + app.name, ctx.ip);
  }),

  "paas.regenHook": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    await ctx.db.update(paasApps).set({ hookToken: randomBytes(24).toString("base64url") }).where(eq(paasApps.id, app.id));
  }),

  "paas.addDomain": method(z.tuple([id, z.string().trim().toLowerCase().max(253)]), async (ctx, [appId, host]) => {
    const { app } = await ownApp(ctx, appId);
    if (!HOST_RE.test(host)) fail("دامنه معتبر نیست؛ مثل app.example.com");
    const base = await appsDomain(ctx.db);
    if (host === base || host.endsWith("." + base)) fail("زیردامنه‌های پلتفرم را نمی‌توان اضافه کرد.");
    const count = await ctx.db.select({ id: paasDomains.id }).from(paasDomains).where(eq(paasDomains.appId, app.id));
    if (count.length >= 20) fail("حداکثر ۲۰ دامنه برای هر اپ.");
    const [taken] = await ctx.db.select({ id: paasDomains.id }).from(paasDomains).where(eq(paasDomains.host, host));
    if (taken) fail("این دامنه به اپ دیگری متصل است.");
    const did = rid("pdm");
    await ctx.db.insert(paasDomains).values({ id: did, appId: app.id, host });
    await checkDomain(ctx.db, did, app);
    return did;
  }),
  "paas.checkDomain": method(z.tuple([id]), async (ctx, [domId]) => {
    const a = needUser(ctx);
    const [row] = await ctx.db.select({ dm: paasDomains, app: paasApps }).from(paasDomains).innerJoin(paasApps, eq(paasApps.id, paasDomains.appId)).where(and(eq(paasDomains.id, domId), eq(paasApps.userId, a.uid)));
    if (!row) fail("دامنه پیدا نشد.", 404);
    if (row!.dm.status === "failed") await ctx.db.update(paasDomains).set({ status: "pending", createdAt: new Date() }).where(eq(paasDomains.id, domId));
    const ok = await checkDomain(ctx.db, domId, row!.app);
    if (!ok) fail("رکورد DNS هنوز به گره اشاره نمی‌کند؛ پس از ثبت رکورد ممکن است تا چند ساعت طول بکشد.");
  }),
  "paas.removeDomain": method(z.tuple([id]), async (ctx, [domId]) => {
    const a = needUser(ctx);
    const [row] = await ctx.db.select({ dm: paasDomains, app: paasApps }).from(paasDomains).innerJoin(paasApps, eq(paasApps.id, paasDomains.appId)).where(and(eq(paasDomains.id, domId), eq(paasApps.userId, a.uid)));
    if (!row) fail("دامنه پیدا نشد.", 404);
    await ctx.db.delete(paasDomains).where(eq(paasDomains.id, domId));
    await redeployConfig(ctx.db, row!.app, "حذف دامنه " + row!.dm.host);
  }),

  /* ---------------- databases ---------------- */
  "paas.createDb": method(z.tuple([z.object({ name: z.string().trim().toLowerCase().max(30), engine: z.enum(DB_ENGINES.map((e) => e.id) as [string, ...string[]]), version: z.string().max(10), planId: id, publicAccess: z.boolean().default(false), backups: z.boolean().default(true) })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    checkName(i.name);
    const e = DB_ENGINES.find((x) => x.id === i.engine)!;
    if (!e.versions.includes(i.version)) fail("نسخه انتخابی پشتیبانی نمی‌شود.");
    const p = await plan(ctx, i.planId, "db");
    await needCredit(ctx, a.uid, p.price);
    const [dup] = await ctx.db.select({ id: paasDbs.id }).from(paasDbs).where(and(eq(paasDbs.userId, a.uid), eq(paasDbs.name, i.name)));
    if (dup) fail("پایگاه داده‌ای با این نام دارید.");
    const dbId = rid("pdb");
    const password = randomBytes(18).toString("base64url");
    await ctx.db.insert(paasDbs).values({ id: dbId, userId: a.uid, name: i.name, engine: i.engine as never, version: i.version, planId: p.id, port: e.port, username: i.engine === "redis" ? "default" : "u_" + i.name.replace(/-/g, "_").slice(0, 20), passwordEnc: seal(password), dbName: i.name.replace(/-/g, "_"), publicAccess: i.publicAccess, backups: i.backups });
    await enqueue(ctx.db, "paas.db", { dbId });
    await logActivity(ctx.db, a.uid, "database", "ساخت پایگاه داده " + e.label + " " + i.name, ctx.ip);
    return dbId;
  }),

  /** connection details including the password (logged) */
  "paas.dbCredentials": method(z.tuple([id]), async (ctx, [dbId]) => {
    const { a, row } = await ownDb(ctx, dbId);
    const password = open(row.passwordEnc) ?? "";
    await logActivity(ctx.db, a.uid, "key-round", "نمایش رمز پایگاه داده " + row.name, ctx.ip);
    return { password, url: connectionUrl(row, password), publicUrl: row.publicAccess && row.publicPort ? connectionUrl({ ...row, host: "db." + (await appsDomain(ctx.db)), port: row.publicPort }, password) : "" };
  }),

  "paas.resetDbPassword": method(z.tuple([id]), async (ctx, [dbId]) => {
    const { a, row } = await ownDb(ctx, dbId);
    const password = randomBytes(18).toString("base64url");
    await ctx.db.update(paasDbs).set({ passwordEnc: seal(password) }).where(eq(paasDbs.id, row.id));
    const next = { ...row, passwordEnc: seal(password) };
    await (await paas()).updateDb(await dbSpec(ctx.db, next));
    // linked apps get the new URL
    for (const l of await ctx.db.select().from(paasLinks).where(eq(paasLinks.dbId, row.id))) {
      const [app] = await ctx.db.select().from(paasApps).where(eq(paasApps.id, l.appId));
      if (app) await redeployConfig(ctx.db, app, "رمز جدید پایگاه داده " + row.name);
    }
    await logActivity(ctx.db, a.uid, "key-round", "تغییر رمز پایگاه داده " + row.name, ctx.ip);
  }),

  "paas.updateDb": method(z.tuple([id, z.object({ planId: id.optional(), publicAccess: z.boolean().optional(), backups: z.boolean().optional() })]), async (ctx, [dbId, patch]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (patch.planId && patch.planId !== row.planId) {
      const p = await plan(ctx, patch.planId, "db");
      const [cur] = await ctx.db.select().from(paasPlans).where(eq(paasPlans.id, row.planId));
      if (cur && p.diskGb < cur.diskGb) fail("کوچک کردن دیسک پایگاه داده ممکن نیست؛ پلنی با دیسک برابر یا بزرگ‌تر انتخاب کنید.");
      if (cur && p.price > cur.price) await needCredit(ctx, a.uid, p.price - cur.price);
    }
    const [next] = await ctx.db.update(paasDbs).set(patch).where(eq(paasDbs.id, row.id)).returning();
    if (patch.planId !== undefined || patch.publicAccess !== undefined) {
      const r = await (await paas()).updateDb(await dbSpec(ctx.db, next));
      await ctx.db.update(paasDbs).set({ publicPort: r.publicPort ?? null }).where(eq(paasDbs.id, row.id));
    }
  }),

  "paas.dbPower": method(z.tuple([id, z.enum(["start", "stop"])]), async (ctx, [dbId, action]) => {
    const { row } = await ownDb(ctx, dbId);
    if (row.status === "creating") fail("پایگاه داده هنوز آماده نشده است.");
    await (await paas()).setDbState(await dbSpec(ctx.db, row), action);
    await ctx.db.update(paasDbs).set({ status: action === "stop" ? "stopped" : "running" }).where(eq(paasDbs.id, row.id));
  }),

  "paas.deleteDb": method(z.tuple([id, z.string().max(30)]), async (ctx, [dbId, confirm]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (confirm !== row.name) fail("برای حذف، نام پایگاه داده را دقیق وارد کنید.");
    const links = await ctx.db.select().from(paasLinks).where(eq(paasLinks.dbId, row.id));
    if (links.length) fail("این پایگاه داده به " + links.length.toLocaleString("fa-IR") + " اپ متصل است؛ اول اتصال‌ها را بردارید.");
    await (await paas()).removeDb(await dbSpec(ctx.db, row));
    await ctx.db.delete(paasDbs).where(eq(paasDbs.id, row.id));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف پایگاه داده " + row.name, ctx.ip);
  }),

  "paas.backupDb": method(z.tuple([id]), async (ctx, [dbId]) => {
    const { row } = await ownDb(ctx, dbId);
    if (row.status !== "running") fail("پایگاه داده باید روشن باشد.");
    const [running] = await ctx.db.select({ id: paasDbBackups.id }).from(paasDbBackups).where(and(eq(paasDbBackups.dbId, row.id), eq(paasDbBackups.status, "running")));
    if (running) fail("یک پشتیبان‌گیری در جریان است.");
    const manual = await ctx.db.select({ id: paasDbBackups.id }).from(paasDbBackups).where(and(eq(paasDbBackups.dbId, row.id), eq(paasDbBackups.kind, "manual"))).orderBy(desc(paasDbBackups.createdAt));
    if (manual.length >= 10) fail("حداکثر ۱۰ پشتیبان دستی؛ پشتیبان‌های قدیمی را حذف کنید.");
    const bid = rid("bk");
    await ctx.db.insert(paasDbBackups).values({ id: bid, dbId: row.id, kind: "manual" });
    await enqueue(ctx.db, "paas.backup", { backupId: bid });
    return bid;
  }),
  "paas.deleteBackup": method(z.tuple([id]), async (ctx, [bid]) => {
    const a = needUser(ctx);
    const [b] = await ctx.db.select({ b: paasDbBackups }).from(paasDbBackups).innerJoin(paasDbs, eq(paasDbs.id, paasDbBackups.dbId)).where(and(eq(paasDbBackups.id, bid), eq(paasDbs.userId, a.uid)));
    if (!b) fail("پشتیبان پیدا نشد.", 404);
    await ctx.db.delete(paasDbBackups).where(eq(paasDbBackups.id, bid));
  }),
  "paas.restoreDb": method(z.tuple([id]), async (ctx, [bid]) => {
    const a = needUser(ctx);
    const [r] = await ctx.db.select({ b: paasDbBackups, d: paasDbs }).from(paasDbBackups).innerJoin(paasDbs, eq(paasDbs.id, paasDbBackups.dbId)).where(and(eq(paasDbBackups.id, bid), eq(paasDbs.userId, a.uid)));
    if (!r || r.b.status !== "done") fail("پشتیبان آماده پیدا نشد.", 404);
    if (r!.d.status === "suspended") fail("این پایگاه داده معلق است.", 403);
    await enqueue(ctx.db, "paas.backup", { backupId: bid, restore: true });
    await logActivity(ctx.db, a.uid, "database-backup", "بازگردانی پایگاه داده " + r!.d.name, ctx.ip);
  }),

  /** wire a database into an app as an env var (DATABASE_URL, REDIS_URL…) */
  "paas.link": method(z.tuple([id, id, z.string().max(128).optional()]), async (ctx, [appId, dbId, key]) => {
    const { app } = await ownApp(ctx, appId);
    const { row } = await ownDb(ctx, dbId);
    const envKey = key?.trim() || defaultEnvKey(row.engine);
    if (!ENV_KEY_RE.test(envKey) || ENV_RESERVED.has(envKey)) fail("نام متغیر معتبر نیست.");
    const [clash] = await ctx.db.select().from(paasEnv).where(and(eq(paasEnv.appId, app.id), eq(paasEnv.key, envKey)));
    const [clash2] = await ctx.db.select().from(paasLinks).where(and(eq(paasLinks.appId, app.id), eq(paasLinks.envKey, envKey)));
    if (clash2 && clash2.dbId !== row.id) fail("متغیر " + envKey + " برای پایگاه داده دیگری استفاده شده است.");
    if (clash) fail("متغیر " + envKey + " در این اپ وجود دارد؛ نام دیگری بدهید.");
    await ctx.db.insert(paasLinks).values({ appId: app.id, dbId: row.id, envKey }).onConflictDoNothing();
    return redeployConfig(ctx.db, app, "اتصال پایگاه داده " + row.name);
  }),
  "paas.unlink": method(z.tuple([id, id]), async (ctx, [appId, dbId]) => {
    const { app } = await ownApp(ctx, appId);
    await ctx.db.delete(paasLinks).where(and(eq(paasLinks.appId, app.id), eq(paasLinks.dbId, dbId)));
    return redeployConfig(ctx.db, app, "جدا کردن پایگاه داده");
  }),

  /* ---------------- staff ---------------- */
  "paas.adminPlan": method(z.tuple([id, z.object({ name: z.string().max(40).optional(), price: z.number().int().min(1000).max(1e10).optional(), active: z.boolean().optional() })]), async (ctx, [planId, patch]) => {
    needStaff(ctx, "products");
    const r = await ctx.db.update(paasPlans).set(patch).where(eq(paasPlans.id, planId)).returning({ id: paasPlans.id });
    if (!r.length) fail("پلن پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "تغییر پلن گره اپ", planId, ctx.ip);
  }),
  "paas.adminSuspend": method(z.tuple([z.enum(["app", "db"]), id, z.boolean()]), async (ctx, [kind, targetId, on]) => {
    needStaff(ctx, "services");
    const d = await paas();
    if (kind === "app") {
      const [app] = await ctx.db.select().from(paasApps).where(eq(paasApps.id, targetId));
      if (!app) fail("اپ پیدا نشد.", 404);
      await d.setState(await appSpec(ctx.db, app!), on ? "stop" : "start");
      await ctx.db.update(paasApps).set({ status: on ? "suspended" : app!.liveDeployment ? "running" : "failed", suspendedAt: on ? new Date() : null }).where(eq(paasApps.id, targetId));
    } else {
      const [row] = await ctx.db.select().from(paasDbs).where(eq(paasDbs.id, targetId));
      if (!row) fail("پایگاه داده پیدا نشد.", 404);
      await d.setDbState(await dbSpec(ctx.db, row!), on ? "stop" : "start");
      await ctx.db.update(paasDbs).set({ status: on ? "suspended" : "running", suspendedAt: on ? new Date() : null }).where(eq(paasDbs.id, targetId));
    }
    await logAudit(ctx.db, actor(ctx), (on ? "تعلیق " : "رفع تعلیق ") + (kind === "app" ? "اپ" : "پایگاه داده"), targetId, ctx.ip);
  }),
  "paas.adminTest": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "infra");
    const d = await paas();
    return { driver: d.name, ...(await d.test()) };
  }),
};
