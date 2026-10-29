/* «دستیار گره» for staff: the operator console mounted on /admin. A separate tool set over the admin RPCs and
   report functions; each tool names the staff areas that allow it (isStaff, the same roles as the admin pages) and
   runs as the staff member, so the RPC layer checks again. Reads cross customers; changes (retry or manual
   delivery, suspend, wallet credit/debit, ticket replies) are only proposed and run after the staff member confirms
   them, each with an audit line "via assistant" (./confirm.ts). Never a password, key or token in a result. */
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { ToolRisk } from "@/lib/assistant";
import { fa, toEnDigits } from "@/lib/format";
import { isStaff, type Ctx } from "../ctx";
import { hosting, jobs, servers, tickets, users, vpsIps } from "../db/schema";
import { abuseForStaff } from "../monitor/service";
import { listUndelivered } from "../provisioning";
import { financeReport } from "../reports";
import { AppError, fail } from "../util";
import { customerKit, L, plain, rpc, S, str, type AssistantTool, type Kit } from "./tools";

type Json = Record<string, unknown>;
const fixed = (r: ToolRisk) => () => r;
const firstLine = (t: string | null | undefined, n = 200) => (t ?? "").split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, n) ?? "";
/** anything shaped like a credential in free text (job errors) */
const scrub = (t: string) => t.replace(/\b(pass(?:word)?|rootpass|secret|token|api[_-]?key|key)\b(\s*[=:]\s*)\S+/gi, "$1$2***").replace(/(رمز[^:\n]{0,20}:\s*)\S+/g, "$1***");
const toman = (n: number) => fa(Math.round(n)) + " تومان";

async function customerOf(ctx: Ctx, ref: unknown) {
  const q = S(ref).trim();
  if (!q) fail("کاربر را مشخص کنید.");
  const [u] = await ctx.db.select().from(users).where(or(eq(users.id, q), eq(sql`lower(${users.email})`, q.toLowerCase())));
  if (!u) fail("کاربر «" + q + "» پیدا نشد؛ ابتدا با search_customers جست‌وجو کنید.", 404);
  return u!;
}
async function serverOf(ctx: Ctx, ref: unknown) {
  const q = toEnDigits(S(ref)).trim().toLowerCase();
  if (!q) fail("سرور را با شناسه، IP یا hostname مشخص کنید.");
  const extra = await ctx.db.select({ id: vpsIps.serverId }).from(vpsIps).where(eq(vpsIps.ip, q)).limit(1);
  const [s] = await ctx.db.select().from(servers).where(or(sql`lower(${servers.id}) = ${q}`, eq(servers.ip, q), eq(servers.ipv6, q), sql`lower(${servers.hostname}) = ${q}`, sql`lower(${servers.name}) = ${q}`, ...(extra.length ? [eq(servers.id, extra[0].id)] : []))).limit(1);
  if (!s) fail("سروری با «" + S(ref) + "» پیدا نشد.", 404);
  return s!;
}
async function undelivered(ctx: Ctx, key: unknown) {
  const u = (await listUndelivered(ctx.db)).find((x) => x.key === S(key));
  if (!u) fail("سفارش تحویل‌نشده «" + S(key) + "» پیدا نشد؛ فهرست را با undelivered_orders بخوانید.", 404);
  return u!;
}

