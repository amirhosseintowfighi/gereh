/* The builder in the public API (/api/v1/builder/…) and so in MCP: create from a prompt, edit, deploy,
   status. Generation runs to completion inside the request (no stream) and is billed like the panel. */
import "server-only";
import { BUILDER } from "@/lib/builder";
import type { Ctx } from "../ctx";
import { AppError } from "../util";
import { ownProject, runAgent } from "./engine";
import { listProjects, projectView, runView } from "./service";

type Route = { method: string; pattern: RegExp; write?: boolean; run: (ctx: Ctx, m: RegExpExecArray, body: Record<string, unknown>) => Promise<unknown> };

async function rpc<T>(ctx: Ctx, name: string, ...args: unknown[]) {
  const { registry } = await import("../rpc");
  const m = registry[name];
  return (await m.run(ctx, m.args.parse(args))) as T;
}
async function statusOut(ctx: Ctx, id: string) {
  const p = await ownProject(ctx.db, ctx.auth!.uid, id);
  if (!p) throw new AppError("Not found", 404);
  const v = await projectView(ctx.db, p);
  return {
    id: v.id, name: v.name, product: BUILDER.name, stack: v.stack, status: v.status, version: v.version, deployed_version: v.deployedVersion, files: v.tree.map((f) => f.path),
    live_url: v.liveUrl, app_id: v.appId, app_name: v.appName, ai_cost_toman: v.spent, site_language: v.siteLanguage, site_dir: v.siteDir,
    deploy: v.deploy && { status: v.deploy.status, attempt: v.deploy.attempt, failure: v.deploy.failure, log_tail: v.deploy.log.slice(-1500) },
    plan: v.plan, latest_runs: v.runs.slice(0, 5).map((r) => ({ id: r.id, kind: r.kind, status: r.status, summary: r.summary, cost_toman: r.cost, review_cost_toman: r.reviewCost, skills: r.skills, quality_score: r.quality?.score ?? null, diff: r.diff, at: r.at })),
  };
}
async function generate(ctx: Ctx, id: string, prompt: string) {
  const p = await ownProject(ctx.db, ctx.auth!.uid, id);
  if (!p) throw new AppError("Not found", 404);
  if (prompt.trim().length < 2) throw new AppError("prompt is required");
  const r = await runAgent(ctx.db, { userId: ctx.auth!.uid, projectId: p.id, kind: p.version ? "edit" : "generate", prompt: prompt.slice(0, 4000) });
  if (!r.ok) throw new AppError(r.error, r.status && r.status >= 400 && r.status < 600 && r.status !== 499 ? r.status : 400);
  return { project: await statusOut(ctx, p.id), run: runView(r.run) };
}

export const BUILDER_ROUTES: Route[] = [
  { method: "GET", pattern: /^builder\/projects$/, run: async (ctx) => ({ data: await listProjects(ctx.db, ctx.auth!.uid) }) },
  { method: "GET", pattern: /^builder\/projects\/([\w-]+)$/, run: async (ctx, m) => statusOut(ctx, m[1]) },
  { method: "POST", pattern: /^builder\/projects$/, write: true, run: async (ctx, _m, b) => {
    const id = await rpc<string>(ctx, "builder.create", { prompt: String(b.prompt ?? ""), stack: ["static", "node"].includes(String(b.stack)) ? b.stack : "auto", ...(typeof b.language === "string" ? { language: b.language } : {}) });
    return generate(ctx, id, String(b.prompt ?? ""));
  } },
  { method: "POST", pattern: /^builder\/projects\/([\w-]+)\/edit$/, write: true, run: async (ctx, m, b) => generate(ctx, m[1], String(b.prompt ?? "")) },
  { method: "POST", pattern: /^builder\/projects\/([\w-]+)\/deploy$/, write: true, run: async (ctx, m) => {
    const r = await rpc<{ deploymentId: string | null; fixing: boolean }>(ctx, "builder.deploy", m[1]);
    return { deployment_id: r.deploymentId, auto_fixing: r.fixing, project: await statusOut(ctx, m[1]) };
  } },
];
