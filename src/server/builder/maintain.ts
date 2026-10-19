/* The maintenance agent. When it looks depends on the project's mode:
   - continuous: a routine AI read of the logs every scanEvery minutes, plus everything below
   - incident:   crash, OOM, failed health check or a burst of errors in the logs (no tokens otherwise)
   - manual:     only the owner's «بررسی سلامت با AI»
   Each look asks the AI for a Persian diagnosis and a patch. With «نگهداری خودکار» on, the patch is
   applied and redeployed by itself (automatic looks at most AUTO_PER_DAY times a day); every look stays
   within the project's monthly AI cost cap. */
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
import { AppError, notify, sha256 } from "../util";
import { startDeploy, systemCtx } from "./deploy";
import { filesAt, runAgent, saveVersion, type AgentResult, type Project, type Run } from "./engine";

const AUTO_PER_DAY = 3;
const COOLDOWN_MS = 30 * 60_000;
const SEVERITY = ["oom", "crash", "health_failed"];
/** log lines that count as errors; a burst is ERROR_BURST of them in the recent tail */
const ERROR_RE = /\b(error|exception|fatal|unhandled|uncaught|ECONNREFUSED|ETIMEDOUT|panic|traceback)\b|\s5\d\d\s/i;
const ERROR_BURST = 3;
/** a routine scan that found nothing begins its summary with this */
export const healthy = (summary: string) => /^\s*وضعیت:\s*سالم/.test(summary);

async function appLogs(db: DB, appId: string | null) {
  if (!appId) return "";
  const [app] = await db.select().from(paasApps).where(eq(paasApps.id, appId));
  if (!app) return "";
  try { return (await (await paas()).logs(await appSpec(db, app), 120)).join("\n"); } catch { return ""; }
}

/** one look; `manual` runs come from the panel button. A healthy routine scan stays quiet. */
export async function maintainProject(db: DB, p: Project, incident: string, events: string, manual: boolean): Promise<AgentResult> {
  const logs = await appLogs(db, p.appId);
  const r = await runAgent(db, { userId: p.userId, projectId: p.id, kind: "maintain", context: { incident, events, logs } });
  if (!r.ok) return r;
  const label = INCIDENT_LABEL[incident] ?? incident;
  const ok = !r.patch && healthy(r.run.summary);
  if (!manual && !ok) {
    const text = "عامل نگهداری «" + p.name + "»: " + label + " — " + (r.patch ? "تشخیص و وصله پیشنهادی آماده است" : "تشخیص آماده است");
    await notify(db, p.userId, "heart-pulse", text);
    await enqueue(db, "notify.send", { userId: p.userId, kind: "service", subject: text, text: r.run.summary + "\n\nجزئیات و اعمال وصله در پنل گره › " + p.name });
  }
  if (r.patch && p.autoMaintain) {
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

/** every 5 minutes: incidents, error bursts and due routine scans on running builder apps */
export async function builderMaintain(db: DB) {
  const month = monthKey();
  await db.update(builderProjects).set({ maintainSpent: 0, maintainMonth: month }).where(and(isNotNull(builderProjects.appId), sql`${builderProjects.maintainMonth} <> ${month}`));
  const rows = await db.select({ p: builderProjects, app: paasApps }).from(builderProjects).innerJoin(paasApps, eq(paasApps.id, builderProjects.appId))
    .where(and(eq(paasApps.status, "running"), isNotNull(paasApps.liveDeployment)));
  for (const { p, app } of rows) {
    if (p.maintainMode === "manual") continue;
    const since = p.checkedAt ?? new Date(Date.now() - 10 * 60_000);
    const evs = await db.select().from(paasEvents).where(and(eq(paasEvents.appId, app.id), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]), gt(paasEvents.createdAt, since))).orderBy(asc(paasEvents.createdAt));
    await db.update(builderProjects).set({ checkedAt: new Date() }).where(eq(builderProjects.id, p.id));
    if (p.status === "deploying" || p.status === "fixing" || p.status === "generating") continue;
    if (p.maintainSpent >= p.maintainCap) continue;

    // incidents: events first, then a new burst of errors in the logs (no AI call to notice either)
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
      const [recent] = await db.select({ id: builderRuns.id }).from(builderRuns).where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.kind, "maintain"), gte(builderRuns.createdAt, new Date(Date.now() - COOLDOWN_MS)))).limit(1);
      if (!recent) { await maintainProject(db, p, incident, text, false); continue; }
    }

    // continuous: a routine read of the logs when due
    if (p.maintainMode === "continuous" && (!p.scannedAt || Date.now() - p.scannedAt.getTime() >= p.scanEvery * 60_000)) {
      await db.update(builderProjects).set({ scannedAt: new Date() }).where(eq(builderProjects.id, p.id));
      await maintainProject(db, p, "scan", "", false);
    }
  }
}
