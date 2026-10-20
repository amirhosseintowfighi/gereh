import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BUILDER } from "@/lib/builder";
import { rateLimit } from "../auth";
import { method, needUser, type Ctx } from "../ctx";
import { aiModels, builderProjects } from "../db/schema";
import { startDeploy } from "../builder/deploy";
import { filesAt, ownProject } from "../builder/engine";
import { applyPatch, maintainProject } from "../builder/maintain";
import { createProject, listProjects, projectView, restoreVersion, runView, writeFile } from "../builder/service";
import { faDateTime } from "@/lib/jalali";
import { dirOf, LANG_RE } from "@/lib/site-language";
import { paas } from "../paas/driver";
import { logEvent } from "../paas/runtime";
import { fail, logActivity } from "../util";

const id = z.string().max(40);
const stack = z.enum(["auto", "static", "node"]);
const language = z.string().trim().max(20).refine((s) => s === "auto" || LANG_RE.test(s), "زبان نامعتبر است.");

async function own(ctx: Ctx, projectId: string) {
  const a = needUser(ctx);
  const p = await ownProject(ctx.db, a.uid, projectId);
  if (!p) fail("پروژه پیدا نشد.", 404);
  return { a, p: p! };
}
async function checkModel(ctx: Ctx, model: string) {
  const [m] = await ctx.db.select().from(aiModels).where(and(eq(aiModels.id, model), eq(aiModels.kind, "chat"), eq(aiModels.active, true)));
  if (!m) fail("این مدل در دسترس نیست.");
}

export const builderRpc = {
  "builder.list": method(z.tuple([]), async (ctx) => listProjects(ctx.db, needUser(ctx).uid)),
  "builder.get": method(z.tuple([id]), async (ctx, [projectId]) => projectView(ctx.db, (await own(ctx, projectId)).p)),

  /** a new project from an idea; the panel then streams the first generation from /api/build/run */
  "builder.create": method(z.tuple([z.object({ prompt: z.string().trim().min(3, "ایده را کمی کامل‌تر بنویسید.").max(4000), stack: stack.default("auto"), model: z.string().max(80).optional(), language: language.optional() })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    await rateLimit(ctx.db, "builder-create:" + a.uid, 30, 3600);
    if (i.model) await checkModel(ctx, i.model);
    const projectId = await createProject(ctx.db, a.uid, i);
    await logActivity(ctx.db, a.uid, "sparkles", "پروژه جدید در " + BUILDER.name, ctx.ip);
    return projectId;
  }),

  "builder.update": method(z.tuple([id, z.object({ name: z.string().trim().min(1).max(80).optional(), model: z.string().max(80).optional(), selfReview: z.boolean().optional(), language: language.optional(), autoMaintain: z.boolean().optional(), maintainCap: z.number().int().min(0).max(50_000_000).optional(), maintainMode: z.enum(["continuous", "incident", "manual"]).optional(), scanEvery: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional() })]), async (ctx, [projectId, patch]) => {
    const { p } = await own(ctx, projectId);
    if (patch.model) await checkModel(ctx, patch.model);
    const { language, ...rest } = patch;
    // a chosen language applies to the next run; "auto" keeps the language the site already has
    const lang = language === undefined ? {} : language === "auto" ? { languageSetting: "auto" } : { languageSetting: language, siteLanguage: language, siteDir: dirOf(language) };
    await ctx.db.update(builderProjects).set({ ...rest, ...lang, updatedAt: new Date() }).where(eq(builderProjects.id, p.id));
  }),

  /** the project only: a deployed app keeps running and stays in the apps list */
  "builder.remove": method(z.tuple([id]), async (ctx, [projectId]) => {
    const { a, p } = await own(ctx, projectId);
    await ctx.db.delete(builderProjects).where(eq(builderProjects.id, p.id));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف پروژه «" + p.name + "» از " + BUILDER.name, ctx.ip);
  }),

  "builder.file": method(z.tuple([id, z.string().max(200), z.number().int().min(1).optional()]), async (ctx, [projectId, path, version]) => {
    const { p } = await own(ctx, projectId);
    const files = await filesAt(ctx.db, p.id, version ?? p.version);
    if (!(path in files)) fail("فایل پیدا نشد.", 404);
    return files[path];
  }),
  "builder.saveFile": method(z.tuple([id, z.string().max(200), z.string().max(200_000).nullable()]), async (ctx, [projectId, path, content]) => {
    const { p } = await own(ctx, projectId);
    if (p.status === "generating") fail("AI در حال نوشتن کد است؛ کمی صبر کنید.", 409);
    return writeFile(ctx.db, p, path, content);
  }),
  "builder.restore": method(z.tuple([id, z.number().int().min(1)]), async (ctx, [projectId, version]) => {
    const { p } = await own(ctx, projectId);
    if (p.status === "generating") fail("AI در حال نوشتن کد است؛ کمی صبر کنید.", 409);
    return restoreVersion(ctx.db, p, version);
  }),

  "builder.deploy": method(z.tuple([id]), async (ctx, [projectId]) => {
    const { a, p } = await own(ctx, projectId);
    if (p.status === "deploying" || p.status === "fixing") fail("انتشار قبلی هنوز در جریان است.", 409);
    const r = await startDeploy(ctx, p.id, 1);
    await logActivity(ctx.db, a.uid, "rocket", "انتشار «" + p.name + "» با " + BUILDER.name, ctx.ip);
    return r;
  }),

  /** «بررسی سلامت با AI»: a diagnosis of the running app now */
  "builder.healthCheck": method(z.tuple([id]), async (ctx, [projectId]) => {
    const { a, p } = await own(ctx, projectId);
    if (!p.appId) fail("پروژه هنوز منتشر نشده است.");
    await rateLimit(ctx.db, "builder-health:" + a.uid, 20, 3600);
    const r = await maintainProject(ctx.db, p, "manual", "", true);
    if (!r.ok) return fail(r.error, r.status === 402 ? 402 : 400);
    return runView(r.run);
  }),
  /** demos on the simulator: a crash of the running app, handled by the maintenance agent right away */
  "builder.simulateIncident": method(z.tuple([id]), async (ctx, [projectId]) => {
    const { a, p } = await own(ctx, projectId);
    if ((await paas()).name !== "simulator") return fail("این امکان فقط در محیط نمایشی در دسترس است.", 403);
    if (!p.appId) return fail("پروژه هنوز منتشر نشده است.");
    await rateLimit(ctx.db, "builder-health:" + a.uid, 20, 3600);
    const message = "container exited with code 1 (Error: Connection terminated unexpectedly); restarted";
    await logEvent(ctx.db, p.appId, "crash", message);
    await ctx.db.update(builderProjects).set({ checkedAt: new Date() }).where(eq(builderProjects.id, p.id));
    const r = await maintainProject(ctx.db, p, "crash", faDateTime(new Date()) + " crash: " + message, false);
    if (!r.ok) return fail(r.error, r.status === 402 ? 402 : 400);
    return runView(r.run);
  }),
  "builder.applyPatch": method(z.tuple([id, id]), async (ctx, [projectId, runId]) => {
    const { p } = await own(ctx, projectId);
    if (p.status === "deploying" || p.status === "fixing") fail("انتشار قبلی هنوز در جریان است.", 409);
    return applyPatch(ctx, p.id, runId);
  }),
};
