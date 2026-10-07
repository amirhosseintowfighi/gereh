/* Staff reports: monthly finance (Jalali months, Tehran time) and ticket SLA per agent. Both are
   computed on demand from the ledger tables, so they always match what customers were charged. */
import "server-only";
import { and, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { invGross } from "@/lib/money";
import { jalaliToGregorian, TZ } from "@/lib/jalali";
import type { DB } from "./db/client";
import { invoiceItems, invoices, payments, ticketMessages, tickets, transactions, users } from "./db/schema";
import { AUTO_REPLY_NAME, SLA_MIN } from "./worker/ops";
import type { Sheet } from "./xlsx";

const ymFmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { timeZone: TZ, year: "numeric", month: "numeric" });
/** Jalali [year, month] of an instant in Tehran */
export function jalaliYM(d: Date): [number, number] {
  const p = ymFmt.formatToParts(d);
  return [Number(p.find((x) => x.type === "year")!.value), Number(p.find((x) => x.type === "month")!.value)];
}
/** first instant of a Jalali month in Tehran (fixed UTC+03:30) */
export function monthStart(jy: number, jm: number) {
  while (jm < 1) { jm += 12; jy--; }
  while (jm > 12) { jm -= 12; jy++; }
  const { gy, gm, gd } = jalaliToGregorian(jy, jm, 1);
  return new Date(Date.UTC(gy, gm - 1, gd) - 3.5 * 3600_000);
}
const faMonth = (jy: number, jm: number) => (jy + "/" + String(jm).padStart(2, "0")).replace(/\d/g, (c) => "۰۱۲۳۴۵۶۷۸۹"[+c]);

export type MonthRow = { month: string; key: string; invoices: number; net: number; vat: number; gross: number; refunds: number; commissions: number; topups: number; online: number; newCustomers: number };
export type FinanceReport = {
  months: MonthRow[];
  totals: Omit<MonthRow, "month" | "key">;
  categories: { name: string; amount: number }[];
  topCustomers: { id: string; name: string; email: string; amount: number }[];
  gateways: { name: string; amount: number; count: number }[];
  outstanding: { count: number; amount: number };
};

/** what kind of product an invoice line is, from its description */
export function category(desc: string) {
  if (/تخفیف/.test(desc)) return "تخفیف";
  if (/هاست/.test(desc)) return "هاست";
  if (/دامنه|\.(ir|com|net|org|io|co|dev|app|xyz|online|shop|store|tech|info|me|cloud)\b/i.test(desc)) return "دامنه";
  if (/IP/i.test(desc)) return "IP اضافه";
  if (/سرور|VPS|ابری|اختصاصی|srv-/i.test(desc)) return "سرور";
  return "سایر";
}