const READ: AssistantTool[] = [
  { name: "search_customers", description: "Searches customers and their resources by name, email, phone, user id, invoice id, server IP/hostname/id, domain or hosting. Returns matches with the owning user id.",
    inputSchema: { type: "object", properties: { query: str("Text to search, at least 2 characters") }, required: ["query"] }, areas: ["users", "services", "billing"], perm: "admin.search", risk: fixed("read"),
    label: async (_c, a) => "در حال جست‌وجوی «" + S(a.query).slice(0, 40) + "»…",
    run: async (ctx, a) => ({ hits: (await rpc<{ kind: string; label: string; sub: string; userId: string }[]>(ctx, "admin.search", S(a.query).slice(0, 120))).map((h) => ({ kind: h.kind, label: h.label, detail: h.sub, user_id: h.userId })) }),
    brief: (o) => { const h = (o as { hits: unknown[] }).hits; return h.length ? fa(h.length) + " نتیجه" : "نتیجه‌ای پیدا نشد."; } },
  { name: "customer_360", description: "One customer's full picture: profile, status, KYC, wallet balance and burn forecast, level, team, last login, counts, flags and every service with its status.",
    inputSchema: { type: "object", properties: { user: str("User id (u…) or email") }, required: ["user"] }, areas: ["users"], perm: "admin.userDetail", risk: fixed("read"),
    label: L("در حال خواندن پرونده مشتری…"),
    run: async (ctx, a) => {
      const u = await customerOf(ctx, a.user);
      const sum = await rpc<Json & { user: Json }>(ctx, "admin.userDetail", u.id, "summary");
      const svc = await rpc<{ rows: { kind: string; id: string; name: string; status: string; info: string; notes?: string[] }[] }>(ctx, "admin.userDetail", u.id, "services");
      const { referralCode: _r, virtUid: _v, ...user } = sum.user;
      void _r; void _v;
      return { ...sum, user, services: svc.rows.map((r) => ({ kind: r.kind, id: r.id, name: r.name, status: r.status, info: r.info, notes: r.notes ?? [] })) };
    },
    brief: (o) => { const x = o as { user: { name?: string; balance?: number }; services: unknown[] }; return S(x.user.name) + "، موجودی " + toman(Number(x.user.balance) || 0) + "، " + fa(x.services.length) + " سرویس"; } },
  { name: "abuse_incidents", description: "Smart monitoring («پایش هوشمند») across customers: open critical and abuse incidents (outbound DDoS/spam that can get the platform's IPs blacklisted, crypto miners, attacks), abuse first, with the customer, the resource and its status, the evidence and the staff actions already taken. Suspending or contacting the customer is done on /admin/monitor.",
    inputSchema: { type: "object", properties: {} }, areas: ["services"], perm: "monitor.adminIncidents", risk: fixed("read"), label: L("در حال خواندن رخدادهای سوءاستفاده…"),
    run: (ctx) => abuseForStaff(ctx),
    brief: (o) => { const r = (o as { incidents: { abuse: boolean }[] }).incidents; return r.length ? fa(r.length) + " رخداد بحرانی (" + fa(r.filter((x) => x.abuse).length) + " سوءاستفاده)" : "رخداد بحرانی بازی نیست."; } },
  { name: "undelivered_orders", description: "Paid order lines not yet delivered (servers, hosting, domains, IPs): customer, item, stage (queued, retrying, stuck, failed, building), attempts and the first line of the last error. order_key is used by retry_delivery and manual_deliver.",
    inputSchema: { type: "object", properties: {} }, areas: ["services"], perm: "provisioning.list", risk: fixed("read"), label: L("در حال خواندن سفارش‌های تحویل‌نشده…"),
    run: async (ctx) => ({ orders: (await rpc<{ key: string; kind: string; userId: string; userName: string; email: string; item: string; amount: number; stage: string; attempts: number; ageMin: number; error: string; serverId: string | null }[]>(ctx, "provisioning.list"))
      .map((u) => ({ order_key: u.key, kind: u.kind, customer: u.userName + " <" + u.email + ">", user_id: u.userId, item: u.item, amount_toman: u.amount, stage: u.stage, attempts: u.attempts, age_minutes: u.ageMin, error: scrub(firstLine(u.error)), server_id: u.serverId })) }),
    brief: (o) => { const r = (o as { orders: { stage: string }[] }).orders; return r.length ? fa(r.length) + " سفارش تحویل‌نشده (" + fa(r.filter((x) => x.stage === "failed" || x.stage === "stuck").length) + " ناموفق یا گیرکرده)" : "همه سفارش‌ها تحویل شده‌اند."; } },
  { name: "failed_jobs", description: "Background jobs that failed or are retrying after an error in the last N hours (default 24): counts by job type and the newest ones with the first line of their error. Payloads are never shown.",
    inputSchema: { type: "object", properties: { hours: { type: "integer", description: "Look-back window in hours (1–168, default 24)" } } }, areas: ["services"], perm: "admin.jobs", risk: fixed("read"), label: L("در حال خواندن کارهای ناموفق…"),
    run: async (ctx, a) => {
      const hours = Math.min(168, Math.max(1, Math.floor(Number(a.hours) || 24)));
      const since = new Date(Date.now() - hours * 3600_000);
      const rows = await ctx.db.select({ id: jobs.id, type: jobs.type, status: jobs.status, attempts: jobs.attempts, lastError: jobs.lastError, createdAt: jobs.createdAt, runAt: jobs.runAt }).from(jobs)
        .where(and(isNotNull(jobs.lastError), inArray(jobs.status, ["failed", "pending"]), or(gte(jobs.createdAt, since), gte(jobs.runAt, since)))).orderBy(desc(jobs.id)).limit(200);
      const by = new Map<string, { failed: number; retrying: number }>();
      for (const r of rows) { const b = by.get(r.type) ?? { failed: 0, retrying: 0 }; if (r.status === "failed") b.failed++; else b.retrying++; by.set(r.type, b); }
      return {
        hours, total: rows.length, by_type: [...by.entries()].map(([type, n]) => ({ type, ...n })).sort((x, y) => y.failed + y.retrying - x.failed - x.retrying),
        newest: rows.slice(0, 15).map((r) => ({ id: r.id, type: r.type, status: r.status === "failed" ? "failed" : "retrying", attempts: r.attempts, error: scrub(firstLine(r.lastError)) })),
      };
    },
    brief: (o) => { const x = o as { total: number; hours: number; by_type: { type: string }[] }; return x.total ? fa(x.total) + " کار ناموفق یا در تلاش دوباره در " + fa(x.hours) + " ساعت اخیر (" + x.by_type.slice(0, 3).map((t) => t.type).join("، ") + ")" : "در " + fa(x.hours) + " ساعت اخیر کار ناموفقی نیست."; } },
  { name: "sales_summary", description: "Sales and revenue for the last N Jalali months (default 1 = this month): paid invoices, net, VAT, gross, refunds, top-ups, online payments, new customers per month, plus categories, top customers, gateways and outstanding invoices.",
    inputSchema: { type: "object", properties: { months: { type: "integer", description: "Months back including this one (1–12, default 1)" } } }, areas: ["reports"], perm: "admin.reports", risk: fixed("read"), label: L("در حال محاسبه گزارش فروش…"),
    run: async (ctx, a) => {
      const r = await financeReport(ctx.db, Math.min(12, Math.max(1, Math.floor(Number(a.months) || 1))));
      return { months: r.months, totals: r.totals, categories: r.categories.slice(0, 8), top_customers: r.topCustomers.slice(0, 5), gateways: r.gateways, outstanding: r.outstanding };
    },
    brief: (o) => { const x = o as { totals: { gross: number; invoices: number } }; return "فروش " + toman(x.totals.gross) + " در " + fa(x.totals.invoices) + " صورتحساب"; } },
  { name: "open_tickets", description: "Tickets waiting for staff (open or with a new customer reply), oldest first: id, subject, customer, department, priority, status and how long they have waited.",
    inputSchema: { type: "object", properties: {} }, areas: ["tickets"], perm: "admin.tickets", risk: fixed("read"), label: L("در حال خواندن تیکت‌های باز…"),
    run: async (ctx) => {
      const rows = await ctx.db.select({ id: tickets.id, subject: tickets.subject, dept: tickets.dept, priority: tickets.priority, status: tickets.status, updatedAt: tickets.updatedAt, name: users.name, email: users.email })
        .from(tickets).innerJoin(users, eq(users.id, tickets.userId)).where(inArray(tickets.status, ["open", "customer-reply"])).orderBy(tickets.updatedAt);
      return { count: rows.length, tickets: rows.slice(0, 25).map((t) => ({ id: t.id, subject: t.subject, customer: t.name + " <" + t.email + ">", dept: t.dept, priority: t.priority, status: t.status, waiting_minutes: Math.round((Date.now() - t.updatedAt.getTime()) / 60_000) })) };
    },
    brief: (o) => { const n = (o as { count: number }).count; return n ? fa(n) + " تیکت در انتظار پاسخ" : "تیکت بازی نیست."; } },
  { name: "server_details", description: "A cloud server by id (srv-…), IPv4/IPv6, hostname or name: owner, status, plan and resources, location, Virtualizor vpsid, billing and the first line of any delivery error.",
    inputSchema: { type: "object", properties: { server: str("Server id, IP, hostname or name") }, required: ["server"] }, areas: ["services"], perm: "servers.get", risk: fixed("read"),
    label: async (_c, a) => "در حال خواندن سرور " + S(a.server).slice(0, 60) + "…",
    run: async (ctx, a) => {
      const s = await serverOf(ctx, a.server);
      const [o] = await ctx.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, s.userId));
      return {
        id: s.id, name: s.name, owner: o ? { user_id: o.id, name: o.name, email: o.email } : null, status: s.status, plan: s.plan, cpu: s.cpu, ram_gb: s.ram, disk_gb: s.disk, os: s.os,
        location: s.loc, ip: s.ip, ipv6: s.ipv6, hostname: s.hostname, vpsid: s.vpsid, billing: s.billing, price_toman: s.price, paid_until: s.paidUntil?.toISOString() ?? null,
        order_key: s.orderRef, delivery_error: scrub(firstLine(s.provisionError)),
      };
    },
    brief: (o) => { const x = o as { name: string; status: string; ip: string; owner: { name: string } | null }; return x.name + " (" + x.ip + ")، " + x.status + (x.owner ? "، مالک " + x.owner.name : ""); } },
];

