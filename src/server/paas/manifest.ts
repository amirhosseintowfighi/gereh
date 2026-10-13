/* gereh.json: app settings kept in the repository. Read after each production build (from the
   uploaded ZIP, or printed by the Kubernetes build job) and applied before the release, so the
   repository is the source of truth for how the app runs. Build commands stay with Nixpacks
   (nixpacks.toml) or the Dockerfile. Example:
   {
     "app": "shop",
     "start": "gunicorn config.wsgi",
     "port": 8000,
     "health": "/healthz",
     "release": "python manage.py migrate --noinput",
     "processes": { "worker": "celery -A config worker", "beat": { "command": "celery -A config beat", "instances": 1 } },
     "crons": [{ "name": "cleanup", "schedule": "0 3 * * *", "command": "python manage.py clearsessions" }],
     "hooks": { "preBuild": "npm run lint", "postBuild": "npm prune --omit=dev", "preStart": "python manage.py check" },
     "healthcheck": { "path": "/healthz", "codes": "200-299", "interval": 10, "timeout": 3, "retries": 3, "startPeriod": 30 }
   } */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MAX_CRONS, MAX_PROCESSES, PROC_NAME_RE, cronError } from "@/lib/paas";
import { healthCodesError } from "@/lib/paas-runtime";
import type { DB } from "../db/client";
import { paasApps, paasCrons, paasProcesses } from "../db/schema";
import { readFile } from "node:fs/promises";
import { projectFiles } from "../unzip";
import { rid } from "../util";
import { loadRuntime, saveRuntime } from "./runtime";
import type { AppRow } from "./service";

export const MANIFEST_FILE = "gereh.json";
const cmd = z.string().trim().min(1).max(500);
const Manifest = z.object({
  $schema: z.string().optional(), app: z.string().optional(),
  start: cmd.optional(), port: z.number().int().min(1).max(65535).optional(),
  health: z.string().max(200).regex(/^\/[\w./?=&%-]*$/, "health must be a path like /healthz").optional(),
  release: z.string().trim().max(500).optional(),
  processes: z.record(z.string().regex(PROC_NAME_RE, "process names: lowercase letters, digits and -"), z.union([cmd, z.object({ command: cmd, instances: z.number().int().min(0).max(10).default(1) })])).optional()
    .refine((p) => !p || Object.keys(p).length <= MAX_PROCESSES, "at most " + MAX_PROCESSES + " processes"),
  crons: z.array(z.object({ name: z.string().regex(PROC_NAME_RE), schedule: z.string().max(100), command: cmd, enabled: z.boolean().default(true) })).max(MAX_CRONS).optional(),
  hooks: z.object({ preBuild: z.string().trim().max(1000), postBuild: z.string().trim().max(1000), preStart: z.string().trim().max(1000) }).partial().strict().optional(),
  healthcheck: z.object({
    type: z.enum(["http", "command", "tcp"]), path: z.string().max(200).regex(/^\/[\w./?=&%-]*$/, "path must look like /healthz"), command: z.string().trim().max(500),
    codes: z.string().max(100).refine((c) => !healthCodesError(c), "codes: like 200-399 or 200,204"),
    interval: z.number().int().min(1).max(300), timeout: z.number().int().min(1).max(120), retries: z.number().int().min(1).max(20), startPeriod: z.number().int().min(0).max(1800),
  }).partial().strict().optional(),
}).strict();
export type ManifestT = z.infer<typeof Manifest>;

export function parseManifest(text: string): { manifest?: ManifestT; error?: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { error: "gereh.json is not valid JSON: " + (e as Error).message }; }
  const r = Manifest.safeParse(raw);
  if (!r.success) return { error: "gereh.json: " + r.error.issues.map((i) => (i.path.join(".") || "root") + ": " + i.message).join("; ") };
  for (const c of r.data.crons ?? []) { const e = cronError(c.schedule); if (e) return { error: "gereh.json crons." + c.name + ": " + c.schedule + " — " + e }; }
  if (r.data.healthcheck?.type === "command" && !r.data.healthcheck.command) return { error: "gereh.json healthcheck: type \"command\" needs a command" };
  if (new Set((r.data.crons ?? []).map((c) => c.name)).size !== (r.data.crons ?? []).length) return { error: "gereh.json: duplicate cron names" };
  return { manifest: r.data };
}

