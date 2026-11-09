/* The maintenance agent. Automatic looks come with «پایش پیشرفته» (src/server/watch) on the project's app, paid by
   the plan (the platform pays the tokens):
   - continuous: crash, OOM, failed health check or a burst of errors in the logs, at most continuousMaxPerDay a
                 day, plus a daily routine read
   - every3h:    a routine read of the logs every 3 hours
   Without a plan only the owner's «بررسی سلامت با AI» looks (billed to the wallet, within the monthly cap); getting
   the app up (build and deploy failures) is the free basic care of ./deploy.ts. Each look asks the AI for a Persian
   diagnosis and a patch. With «نگهداری خودکار» on, the patch is applied and redeployed by itself (automatic looks
   at most AUTO_PER_DAY times a day). */
import "server-only";
import { and, asc, eq, gt, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { INCIDENT_LABEL } from "@/lib/builder";
import { faDateTime } from "@/lib/jalali";
import { monthKey } from "@/lib/paas-runtime";
import type { Ctx } from "../ctx";
import type { DB } from "../db/client";
import { aiModels, builderProjects, builderRuns, paasApps, paasEvents, watchChecks, watchPlans } from "../db/schema";
import { enqueue } from "../jobs";
import { paas } from "../paas/driver";
import { appSpec } from "../paas/service";
import { AppError, notify, rid, sha256 } from "../util";
import { costPrice, watchSettings } from "../watch/settings";
import { startDeploy, systemCtx } from "./deploy";
import { filesAt, runAgent, saveVersion, type AgentResult, type Project, type Run } from "./engine";

const AUTO_PER_DAY = 3;
const COOLDOWN_MS = 30 * 60_000;
const SEVERITY = ["oom", "crash", "health_failed"];
/** log lines that count as errors; a burst is ERROR_BURST of them in the recent tail */
const ERROR_RE = /\b(error|exception|fatal|unhandled|uncaught|ECONNREFUSED|ETIMEDOUT|panic|traceback)\b|\s5\d\d\s/i;
const ERROR_BURST = 3;
/** a routine scan that found nothing begins its summary with this */
export const healthy = (summary: string) => /^\s*(وضعیت:\s*سالم|status:\s*healthy)/i.test(summary);

async function appLogs(db: DB, appId: string | null) {
  if (!appId) return "";
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, appId));
  if (!app) return "";
  try { return (await (await paas()).logs(await appSpec(db, app), 120)).join("\n"); } catch { return ""; }
}

type Plan = typeof watchPlans.$inferSelect;

/** one look; `manual` runs come from the panel button. A healthy routine scan stays quiet. With a «پایش پیشرفته»
    plan the platform pays the tokens and the plan's «رفع خودکار» also applies patches. */
export async function maintainProject(db: DB, p: Project, incident: string, events: string, manual: boolean, plan?: Plan | null): Promise<AgentResult> {
  const logs = await appLogs(db, p.appId);
  const r = await runAgent(db, { userId: p.userId, projectId: p.id, kind: "maintain", context: { incident, events, logs }, ...(plan ? { platform: { purpose: "watch", ref: "app:" + plan.resourceId } } : {}) });
  if (!r.ok) return r;
  const label = INCIDENT_LABEL[incident] ?? incident;
  const ok = !r.patch && healthy(r.run.summary);
  if (!manual && !ok) {
    const text = "عامل نگهداری «" + p.name + "»: " + label + " — " + (r.patch ? "تشخیص و وصله پیشنهادی آماده است" : "تشخیص آماده است");
    await notify(db, p.userId, "heart-pulse", text);
    await enqueue(db, "notify.send", { userId: p.userId, kind: "service", subject: text, text: r.run.summary + "\n\nجزئیات و اعمال وصله در پنل گره › " + p.name });
  }
  if (r.patch && (p.autoMaintain || plan?.autoFix)) {
    // the owner's own check fixes what it finds; automatic looks are rate limited
    const [n] = manual ? [{ n: 0 }] : await db.select({ n: sql<number>`count(*)::int` }).from(builderRuns)
      .where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.kind, "maintain"), eq(builderRuns.applied, true), gte(builderRuns.createdAt, new Date(Date.now() - 86400_000))));
    if ((n?.n ?? 0) < AUTO_PER_DAY) {
      try { await applyPatch(await systemCtx(db, p.userId), p.id, r.run.id); }
      catch (e) { if (!(e instanceof AppError)) throw e; }
    }
  }
  return r;
}

/** the status of a maintenance look, as a «پایش پیشرفته» check sees it */
export const lookStatus = (run: Run, incident: string) => (healthy(run.summary) && !run.patch ? "healthy" as const : SEVERITY.includes(incident) ? "critical" as const : "warn" as const);
/** Gereh's token cost of a platform-paid look (the model's cost price) */
async function lookCost(db: DB, run: Run) {
  const [row] = await db.select().from(aiModels).where(eq(aiModels.id, run.model));
  if (!row) return 0;
  const c = costPrice(row);
  return (run.inTokens * c.in + run.outTokens * c.out) / 1e6;
}