const DANGER: AssistantTool[] = [
  { name: "retry_delivery", description: "Retries the delivery of an undelivered order (order_key from undelivered_orders) after the cause was fixed. Needs confirmation.",
    inputSchema: { type: "object", properties: { order_key: str("order_key from undelivered_orders, e.g. INV-1234:0") }, required: ["order_key"] }, areas: ["services"], perm: "provisioning.retry", risk: fixed("danger"),
    label: async (_c, a) => "تلاش دوباره برای تحویل " + S(a.order_key) + "…",
    quote: async (c, a) => { const u = await undelivered(c, a.order_key); return plain("تلاش دوباره برای تحویل سفارش", "تحویل «" + u.item + "» برای " + u.userName + " (" + u.email + ") دوباره در صف قرار می‌گیرد." + (u.error ? " آخرین خطا: " + scrub(firstLine(u.error, 160)) : ""), u.key); },
    run: async (ctx, a) => { await rpc(ctx, "provisioning.retry", S(a.order_key)); return { ok: true, order_key: S(a.order_key) }; },
    brief: (_o, a) => "سفارش " + S(a.order_key) + " دوباره در صف تحویل قرار گرفت." },
  { name: "manual_deliver", description: "Delivers an undelivered server order by hand by attaching an existing Virtualizor VPS (vpsid); IP and hostname are read from Virtualizor. No password is ever passed here. Needs confirmation.",
    inputSchema: { type: "object", properties: { order_key: str("order_key from undelivered_orders"), vpsid: { type: "integer", description: "Existing Virtualizor VPS id" }, note: str("Optional note for the order history") }, required: ["order_key", "vpsid"] },
    areas: ["services"], perm: "provisioning.deliverServer", risk: fixed("danger"), label: async (_c, a) => "تحویل دستی " + S(a.order_key) + "…",
    quote: async (c, a) => {
      const u = await undelivered(c, a.order_key);
      if (u.kind !== "server") fail("تحویل دستی با vpsid فقط برای سفارش سرور است.");
      const vpsid = Math.floor(Number(a.vpsid));
      if (!Number.isInteger(vpsid) || vpsid < 1) fail("vpsid معتبر نیست.");
      return plain("تحویل دستی سرور", "VPS شماره " + vpsid + " به‌عنوان «" + u.item + "» به " + u.userName + " (" + u.email + ") تحویل می‌شود؛ IP و hostname از Virtualizor خوانده می‌شود و سفارش بسته می‌شود.", u.key + " ← VPS " + vpsid);
    },
    run: async (ctx, a) => ({ server_id: await rpc<string>(ctx, "provisioning.deliverServer", S(a.order_key), { vpsid: Math.floor(Number(a.vpsid)), note: (S(a.note) || "تحویل دستی با دستیار گره").slice(0, 300) }) }),
    brief: (o) => "سرور " + S((o as Json).server_id) + " تحویل شد." },
  { name: "set_service_status", description: "Suspends or unsuspends a customer's cloud server or hosting. Needs confirmation.",
    inputSchema: { type: "object", properties: { kind: str("server or hosting", { enum: ["server", "hosting"] }), id: str("Server id (srv-…) or hosting id"), action: str("suspend or unsuspend", { enum: ["suspend", "unsuspend"] }) }, required: ["kind", "id", "action"] },
    areas: ["services"], perm: "servers.setStatus", risk: fixed("danger"), label: async (_c, a) => (a.action === "unsuspend" ? "رفع تعلیق " : "تعلیق ") + S(a.id) + "…",
    quote: async (c, a) => {
      if (a.action !== "suspend" && a.action !== "unsuspend") fail("اقدام باید suspend یا unsuspend باشد.");
      const on = a.action === "suspend";
      if (a.kind === "hosting") {
        const [h] = await c.db.select().from(hosting).where(eq(hosting.id, S(a.id)));
        if (!h) fail("هاست پیدا نشد.", 404);
        const [o] = await c.db.select({ name: users.name }).from(users).where(eq(users.id, h!.userId));
        return plain(on ? "تعلیق هاست" : "رفع تعلیق هاست", "هاست «" + h!.domain + "» متعلق به " + (o?.name ?? h!.userId) + (on ? " معلق می‌شود و سایت‌هایش از دسترس خارج می‌شوند." : " دوباره فعال می‌شود."), h!.domain);
      }
      if (a.kind !== "server") fail("نوع سرویس باید server یا hosting باشد.");
      const s = await serverOf(c, a.id);
      const [o] = await c.db.select({ name: users.name }).from(users).where(eq(users.id, s.userId));
      if (!on && s.status !== "suspended") fail("این سرور معلق نیست.");
      return plain(on ? "تعلیق سرور" : "رفع تعلیق سرور", "سرور «" + s.name + "» (" + s.ip + ") متعلق به " + (o?.name ?? s.userId) + (on ? " معلق می‌شود و در Virtualizor متوقف می‌ماند." : " از تعلیق خارج و روشن می‌شود."), s.name);
    },
    run: async (ctx, a) => {
      const on = a.action === "suspend";
      if (a.kind === "hosting") await rpc(ctx, "hosting.setStatus", S(a.id), on ? "suspended" : "active");
      else await rpc(ctx, "servers.setStatus", (await serverOf(ctx, a.id)).id, on ? "suspended" : "running");
      return { ok: true };
    },
    brief: (_o, a) => (a.action === "suspend" ? "سرویس معلق شد." : "تعلیق سرویس برداشته شد.") },
  { name: "adjust_wallet", description: "Credits (positive amount) or debits (negative amount) a customer's main wallet in Toman, with a required reason that is recorded in the transaction and the audit log. Needs confirmation.",
    inputSchema: { type: "object", properties: { user: str("User id or email"), amount: { type: "integer", description: "Toman; positive credits, negative debits" }, reason: str("Why (required, shown in the customer's transactions)") }, required: ["user", "amount", "reason"] },
    areas: ["billing"], perm: "admin.adjustBalance", risk: fixed("danger"), label: L("آماده‌سازی تغییر موجودی کیف پول…"),
    quote: async (c, a) => {
      const u = await customerOf(c, a.user);
      if (u.id === c.auth!.user.id) fail("موجودی کیف پول خودتان را نمی‌توانید تغییر دهید.", 403);
      const amount = Math.trunc(Number(a.amount));
      if (!Number.isFinite(amount) || !amount || Math.abs(amount) > 1_000_000_000) fail("مبلغ معتبر (غیر صفر) به تومان بدهید.");
      const reason = S(a.reason).trim();
      if (reason.length < 3) fail("دلیل تغییر موجودی لازم است.");
      if (u.balance + amount < 0) fail("موجودی نمی‌تواند منفی شود (موجودی فعلی " + toman(u.balance) + ").");
      return { title: amount > 0 ? "افزایش موجودی کیف پول" : "کاهش موجودی کیف پول", summary: (amount > 0 ? "واریز " : "برداشت ") + toman(Math.abs(amount)) + (amount > 0 ? " به " : " از ") + "کیف پول " + u.name + " (" + u.email + "): موجودی از " + toman(u.balance) + " به " + toman(u.balance + amount) + " می‌رسد. دلیل: «" + reason.slice(0, 160) + "»", resource: u.name, cost: null, costNote: "در تراکنش‌های مشتری با همین دلیل و در گزارش ممیزی ثبت می‌شود." };
    },
    run: async (ctx, a) => {
      const u = await customerOf(ctx, a.user);
      if (u.id === ctx.auth!.user.id) fail("موجودی کیف پول خودتان را نمی‌توانید تغییر دهید.", 403);
      const amount = Math.trunc(Number(a.amount));
      await rpc(ctx, "admin.adjustBalance", u.id, amount, (S(a.reason).trim().slice(0, 170) + " (دستیار گره)"));
      const [after] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, u.id));
      return { user_id: u.id, amount_toman: amount, balance_toman: after?.balance ?? null };
    },
    brief: (o) => { const x = o as { amount_toman: number; balance_toman: number }; return (x.amount_toman > 0 ? "واریز " : "برداشت ") + toman(Math.abs(x.amount_toman)) + " انجام شد؛ موجودی جدید " + toman(x.balance_toman); } },
  { name: "reply_ticket", description: "Sends a staff reply to a ticket (the customer is notified and emailed). Write the full reply text in the customer's language. Needs confirmation; the text is shown on the card.",
    inputSchema: { type: "object", properties: { ticket_id: str("Ticket id (TK-…)"), text: str("The reply exactly as the customer will read it") }, required: ["ticket_id", "text"] },
    areas: ["tickets"], perm: "tickets.reply", risk: fixed("danger"), label: async (_c, a) => "پاسخ به تیکت " + S(a.ticket_id) + "…",
    quote: async (c, a) => {
      const [t] = await c.db.select({ id: tickets.id, subject: tickets.subject, name: users.name }).from(tickets).innerJoin(users, eq(users.id, tickets.userId)).where(eq(tickets.id, S(a.ticket_id)));
      if (!t) fail("تیکت پیدا نشد.", 404);
      const text = S(a.text).trim();
      if (text.length < 2 || text.length > 5000) fail("متن پاسخ باید بین ۲ تا ۵۰۰۰ نویسه باشد.");
      return plain("ارسال پاسخ تیکت", "پاسخ به تیکت " + t!.id + " «" + t!.subject + "» (" + t!.name + "):\n\n" + text, t!.id);
    },
    run: async (ctx, a) => { await rpc(ctx, "tickets.reply", S(a.ticket_id), S(a.text).trim(), "staff"); return { ok: true, ticket_id: S(a.ticket_id) }; },
    brief: (_o, a) => "پاسخ در تیکت " + S(a.ticket_id) + " ثبت و برای مشتری ارسال شد." },
];

