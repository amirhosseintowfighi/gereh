/* Dashboard figures computed from the records themselves (never invented): admin sign-ups, revenue and
   first-response time, and a customer's daily traffic as Virtualizor reported it. When there is nothing
   yet, each figure says so and why (`empty`) instead of showing a made-up series. */
import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { TZ } from "@/lib/jalali";
import type { AdminDashboardStats, TrafficSummary } from "@/lib/dashboard";
import type { DB } from "./db/client";
import { servers, tickets, users, vpsTrafficDaily } from "./db/schema";
import { getLocations } from "./locations";
import { financeReport } from "./reports";

const DAY = 86400_000;
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const weekday = new Intl.DateTimeFormat("fa-IR", { timeZone: TZ, weekday: "short" });
const dayLabel = new Intl.DateTimeFormat("fa-IR", { timeZone: TZ, month: "short", day: "numeric" });

/** customers only: staff accounts and deleted accounts are not sign-ups */
const customer = and(eq(users.role, "user"), ne(users.status, "deleted"));

export async function adminDashboardStats(db: DB, now = new Date()): Promise<AdminDashboardStats> {
  // sign-ups: the last 7 Tehran calendar days, today included
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() - (6 - i) * DAY));
  const keys = days.map((d) => dayKey.format(d));
  const since = new Date(now.getTime() - 8 * DAY);
  const [joined, [{ n: customers }], [{ n: active }], fr, finance] = await Promise.all([
    db.select({ at: users.createdAt }).from(users).where(and(customer, gte(users.createdAt, since))),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(customer),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(customer, eq(users.status, "active"))),
    // first response over the last 30 days, from the tickets' own timestamps
    db.select({ avg: sql<number | null>`avg(extract(epoch from (${tickets.firstResponseAt} - ${tickets.createdAt})) / 60)`, n: sql<number>`count(*)::int` }).from(tickets)
      .where(and(isNotNull(tickets.firstResponseAt), gte(tickets.createdAt, new Date(now.getTime() - 30 * DAY)))),
    financeReport(db, 12, now),
  ]);
  const by = new Map<string, number>();
  for (const u of joined) { const k = dayKey.format(u.at); by.set(k, (by.get(k) ?? 0) + 1); }
  const counts = keys.map((k) => by.get(k) ?? 0);
  const [{ avg, n: answered }] = fr;
  return {
    signups: { period: "۷ روز اخیر (" + dayLabel.format(days[0]) + " تا " + dayLabel.format(days[6]) + ")", labels: days.map((d) => weekday.format(d)), counts, total: counts.reduce((a, b) => a + b, 0) },
    customers: { total: customers, active },
    revenue: { period: "۱۲ ماه شمسی اخیر", labels: finance.months.map((m) => m.month), gross: finance.months.map((m) => m.gross), total: finance.totals.gross },
    firstResponse: { period: "۳۰ روز اخیر", minutes: answered && avg !== null ? Math.round(Number(avg)) : null, tickets: answered },
  };
}

/** a customer's daily traffic over the last 30 days, all their servers together (GB = MB / 1024, in + out) */
export async function trafficSummary(db: DB, uid: string, now = new Date()): Promise<TrafficSummary> {
  const mine = await db.select({ id: servers.id, vpsid: servers.vpsid }).from(servers).where(eq(servers.userId, uid));
  const from = new Date(now.getTime() - 29 * DAY).toISOString().slice(0, 10);
  const rows = mine.length ? await db.select({ day: vpsTrafficDaily.day, inMb: sql<number>`sum(${vpsTrafficDaily.inMb})`, outMb: sql<number>`sum(${vpsTrafficDaily.outMb})` }).from(vpsTrafficDaily)
    .where(and(inArray(vpsTrafficDaily.serverId, mine.map((s) => s.id)), gte(vpsTrafficDaily.day, from))).groupBy(vpsTrafficDaily.day).orderBy(asc(vpsTrafficDaily.day)) : [];
  const days = rows.map((r) => ({ day: r.day, inGb: +(Number(r.inMb) / 1024).toFixed(2), outGb: +(Number(r.outMb) / 1024).toFixed(2) }));
  const totalGb = +days.reduce((a, d) => a + d.inGb + d.outGb, 0).toFixed(1);
  const empty = days.length ? ""
    : !mine.length ? "هنوز سروری ندارید؛ ترافیک سرورهای ابری شما این‌جا نمایش داده می‌شود."
    : !mine.some((s) => s.vpsid) ? "سرورهای شما هنوز تحویل نشده‌اند؛ پس از راه‌اندازی، آمار روزانه از Virtualizor خوانده می‌شود."
    : "Virtualizor هنوز آماری برای این ماه برنگردانده است؛ آمار هر ساعت خوانده می‌شود و پس از اولین گزارش این‌جا نمایش داده می‌شود.";
  return { days, totalGb, servers: mine.length, empty };
}

/** figures the public pages may show, all counted from the records; null = not enough data to state one */
export async function publicFacts(db: DB, now = new Date()) {
  const [[{ n: customers }], locs, [fr]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(customer, eq(users.status, "active"))),
    getLocations(db),
    db.select({ avg: sql<number | null>`avg(extract(epoch from (${tickets.firstResponseAt} - ${tickets.createdAt})) / 60)`, n: sql<number>`count(*)::int` }).from(tickets)
      .where(and(isNotNull(tickets.firstResponseAt), gte(tickets.createdAt, new Date(now.getTime() - 90 * DAY)))),
  ]);
  return {
    customers, locations: locs.filter((l) => l.active !== false).length,
    /** average first response over 90 days, from at least 10 answered tickets */
    firstResponseMin: fr.n >= 10 && fr.avg !== null ? Math.round(Number(fr.avg)) : null,
  };
}
