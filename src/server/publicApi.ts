/* Public REST API (/api/v1) for customers' scripts and Terraform. Bearer tokens from Panel › SSH و API;
   "read" tokens may only GET. Every write goes through the same RPC methods (validation, ownership,
   audit) as the panel. */
import "server-only";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Auth } from "./auth";
import { rateLimit } from "./auth";
import type { Ctx } from "./ctx";
import { apiTokens, dnsRecords, domains, invoiceItems, invoices, servers, users } from "./db/schema";
import { registry } from "./rpc";
import { AppError, sha256 } from "./util";
import { invGross } from "@/lib/money";

export async function tokenAuth(ctx: Omit<Ctx, "auth">, header: string | null): Promise<{ auth: Auth; scope: string }> {
  const token = /^Bearer\s+(grh_[A-Za-z0-9]{40})$/.exec(header || "")?.[1];
  if (!token) throw new AppError("Missing or malformed bearer token", 401);
  const [row] = await ctx.db.select({ t: apiTokens, u: users }).from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, sha256(token)), or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date()))));
  if (!row || row.u.status === "suspended") throw new AppError("Invalid or expired token", 401);
  await rateLimit(ctx.db, "api:" + row.t.id, 120, 60);
  if (!row.t.lastUsedAt || Date.now() - row.t.lastUsedAt.getTime() > 60_000) await ctx.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.t.id));
  return { auth: { sessionId: "token:" + row.t.id, user: row.u, uid: row.u.id }, scope: row.t.scope };
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const serverOut = (s: typeof servers.$inferSelect) => ({
  id: s.id, name: s.name, status: s.status, plan: s.plan, cpu: s.cpu, ram_gb: s.ram, disk_gb: s.disk, location: s.loc, os: s.os,
  ipv4: s.ip || null, ipv6: s.ipv6 || null, hostname: s.hostname, billing: s.billing, monthly_price_toman: s.price, paid_until: iso(s.paidUntil), created_at: iso(s.createdAt),
});
const recordOut = (r: typeof dnsRecords.$inferSelect) => ({ id: r.id, type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority });

async function rpc(ctx: Ctx, name: string, ...args: unknown[]) {
  const m = registry[name];
  return m.run(ctx, m.args.parse(args));
}
const notFound = () => { throw new AppError("Not found", 404); };

type Route = { method: string; pattern: RegExp; write?: boolean; run: (ctx: Ctx, m: RegExpExecArray, body: Record<string, unknown>) => Promise<unknown> };
export const ROUTES: Route[] = [
  { method: "GET", pattern: /^account$/, run: async (ctx) => {
    const u = ctx.auth!.user;
    return { id: u.id, name: u.name, email: u.email, balance_toman: u.balance };
  } },
  { method: "GET", pattern: /^servers$/, run: async (ctx) => ({ data: (await ctx.db.select().from(servers).where(eq(servers.userId, ctx.auth!.uid))).map(serverOut) }) },
  { method: "GET", pattern: /^servers\/([\w-]+)$/, run: async (ctx, m) => {
    const [s] = await ctx.db.select().from(servers).where(and(eq(servers.id, m[1]), eq(servers.userId, ctx.auth!.uid)));
    return s ? serverOut(s) : notFound();
  } },
  { method: "POST", pattern: /^servers\/([\w-]+)\/actions$/, write: true, run: async (ctx, m, b) => {
    const action = String(b.action || "");
    if (!["start", "stop", "reboot"].includes(action)) throw new AppError("action must be start, stop or reboot", 422);
    await rpc(ctx, "servers.power", m[1], action);
    return { ok: true };
  } },
  { method: "GET", pattern: /^domains$/, run: async (ctx) => ({ data: (await ctx.db.select().from(domains).where(eq(domains.userId, ctx.auth!.uid))).map((d) => ({ id: d.id, name: d.name, status: d.status, nameservers: d.ns, auto_renew: d.autoRenew, expires_at: iso(d.expiresAt) })) }) },
  { method: "GET", pattern: /^domains\/([\w-]+)\/records$/, run: async (ctx, m) => {
    const [d] = await ctx.db.select().from(domains).where(and(eq(domains.id, m[1]), eq(domains.userId, ctx.auth!.uid)));
    if (!d) notFound();
    return { data: (await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, d!.id))).map(recordOut) };
  } },
  { method: "POST", pattern: /^domains\/([\w-]+)\/records$/, write: true, run: async (ctx, m, b) => {
    await rpc(ctx, "domains.addRecord", m[1], { type: b.type, name: b.name, value: b.value, ttl: b.ttl ?? 3600, ...(b.priority !== undefined && b.priority !== null ? { priority: b.priority } : {}) });
    const all = await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, m[1]));
    return recordOut(all.sort((x, y) => y.position - x.position)[0]);
  } },
  { method: "PUT", pattern: /^domains\/([\w-]+)\/records\/([\w-]+)$/, write: true, run: async (ctx, m, b) => {
    await rpc(ctx, "domains.updateRecord", m[1], { id: m[2], type: b.type, name: b.name, value: b.value, ttl: b.ttl ?? 3600, ...(b.priority !== undefined && b.priority !== null ? { priority: b.priority } : {}) });
    const [r] = await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.id, m[2]));
    return recordOut(r);
  } },
  { method: "DELETE", pattern: /^domains\/([\w-]+)\/records\/([\w-]+)$/, write: true, run: async (ctx, m) => {
    await rpc(ctx, "domains.removeRecord", m[1], m[2]);
    return { ok: true };
  } },
  { method: "GET", pattern: /^invoices$/, run: async (ctx) => {
    const list = await ctx.db.select().from(invoices).where(eq(invoices.userId, ctx.auth!.uid));
    const items = list.length ? await ctx.db.select().from(invoiceItems) : [];
    return { data: list.map((i) => { const it = items.filter((x) => x.invoiceId === i.id); return { id: i.id, status: i.status, total_toman: invGross({ items: it, tax: i.taxRate }), created_at: iso(i.createdAt), due_at: iso(i.dueAt), paid_at: iso(i.paidAt) }; }) };
  } },
];
