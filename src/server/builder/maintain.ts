/* The maintenance agent: watches builder-made apps through the events timeline (crash, OOM, failed
   health checks), reads the logs, asks the AI for a Persian diagnosis and a patch, and tells the owner.
   With «نگهداری خودکار» on, the patch is applied and redeployed by itself: at most AUTO_PER_DAY times a
   day and within the project's monthly AI cost cap. */
import "server-only";
import { and, asc, eq, gt, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { INCIDENT_LABEL } from "@/lib/builder";
import { faDateTime } from "@/lib/jalali";
import { monthKey } from "@/lib/paas-runtime";
import type { Ctx } from "../ctx";
import type { DB } from "../db/client";
import { builderProjects, builderRuns, paasApps, paasEvents } from "../db/schema";
import { enqueue } from "../jobs";
import { paas } from "../paas/driver";
import { appSpec } from "../paas/service";
import { AppError, notify } from "../util";
import { startDeploy, systemCtx } from "./deploy";
import { filesAt, runAgent, saveVersion, type AgentResult, type Project, type Run } from "./engine";

const AUTO_PER_DAY = 3;
const COOLDOWN_MS = 30 * 60_000;
const SEVERITY = ["oom", "crash", "health_failed"];

async function appLogs(db: DB, appId: string | null) {
  if (!appId) return "";
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, appId));
  if (!app) return "";
  try { return (await (await paas()).logs(await appSpec(db, app), 120)).join("\n"); } catch { return ""; }
}

/** one diagnosis; `manual` runs come from the panel button and never auto-apply */
export async function maintainProject(db: DB, p: Project, incident: string, events: string, manual: boolean): Promise<AgentResult> {
  const logs = await appLogs(db, p.appId);
  const r = await runAgent(db, { userId: p.userId, projectId: p.id, kind: "maintain", context: { incident, events, logs } });
  if (!r.ok) return r;
  const label = INCIDENT_LABEL[incident] ?? incident;
  if (!manual) {
    const text = "عامل نگهداری «" + p.name + "»: " + label + " — " + (r.patch ? "تشخیص و وصله پیشنهادی آماده است" : "تشخیص آماده است");
    await notify(db, p.userId, "heart-pulse", text);
    await enqueue(db, "notify.send", { userId: p.userId, kind: "service", subject: text, text: r.run.summary + "\n\nجزئیات و اعمال وصله در پنل گره › " + p.name });
  }
  if (!manual && r.patch && p.autoMaintain) {
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(builderRuns)
      .where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.kind, "maintain"), eq(builderRuns.applied, true), gte(builderRuns.createdAt, new Date(Date.now() - 86400_000))));
    if ((n?.n ?? 0) < AUTO_PER_DAY) {
      try { await applyPatch(await systemCtx(db, p.userId), p.id, r.run.id); }
      catch (e) { if (!(e instanceof AppError)) throw e; }
    }
  }
  return r;
}

/** applies a maintenance run's patch as a new version and redeploys */
export async function applyPatch(ctx: Ctx, projectId: string, runId: string) {
  const uid = ctx.auth!.uid;
  const [p] = await ctx.db.select().from(builderProjects).where(and(eq(builderProjects.id, projectId), eq(builderProjects.userId, uid)));
  if (!p) throw new AppError("پروژه پیدا نشد.", 404);
  const [run] = await ctx.db.select().from(builderRuns).where(and(eq(builderRuns.id, runId), eq(builderRuns.projectId, p.id)));
  if (!run || run.kind !== "maintain" || !run.patch) throw new AppError("وصله‌ای برای اعمال وجود ندارد.");
  if (run.applied) throw new AppError("این وصله قبلاً اعمال شده است.");
  const files = { ...await filesAt(ctx.db, p.id, p.version) };
  for (const [path, content] of Object.entries(run.patch as Record<string, string | null>)) { if (content === null) delete files[path]; else files[path] = content; }
  const version = await saveVersion(ctx.db, p.id, files, "وصله نگهداری: " + (INCIDENT_LABEL[run.incident] ?? run.incident), run.id);
  await ctx.db.update(builderRuns).set({ applied: true, version } satisfies Partial<Run>).where(eq(builderRuns.id, run.id));
  if (p.appId) await startDeploy(ctx, p.id, 1);
  return version;
}

/** every 5 minutes: new incidents on running builder apps */
export async function builderMaintain(db: DB) {
  const month = monthKey();
  await db.update(builderProjects).set({ maintainSpent: 0, maintainMonth: month }).where(and(isNotNull(builderProjects.appId), sql`${builderProjects.maintainMonth} <> ${month}`));
  const rows = await db.select({ p: builderProjects, app: paasApps }).from(builderProjects).innerJoin(paasApps, eq(paasApps.id, builderProjects.appId))
    .where(and(eq(paasApps.status, "running"), isNotNull(paasApps.liveDeployment)));
  for (const { p, app } of rows) {
    const since = p.checkedAt ?? new Date(Date.now() - 10 * 60_000);
    const evs = await db.select().from(paasEvents).where(and(eq(paasEvents.appId, app.id), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]), gt(paasEvents.createdAt, since))).orderBy(asc(paasEvents.createdAt));
    await db.update(builderProjects).set({ checkedAt: new Date() }).where(eq(builderProjects.id, p.id));
    if (!evs.length || p.status === "deploying" || p.status === "fixing" || p.status === "generating") continue;
    const [recent] = await db.select({ id: builderRuns.id }).from(builderRuns).where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.kind, "maintain"), gte(builderRuns.createdAt, new Date(Date.now() - COOLDOWN_MS)))).limit(1);
    if (recent) continue;
    if (p.maintainSpent >= p.maintainCap) continue;
    const incident = SEVERITY.find((k) => evs.some((e) => e.kind === k)) ?? "crash";
    const text = evs.slice(-20).map((e) => faDateTime(e.createdAt) + " " + e.kind + ": " + e.message).join("\n");
    await maintainProject(db, p, incident, text, false);
  }
}
