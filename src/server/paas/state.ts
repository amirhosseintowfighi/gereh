/* Gereh Apps slice of /api/state: a customer gets their own apps and databases (with env values
   except secrets); staff get everything but never env values. */
import "server-only";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { faDateTime } from "@/lib/jalali";
import { appMonthly, hourlyOf } from "@/lib/paas";
import type { ClientDB } from "@/lib/types";
import type { DB } from "../db/client";
import { paasApps, paasCrons, paasDbBackups, paasDbs, paasDeployments, paasDomains, paasEnv, paasJobs, paasLinks, paasMetrics, paasPlans, paasProcesses } from "../db/schema";
import { open } from "../secrets";
import { previewHost } from "./service";

export async function paasState(db: DB, opts: { uid: string; admin: boolean; domain: string; siteUrl: string }): Promise<Pick<ClientDB, "paasApps" | "paasDbs" | "paasPlans">> {
  const plans = await db.select().from(paasPlans).orderBy(asc(paasPlans.position));
  const planMap = new Map(plans.map((p) => [p.id, p]));
  const apps = await (opts.admin ? db.select().from(paasApps).orderBy(desc(paasApps.createdAt)).limit(500) : db.select().from(paasApps).where(eq(paasApps.userId, opts.uid)).orderBy(desc(paasApps.createdAt)));
  const dbs = await (opts.admin ? db.select().from(paasDbs).orderBy(desc(paasDbs.createdAt)).limit(500) : db.select().from(paasDbs).where(eq(paasDbs.userId, opts.uid)).orderBy(desc(paasDbs.createdAt)));
  const appIds = apps.map((a) => a.id), dbIds = dbs.map((d) => d.id);
  const since = new Date(Date.now() - 4 * 3600_000);
  const [deps, domains, env, links, backups, metrics, procs, crons, jobs] = await Promise.all([
    appIds.length ? db.select({ id: paasDeployments.id, appId: paasDeployments.appId, status: paasDeployments.status, trigger: paasDeployments.trigger, ref: paasDeployments.ref, message: paasDeployments.message, image: paasDeployments.image, target: paasDeployments.target, branch: paasDeployments.branch, createdAt: paasDeployments.createdAt, startedAt: paasDeployments.startedAt, finishedAt: paasDeployments.finishedAt })
      .from(paasDeployments).where(inArray(paasDeployments.appId, appIds)).orderBy(desc(paasDeployments.createdAt)) : [],
    appIds.length ? db.select().from(paasDomains).where(inArray(paasDomains.appId, appIds)).orderBy(asc(paasDomains.createdAt)) : [],
    appIds.length ? db.select().from(paasEnv).where(inArray(paasEnv.appId, appIds)).orderBy(asc(paasEnv.key)) : [],
    appIds.length || dbIds.length ? db.select().from(paasLinks).where(appIds.length ? inArray(paasLinks.appId, appIds) : inArray(paasLinks.dbId, dbIds)) : [],
    dbIds.length ? db.select().from(paasDbBackups).where(inArray(paasDbBackups.dbId, dbIds)).orderBy(desc(paasDbBackups.createdAt)) : [],
    appIds.length + dbIds.length && !opts.admin ? db.select().from(paasMetrics).where(and(inArray(paasMetrics.target, [...appIds, ...dbIds]), gte(paasMetrics.createdAt, since))).orderBy(asc(paasMetrics.createdAt)) : [],
    appIds.length ? db.select().from(paasProcesses).where(inArray(paasProcesses.appId, appIds)).orderBy(asc(paasProcesses.name)) : [],
    appIds.length ? db.select().from(paasCrons).where(inArray(paasCrons.appId, appIds)).orderBy(asc(paasCrons.name)) : [],
    appIds.length && !opts.admin ? db.select().from(paasJobs).where(and(inArray(paasJobs.appId, appIds), gte(paasJobs.createdAt, new Date(Date.now() - 7 * 86400_000)))).orderBy(desc(paasJobs.createdAt)).limit(200) : [],
  ]);
  const m = (target: string) => metrics.filter((x) => x.target === target).map((x) => ({ at: faDateTime(x.createdAt).split(" ")[1] ?? "", cpu: x.cpu, ramMb: x.ramMb, rpm: x.rpm }));
  const appName = new Map(apps.map((a) => [a.id, a.name]));
  return {
    paasPlans: plans.filter((p) => opts.admin || p.active).map((p) => ({ id: p.id, kind: p.kind, name: p.name, cpu: p.cpu, ramMb: p.ramMb, diskGb: p.diskGb, price: p.price, active: p.active })),
    paasApps: apps.map((a) => {
      const pl = planMap.get(a.planId);
      return {
        id: a.id, userId: a.userId, name: a.name, stack: a.stack, source: a.source, gitUrl: a.gitUrl, gitBranch: a.gitBranch, image: a.image, rootDir: a.rootDir,
        buildCommand: a.buildCommand, startCommand: a.startCommand, port: a.port, healthPath: a.healthPath, planId: a.planId, instances: a.instances, autoscale: a.autoscale,
        maxInstances: a.maxInstances, autoscaleCpu: a.autoscaleCpu, diskGb: a.diskGb, diskMount: a.diskMount, status: a.status, url: "https://" + a.name + "." + opts.domain,
        hookUrl: opts.admin ? "" : opts.siteUrl + "/api/paas/hook/" + a.id + "?token=" + a.hookToken, autoDeploy: a.autoDeploy, cdn: a.cdn, liveDeployment: a.liveDeployment, at: faDateTime(a.createdAt),
        hourly: pl ? (a.status === "stopped" ? (a.diskGb ? hourlyOf(a.diskGb * 3000) : 0) : hourlyOf(appMonthly(pl, a.instances + a.workerInstances + (a.previewDeployment ? 1 : 0), a.diskGb))) : 0,
        deployments: deps.filter((d) => d.appId === a.id).slice(0, 25).map((d) => ({ id: d.id, status: d.status, trigger: d.trigger, ref: d.ref, message: d.message, at: faDateTime(d.createdAt), seconds: d.startedAt && d.finishedAt ? Math.round((d.finishedAt.getTime() - d.startedAt.getTime()) / 1000) : null, image: !!d.image, target: d.target, branch: d.branch })),
        product: a.product, wpPlan: a.wpPlan, previews: a.previews, previewDeployment: a.previewDeployment, previewUrl: "https://" + previewHost(a.name, opts.domain),
        domains: domains.filter((d) => d.appId === a.id).map((d) => ({ id: d.id, host: d.host, status: d.status, ssl: d.ssl })),
        env: env.filter((e) => e.appId === a.id).map((e) => ({ key: e.key, secret: e.secret, value: opts.admin || e.secret ? null : open(e.valueEnc) })),
        links: links.filter((l) => l.appId === a.id).map((l) => ({ dbId: l.dbId, envKey: l.envKey })),
        metrics: m(a.id),
        releaseCommand: a.releaseCommand,
        processes: procs.filter((x) => x.appId === a.id).map((x) => ({ name: x.name, command: x.command, instances: x.instances })),
        crons: crons.filter((x) => x.appId === a.id).map((x) => ({ id: x.id, name: x.name, schedule: x.schedule, command: x.command, enabled: x.enabled })),
        jobs: jobs.filter((x) => x.appId === a.id).slice(0, 10).map((x) => ({ id: x.id, kind: x.kind, command: x.command, status: x.status, output: x.output.slice(-20_000), at: faDateTime(x.createdAt) })),
      };
    }),
    paasDbs: dbs.map((d) => {
      const pl = planMap.get(d.planId);
      return {
        id: d.id, userId: d.userId, name: d.name, engine: d.engine, version: d.version, planId: d.planId, status: d.status, host: d.host, port: d.port, username: d.username, dbName: d.dbName,
        publicAccess: d.publicAccess, publicPort: d.publicPort, backups: d.backups, at: faDateTime(d.createdAt),
        hourly: pl ? (d.status === "stopped" ? hourlyOf(pl.diskGb * 3000) : hourlyOf(pl.price)) : 0,
        backupList: backups.filter((b) => b.dbId === d.id).slice(0, 30).map((b) => ({ id: b.id, kind: b.kind, status: b.status, sizeMb: b.sizeMb, at: faDateTime(b.createdAt) })),
        links: links.filter((l) => l.dbId === d.id).map((l) => ({ appId: l.appId, appName: appName.get(l.appId) ?? l.appId, envKey: l.envKey })),
        metrics: m(d.id),
      };
    }),
  };
}
