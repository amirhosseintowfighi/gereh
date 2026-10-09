/* Managed WordPress: creates the PaaS pieces (MariaDB, WordPress app with disk, link) as one product
   and imports sites from cPanel backups. */
import "server-only";
import { access } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appMonthly } from "@/lib/paas";
import { WP_CONFIG_EXTRA, WP_IMAGE, wpPlanOf } from "@/lib/wordpress";
import { method, needUser, type Ctx } from "../ctx";
import { paasApps, paasDbs, paasJobs, paasLinks, paasPlans, users } from "../db/schema";
import { enqueue } from "../jobs";
import { backupPathFor } from "../paas/service";
import { fail, logActivity, rid } from "../util";
import { paasRpc } from "./paas";

type Run = (m: string, args: unknown[]) => Promise<string>;
const runner = (ctx: Ctx): Run => (m, args) => {
  const meth = (paasRpc as unknown as Record<string, { args: z.ZodTypeAny; run: (c: Ctx, a: unknown) => Promise<unknown> }>)[m];
  return meth.run(ctx, meth.args.parse(args)) as Promise<string>;
};

async function backup(uid: string, uploadId: string) {
  const p = await backupPathFor(uid, uploadId);
  if (!p) fail("فایل پشتیبان نامعتبر است.");
  try { await access(p!); } catch { fail("فایل پشتیبان پیدا نشد؛ دوباره بارگذاری کنید."); }
  return p!;
}

/** queues the import of an uploaded backup into a WordPress site (runs once the site and its database are up) */
async function queueImport(ctx: Ctx, appId: string, sourcePath: string, keepUrl: boolean) {
  const [running] = await ctx.db.select({ id: paasJobs.id }).from(paasJobs).where(and(eq(paasJobs.appId, appId), eq(paasJobs.kind, "import"), eq(paasJobs.status, "running")));
  if (running) fail("یک انتقال در جریان است؛ تا پایان آن صبر کنید.");
  const jobId = rid("job");
  await ctx.db.insert(paasJobs).values({ id: jobId, appId, kind: "import", command: "انتقال سایت از فایل پشتیبان" + (keepUrl ? " (بدون تغییر آدرس)" : ""), sourcePath });
  await enqueue(ctx.db, "wp.import", { jobId, keepUrl, since: Date.now() });
  return jobId;
}

export const wordpressRpc = {
  "wp.create": method(z.tuple([z.object({ name: z.string().trim().toLowerCase().max(30), plan: z.enum(["eco", "turbo"]), uploadId: z.string().max(64).optional(), keepUrl: z.boolean().default(false) })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    const p = wpPlanOf(i.plan)!;
    const [ap] = await ctx.db.select().from(paasPlans).where(eq(paasPlans.id, p.appPlan));
    const [dp] = await ctx.db.select().from(paasPlans).where(eq(paasPlans.id, p.dbPlan));
    if (!ap || !dp) fail("این بسته فعلاً در دسترس نیست.");
    const source = i.uploadId ? await backup(a.uid, i.uploadId) : undefined;
    const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, a.uid));
    const monthly = appMonthly(ap!, 1, p.diskGb) + dp!.price;
    if ((u?.balance ?? 0) < Math.ceil(monthly / 30)) fail("موجودی کیف پول کافی نیست؛ برای شروع دست‌کم هزینه یک روز (" + Math.ceil(monthly / 30).toLocaleString("fa-IR") + " تومان) لازم است.", 402);
    const run = runner(ctx);
    const dbId = await run("paas.createDb", [{ name: (i.name + "-db").slice(0, 30), engine: "mariadb", version: "11.4", planId: dp!.id, publicAccess: false, backups: true }]);
    let appId: string;
    try {
      appId = await run("paas.createApp", [{ name: i.name, stack: "wordpress", source: "image", image: WP_IMAGE, port: 80, planId: ap!.id, instances: 1, diskGb: p.diskGb,
        env: [{ key: "WORDPRESS_CONFIG_EXTRA", value: WP_CONFIG_EXTRA, secret: false }] }]);
    } catch (e) { await ctx.db.delete(paasDbs).where(eq(paasDbs.id, dbId)); throw e; }
    await ctx.db.update(paasApps).set({ product: "wordpress", wpPlan: p.id, diskMount: "/var/www/html", cdn: p.cdn }).where(eq(paasApps.id, appId));
    await ctx.db.insert(paasLinks).values({ appId, dbId, envKey: "@parts:WORDPRESS_DB_" });
    if (source) await queueImport(ctx, appId, source, i.keepUrl);
    await logActivity(ctx.db, a.uid, "layers", "ساخت وردپرس " + p.name + " " + i.name, ctx.ip);
    return appId;
  }),

  /** imports a backup into an existing site (replaces its files and database) */
  "wp.import": method(z.tuple([z.string().max(40), z.string().max(64), z.boolean().default(false)]), async (ctx, [appId, uploadId, keepUrl]) => {
    const a = needUser(ctx);
    const [app] = await ctx.db.select().from(paasApps).where(and(eq(paasApps.id, appId), eq(paasApps.userId, a.uid), eq(paasApps.product, "wordpress")));
    if (!app) fail("سایت پیدا نشد.", 404);
    if (app!.status === "suspended") fail("این سایت معلق است.", 403);
    const jobId = await queueImport(ctx, app!.id, await backup(a.uid, uploadId), keepUrl);
    await logActivity(ctx.db, a.uid, "upload", "انتقال پشتیبان به وردپرس " + app!.name, ctx.ip);
    return jobId;
  }),

  /** moves a site between Eco and Turbo (app size, database size, CDN) */
  "wp.changePlan": method(z.tuple([z.string().max(40), z.enum(["eco", "turbo"])]), async (ctx, [appId, planId]) => {
    const a = needUser(ctx);
    const [app] = await ctx.db.select().from(paasApps).where(and(eq(paasApps.id, appId), eq(paasApps.userId, a.uid), eq(paasApps.product, "wordpress")));
    if (!app) fail("سایت پیدا نشد.", 404);
    const p = wpPlanOf(planId)!;
    if (p.diskGb < app!.diskGb) fail("کوچک کردن دیسک ممکن نیست.");
    const run = runner(ctx);
    await run("paas.scale", [app!.id, { planId: p.appPlan, instances: 1, autoscale: false, maxInstances: 1, diskGb: p.diskGb }]);
    const [link] = await ctx.db.select().from(paasLinks).where(eq(paasLinks.appId, app!.id));
    const [d] = link ? await ctx.db.select().from(paasDbs).where(and(eq(paasDbs.id, link.dbId), inArray(paasDbs.status, ["running", "stopped"]))) : [];
    if (d && d.planId !== p.dbPlan) await run("paas.updateDb", [d.id, { planId: p.dbPlan }]);
    await ctx.db.update(paasApps).set({ wpPlan: p.id, cdn: p.cdn }).where(eq(paasApps.id, app!.id));
  }),
};
