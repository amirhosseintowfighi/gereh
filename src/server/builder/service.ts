/* Builder projects for the panel, the public API and MCP: create, views, manual edits, versions. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { BUILDER_DEFAULT_MODEL, filesError, guessStack, pathError, projectName, type BuilderProjectSummary, type BuilderProjectView, type BuilderRunView, type BuilderStack } from "@/lib/builder";
import { faDateTime } from "@/lib/jalali";
import type { DB } from "../db/client";
import { builderMessages, builderProjects, builderRuns, builderVersions, paasApps, paasDeployments } from "../db/schema";
import { paas } from "../paas/driver";
import { appsDomain } from "../paas/service";
import { AppError, rid } from "../util";
import { filesAt, saveVersion, type Project, type Run } from "./engine";
import { quote } from "./deploy";

export const MAX_PROJECTS = 50;

export async function createProject(db: DB, userId: string, o: { prompt: string; stack: BuilderStack | "auto"; model?: string }) {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(builderProjects).where(eq(builderProjects.userId, userId));
  if ((n?.n ?? 0) >= MAX_PROJECTS) throw new AppError("حداکثر " + MAX_PROJECTS.toLocaleString("fa-IR") + " پروژه مجاز است؛ پروژه‌های قدیمی را حذف کنید.");
  const id = rid("bld");
  const stack = o.stack === "auto" ? guessStack(o.prompt) : o.stack;
  await db.insert(builderProjects).values({ id, userId, name: projectName(o.prompt), description: o.prompt.slice(0, 4000), stack, model: o.model || BUILDER_DEFAULT_MODEL, previewToken: randomBytes(24).toString("base64url") });
  return id;
}

const iso = (d: Date) => faDateTime(d);
export const previewPath = (token: string, version?: number | null) => "/api/build/preview/" + token + (version ? ".v" + version : "") + "/index.html";

async function hostOf(db: DB, appIds: string[]) {
  if (!appIds.length) return new Map<string, string>();
  const [apps, domain] = await Promise.all([db.select({ id: paasApps.id, name: paasApps.name }).from(paasApps).where(inArray(paasApps.id, appIds)), appsDomain(db)]);
  return new Map(apps.map((a) => [a.id, a.name + "." + domain]));
}

export async function listProjects(db: DB, userId: string): Promise<BuilderProjectSummary[]> {
  const rows = await db.select({ p: builderProjects, files: sql<number>`coalesce((select count(*) from jsonb_object_keys(${builderVersions.files})), 0)::int` })
    .from(builderProjects).leftJoin(builderVersions, and(eq(builderVersions.projectId, builderProjects.id), eq(builderVersions.version, builderProjects.version)))
    .where(eq(builderProjects.userId, userId)).orderBy(desc(builderProjects.updatedAt));
  const hosts = await hostOf(db, rows.map((r) => r.p.appId).filter((x): x is string => !!x));
  return rows.map(({ p, files }) => summary(p, files, hosts));
}
const summary = (p: Project, files: number, hosts: Map<string, string>): BuilderProjectSummary => ({
  id: p.id, name: p.name, description: p.description, stack: p.stack, status: p.status, version: p.version, spent: p.spent, updatedAt: iso(p.updatedAt), files,
  liveUrl: p.appId && p.deployedVersion && hosts.get(p.appId) ? "https://" + hosts.get(p.appId) : null,
});

export const runView = (r: Run): BuilderRunView => ({
  id: r.id, kind: r.kind, status: r.status, model: r.model, prompt: r.prompt, cost: r.cost, inTokens: r.inTokens, outTokens: r.outTokens, summary: r.summary, log: r.log,
  diff: r.diff, version: r.version, attempt: r.attempt, incident: r.incident, hasPatch: !!r.patch && Object.keys(r.patch).length > 0, applied: r.applied, at: iso(r.createdAt),
});

export async function projectView(db: DB, p: Project): Promise<BuilderProjectView> {
  const [files, messages, runs, versions, hosts] = await Promise.all([
    filesAt(db, p.id, p.version),
    db.select().from(builderMessages).where(eq(builderMessages.projectId, p.id)).orderBy(desc(builderMessages.id)).limit(200),
    db.select().from(builderRuns).where(eq(builderRuns.projectId, p.id)).orderBy(desc(builderRuns.createdAt)).limit(60),
    db.select({ version: builderVersions.version, message: builderVersions.message, createdAt: builderVersions.createdAt, files: sql<number>`(select count(*) from jsonb_object_keys(${builderVersions.files}))::int` })
      .from(builderVersions).where(eq(builderVersions.projectId, p.id)).orderBy(desc(builderVersions.version)).limit(100),
    hostOf(db, p.appId ? [p.appId] : []),
  ]);
  let deploy: BuilderProjectView["deploy"] = null;
  const [app] = p.appId ? await db.select({ id: paasApps.id, name: paasApps.name }).from(paasApps).where(eq(paasApps.id, p.appId)) : [];
  if (p.deploymentId || p.deployError || ["deploying", "fixing", "failed"].includes(p.status)) {
    const [dep] = p.deploymentId ? await db.select().from(paasDeployments).where(eq(paasDeployments.id, p.deploymentId)) : [];
    deploy = { status: dep?.status ?? (p.status === "fixing" ? "fixing" : p.status === "failed" ? "failed" : "queued"), attempt: p.deployAttempt, error: p.deployError.slice(-6000), deploymentId: p.deploymentId, log: (dep?.log ?? p.deployError).slice(-6000), failure: dep?.failure ?? "", appId: app?.id ?? null, appName: app?.name ?? null };
  }
  const s = summary(p, Object.keys(files).length, hosts);
  const sim = (await paas()).name === "simulator";
  return {
    ...s, model: p.model, previewUrl: previewPath(p.previewToken), appId: p.appId, appName: app?.name ?? null, dbId: p.dbId, deployedVersion: p.deployedVersion,
    liveView: s.liveUrl ? (sim ? previewPath(p.previewToken, p.deployedVersion) : s.liveUrl) : null, simulator: sim,
    autoMaintain: p.autoMaintain, maintainCap: p.maintainCap, maintainSpent: p.maintainSpent, checkedAt: p.checkedAt ? iso(p.checkedAt) : null,
    tree: Object.keys(files).sort().map((path) => ({ path, size: new TextEncoder().encode(files[path]).length })),
    messages: messages.reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, runId: m.runId, at: iso(m.createdAt) })),
    runs: runs.map(runView),
    versions: versions.map((v) => ({ version: v.version, message: v.message, at: iso(v.createdAt), files: v.files })),
    deploy, plan: await quote(db, p, files),
  };
}

/** a manual edit from the code view: one file written or removed, as a new version */
export async function writeFile(db: DB, p: Project, path: string, content: string | null) {
  const bad = pathError(path);
  if (bad) throw new AppError(bad);
  const files = { ...await filesAt(db, p.id, p.version) };
  if (content === null) { if (!(path in files)) throw new AppError("فایل پیدا نشد.", 404); delete files[path]; }
  else { if (files[path] === content) return p.version; files[path] = content; }
  const err = filesError(files);
  if (err) throw new AppError(err);
  return saveVersion(db, p.id, files, (content === null ? "حذف " : "ویرایش دستی ") + path);
}

/** restoring an old version makes a new version with its files (history is never rewritten) */
export async function restoreVersion(db: DB, p: Project, version: number) {
  if (version === p.version) throw new AppError("این نسخه همین حالا فعال است.");
  const [v] = await db.select().from(builderVersions).where(and(eq(builderVersions.projectId, p.id), eq(builderVersions.version, version)));
  if (!v) throw new AppError("نسخه پیدا نشد.", 404);
  const next = await saveVersion(db, p.id, v.files, "بازگردانی نسخه " + version.toLocaleString("fa-IR"));
  await db.insert(builderMessages).values({ projectId: p.id, role: "assistant", content: "نسخه " + version.toLocaleString("fa-IR") + " بازگردانی شد (اکنون نسخه " + next.toLocaleString("fa-IR") + ")." });
  return next;
}
