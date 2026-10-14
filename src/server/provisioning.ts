/* Paid but undelivered orders: what Admin › سفارش‌های تحویل‌نشده lists, and the refund amount of one order line. */
import "server-only";
import { and, asc, eq, inArray, isNotNull, like, lt, or, sql } from "drizzle-orm";
import type { Sku } from "@/lib/catalog";
import { roundK } from "@/lib/format";
import type { DB, Tx } from "./db/client";
import { invoiceItems, invoices, jobs, servers, users } from "./db/schema";

export type Undelivered = {
  key: string; kind: "server" | "hosting" | "domain" | "ip"; invoiceId: string; index: number; userId: string; userName: string; email: string;
  item: string; amount: number; createdAt: string; jobId: number | null; jobStatus: string; attempts: number; error: string; resolved: boolean;
  serverId: string | null; serverName: string; serverStatus: string; vpsid: number | null; ticket: string | null; sku: Sku | null; stage: "queued" | "retrying" | "stuck" | "failed" | "building";
};

const KIND: Record<string, Undelivered["kind"]> = { "provision.server": "server", "provision.hosting": "hosting", "provision.domain": "domain", "provision.ip": "ip" };

/** the paid amount (incl. VAT, net of the coupon share) of invoice line `index` */
export async function lineAmount(db: DB | Tx, invoiceId: string, index: number) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return { desc: "", amount: 0 };
  const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId)).orderBy(asc(invoiceItems.id));
  const line = items[index];
  if (!line || line.amount <= 0) return { desc: line?.desc ?? "", amount: 0 };
  const positive = items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const discount = -items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const net = line.amount - (positive ? (discount * line.amount) / positive : 0);
  return { desc: line.desc, amount: roundK(net * (1 + inv.taxRate / 100)) };
}

/** provisioning jobs that are retrying, stuck or dead, plus server rows that never got delivered */
export async function listUndelivered(db: DB): Promise<Undelivered[]> {
  const stuck = new Date(Date.now() - 15 * 60_000);
  const jobRows = await db.select().from(jobs).where(and(like(jobs.type, "provision.%"), sql`(${jobs.payload}->>'phase') is null`, sql`(${jobs.payload}->>'renew') is null`, or(
    eq(jobs.status, "failed"),
    and(eq(jobs.status, "pending"), sql`${jobs.attempts} > 0`),
    and(eq(jobs.status, "running"), lt(jobs.lockedAt, stuck)),
  )));
  const srvRows = await db.select().from(servers).where(and(isNotNull(servers.orderRef), or(eq(servers.status, "provisioning"), isNotNull(servers.provisionError))));
  const byKey = new Map<string, Undelivered>();
  const userIds = new Set<string>();
  for (const j of jobRows) {
    const p = j.payload as { userId?: string; invoiceId?: string; index?: number; sku?: Sku; resolved?: unknown };
    if (!p.invoiceId || p.index === undefined || p.resolved) continue;
    const key = p.invoiceId + ":" + p.index;
    userIds.add(p.userId ?? "");
    byKey.set(key, {
      key, kind: KIND[j.type] ?? "server", invoiceId: p.invoiceId, index: p.index, userId: p.userId ?? "", userName: "", email: "", item: "", amount: 0,
      createdAt: j.createdAt.toISOString(), jobId: j.id, jobStatus: j.status, attempts: j.attempts, error: j.lastError ?? "", resolved: false,
      serverId: null, serverName: "", serverStatus: "", vpsid: null, ticket: null, sku: p.sku ?? null,
      stage: j.status === "failed" ? "failed" : j.status === "running" ? "stuck" : "retrying",
    });
  }
  // a server row without its job (e.g. the job finished but the build timed out) is listed too
  const missing = srvRows.filter((s) => !byKey.has(s.orderRef!));
  const extraJobs = missing.length ? await db.select().from(jobs).where(and(eq(jobs.type, "provision.server"), inArray(jobs.dedupe, missing.map((s) => s.orderRef!)))) : [];
  for (const s of srvRows) {
    const [invoiceId, idx] = [s.orderRef!.slice(0, s.orderRef!.lastIndexOf(":")), Number(s.orderRef!.slice(s.orderRef!.lastIndexOf(":") + 1))];
    let u = byKey.get(s.orderRef!);
    if (!u) {
      const j = extraJobs.filter((x) => x.dedupe === s.orderRef).sort((a, b) => b.id - a.id)[0];
      userIds.add(s.userId);
      u = {
        key: s.orderRef!, kind: "server", invoiceId, index: idx, userId: s.userId, userName: "", email: "", item: "", amount: 0, createdAt: s.createdAt.toISOString(),
        jobId: j?.id ?? null, jobStatus: j?.status ?? "", attempts: j?.attempts ?? 0, error: "", resolved: false, serverId: null, serverName: "", serverStatus: "", vpsid: null, ticket: null,
        sku: ((j?.payload as { sku?: Sku } | undefined)?.sku) ?? null, stage: s.vpsid ? "building" : j?.status === "pending" && !j.attempts ? "queued" : "retrying",
      };
      byKey.set(s.orderRef!, u);
    }
    Object.assign(u, { serverId: s.id, serverName: s.name, serverStatus: s.status, vpsid: s.vpsid, ticket: s.provisionTicket, error: s.provisionError || u.error });
    if (s.vpsid && u.stage !== "failed") u.stage = "building";
  }
  const list = [...byKey.values()];
  const people = userIds.size ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...userIds])) : [];
  for (const u of list) {
    const p = people.find((x) => x.id === u.userId);
    u.userName = p?.name ?? ""; u.email = p?.email ?? "";
    const l = await lineAmount(db, u.invoiceId, u.index);
    u.item = l.desc; u.amount = l.amount;
  }
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** orders that need attention (a first attempt still waiting in the queue does not count) */
export const undeliveredCount = async (db: DB) => (await listUndelivered(db)).filter((u) => u.stage !== "queued").length;
