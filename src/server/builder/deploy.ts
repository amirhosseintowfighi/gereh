/* Deploying a builder project on Gereh Apps: a pre-flight check of the files, a ZIP through the normal
   upload flow, the app (and, when the code uses DATABASE_URL, a PostgreSQL database) created through the
   same RPC methods as the panel, then a watch job. A failed build or start triggers the auto-fix loop:
   the AI reads the log, patches the files and the project redeploys, at most MAX_FIXES times. */
import "server-only";
import { writeFile } from "node:fs/promises";
import { and, asc, desc, eq } from "drizzle-orm";
import { BUILDER } from "@/lib/builder";
import { appMonthly, hourlyOf, PAAS_NAME_RE } from "@/lib/paas";
import { classifyFailure, FAILURES } from "@/lib/paas-runtime";
import type { Ctx } from "../ctx";
import type { DB } from "../db/client";
import { builderMessages, builderProjects, paasApps, paasDeployments, paasPlans, users } from "../db/schema";
import { enqueue } from "../jobs";
import { appsDomain, newUploadId, uploadPathFor } from "../paas/service";
import { AppError, notify, rid } from "../util";
import { zip } from "../xlsx";
import { localizeFiles } from "./assets";
import { filesAt, runAgent, type Project } from "./engine";

export const MAX_FIXES = 3;
const pollMs = () => Number(process.env.PAAS_POLL_MS ?? 3000);
const later = (ms: number) => new Date(Date.now() + ms);
const WATCH_LIMIT_MS = 45 * 60_000;

/** acts for the owner from the worker (fix loop, maintenance): the same RPC checks as the panel */
export async function systemCtx(db: DB, userId: string): Promise<Ctx> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("کاربر پیدا نشد.", 404);
  return { db, auth: { sessionId: "system:builder", user: u, uid: u.id }, ip: "", device: BUILDER.slug };
}
const call = async <T>(ctx: Ctx, name: string, ...args: unknown[]) => {
  const { registry } = await import("../rpc"); // lazy: the RPC registry imports this module
  const m = registry[name];
  return (await m.run(ctx, m.args.parse(args))) as T;
};