export async function financeReport(db: DB, monthsBack = 12, now = new Date()): Promise<FinanceReport> {
  const n = Math.min(36, Math.max(1, Math.floor(monthsBack)));
  const [cy, cm] = jalaliYM(now);
  const starts = Array.from({ length: n + 1 }, (_, i) => monthStart(cy, cm - n + 1 + i)); // n months + the end bound
  const from = starts[0]; const to = starts[n];
  const bucket = (d: Date) => { for (let i = n - 1; i >= 0; i--) if (d >= starts[i]) return d < starts[i + 1] ? i : -1; return -1; };
  const months: MonthRow[] = starts.slice(0, n).map((s) => { const [y, m] = jalaliYM(s); return { month: faMonth(y, m), key: y + "-" + String(m).padStart(2, "0"), invoices: 0, net: 0, vat: 0, gross: 0, refunds: 0, commissions: 0, topups: 0, online: 0, newCustomers: 0 }; });

  const [paid, items, txs, pays, newUsers, open] = await Promise.all([
    db.select({ id: invoices.id, userId: invoices.userId, paidAt: invoices.paidAt, tax: invoices.taxRate }).from(invoices)
      .where(and(inArray(invoices.status, ["paid", "refunded"]), isNotNull(invoices.paidAt), gte(invoices.paidAt, from), lt(invoices.paidAt, to))),
    db.select({ invoiceId: invoiceItems.invoiceId, desc: invoiceItems.desc, amount: invoiceItems.amount }).from(invoiceItems).innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(and(inArray(invoices.status, ["paid", "refunded"]), gte(invoices.paidAt, from), lt(invoices.paidAt, to))),
    db.select({ type: transactions.type, amount: transactions.amount, at: transactions.createdAt }).from(transactions)
      .where(and(inArray(transactions.type, ["refund", "commission", "topup"]), gte(transactions.createdAt, from), lt(transactions.createdAt, to))),
    db.select({ amount: payments.amount, gateway: payments.gateway, at: payments.verifiedAt }).from(payments)
      .where(and(eq(payments.status, "paid"), gte(payments.verifiedAt, from), lt(payments.verifiedAt, to))),
    db.select({ at: users.createdAt }).from(users).where(and(eq(users.role, "user"), gte(users.createdAt, from), lt(users.createdAt, to))),
    db.select({ id: invoices.id, tax: invoices.taxRate }).from(invoices).where(inArray(invoices.status, ["unpaid", "overdue"])),
  ]);

  const byInv = new Map<string, { desc: string; amount: number }[]>();
  for (const it of items) (byInv.get(it.invoiceId) ?? byInv.set(it.invoiceId, []).get(it.invoiceId)!).push(it);
  const cats = new Map<string, number>(); const cust = new Map<string, number>();
  for (const inv of paid) {
    const b = bucket(inv.paidAt!); if (b < 0) continue;
    const its = byInv.get(inv.id) ?? [];
    const net = its.reduce((s, i) => s + i.amount, 0); const gross = invGross({ items: its, tax: inv.tax });
    const m = months[b]; m.invoices++; m.net += net; m.gross += gross; m.vat += gross - net;
    for (const i of its) cats.set(category(i.desc), (cats.get(category(i.desc)) ?? 0) + i.amount);
    cust.set(inv.userId, (cust.get(inv.userId) ?? 0) + gross);
  }
  for (const t of txs) {
    const b = bucket(t.at); if (b < 0) continue;
    if (t.type === "refund") months[b].refunds += Math.abs(t.amount);
    else if (t.type === "commission") months[b].commissions += t.amount;
    else months[b].topups += t.amount;
  }
  const gw = new Map<string, { amount: number; count: number }>();
  for (const p of pays) {
    const b = bucket(p.at!); if (b < 0) continue;
    months[b].online += p.amount;
    const g = gw.get(p.gateway) ?? { amount: 0, count: 0 }; g.amount += p.amount; g.count++; gw.set(p.gateway, g);
  }
  for (const u of newUsers) { const b = bucket(u.at); if (b >= 0) months[b].newCustomers++; }

  const top = [...cust.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const people = top.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, top.map(([id]) => id))) : [];
  const openItems = open.length ? await db.select({ invoiceId: invoiceItems.invoiceId, amount: invoiceItems.amount }).from(invoiceItems).where(inArray(invoiceItems.invoiceId, open.map((o) => o.id))) : [];

  const keys = ["invoices", "net", "vat", "gross", "refunds", "commissions", "topups", "online", "newCustomers"] as const;
  return {
    months,
    totals: Object.fromEntries(keys.map((k) => [k, months.reduce((s, m) => s + m[k], 0)])) as FinanceReport["totals"],
    categories: [...cats.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    topCustomers: top.map(([id, amount]) => { const p = people.find((x) => x.id === id); return { id, name: p?.name ?? id, email: p?.email ?? "", amount }; }),
    gateways: [...gw.entries()].map(([name, g]) => ({ name, ...g })).sort((a, b) => b.amount - a.amount),
    outstanding: { count: open.length, amount: open.reduce((s, o) => s + invGross({ items: openItems.filter((i) => i.invoiceId === o.id), tax: o.tax }), 0) },
  };
}

