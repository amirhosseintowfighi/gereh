/* Postgres-backed job queue. Producers call enqueue() inside their transaction, so a job exists iff
   the change that caused it committed. The worker (src/server/worker.ts) claims due jobs with
   FOR UPDATE SKIP LOCKED, so several worker processes can run side by side. */
import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB, Tx } from "./db/client";
import { jobs } from "./db/schema";

export type JobType =
  | "provision.server" | "provision.hosting" | "provision.domain" | "provision.ip"
  | "billing.renewals" | "billing.hourly" | "billing.overdue" | "billing.reminders"
  | "usage.collect" | "usage.alerts" | "virt.reconcile" | "tickets.sla" | "notify.send" | "devops.billing"
  | "paas.build" | "paas.poll" | "paas.job" | "wp.import" | "notify.channel" | "paas.db" | "paas.backup" | "paas.billing" | "paas.collect" | "paas.daily"
  | "inquiry.settle" | "geo.billing" | "geo.health" | "geo.ns" | "ai.settle";

export async function enqueue(db: DB | Tx, type: JobType, payload: Record<string, unknown> = {}, opts: { runAt?: Date; dedupe?: string } = {}) {
  await db.insert(jobs).values({ type, payload, runAt: opts.runAt ?? new Date(), dedupe: opts.dedupe ?? null }).onConflictDoNothing();
}

/** claims up to `n` due jobs (crashed workers' jobs are reclaimed after 10 minutes) */
export async function claim(db: DB, n: number) {
  return db.transaction(async (tx) => {
    const due = await tx.select({ id: jobs.id }).from(jobs)
      .where(sql`(${jobs.status} = 'pending' and ${jobs.runAt} <= now()) or (${jobs.status} = 'running' and ${jobs.lockedAt} < now() - interval '10 minutes')`)
      .orderBy(asc(jobs.runAt)).limit(n).for("update", { skipLocked: true });
    if (!due.length) return [];
    return tx.update(jobs).set({ status: "running", lockedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, due.map((d) => d.id))).returning();
  });
}

export const complete = (db: DB, id: number) => db.update(jobs).set({ status: "done", lockedAt: null, lastError: null }).where(eq(jobs.id, id));

/** exponential backoff: 30 s, 2 min, 8 min … up to 6 attempts, then failed */
export async function retry(db: DB, id: number, attempts: number, error: string) {
  const dead = attempts >= 6;
  await db.update(jobs).set({ status: dead ? "failed" : "pending", lockedAt: null, lastError: error.slice(0, 2000), runAt: new Date(Date.now() + 30_000 * 4 ** (attempts - 1)) }).where(eq(jobs.id, id));
  return dead;
}

export const pendingCount = async (db: DB, type?: JobType) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.status, "pending"), type ? eq(jobs.type, type) : undefined, lte(jobs.runAt, new Date()))))[0].n;
