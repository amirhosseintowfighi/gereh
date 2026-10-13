/* Gereh Apps build and runtime options on the server: the per-app row (or its defaults), the
   driver's RuntimeSpec, the events timeline, plan deploy limits and basic-auth hashing. */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { DEFAULT_RUNTIME, type RuntimeConfig } from "@/lib/paas-runtime";
import type { DB, Tx } from "../db/client";
import { paasDeployments, paasDomainRedirects, paasDomains, paasEvents, paasPlans, paasRuntime } from "../db/schema";
import { fail } from "../util";
import type { RuntimeSpec } from "./driver";

export type RuntimeRow = typeof paasRuntime.$inferSelect;
type EventKind = (typeof paasEvents.$inferInsert)["kind"];

/** default limits of the seeded app plans (staff change them in /admin/paas) */
export const PLAN_LIMITS: Record<string, { deploysPerDay: number; maxBuildMinutes: number }> = {
  "app-nano": { deploysPerDay: 10, maxBuildMinutes: 15 }, "app-micro": { deploysPerDay: 20, maxBuildMinutes: 20 }, "app-small": { deploysPerDay: 50, maxBuildMinutes: 30 },
  "app-medium": { deploysPerDay: 100, maxBuildMinutes: 45 }, "app-large": { deploysPerDay: 0, maxBuildMinutes: 60 }, "app-xlarge": { deploysPerDay: 0, maxBuildMinutes: 60 },
};

export async function loadRuntime(db: DB | Tx, appId: string): Promise<RuntimeConfig & { authHtpasswd: string }> {
  const [r] = await db.select().from(paasRuntime).where(eq(paasRuntime.appId, appId));
  return r ? toConfig(r) : { ...DEFAULT_RUNTIME, authHtpasswd: "" };
}
export function toConfig(r: RuntimeRow): RuntimeConfig & { authHtpasswd: string } {
  return {
    preBuild: r.preBuild, postBuild: r.postBuild, preStart: r.preStart,
    healthType: r.healthType, healthCommand: r.healthCommand, healthCodes: r.healthCodes, healthInterval: r.healthInterval, healthTimeout: r.healthTimeout, healthRetries: r.healthRetries, healthStartPeriod: r.healthStartPeriod,
    zeroDowntime: r.zeroDowntime, buildCache: r.buildCache, mirror: r.mirror, buildArgs: r.buildArgs, dockerfile: r.dockerfile,
    timezone: r.timezone, readOnlyFs: r.readOnlyFs, dnsServers: r.dnsServers, nginxConf: r.nginxConf, phpIni: r.phpIni,
    defaultDomain: r.defaultDomain, authPath: r.authPath, authUser: r.authUser, authHtpasswd: r.authHtpasswd,
    budget: r.budget, budgetAlertPct: r.budgetAlertPct, budgetStop: r.budgetStop, trafficAlertGb: r.trafficAlertGb,
  };
}
/** writes part of the row (creating it with defaults first) */
export async function saveRuntime(db: DB | Tx, appId: string, patch: Partial<typeof paasRuntime.$inferInsert>) {
  await db.insert(paasRuntime).values({ appId, ...patch, updatedAt: new Date() }).onConflictDoUpdate({ target: paasRuntime.appId, set: { ...patch, updatedAt: new Date() } });
}

/** the driver's view: options, plan build limit, redirecting domains */
export async function runtimeSpec(db: DB | Tx, app: { id: string; planId: string }): Promise<RuntimeSpec> {
  const [rt, [plan], redirects] = await Promise.all([
    loadRuntime(db, app.id),
    db.select({ maxBuildMinutes: paasPlans.maxBuildMinutes }).from(paasPlans).where(eq(paasPlans.id, app.planId)),
    db.select({ host: paasDomains.host, target: paasDomainRedirects.target, code: paasDomainRedirects.code, keepPath: paasDomainRedirects.keepPath })
      .from(paasDomainRedirects).innerJoin(paasDomains, eq(paasDomains.id, paasDomainRedirects.domainId)).where(and(eq(paasDomains.appId, app.id), eq(paasDomains.status, "active"))),
  ]);
  return {
    preBuild: rt.preBuild, postBuild: rt.postBuild, preStart: rt.preStart,
    health: { type: rt.healthType, command: rt.healthCommand, codes: rt.healthCodes, interval: rt.healthInterval, timeout: rt.healthTimeout, retries: rt.healthRetries, startPeriod: rt.healthStartPeriod },
    zeroDowntime: rt.zeroDowntime,
    build: { cache: rt.buildCache, mirror: rt.mirror, args: rt.buildArgs, dockerfile: rt.dockerfile || "Dockerfile", timeoutMin: plan?.maxBuildMinutes || 30 },
    timezone: rt.timezone, readOnlyFs: rt.readOnlyFs, dns: rt.dnsServers, nginxConf: rt.nginxConf, phpIni: rt.phpIni,
    defaultDomain: rt.defaultDomain,
    basicAuth: rt.authPath && rt.authHtpasswd ? { path: rt.authPath, htpasswd: rt.authHtpasswd } : null,
    redirects: redirects.map((r) => ({ host: r.host, target: r.target, code: r.code === 302 ? 302 : 301, keepPath: r.keepPath })),
  };
}

export const logEvent = (db: DB | Tx, appId: string, kind: EventKind, message: string, at?: Date) =>
  db.insert(paasEvents).values({ appId, kind, message: message.slice(0, 500), ...(at ? { createdAt: at } : {}) });

/** deployments that build (config changes and rollbacks reuse an image and do not count) */
const BUILD_TRIGGERS = ["create", "manual", "git", "cli", "api"] as const;
export async function checkDeployQuota(db: DB | Tx, app: { id: string; planId: string }) {
  const [p] = await db.select({ limit: paasPlans.deploysPerDay }).from(paasPlans).where(eq(paasPlans.id, app.planId));
  if (!p?.limit) return;
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(paasDeployments)
    .where(and(eq(paasDeployments.appId, app.id), inArray(paasDeployments.trigger, [...BUILD_TRIGGERS]), notInArray(paasDeployments.status, ["cancelled"]), gte(paasDeployments.createdAt, new Date(Date.now() - 86400_000))));
  if ((n?.n ?? 0) >= p.limit) fail("سقف استقرار روزانه پلن این اپ (" + p.limit.toLocaleString("fa-IR") + " بیلد در ۲۴ ساعت) پر شده است؛ کمی بعد دوباره تلاش کنید یا پلن را بزرگ‌تر کنید.", 429);
}

/** nginx-compatible {SSHA} htpasswd line */
export function htpasswdLine(user: string, password: string) {
  const salt = randomBytes(8);
  return user + ":{SSHA}" + Buffer.concat([createHash("sha1").update(password).update(salt).digest(), salt]).toString("base64");
}
export function checkHtpasswd(line: string, user: string, password: string) {
  const [u, h] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)];
  if (u !== user || !h.startsWith("{SSHA}")) return false;
  const raw = Buffer.from(h.slice(6), "base64"), salt = raw.subarray(20);
  return createHash("sha1").update(password).update(salt).digest().equals(raw.subarray(0, 20));
}

/** the static outbound addresses of the cluster (PAAS_EGRESS_IPS, comma separated) */
export const egressIps = () => (process.env.PAAS_EGRESS_IPS || "").split(/[\s,]+/).filter((s) => /^[\d.:a-fA-F]+$/.test(s));