/* ---------- pre-flight: catch what would surely fail the build, with a builder-style log ---------- */
const BUILTIN = /^(node:|path$|fs$|http$|https$|crypto$|url$|os$|util$|events$|stream$|zlib$|child_process$|querystring$|buffer$|assert$|net$|dns$|timers$)/;
export function preflight(files: Record<string, string>, stack: Project["stack"]): { log: string; failure: string } | null {
  const head = "==> Checking project files (" + Object.keys(files).length + " files)";
  const bad = (lines: string[]) => { const log = [head, ...lines, "ERROR: build step exited with code 1"].join("\n"); return { log, failure: classifyFailure(log) }; };
  if (stack === "static") {
    if (!files["index.html"]) return bad(["==> Static site: serving with nginx", "nginx: index.html not found at the project root (403 on /)", "health check failed: GET / returned 403"]);
    return null;
  }
  if (!files["package.json"]) return bad(["$ npm install", "npm ERR! code ENOENT", "npm ERR! enoent Could not read package.json: no such file or directory"]);
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string> };
  try { pkg = JSON.parse(files["package.json"]); } catch (e) { return bad(["$ npm install", "npm ERR! code EJSONPARSE", "npm ERR! JSON.parse Failed to parse package.json: " + (e as Error).message]); }
  const start = pkg?.scripts?.start;
  if (!start) return bad(["$ npm start", 'npm ERR! Missing script: "start"', "No start command could be found"]);
  const entry = /node\s+([\w./-]+\.(?:c|m)?js)/.exec(start)?.[1]?.replace(/^\.\//, "");
  if (entry && !files[entry]) return bad(["$ " + start, "Error: Cannot find module '/app/" + entry + "'", "could not determine how to start: " + entry + " is missing"]);
  const deps = pkg.dependencies ?? {};
  const server = Object.entries(files).filter(([p]) => /\.(c|m)?js$/.test(p) && !p.startsWith("public/")).map(([, c]) => c).join("\n");
  for (const m of server.matchAll(/require\(\s*["']([^"'.][^"']*)["']\s*\)|^\s*import\s[^"'\n]*?from\s+["']([^"'.][^"']*)["']/gm)) {
    const name = (m[1] ?? m[2]).startsWith("@") ? (m[1] ?? m[2]).split("/").slice(0, 2).join("/") : (m[1] ?? m[2]).split("/")[0];
    if (!BUILTIN.test(name) && !deps[name]) return bad(["$ npm install --omit=dev", "$ " + start, "Error: Cannot find module '" + name + "'", "npm ERR! missing dependency: " + name + " is required but not listed in package.json"]);
  }
  if (entry && files[entry] && !/process\.env\.PORT/.test(files[entry])) return bad(["$ " + start, "listening on a fixed port", "Readiness probe failed: dial tcp 10.42.0.17:8080: connect: connection refused (no process listening on port 8080)"]);
  return null;
}

export const needsDb = (files: Record<string, string>, stack: Project["stack"]) => stack === "node" && Object.values(files).some((c) => c.includes("DATABASE_URL"));

/** the cheapest active plans: what one click deploys on */
export async function cheapestPlans(db: DB) {
  const plans = await db.select().from(paasPlans).where(eq(paasPlans.active, true)).orderBy(asc(paasPlans.price));
  return { app: plans.find((p) => p.kind === "app") ?? null, db: plans.find((p) => p.kind === "db") ?? null };
}
export async function quote(db: DB, p: Project, files: Record<string, string>) {
  const { app, db: dbPlan } = await cheapestPlans(db);
  if (!app) return null;
  const [cur] = p.appId ? await db.select({ planId: paasApps.planId }).from(paasApps).where(eq(paasApps.id, p.appId)) : [];
  const plan = cur ? (await db.select().from(paasPlans).where(eq(paasPlans.id, cur.planId)))[0] ?? app : app;
  const dbMonthly = needsDb(files, p.stack) && !p.dbId && dbPlan ? dbPlan.price : 0;
  return { id: plan.id, name: plan.name, monthly: appMonthly(plan, 1, 0), hourly: hourlyOf(appMonthly(plan, 1, 0)), dbMonthly };
}

const PREFIX: [RegExp, string][] = [[/نوبت|آرایش|سالن|زیبایی/, "salon"], [/فروشگاه|لباس|خرید/, "shop"], [/رستوران|کافه|غذا|منو/, "food"], [/رویداد|همایش|ثبت[‌ ]?نام/, "event"]];
async function freeName(db: DB, p: Project) {
  const base = PREFIX.find(([re]) => re.test(p.description + " " + p.name))?.[1] ?? (p.stack === "node" ? "app" : "site");
  for (let i = 0; i < 8; i++) {
    const name = base + "-" + rid("x").slice(2, 7);
    if (!PAAS_NAME_RE.test(name)) continue;
    const [taken] = await db.select({ id: paasApps.id }).from(paasApps).where(eq(paasApps.name, name));
    if (!taken) return name;
  }
  throw new AppError("نام آزادی برای اپ پیدا نشد؛ دوباره تلاش کنید.");
}

const say = (db: DB, projectId: string, content: string, runId: string | null = null) => db.insert(builderMessages).values({ projectId, role: "assistant", content, runId });

/** zips the current files and deploys them (creating the app on the first deploy); attempt is 1-based */
export async function startDeploy(ctx: Ctx, projectId: string, attempt = 1): Promise<{ deploymentId: string | null; fixing: boolean }> {
  const uid = ctx.auth!.uid;
  const [p] = await ctx.db.select().from(builderProjects).where(and(eq(builderProjects.id, projectId), eq(builderProjects.userId, uid)));
  if (!p) throw new AppError("پروژه پیدا نشد.", 404);
  if (!p.version) throw new AppError("پروژه هنوز فایلی ندارد؛ اول ایده را بنویسید تا AI آن را بسازد.");
  if (p.status === "generating") throw new AppError("AI در حال نوشتن کد است؛ پس از پایان، منتشر کنید.", 409);
  const files = await filesAt(ctx.db, p.id, p.version);
  const pre = preflight(files, p.stack);
  if (pre) {
    // the build would fail: go straight to the fix loop without spending a deploy
    await ctx.db.update(builderProjects).set({ status: "fixing", deployAttempt: attempt, deployError: pre.log, deploymentId: null, updatedAt: new Date() }).where(eq(builderProjects.id, p.id));
    await afterFailure(ctx.db, p, attempt, pre.log, pre.failure);
    return { deploymentId: null, fixing: true };
  }

  const uploadId = newUploadId();
  const path = await uploadPathFor(uid, uploadId);
  // the deployed pages load Tailwind and the font from Gereh, not from foreign CDNs
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const shipped = /^https:\/\//.test(site) ? localizeFiles(files, site) : files;
  await writeFile(path!, zip(Object.entries(shipped).map(([n, c]) => [n, Buffer.from(c, "utf8")])));
  let appId = p.appId, depId: string;
  const [app] = appId ? await ctx.db.select().from(paasApps).where(and(eq(paasApps.id, appId), eq(paasApps.userId, uid))) : [];
  if (!app) {
    const { app: plan, db: dbPlan } = await cheapestPlans(ctx.db);
    if (!plan) throw new AppError("پلن فعالی برای اپ‌ها تعریف نشده است.");
    let dbId = p.dbId;
    const name = await freeName(ctx.db, p);
    if (needsDb(files, p.stack) && !dbId && dbPlan) dbId = await call<string>(ctx, "paas.createDb", { name: name + "-db", engine: "postgres", version: "17", planId: dbPlan.id, publicAccess: false, backups: true });
    appId = await call<string>(ctx, "paas.createApp", {
      name, stack: p.stack === "node" ? "node" : "static", source: "zip", uploadId, port: p.stack === "node" ? 8080 : 80, planId: plan.id,
      startCommand: p.stack === "node" ? "npm start" : "", env: [],
    });
    if (p.stack === "node") await ctx.db.update(paasApps).set({ healthPath: "/healthz" }).where(eq(paasApps.id, appId));
    if (dbId) await call(ctx, "paas.link", appId, dbId, "DATABASE_URL");
    const [d] = await ctx.db.select({ id: paasDeployments.id }).from(paasDeployments).where(eq(paasDeployments.appId, appId)).orderBy(desc(paasDeployments.createdAt)).limit(1);
    depId = d.id;
    await ctx.db.update(builderProjects).set({ appId, dbId }).where(eq(builderProjects.id, p.id));
  } else {
    depId = await call<string>(ctx, "paas.deploy", app.id, { uploadId, message: (attempt > 1 ? "رفع خودکار خطا — " : "") + BUILDER.name + " نسخه " + p.version });
  }
  await ctx.db.update(builderProjects).set({ status: "deploying", deploymentId: depId, deployAttempt: attempt, deployError: "", updatedAt: new Date() }).where(eq(builderProjects.id, p.id));
  await enqueue(ctx.db, "builder.watch", { projectId: p.id, deploymentId: depId, attempt, version: p.version, since: Date.now() }, { runAt: later(pollMs()) });
  return { deploymentId: depId, fixing: false };
}

async function afterFailure(db: DB, p: Project, attempt: number, log: string, failure: string) {
  if (attempt > MAX_FIXES) {
    const msg = "انتشار پس از " + MAX_FIXES.toLocaleString("fa-IR") + " بار تلاش برای رفع خودکار ناموفق ماند. لاگ بیلد را ببینید یا درخواست را ساده‌تر کنید و دوباره منتشر کنید.";
    await db.update(builderProjects).set({ status: "failed", deployError: log.slice(-20_000) }).where(eq(builderProjects.id, p.id));
    await say(db, p.id, msg);
    await notify(db, p.userId, "circle-alert", "انتشار پروژه «" + p.name + "» ناموفق بود");
    return;
  }
  await db.update(builderProjects).set({ status: "fixing", deployError: log.slice(-20_000) }).where(eq(builderProjects.id, p.id));
  await say(db, p.id, "انتشار ناموفق بود" + (failure && failure in FAILURES ? " (" + FAILURES[failure as keyof typeof FAILURES].title + ")" : "") + "؛ AI در حال بررسی لاگ و رفع خودکار خطاست (تلاش " + attempt.toLocaleString("fa-IR") + " از " + MAX_FIXES.toLocaleString("fa-IR") + ").");
  await enqueue(db, "builder.fix", { projectId: p.id, attempt, log: log.slice(-8000), failure });
}

/* ---------- worker jobs ---------- */
/** follows a deployment: live → done; failed → the fix loop */
export async function builderWatch(db: DB, j: { projectId: string; deploymentId: string; attempt: number; version: number; since: number }) {
  const [p] = await db.select().from(builderProjects).where(eq(builderProjects.id, j.projectId));
  if (!p || p.deploymentId !== j.deploymentId) return;
  const [dep] = await db.select().from(paasDeployments).where(eq(paasDeployments.id, j.deploymentId));
  if (!dep) return;
  if (["queued", "building", "deploying"].includes(dep.status)) {
    if (Date.now() - j.since > WATCH_LIMIT_MS) { await db.update(builderProjects).set({ status: "failed", deployError: "زمان انتشار طولانی شد." }).where(eq(builderProjects.id, p.id)); return; }
    await enqueue(db, "builder.watch", j, { runAt: later(pollMs()) });
    return;
  }
  if (dep.status === "live" || dep.status === "superseded") {
    const [app] = p.appId ? await db.select().from(paasApps).where(eq(paasApps.id, p.appId)) : [];
    const url = app ? "https://" + app.name + "." + (await appsDomain(db)) : "";
    await db.update(builderProjects).set({ status: "live", deployedVersion: j.version, deployError: "", updatedAt: new Date() }).where(eq(builderProjects.id, p.id));
    await say(db, p.id, "🎉 منتشر شد" + (j.attempt > 1 ? " (پس از رفع خودکار خطا)" : "") + "! نشانی سایت: " + url);
    await notify(db, p.userId, "rocket", "پروژه «" + p.name + "» منتشر شد: " + url.replace("https://", ""));
    return;
  }
  if (dep.status === "failed") await afterFailure(db, p, j.attempt, dep.log, dep.failure || classifyFailure(dep.log));
}

/** asks the AI for a fix of a failed deploy, then redeploys */
export async function builderFix(db: DB, j: { projectId: string; attempt: number; log: string; failure: string }) {
  const [p] = await db.select().from(builderProjects).where(eq(builderProjects.id, j.projectId));
  if (!p || p.status !== "fixing") return;
  const r = await runAgent(db, { userId: p.userId, projectId: p.id, kind: "fix", attempt: j.attempt, context: { log: j.log, failure: j.failure } });
  if (!r.ok) {
    await db.update(builderProjects).set({ status: "failed" }).where(eq(builderProjects.id, p.id));
    await say(db, p.id, "رفع خودکار انجام نشد: " + r.error);
    return;
  }
  try { await startDeploy(await systemCtx(db, p.userId), p.id, j.attempt + 1); }
  catch (e) {
    if (!(e instanceof AppError)) throw e;
    await db.update(builderProjects).set({ status: "failed", deployError: e.message }).where(eq(builderProjects.id, p.id));
    await say(db, p.id, "انتشار دوباره انجام نشد: " + e.message);
  }
}