export async function manifestFromZip(zipPath: string, rootDir = "") {
  const files = projectFiles(await readFile(zipPath), new Set([MANIFEST_FILE]), rootDir).files;
  const t = files.get(MANIFEST_FILE);
  return typeof t === "string" ? t : undefined;
}

/** writes the manifest's settings to the app; returns a log line per change */
export async function applyManifest(db: DB, app: AppRow, m: ManifestT): Promise<string[]> {
  const log: string[] = [], patch: Partial<AppRow> = {};
  if (m.start !== undefined && m.start !== app.startCommand) { patch.startCommand = m.start; log.push("start: " + m.start); }
  if (m.port !== undefined && m.port !== app.port) { patch.port = m.port; log.push("port: " + m.port); }
  if (m.health !== undefined && m.health !== app.healthPath) { patch.healthPath = m.health; log.push("health: " + m.health); }
  if (m.release !== undefined && m.release !== app.releaseCommand) { patch.releaseCommand = m.release; log.push("release: " + (m.release || "(none)")); }
  const h = m.healthcheck;
  if (h?.path !== undefined && h.path !== (patch.healthPath ?? app.healthPath)) { patch.healthPath = h.path; log.push("healthcheck.path: " + h.path); }
  // hooks and health check options live in the runtime row
  const cur = await loadRuntime(db, app.id), rt: Parameters<typeof saveRuntime>[2] = {};
  const set = <K extends keyof typeof rt>(k: K, v: (typeof rt)[K] | undefined, label: string, now: unknown) => { if (v !== undefined && v !== now) { rt[k] = v; log.push(label + ": " + (v === "" ? "(none)" : String(v))); } };
  set("preBuild", m.hooks?.preBuild, "hooks.preBuild", cur.preBuild);
  set("postBuild", m.hooks?.postBuild, "hooks.postBuild", cur.postBuild);
  set("preStart", m.hooks?.preStart, "hooks.preStart", cur.preStart);
  set("healthType", h?.type, "healthcheck.type", cur.healthType);
  set("healthCommand", h?.command, "healthcheck.command", cur.healthCommand);
  set("healthCodes", h?.codes, "healthcheck.codes", cur.healthCodes);
  set("healthInterval", h?.interval, "healthcheck.interval", cur.healthInterval);
  set("healthTimeout", h?.timeout, "healthcheck.timeout", cur.healthTimeout);
  set("healthRetries", h?.retries, "healthcheck.retries", cur.healthRetries);
  set("healthStartPeriod", h?.startPeriod, "healthcheck.startPeriod", cur.healthStartPeriod);
  await db.transaction(async (tx) => {
    if (m.processes && app.source !== "compose") {
      const list = Object.entries(m.processes).map(([name, v]) => (typeof v === "string" ? { name, command: v, instances: 1 } : { name, ...v }));
      await tx.delete(paasProcesses).where(eq(paasProcesses.appId, app.id));
      if (list.length) await tx.insert(paasProcesses).values(list.map((p) => ({ appId: app.id, ...p })));
      patch.workerInstances = list.reduce((s, p) => s + p.instances, 0);
      log.push("processes: " + (list.map((p) => p.name + "×" + p.instances).join(", ") || "(none)"));
    }
    if (m.crons && app.source !== "compose") {
      await tx.delete(paasCrons).where(eq(paasCrons.appId, app.id));
      if (m.crons.length) await tx.insert(paasCrons).values(m.crons.map((c) => ({ id: rid("cron"), appId: app.id, ...c })));
      log.push("crons: " + (m.crons.map((c) => c.name + " (" + c.schedule + ")").join(", ") || "(none)"));
    }
    if (Object.keys(patch).length) await tx.update(paasApps).set(patch).where(eq(paasApps.id, app.id));
    if (Object.keys(rt).length) await saveRuntime(tx, app.id, rt);
  });
  return log;
}
