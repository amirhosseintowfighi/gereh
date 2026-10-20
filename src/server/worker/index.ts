/* The worker loop. It runs inside every Next.js server process (instrumentation.ts) — the queue uses
   SKIP LOCKED and the scheduler claims runs atomically, so any number of instances is safe.
   WORKER=0 disables it (e.g. on a web-only replica); `npm run worker` is not needed. */
import "server-only";
import { and, eq, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { schedules } from "../db/schema";
import { claim, complete, enqueue, heartbeat, retry, type JobType } from "../jobs";
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
  "dbaas.init": 20, "builder.maintain": 30, "builder.fix": 15, "paas.collect": 10, "virt.reconcile": 20, "virt.sync": 20,
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

/* Lanes. One sequential loop let a slow job (an AI maintenance scan, a Virtualizor sync over every VPS, a
   database import) hold everything queued behind it, so an app build, a VPS delivery or a disk relayout sat at
   «در انتظار» for as long as that job ran. Each lane now claims one job at a time for itself:
   - work: what a customer just asked for (builds, deliveries, power, notifications…), never waits on the others
   - long: customer-started jobs that may run for many minutes (imports, backups, the VPS relayout, builder fixes)
   - background: the periodic jobs in SCHEDULE
   Sizes: WORKER_WORK (3), WORKER_LONG (2), WORKER_BACKGROUND (2). */
const PERIODIC = [...new Set(SCHEDULE.map(([t]) => t))];
const LONG_EVENT = (Object.keys(LONG_JOBS) as JobType[]).filter((t) => !PERIODIC.includes(t));
const size = (env: string, d: number) => Math.max(1, Math.min(16, Math.round(Number(process.env[env])) || d));
export const LANES: { name: string; size: number; filter: { only?: JobType[]; except?: JobType[] } }[] = [
  { name: "work", size: size("WORKER_WORK", 3), filter: { except: [...PERIODIC, ...LONG_EVENT] } },
  { name: "long", size: size("WORKER_LONG", 2), filter: { only: LONG_EVENT } },
  { name: "background", size: size("WORKER_BACKGROUND", 2), filter: { only: PERIODIC } },
];

/** runs one claimed job within its time limit, renewing its lock every minute while it runs */
async function runJob(db: DB, job: Awaited<ReturnType<typeof claim>>[number]) {
  const beat = setInterval(() => { heartbeat(db, job.id).catch(() => {}); }, 60_000);
  beat.unref?.();
  try {
    await withLimit(Promise.resolve(handlers[job.type as JobType](db, (job.payload as Record<string, unknown>) ?? {})), jobLimitMs(job.type), job.type + " #" + job.id);
    await complete(db, job.id);
  } catch (e) {
    const dead = await retry(db, job.id, job.attempts, e instanceof Error ? e.stack || e.message : String(e));
    console.error("[worker] " + job.type + " #" + job.id + (dead ? " failed permanently" : " will retry"), e);
  } finally {
    clearInterval(beat);
  }
}

/** processes due jobs one at a time until none are left (or `max` were run); returns how many ran. A job is
    claimed only when it is about to run, so nothing sits «running» behind another job. */
export async function drain(db: DB, max = 100, filter: { only?: JobType[]; except?: JobType[] } = {}) {
  let ran = 0;
  while (ran < max) {
    const [job] = await claim(db, 1, filter);
    if (!job) break;
    ran++;
    await runJob(db, job);
  }
  return ran;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startWorker(getDb: () => Promise<DB>, everyMs = 5000) {
  if (timer) return;
  let ticking = false;
  const active = new Map<string, number>();
  const kick = (db: DB) => {
    for (const lane of LANES) {
      while ((active.get(lane.name) ?? 0) < lane.size) {
        active.set(lane.name, (active.get(lane.name) ?? 0) + 1);
        drain(db, 50, lane.filter)
          .catch((e) => console.error("[worker] " + lane.name + " lane failed", e))
          .finally(() => active.set(lane.name, (active.get(lane.name) ?? 1) - 1));
      }
    }
  };
  timer = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const db = await getDb();
      await tickSchedule(db);
      kick(db);
    } catch (e) {
      console.error("[worker] tick failed", e);
    } finally {
      ticking = false;
    }
  }, everyMs);
  timer.unref?.();
}
export const stopWorker = () => { if (timer) clearInterval(timer); timer = null; };
