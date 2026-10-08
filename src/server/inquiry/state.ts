/* Inquiry slice of /api/state. Customers see their account (never the secret), access status per
   service, their last calls and spend; staff additionally see access requests and all accounts. */
import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { faDate, faDateTime } from "@/lib/jalali";
import type { InquiryState } from "@/lib/types";
import type { DB } from "../db/client";
import { inquiryAccounts, inquiryCalls, inquiryGrants, inquiryServices, users } from "../db/schema";
import { inquiryProvider } from "./provider";

export const EMPTY_INQUIRY: InquiryState = { services: [], account: null, calls: [], stats: { todayCount: 0, todaySpend: 0, monthCount: 0, monthSpend: 0, daily: [] }, grants: [], accounts: [], provider: "" };

export async function inquiryState(db: DB, o: { uid: string; admin: boolean }): Promise<InquiryState> {
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const since30 = new Date(day0.getTime() - 29 * 86400_000);
  const mine = eq(inquiryCalls.userId, o.uid);
  const [services, acct, grants, calls, daily, [today]] = await Promise.all([
    db.select().from(inquiryServices).orderBy(asc(inquiryServices.position)),
    o.admin ? [] : db.select().from(inquiryAccounts).where(eq(inquiryAccounts.userId, o.uid)),
    o.admin
      ? db.select({ g: inquiryGrants, name: users.name }).from(inquiryGrants).innerJoin(users, eq(users.id, inquiryGrants.userId)).orderBy(desc(inquiryGrants.createdAt)).limit(300)
      : db.select({ g: inquiryGrants, name: sql<string>`''` }).from(inquiryGrants).where(eq(inquiryGrants.userId, o.uid)),
    db.select().from(inquiryCalls).where(o.admin ? undefined : mine).orderBy(desc(inquiryCalls.createdAt)).limit(o.admin ? 200 : 100),
    db.select({ day: sql<string>`to_char(${inquiryCalls.createdAt}, 'YYYY-MM-DD')`, count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${inquiryCalls.charged}),0)::bigint` })
      .from(inquiryCalls).where(and(o.admin ? undefined : mine, gte(inquiryCalls.createdAt, since30), eq(inquiryCalls.sandbox, false))).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ count: sql<number>`count(*)::int`, spend: sql<number>`coalesce(sum(${inquiryCalls.charged}),0)::bigint` })
      .from(inquiryCalls).where(and(o.admin ? undefined : mine, gte(inquiryCalls.createdAt, day0), eq(inquiryCalls.sandbox, false))),
  ]);
  const days = daily.map((d) => ({ day: faDate(new Date(d.day + "T12:00:00")), count: d.count, spend: Number(d.spend) }));
  const grant = (id: string) => (o.admin ? undefined : grants.find((x) => x.g.serviceId === id)?.g);
  const a = acct[0];
  let accounts: InquiryState["accounts"] = [];
  if (o.admin) {
    const rows = await db.select({ a: inquiryAccounts, name: users.name, email: users.email }).from(inquiryAccounts).innerJoin(users, eq(users.id, inquiryAccounts.userId)).orderBy(desc(inquiryAccounts.createdAt)).limit(500);
    const usage = await db.select({ userId: inquiryCalls.userId, n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${inquiryCalls.charged}),0)::bigint` })
      .from(inquiryCalls).where(and(gte(inquiryCalls.createdAt, since30), eq(inquiryCalls.sandbox, false))).groupBy(inquiryCalls.userId);
    accounts = rows.map((r) => { const u = usage.find((x) => x.userId === r.a.userId); return { userId: r.a.userId, name: r.name, email: r.email, accountNo: r.a.accountNo, status: r.a.status, calls30: u?.n ?? 0, spend30: Number(u?.s ?? 0) }; });
  }
  return {
    services: services.filter((s) => o.admin || s.active).map((s) => {
      const g = grant(s.id);
      return { id: s.id, name: s.name, price: s.price, active: s.active, approval: s.approval, upstream: o.admin ? s.upstream : "", access: !s.approval ? "open" : g?.status ?? "none", note: g?.note ?? "" };
    }),
    account: a ? { accountNo: a.accountNo, apiKey: a.apiKey, status: a.status, ipAllow: a.ipAllow, since: faDate(a.createdAt) } : null,
    calls: calls.map((c) => ({ id: c.id, userId: o.admin ? c.userId : "", serviceId: c.serviceId, status: c.status, charged: c.charged, latencyMs: c.latencyMs, sandbox: c.sandbox, source: c.source, input: c.input, at: faDateTime(c.createdAt) })),
    stats: { todayCount: today?.count ?? 0, todaySpend: Number(today?.spend ?? 0), monthCount: days.reduce((s, d) => s + d.count, 0), monthSpend: days.reduce((s, d) => s + d.spend, 0), daily: days },
    grants: o.admin ? grants.map((x) => ({ id: x.g.id, userId: x.g.userId, userName: x.name, serviceId: x.g.serviceId, status: x.g.status, useCase: x.g.useCase, note: x.g.note, at: faDateTime(x.g.createdAt) })) : [],
    accounts,
    provider: o.admin ? inquiryProvider().name : "",
  };
}