/** a «پایش پیشرفته» check of a بافت project's app: its maintenance agent, paid by the plan */
export async function maintainForWatch(db: DB, projectId: string, trigger: string, events: string) {
  const [p] = await db.select().from(builderProjects).where(eq(builderProjects.id, projectId));
  if (!p?.appId) return null;
  const [plan] = await db.select().from(watchPlans).where(and(eq(watchPlans.resourceKind, "app"), eq(watchPlans.resourceId, p.appId)));
  const incident = trigger === "anomaly" ? "errors" : trigger === "manual" ? "manual" : "scan";
  const r = await maintainProject(db, p, incident, events, trigger === "manual", plan ?? { resourceId: p.appId, autoFix: false } as Plan);
  if (!r.ok) return null;
  return { status: lookStatus(r.run, incident), summary: r.run.summary, cost: await lookCost(db, r.run) };
}

async function recordLook(db: DB, plan: Plan, trigger: "schedule" | "anomaly" | "daily", r: AgentResult, incident: string) {
  if (!r.ok) return;
  await db.insert(watchChecks).values({ id: rid("wchk"), userId: plan.userId, resourceKind: "app", resourceId: plan.resourceId, planId: plan.id, trigger, status: lookStatus(r.run, incident), summary: r.run.summary.slice(0, 4000), cost: await lookCost(db, r.run) });
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

const EVERY3H_MS = 3 * 3600_000, DAY_MS = 86400_000;
/** every 5 minutes: on running builder apps with a «پایش پیشرفته» plan, incidents, error bursts and due routine reads */
export async function builderMaintain(db: DB) {
  const month = monthKey();
  await db.update(builderProjects).set({ maintainSpent: 0, maintainMonth: month }).where(and(isNotNull(builderProjects.appId), sql`${builderProjects.maintainMonth} <> ${month}`));
  const rows = await db.select({ p: builderProjects, app: paasApps, plan: watchPlans }).from(builderProjects).innerJoin(paasApps, eq(paasApps.id, builderProjects.appId))
    .innerJoin(watchPlans, and(eq(watchPlans.resourceKind, "app"), eq(watchPlans.resourceId, paasApps.id), inArray(watchPlans.status, ["trial", "active"])))
    .where(and(eq(paasApps.status, "running"), isNotNull(paasApps.liveDeployment)));
  const ws = rows.length ? await watchSettings(db) : null;
  for (const { p, app, plan } of rows) {
    const since = p.checkedAt ?? new Date(Date.now() - 10 * 60_000);
    const evs = await db.select().from(paasEvents).where(and(eq(paasEvents.appId, app.id), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]), gt(paasEvents.createdAt, since))).orderBy(asc(paasEvents.createdAt));
    await db.update(builderProjects).set({ checkedAt: new Date() }).where(eq(builderProjects.id, p.id));
    if (p.status === "deploying" || p.status === "fixing" || p.status === "generating") continue;
    const now = Date.now();
    if (plan.mode === "every3h") {
      if (!plan.lastCheckAt || now - plan.lastCheckAt.getTime() >= EVERY3H_MS) {
        await db.update(watchPlans).set({ lastCheckAt: new Date() }).where(eq(watchPlans.id, plan.id));
        await recordLook(db, plan, "schedule", await maintainProject(db, p, "scan", "", false, plan), "scan");
      }
      continue;
    }

    // continuous — incidents: events first, then a new burst of errors in the logs (no AI call to notice either)
    let incident = "", text = "";
    if (evs.length) {
      incident = SEVERITY.find((k) => evs.some((e) => e.kind === k)) ?? "crash";
      text = evs.slice(-20).map((e) => faDateTime(e.createdAt) + " " + e.kind + ": " + e.message).join("\n");
    } else {
      const errors = (await appLogs(db, app.id)).split("\n").filter((l) => ERROR_RE.test(l));
      const sig = errors.length ? sha256(errors[errors.length - 1]).slice(0, 16) : "";
      if (errors.length >= ERROR_BURST && sig !== p.logSig) { incident = "errors"; text = errors.slice(-20).join("\n"); }
      if (sig !== p.logSig) await db.update(builderProjects).set({ logSig: sig }).where(eq(builderProjects.id, p.id));
    }
    if (incident) {
      const [recent] = await db.select({ id: builderRuns.id }).from(builderRuns).where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.kind, "maintain"), gte(builderRuns.createdAt, new Date(now - COOLDOWN_MS)))).limit(1);
      const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(watchChecks).where(and(eq(watchChecks.planId, plan.id), eq(watchChecks.trigger, "anomaly"), gte(watchChecks.createdAt, new Date(now - DAY_MS))));
      if (!recent && (today?.n ?? 0) < ws!.continuousMaxPerDay) {
        await db.update(watchPlans).set({ lastCheckAt: new Date() }).where(eq(watchPlans.id, plan.id));
        await recordLook(db, plan, "anomaly", await maintainProject(db, p, incident, text, false, plan), incident);
        continue;
      }
    }

    // continuous: the daily routine read (not right after a look)
    if ((!plan.lastDailyAt || now - plan.lastDailyAt.getTime() >= DAY_MS) && (!plan.lastCheckAt || now - plan.lastCheckAt.getTime() >= COOLDOWN_MS)) {
      await db.update(watchPlans).set({ lastDailyAt: new Date(), lastCheckAt: new Date() }).where(eq(watchPlans.id, plan.id));
      await recordLook(db, plan, "daily", await maintainProject(db, p, "scan", "", false, plan), "scan");
    }
  }
}
