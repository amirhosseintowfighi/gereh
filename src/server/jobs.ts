/* Postgres-backed job queue. Producers call enqueue() inside their transaction, so a job exists iff
   the change that caused it committed. The worker (src/server/worker.ts) claims due jobs with
   FOR UPDATE SKIP LOCKED, so several worker processes can run side by side. */
import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { DB, Tx } from "./db/client";
import { jobs } from "./db/schema";
import { open, seal } from "./secrets";

export type JobType =
  | "provision.server" | "provision.hosting" | "provision.domain" | "provision.ip"
  | "billing.renewals" | "billing.hourly" | "billing.overdue" | "billing.reminders"
  | "usage.collect" | "usage.alerts" | "virt.reconcile" | "virt.sync" | "virt.power" | "virt.relayout" | "tickets.sla" | "notify.send" | "devops.billing"
  | "paas.build" | "paas.poll" | "paas.job" | "wp.import" | "notify.channel" | "paas.scan" | "paas.verify" | "paas.db" | "paas.backup" | "paas.billing" | "paas.collect" | "paas.daily" | "paas.tools" | "paas.toolsDaily" | "paas.diskBackup"
  | "inquiry.settle" | "geo.billing" | "geo.health" | "geo.ns" | "ai.settle"
  | "dbaas.init" | "dbaas.import" | "dbaas.expire"
  | "storage.billing" | "storage.collect"
  | "mail.deliver" | "mail.billing" | "mail.dns" | "mail.daily"
  | "domains.alerts"
  | "vps.billing" | "vps.snapshots"
  | "builder.watch" | "builder.fix" | "builder.maintain"
  | "support.ai"
  | "advisor.weekly";

/* Passwords never sit in jobs.payload in the clear: enqueue() stores each secret field as "<field>Enc" (sealed),
   the worker opens it just before the handler runs (openPayload), and the sealed copy is dropped once it served
   its purpose (on completion, or by the handler when the secret outlives one job). A job queued before this
   carries the plain field: that still works, and the sealed one wins when both are present. */
const SECRET_FIELDS: Partial<Record<JobType, (p: Record<string, unknown>) => string[]>> = {
  "provision.server": () => ["rootpass"],
  // credential mails (root/cPanel passwords in the text)
  "notify.send": (p) => (p.secret ? ["text"] : []),
};
/** fields dropped as soon as the job succeeds (provision.server's root password outlives one poll: see scrubRootpass) */
const SCRUB_ON_DONE: Partial<Record<JobType, (p: Record<string, unknown>) => string[]>> = { "notify.send": (p) => (p.secret ? ["text", "textEnc"] : []) };
const secretFields = (type: string, p: Record<string, unknown>) => SECRET_FIELDS[type as JobType]?.(p) ?? [];

export function sealPayload(type: string, payload: Record<string, unknown>) {
  const out = { ...payload };
  for (const f of secretFields(type, payload)) {
    const v = out[f];
    if (typeof v !== "string") continue;
    delete out[f];
    if (v) out[f + "Enc"] = seal(v);
  }
  return out;
}
/** the payload a handler sees: sealed fields opened (preferred over a legacy plain one), the sealed copies removed */
export function openPayload(type: string, payload: Record<string, unknown>) {
  const out = { ...payload };
  for (const f of secretFields(type, payload)) {
    const enc = out[f + "Enc"];
    delete out[f + "Enc"];
    const v = typeof enc === "string" ? open(enc) : null;
    if (v !== null) out[f] = v;
    else if (typeof out[f] !== "string") out[f] = "";
  }
  return out;
}
/** the secret values of an opened payload, to keep them out of last_error and the logs */
export const secretValues = (type: string, opened: Record<string, unknown>) =>
  secretFields(type, opened).map((f) => opened[f]).filter((v): v is string => typeof v === "string" && v.length >= 4)
    // a mail's text is long: only the password lines inside it are secret
    .flatMap((v) => (v.length > 128 || v.includes("\n") ? [...v.matchAll(/رمز[^:\n]*:\s*(\S+)/g)].map((m) => m[1]) : [v]));
export function redact(text: string, secrets: string[]) {
  let t = text;
  for (const s of secrets) if (s) t = t.split(s).join("***");
  return t;
}

export async function enqueue(db: DB | Tx, type: JobType, payload: Record<string, unknown> = {}, opts: { runAt?: Date; dedupe?: string } = {}) {
  payload = sealPayload(type, payload);
  await db.insert(jobs).values({ type, payload, runAt: opts.runAt ?? new Date(), dedupe: opts.dedupe ?? null }).onConflictDoNothing();
}

/** claims up to `n` due jobs, optionally only of (or never of) some types. A running job's lock is renewed by
    heartbeat() while it runs, so only a crashed worker's job (no heartbeat for 10 minutes) is reclaimed. */
export async function claim(db: DB, n: number, f: { only?: JobType[]; except?: JobType[] } = {}) {
  const types = f.only?.length ? sql` and ${inArray(jobs.type, f.only)}` : f.except?.length ? sql` and ${jobs.type} not in (${sql.join(f.except.map((t) => sql`${t}`), sql`, `)})` : sql``;
  return db.transaction(async (tx) => {
    const due = await tx.select({ id: jobs.id }).from(jobs)
      .where(sql`((${jobs.status} = 'pending' and ${jobs.runAt} <= now()) or (${jobs.status} = 'running' and ${jobs.lockedAt} < now() - interval '10 minutes'))${types}`)
      .orderBy(asc(jobs.runAt)).limit(n).for("update", { skipLocked: true });
    if (!due.length) return [];
    return tx.update(jobs).set({ status: "running", lockedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, due.map((d) => d.id))).returning();
  });
}

/** renews a running job's lock so a long job is not taken for a crashed one */
export const heartbeat = (db: DB, id: number) => db.update(jobs).set({ lockedAt: new Date() }).where(and(eq(jobs.id, id), eq(jobs.status, "running")));

export async function complete(db: DB, id: number, type?: string, payload: Record<string, unknown> = {}) {
  const drop = SCRUB_ON_DONE[type as JobType]?.(payload) ?? [];
  await db.update(jobs).set({ status: "done", lockedAt: null, lastError: null, ...(drop.length ? { payload: sql`${jobs.payload} - array[${sql.join(drop.map((f) => sql`${f}`), sql`, `)}]::text[]` } : {}) })
    .where(eq(jobs.id, id));
}

/** exponential backoff: 30 s, 2 min, 8 min … up to 6 attempts, then failed */
export async function retry(db: DB, id: number, attempts: number, error: string) {
  const dead = attempts >= 6;
  await db.update(jobs).set({ status: dead ? "failed" : "pending", lockedAt: null, lastError: error.slice(0, 2000), runAt: new Date(Date.now() + 30_000 * 4 ** (attempts - 1)) }).where(eq(jobs.id, id));
  return dead;
}

export const pendingCount = async (db: DB, type?: JobType) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.status, "pending"), type ? eq(jobs.type, type) : undefined, lte(jobs.runAt, new Date()))))[0].n;
