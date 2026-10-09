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
import { settleInquiry } from "../inquiry/service";
import { geoBilling, geoHealth, geoNsCheck } from "./geo";
import { devopsBilling } from "../rpc/devops";
import { paasBackup, paasBilling, paasBuild, paasCollect, paasDaily, paasDbCreate, paasPoll } from "./paas";
import { provisionDomain, provisionHosting, provisionIp, provisionServer, waitForBuild } from "./provision";

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
  "tickets.sla": (db, p) => ticketSla(db, p),
  "notify.send": (db, p) => notifySend(db, p as never),
  "devops.billing": (db) => devopsBilling(db),
  "paas.build": (db, p) => paasBuild(db, p as never),
  "paas.poll": (db, p) => paasPoll(db, p as never),
  "paas.db": (db, p) => paasDbCreate(db, p as never),
  "paas.backup": (db, p) => paasBackup(db, p as never),
  "paas.billing": (db) => paasBilling(db),
  "paas.collect": (db) => paasCollect(db),
  "paas.daily": (db) => paasDaily(db),
  "inquiry.settle": (db) => settleInquiry(db),
  "ai.settle": (db) => settleAi(db),
  "geo.billing": (db) => geoBilling(db),
  "geo.health": (db) => geoHealth(db),
  "geo.ns": (db, p) => geoNsCheck(db, p as never),
};

/** periodic jobs: [name, interval in minutes] */
export const SCHEDULE: [JobType, number][] = [
  ["usage.collect", 5], ["tickets.sla", 5], ["billing.hourly", 60],
  ["billing.renewals", 24 * 60], ["billing.overdue", 24 * 60], ["billing.reminders", 24 * 60], ["virt.reconcile", 24 * 60], ["devops.billing", 24 * 60], ["paas.billing", 60], ["paas.collect", 5], ["paas.daily", 24 * 60],
  ["inquiry.settle", 10], ["ai.settle", 10], ["geo.billing", 24 * 60], ["geo.health", 5], ["geo.ns", 60],
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

/** processes due jobs until none are left (or `max` were run); returns how many ran */
export async function drain(db: DB, max = 100) {
  let ran = 0;
  while (ran < max) {
    const batch = await claim(db, Math.min(10, max - ran));
    if (!batch.length) break;
    for (const job of batch) {
      ran++;
      try {
        await handlers[job.type as JobType](db, (job.payload as Record<string, unknown>) ?? {});
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
