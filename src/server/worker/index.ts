/* The worker loop. It runs inside every Next.js server process (instrumentation.ts) — the queue uses
   SKIP LOCKED and the scheduler claims runs atomically, so any number of instances is safe.
   WORKER=0 disables it (e.g. on a web-only replica); `npm run worker` is not needed. */
import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { schedules } from "../db/schema";
import { claim, complete, enqueue, retry, type JobType } from "../jobs";
import { sweepRateLimits } from "../auth";
import { hourly, overdue, reminders, renewals } from "./billing";
import { collectUsage, notifySend, purgeOld, reconcile, ticketSla, usageAlerts } from "./ops";
import { settleAi } from "../ai/service";
import { lowBalanceAlerts, purgeAiLogs } from "../ai/reports";
import { settleInquiry } from "../inquiry/service";
import { geoBilling, geoHealth, geoNsCheck } from "./geo";
import { devopsBilling } from "../rpc/devops";
import { wpImport } from "./wordpress";
import { mailBilling, mailDaily, mailDeliver, mailDns } from "./mail";
import { channelSend } from "../channels";
import { paasBackup, paasBilling, paasBuild, paasCollect, paasDaily, paasDbCreate, paasJobPoll, paasPoll, paasScan, paasVerifyBackups } from "./paas";
import { paasDiskBackup, paasToolsCollect, paasToolsDaily } from "./paas-tools";
import { dbaasExpire, dbaasImport, dbaasInit } from "./dbaas";
import { storageBilling, storageCollect } from "../storage/service";
import { domainAlertsJob } from "../domains/service";
import { provisionDomain, provisionHosting, provisionIp, provisionServer, waitForBuild } from "./provision";
import { vpsBilling, vpsSnapshots } from "./vps";
import { virtSync } from "../virt/sync";
import { confirmPower } from "../virt/power";
import { runRelayout } from "../virt/relayout";
import { builderFix, builderWatch } from "../builder/deploy";
import { builderMaintain } from "../builder/maintain";

type Handler = (db: DB, payload: Record<string, unknown>) => Promise<unknown>;
const handlers: Record<JobType, Handler> = {
  "provision.server": (db, p) => (p.phase === "wait" ? waitForBuild(db, p as never) : provisionServer(db, p as never)),
  "provision.hosting": (db, p) => provisionHosting(db, p as never),
  "provision.domain": (db, p) => provisionDomain(db, p as never),
  "provision.ip": (db, p) => provisionIp(db, p as never),
  "billing.renewals": (db) => renewals(db),
  "billing.overdue": (db) => overdue(db),
  "billing.reminders": (db) => reminders(db),
  "billing.hourly": (db) => hourly(db),
  "usage.collect": async (db) => { await collectUsage(db); await usageAlerts(db); },
  "usage.alerts": (db) => usageAlerts(db),
  "virt.reconcile": async (db) => { await reconcile(db); await purgeOld(db); await sweepRateLimits(db); },
  "virt.sync": (db, p) => virtSync(db, p as never),
  "virt.power": (db, p) => confirmPower(db, p as never),
  "virt.relayout": (db, p) => runRelayout(db, p as never),
  "tickets.sla": (db, p) => ticketSla(db, p),
  "notify.send": (db, p) => notifySend(db, p as never),
  "devops.billing": (db) => devopsBilling(db),
  "paas.build": (db, p) => paasBuild(db, p as never),
  "paas.poll": (db, p) => paasPoll(db, p as never),
  "paas.job": (db, p) => paasJobPoll(db, p as never),
  "wp.import": (db, p) => wpImport(db, p as never),
  "notify.channel": (db, p) => channelSend(db, p as never),
  "paas.scan": (db, p) => paasScan(db, p as never),
  "paas.verify": (db) => paasVerifyBackups(db),
  "paas.db": (db, p) => paasDbCreate(db, p as never),
  "paas.backup": (db, p) => paasBackup(db, p as never),
  "paas.billing": (db) => paasBilling(db),
  "paas.collect": (db) => paasCollect(db),
  "paas.daily": (db) => paasDaily(db),
  "paas.tools": (db) => paasToolsCollect(db),
  "paas.toolsDaily": (db) => paasToolsDaily(db),
  "paas.diskBackup": (db, p) => paasDiskBackup(db, p as never),
  "inquiry.settle": (db) => settleInquiry(db),
  "ai.settle": async (db) => { await settleAi(db); await lowBalanceAlerts(db); await purgeAiLogs(db); },
  "geo.billing": (db) => geoBilling(db),
  "geo.health": (db) => geoHealth(db),
  "geo.ns": (db, p) => geoNsCheck(db, p as never),
  "dbaas.init": (db, p) => dbaasInit(db, p as never),
  "dbaas.import": (db, p) => dbaasImport(db, p as never),
  "dbaas.expire": (db) => dbaasExpire(db),
  "storage.billing": (db) => storageBilling(db),
  "storage.collect": (db) => storageCollect(db),
  "mail.deliver": (db, p) => mailDeliver(db, p as never),
  "mail.billing": (db) => mailBilling(db),
  "mail.dns": (db, p) => mailDns(db, p as never),
  "mail.daily": (db) => mailDaily(db),
  "domains.alerts": (db) => domainAlertsJob(db),
  "vps.billing": (db) => vpsBilling(db),
  "vps.snapshots": (db) => vpsSnapshots(db),
  "builder.watch": (db, p) => builderWatch(db, p as never),
  "builder.fix": (db, p) => builderFix(db, p as never),
  "builder.maintain": (db) => builderMaintain(db),
};