export const STAFF_TOOLS: AssistantTool[] = [...READ, ...DANGER];
export const staffToolByName = (name: string) => STAFF_TOOLS.find((t) => t.name === name);

/** staff in their own session (never while viewing a customer's panel) with a role that covers one of the tool's areas */
export const staffConsole = (ctx: Ctx) => !!ctx.auth && ctx.auth.user.role === "admin" && ctx.auth.uid === ctx.auth.user.id;
export async function staffAllowed(ctx: Ctx, t: AssistantTool) {
  return staffConsole(ctx) && !!t.areas?.some((a) => isStaff(ctx, a));
}

export const staffKit: Kit = {
  mode: "staff",
  byName: staffToolByName,
  allowed: async (ctx, t) => staffAllowed(ctx, t),
  view: (ctx) => ctx,
  async exec(ctx, t, args) {
    if (!(await staffAllowed(ctx, t))) throw new AppError("نقش شما اجازه این کار را ندارد.", 403);
    for (const k of t.inputSchema.required ?? []) if (args[k] === undefined || args[k] === null || args[k] === "") throw new AppError("آرگومان «" + k + "» لازم است.", 422);
    return t.run(ctx, args);
  },
  async specs(ctx) {
    const out = [];
    for (const t of STAFF_TOOLS) {
      if (!(await staffAllowed(ctx, t))) continue;
      const danger = t.risk({}) === "danger";
      out.push({ type: "function" as const, function: { name: t.name, description: t.description + (danger ? " [Runs only after the staff member confirms it.]" : ""), parameters: t.inputSchema } });
    }
    return out;
  },
};

export const kitFor = (mode: "customer" | "staff" | null | undefined): Kit => (mode === "staff" ? staffKit : customerKit);