export type AgentRow = { agent: string; replies: number; tickets: number; firstResponses: number; avgFirstMin: number; withinSla: number };
/** per staff member over the last `days`: replies, tickets touched, first responses and SLA hit rate */
export async function slaReport(db: DB, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400_000);
  const [msgs, tks] = await Promise.all([
    db.select({ ticketId: ticketMessages.ticketId, name: ticketMessages.name, at: ticketMessages.createdAt, id: ticketMessages.id }).from(ticketMessages)
      .where(and(eq(ticketMessages.from, "staff"), ne(ticketMessages.name, AUTO_REPLY_NAME), gte(ticketMessages.createdAt, since))),
    db.select({ id: tickets.id, priority: tickets.priority, createdAt: tickets.createdAt, firstResponseAt: tickets.firstResponseAt, status: tickets.status }).from(tickets).where(gte(tickets.createdAt, since)),
  ]);
  const agents = new Map<string, AgentRow & { firstMin: number[]; touched: Set<string> }>();
  const get = (name: string) => agents.get(name) ?? agents.set(name, { agent: name, replies: 0, tickets: 0, firstResponses: 0, avgFirstMin: 0, withinSla: 0, firstMin: [], touched: new Set() }).get(name)!;
  for (const m of msgs) { const a = get(m.name); a.replies++; a.touched.add(m.ticketId); }
  let breached = 0; let answered = 0; const waiting: string[] = [];
  for (const t of tks) {
    const limit = SLA_MIN[t.priority] ?? 240;
    if (!t.firstResponseAt) {
      if ((t.status === "open" || t.status === "customer-reply") && now.getTime() - t.createdAt.getTime() > limit * 60_000) waiting.push(t.id);
      continue;
    }
    const first = msgs.filter((m) => m.ticketId === t.id).sort((a, b) => a.id - b.id)[0];
    const mins = (t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60_000;
    answered++; if (mins > limit) breached++;
    if (!first) continue;
    const a = get(first.name); a.firstResponses++; a.firstMin.push(mins); if (mins <= limit) a.withinSla++;
  }
  const rows: AgentRow[] = [...agents.values()].map(({ firstMin, touched, ...a }) => ({ ...a, tickets: touched.size, avgFirstMin: firstMin.length ? Math.round(firstMin.reduce((s, x) => s + x, 0) / firstMin.length) : 0 }))
    .sort((a, b) => b.replies - a.replies);
  return { days, agents: rows, tickets: tks.length, answered, slaRate: answered ? Math.round(((answered - breached) / answered) * 1000) / 10 : 100, overdueNow: waiting };
}

/** workbook for the finance export: summary by month, product mix, top customers, gateways */
export function financeSheets(r: FinanceReport, sla?: Awaited<ReturnType<typeof slaReport>>): Sheet[] {
  const sheets: Sheet[] = [
    { name: "خلاصه ماهانه", widths: [12, 10, 16, 14, 16, 14, 14, 16, 18, 12],
      rows: [["ماه", "صورتحساب", "فروش خالص (تومان)", "مالیات (تومان)", "جمع با مالیات", "بازگشت وجه", "پورسانت", "شارژ کیف پول", "پرداخت آنلاین", "مشتری جدید"],
        ...r.months.map((m) => [m.month, m.invoices, m.net, m.vat, m.gross, m.refunds, m.commissions, m.topups, m.online, m.newCustomers]),
        ["جمع", r.totals.invoices, r.totals.net, r.totals.vat, r.totals.gross, r.totals.refunds, r.totals.commissions, r.totals.topups, r.totals.online, r.totals.newCustomers]] },
    { name: "ترکیب فروش", widths: [16, 18], rows: [["دسته", "مبلغ خالص (تومان)"], ...r.categories.map((c) => [c.name, c.amount])] },
    { name: "مشتریان برتر", widths: [10, 24, 30, 18], rows: [["شناسه", "نام", "ایمیل", "پرداختی (تومان)"], ...r.topCustomers.map((c) => [c.id, c.name, c.email, c.amount])] },
    { name: "درگاه‌ها", widths: [16, 10, 18], rows: [["درگاه", "تعداد", "مبلغ (تومان)"], ...r.gateways.map((g) => [g.name, g.count, g.amount])] },
  ];
  if (sla) sheets.push({ name: "پشتیبانی", widths: [20, 10, 10, 14, 18, 14], rows: [["کارشناس", "پاسخ‌ها", "تیکت‌ها", "اولین پاسخ", "میانگین اولین پاسخ (دقیقه)", "در زمان هدف"], ...sla.agents.map((a) => [a.agent, a.replies, a.tickets, a.firstResponses, a.avgFirstMin, a.withinSla])] });
  return sheets;
}