/** periodic jobs: [name, interval in minutes] */
export const SCHEDULE: [JobType, number][] = [
  ["usage.collect", 5], ["tickets.sla", 5], ["billing.hourly", 60],
  ["billing.renewals", 24 * 60], ["billing.overdue", 24 * 60], ["billing.reminders", 24 * 60], ["virt.reconcile", 24 * 60], ["devops.billing", 24 * 60], ["paas.billing", 60], ["paas.collect", 5], ["paas.daily", 24 * 60], ["paas.verify", 7 * 24 * 60], ["paas.tools", 5], ["paas.toolsDaily", 24 * 60],
  ["inquiry.settle", 10], ["ai.settle", 10], ["geo.billing", 24 * 60], ["geo.health", 5], ["geo.ns", 60],
  ["dbaas.expire", 5],
  ["storage.billing", 60], ["storage.collect", 60],
  ["mail.billing", 60], ["mail.dns", 60], ["mail.daily", 24 * 60],
  ["domains.alerts", 60],
  ["vps.billing", 60], ["vps.snapshots", 15],
  ["builder.maintain", 5],
  // Virtualizor → site (resources, IPs, disks, traffic, status); VIRT_SYNC_MINUTES, default 5
  ["virt.sync", Math.max(1, Math.round(Number(process.env.VIRT_SYNC_MINUTES)) || 5)],
];

/** enqueues each periodic job whose time has come; the UPDATE … WHERE next_run_at <= now() claim makes it run once */
export async function tickSchedule(db: DB) {
  await db.insert(schedules).values(SCHEDULE.map(([name]) => ({ name, nextRunAt: new Date() }))).onConflictDoNothing();
  for (const [name, every] of SCHEDULE) {
    const claimed = await db.update(schedules).set({ nextRunAt: sql`now() + make_interval(mins => ${every})` })
      .where(and(eq(schedules.name, name), lte(schedules.nextRunAt, new Date()))).returning();
    if (claimed.length) await enqueue(db, name, {}, { dedupe: "sched:" + name });
  }
}

/** the longest a job may run before it is abandoned and retried (minutes); a handler that never returns
    must not stop the queue behind it */
const LONG_JOBS: Partial<Record<JobType, number>> = {
  "dbaas.import": 90, "paas.diskBackup": 60, "paas.backup": 60, "wp.import": 90, "paas.toolsDaily": 30, "paas.daily": 30,
  "dbaas.init": 20, "builder.maintain": 20, "builder.fix": 10, "paas.collect": 10, "virt.reconcile": 20, "virt.sync": 20,
  // recreating a VPS for a new disk layout: create, delete and the address move (the build wait re-queues itself)
  "virt.relayout": 30,
};
const jobLimitMs = (type: string) => (LONG_JOBS[type as JobType] ?? 5) * 60_000;
class JobTimeout extends Error {}
function withLimit<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new JobTimeout(label + " ran over " + Math.round(ms / 60_000) + " min; abandoned and retried")), ms); t.unref?.(); })])
    .finally(() => clearTimeout(t));
}

/** processes due jobs until none are left (or `max` were run); returns how many ran */
export async function drain(db: DB, max = 100) {
  let ran = 0;
  while (ran < max) {
    const batch = await claim(db, Math.min(10, max - ran));
    if (!batch.length) break;
    for (const job of batch) {
      ran++;
      try {
        await withLimit(Promise.resolve(handlers[job.type as JobType](db, (job.payload as Record<string, unknown>) ?? {})), jobLimitMs(job.type), job.type + " #" + job.id);
        await complete(db, job.id);
      } catch (e) {
        const dead = await retry(db, job.id, job.attempts, e instanceof Error ? e.stack || e.message : String(e));
        console.error("[worker] " + job.type + " #" + job.id + (dead ? " failed permanently" : " will retry"), e);
      }
    }
  }
  return ran;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startWorker(getDb: () => Promise<DB>, everyMs = 5000) {
  if (timer) return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const db = await getDb();
      await tickSchedule(db);
      await drain(db);
    } catch (e) {
      console.error("[worker] tick failed", e);
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref?.();
}
export const stopWorker = () => { if (timer) clearInterval(timer); timer = null; };
