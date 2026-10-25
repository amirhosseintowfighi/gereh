/* The assistant's tools: every MCP tool (src/server/mcp.ts, the same definitions and public-API routes) plus
   panel-only tools over the RPC methods (plans and prices, charts, spending, hostname, snapshots, purchases,
   deletions…). Each tool runs as the customer with the RPC layer's own checks; the assistant adds the team-role
   check (`perm`) and the risk class: read and safe tools run right away, danger tools only after the person
   confirms them (./confirm.ts), with a Persian summary and the cost from the real pricing functions. */
import "server-only";
import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { costOf, estimateTokens } from "@/lib/ai";
import type { AssistantMode, ToolRisk } from "@/lib/assistant";
import { PLAN_NUMS, priceSku, type Sku } from "@/lib/catalog";
import { fa } from "@/lib/format";
import { invGross } from "@/lib/money";
import { customAllows } from "../account-extras";
import { tehranStarts } from "../ai/service";
import { MAX_OUT, pickModel } from "../builder/engine";
import { teamAllows, type Area, type Ctx } from "../ctx";
import { builderProjects, invoiceItems, invoices, osTemplates, paasDbs, paasPlans, plans, servers, storagePlans, subWallets, transactions, users } from "../db/schema";
import { getLocations } from "../locations";
import { callRoute, MCP_TOOLS } from "../mcp";
import { registry } from "../rpc";
import { catalog } from "../rpc/billing";
import { getSettings } from "../state";
import { AppError, fail } from "../util";
import { planLayout } from "../virt/layout";

type Json = Record<string, unknown>;
type Schema = { type: "object"; properties: Record<string, Json>; required?: string[] };
export type Quote = { title: string; summary: string; resource: string; cost: number | null; costNote: string };
export type AssistantTool = {
  name: string; description: string; inputSchema: Schema;
  risk: (a: Json) => ToolRisk;
  /** the RPC method name whose team permission the tool needs (teamAllows + custom roles) */
  perm: string;
  /** staff console tools (./staff.ts): the staff areas, any of which allows the tool (isStaff) */
  areas?: Area[];
  /** the activity chip, e.g. «در حال خواندن وضعیت سرور web-1…» */
  label: (ctx: Ctx, a: Json) => Promise<string>;
  run: (ctx: Ctx, a: Json) => Promise<unknown>;
  /** one Persian line about the result */
  brief: (out: unknown, a: Json) => string;
  /** danger tools: what will happen, on what, and what it costs */
  quote?: (ctx: Ctx, a: Json) => Promise<Quote>;
};

export const str = (description: string, extra: Json = {}) => ({ type: "string", description, ...extra });
export const S = (v: unknown) => String(v ?? "");
const uid = (ctx: Ctx) => ctx.auth!.uid;
export async function rpc<T = unknown>(ctx: Ctx, name: string, ...args: unknown[]): Promise<T> {
  const m = registry[name];
  return (await m.run(ctx, m.args.parse(args))) as T;
}
const list = (out: unknown): Json[] => { const d = (out as { data?: unknown })?.data; return Array.isArray(d) ? (d as Json[]) : []; };
const STATUS_FA: Record<string, string> = { running: "روشن", stopped: "خاموش", suspended: "معلق", provisioning: "در حال آماده‌سازی", failed: "خطا", crashed: "از کار افتاده", building: "در حال ساخت", deploying: "در حال استقرار", live: "فعال", active: "فعال", paid: "پرداخت‌شده", unpaid: "پرداخت‌نشده", overdue: "سررسید گذشته", queued: "در صف", succeeded: "موفق", pending: "در انتظار", ready: "آماده", draft: "پیش‌نویس", sleeping: "خواب" };
export const statusFa = (s: unknown) => STATUS_FA[S(s)] ?? S(s);
const names = (rows: Json[], key = "name", n = 4) => rows.slice(0, n).map((r) => S(r[key]) + (r.status ? " (" + statusFa(r.status) + ")" : "")).join("، ") + (rows.length > n ? "، …" : "");
const countBrief = (noun: string) => (out: unknown) => { const r = list(out); return r.length ? fa(r.length) + " " + noun + ": " + names(r) : "هیچ " + noun + "ی ندارید."; };
const done = (text: string) => () => text;

async function serverRow(ctx: Ctx, id: unknown) {
  const [s] = await ctx.db.select().from(servers).where(and(eq(servers.id, S(id)), eq(servers.userId, uid(ctx))));
  return s ?? null;
}
const serverName = async (ctx: Ctx, id: unknown) => (await serverRow(ctx, id))?.name ?? S(id);
async function needServer(ctx: Ctx, id: unknown) {
  const s = await serverRow(ctx, id);
  if (!s) fail("سرور پیدا نشد.", 404);
  return s!;
}
export const L = (text: string) => async () => text;

/* ---------- the MCP tools, with the panel's classification ---------- */
type Meta = Pick<AssistantTool, "perm" | "label" | "brief"> & { risk: ToolRisk | ((a: Json) => ToolRisk); quote?: AssistantTool["quote"] };
export const plain = (title: string, summary: string, resource: string): Quote => ({ title, summary, resource, cost: null, costNote: "" });

async function builderQuote(ctx: Ctx, a: Json, title: string): Promise<Quote> {
  const [p] = a.id ? await ctx.db.select().from(builderProjects).where(and(eq(builderProjects.id, S(a.id)), eq(builderProjects.userId, uid(ctx)))) : [];
  if (a.id && !p) fail("پروژه پیدا نشد.", 404);
  const model = await pickModel(ctx.db, p?.model ?? "");
  // the builder's own reserve: the prompt and its instructions in, at most MAX_OUT tokens out (plus a self-review)
  const cost = model ? costOf(estimateTokens(S(a.prompt).length + 24_000), MAX_OUT, model) : null;
  return { title, summary: (p ? "پروژه «" + p.name + "»: " : "") + "«" + S(a.prompt).slice(0, 160) + "»", resource: p ? p.name : "پروژه جدید بافت", cost, costNote: "سقف هزینه هوش مصنوعی این اجرا؛ هزینه واقعی بر اساس مصرف از کیف پول کم می‌شود و معمولاً کمتر است." };
}

const MCP_META: Record<string, Meta> = {
  get_account: { perm: "account.readAll", risk: "read", label: L("در حال خواندن اطلاعات حساب…"), brief: (o) => "موجودی کیف پول: " + fa(Number((o as Json).balance_toman) || 0) + " تومان" },
  list_apps: { perm: "paas.list", risk: "read", label: L("در حال خواندن فهرست اپ‌ها…"), brief: countBrief("اپ") },
  get_app: { perm: "paas.get", risk: "read", label: async (_c, a) => "در حال خواندن وضعیت اپ " + S(a.app) + "…", brief: (o) => "اپ " + S((o as Json).name) + ": " + statusFa((o as Json).status) },
  deploy_app: { perm: "paas.deploy", risk: "danger", label: async (_c, a) => "استقرار اپ " + S(a.app) + "…", brief: done("استقرار در صف قرار گرفت."),
    quote: async (_c, a) => plain("استقرار دوباره اپ", "اپ «" + S(a.app) + "» دوباره ساخته و جایگزین نسخه فعلی می‌شود" + (a.preview ? " (در محیط پیش‌نمایش)" : "") + ".", S(a.app)) },
  promote_deployment: { perm: "paas.promote", risk: "danger", label: async (_c, a) => "انتشار پیش‌نمایش " + S(a.app) + "…", brief: done("انتشار در صف قرار گرفت."),
    quote: async (_c, a) => plain("انتشار پیش‌نمایش در محیط اصلی", "استقرار " + S(a.deployment_id) + " جایگزین نسخه فعلی اپ «" + S(a.app) + "» می‌شود.", S(a.app)) },
  get_deployment: { perm: "paas.deployment", risk: "read", label: L("در حال خواندن لاگ استقرار…"), brief: (o) => "وضعیت استقرار: " + statusFa((o as Json).status) },
  app_logs: { perm: "paas.logs", risk: "read", label: async (_c, a) => "در حال خواندن لاگ‌های اپ " + S(a.app) + "…", brief: (o) => fa(((o as { lines?: unknown[] }).lines ?? []).length) + " خط لاگ خوانده شد." },
  set_app_env: { perm: "paas.setEnv", risk: "danger", label: async (_c, a) => "تغییر متغیرهای محیطی " + S(a.app) + "…", brief: done("متغیرها ذخیره و اپ با آن‌ها راه‌اندازی مجدد شد."),
    quote: async (_c, a) => plain("تغییر متغیرهای محیطی", "کلیدهای " + Object.keys((a.vars as Json) ?? {}).join("، ") + " تغییر می‌کند و اپ «" + S(a.app) + "» دوباره راه‌اندازی می‌شود.", S(a.app)) },
  app_action: { perm: "paas.power", risk: (a) => (a.action === "stop" ? "danger" : "safe"), label: async (_c, a) => ({ start: "روشن کردن", stop: "خاموش کردن", restart: "راه‌اندازی مجدد" }[S(a.action)] ?? "اقدام روی") + " اپ " + S(a.app) + "…", brief: done("انجام شد."),
    quote: async (_c, a) => plain("خاموش کردن اپ", "اپ «" + S(a.app) + "» خاموش می‌شود و تا روشن کردن دوباره در دسترس نیست.", S(a.app)) },
  run_job: { perm: "paas.runJob", risk: "danger", label: async (_c, a) => "اجرای فرمان در " + S(a.app) + "…", brief: (o) => "فرمان اجرا شد (" + S((o as Json).id) + ").",
    quote: async (_c, a) => plain("اجرای فرمان یک‌باره", "فرمان `" + S(a.command).slice(0, 200) + "` با متغیرهای اپ «" + S(a.app) + "» اجرا می‌شود.", S(a.app)) },
  get_job: { perm: "paas.job", risk: "read", label: L("در حال خواندن خروجی فرمان…"), brief: (o) => "وضعیت فرمان: " + statusFa((o as Json).status) },
  list_databases: { perm: "paas.dbs", risk: "read", label: L("در حال خواندن پایگاه‌های داده…"), brief: countBrief("پایگاه داده") },
  list_servers: { perm: "servers.list", risk: "read", label: L("در حال خواندن فهرست سرورها…"), brief: countBrief("سرور") },
  get_server: { perm: "servers.get", risk: "read", label: async (c, a) => "در حال خواندن وضعیت سرور " + (await serverName(c, a.server_id)) + "…", brief: (o) => "سرور " + S((o as Json).name) + ": " + statusFa((o as Json).status) + "، IP " + S((o as Json).ipv4) },
  server_action: { perm: "servers.power", risk: (a) => (a.action === "stop" ? "danger" : "safe"), label: async (c, a) => ({ start: "روشن کردن", stop: "خاموش کردن", reboot: "راه‌اندازی مجدد" }[S(a.action)] ?? "اقدام روی") + " سرور " + (await serverName(c, a.server_id)) + "…", brief: done("فرمان به سرور ارسال شد."),
    quote: async (c, a) => { const s = await needServer(c, a.server_id); return plain("خاموش کردن سرور", "سرور «" + s.name + "» (" + s.ip + ") خاموش می‌شود و سرویس‌های روی آن قطع می‌شوند.", s.name); } },
  list_domains: { perm: "domains.list", risk: "read", label: L("در حال خواندن دامنه‌ها…"), brief: countBrief("دامنه") },
  list_dns_records: { perm: "domains.list", risk: "read", label: L("در حال خواندن رکوردهای DNS…"), brief: (o) => fa(list(o).length) + " رکورد DNS" },
  add_dns_record: { perm: "domains.addRecord", risk: "safe", label: async (_c, a) => "افزودن رکورد " + S(a.type) + " برای " + S(a.name) + "…", brief: done("رکورد اضافه شد.") },
  delete_dns_record: { perm: "domains.removeRecord", risk: "danger", label: L("حذف رکورد DNS…"), brief: done("رکورد حذف شد."),
    quote: async (_c, a) => plain("حذف رکورد DNS", "رکورد " + S(a.record_id) + " از دامنه " + S(a.domain_id) + " حذف می‌شود.", S(a.domain_id)) },
  list_buckets: { perm: "storage.list", risk: "read", label: L("در حال خواندن باکت‌های ذخیره‌سازی…"), brief: countBrief("باکت") },
  create_bucket: { perm: "storage.create", risk: "danger", label: async (_c, a) => "ساخت باکت " + S(a.name) + "…", brief: done("باکت ساخته شد."),
    quote: async (c, a) => {
      const [p] = await c.db.select().from(storagePlans).where(eq(storagePlans.id, S(a.plan || "st-20")));
      if (!p || !p.active) fail("پلن ذخیره‌سازی پیدا نشد.");
      return { title: "ساخت باکت ذخیره‌سازی", summary: "باکت «" + S(a.name) + "» با پلن " + p!.name + " (" + fa(p!.sizeGb) + " گیگابایت، " + (a.access === "public" ? "عمومی" : "خصوصی") + ")", resource: S(a.name), cost: p!.price, costNote: "ماهانه، به‌صورت ساعتی از کیف پول کم می‌شود." };
    } },
  list_invoices: { perm: "billing.list", risk: "read", label: L("در حال خواندن صورتحساب‌ها…"), brief: (o) => { const r = list(o); const open = r.filter((i) => i.status !== "paid" && i.status !== "refunded"); return fa(r.length) + " صورتحساب، " + fa(open.length) + " پرداخت‌نشده"; } },
  list_knowledge_bases: { perm: "ai.listKbs", risk: "read", label: L("در حال خواندن پایگاه‌های دانش…"), brief: countBrief("پایگاه دانش") },
  query_knowledge_base: { perm: "ai.kbQuery", risk: "safe", label: L("در حال جست‌وجو در پایگاه دانش…"), brief: (o) => fa(list(o).length) + " بخش مرتبط پیدا شد." },
  builder_create: { perm: "builder.create", risk: "danger", label: L("ساخت پروژه با بافت…"), brief: (o) => "پروژه بافت ساخته شد: /panel/build/" + S((o as { project?: Json }).project?.id),
    quote: (c, a) => builderQuote(c, a, "ساخت سایت با بافت") },
  builder_edit: { perm: "builder.edit", risk: "danger", label: L("تغییر پروژه بافت…"), brief: done("تغییرات اعمال شد."), quote: (c, a) => builderQuote(c, a, "تغییر پروژه بافت") },
  builder_deploy: { perm: "builder.deploy", risk: "danger", label: L("استقرار پروژه بافت…"), brief: done("استقرار پروژه آغاز شد."),
    quote: async (c, a) => {
      const [p] = await c.db.select().from(builderProjects).where(and(eq(builderProjects.id, S(a.id)), eq(builderProjects.userId, uid(c))));
      if (!p) fail("پروژه پیدا نشد.", 404);
      const [cheap] = await c.db.select().from(paasPlans).where(and(eq(paasPlans.kind, "app"), eq(paasPlans.active, true))).orderBy(paasPlans.price).limit(1);
      return { title: "استقرار پروژه بافت", summary: "پروژه «" + p!.name + "» به‌عنوان اپ گره منتشر می‌شود" + (p!.appId ? "." : " (اپ جدید روی ارزان‌ترین پلن ساخته می‌شود)."), resource: p!.name, cost: p!.appId ? null : cheap?.price ?? null, costNote: p!.appId ? "" : "ماهانه، به‌صورت ساعتی از کیف پول." };
    } },
  builder_status: { perm: "builder.get", risk: "read", label: L("در حال خواندن وضعیت پروژه بافت…"), brief: (o) => "پروژه " + S((o as Json).name) + ": " + statusFa((o as Json).status) },
};

const fromMcp: AssistantTool[] = MCP_TOOLS.map((t) => {
  const m = MCP_META[t.name];
  if (!m) throw new Error("assistant: no classification for MCP tool " + t.name);
  return {
    name: t.name, description: t.description, inputSchema: t.inputSchema, perm: m.perm, label: m.label, brief: m.brief, quote: m.quote,
    risk: typeof m.risk === "function" ? m.risk : () => m.risk as ToolRisk,
    run: async (ctx, a) => { const [method, path, body] = t.call(a); return callRoute(ctx, "read-write", method, path, body); },
  };
});

/* ---------- panel tools ---------- */
const sid = { server_id: str("Server id (srv-…) from list_servers") };
const fixed = (r: ToolRisk) => () => r;

async function cloudPlans(ctx: Ctx) {
  const [cat, locs] = await Promise.all([catalog(ctx.db), getLocations(ctx.db)]);
  return {
    plans: cat.plans.cloud.filter((p) => p.active !== false).map((p) => { const n = PLAN_NUMS[p.id]; return { id: p.id, name: p.name, cpu: n?.[0] ?? null, ram_gb: n?.[1] ?? null, disk_gb: n?.[2] ?? null, traffic: p.traffic, monthly_price_toman: p.price }; }),
    locations: locs.filter((l) => l.active !== false).map((l) => ({ id: l.id, name: l.label, foreign: l.foreign, note: l.foreign ? "۱۲٪ گران‌تر از ایران" : "" })),
    billing: "monthly or hourly (hourly: one month is prepaid, then billed per hour from the wallet); prices exclude VAT",
  };
}

async function buyQuote(ctx: Ctx, a: Json): Promise<Quote & { sku: Sku }> {
  const sku: Sku = { t: "plan", kind: "cloud", plan: S(a.plan_id), loc: S(a.location || "thr"), cycle: "m", ...(a.os ? { os: S(a.os) } : {}), ...(a.hourly ? { hourly: true } : {}) };
  const priced = priceSku(sku, await catalog(ctx.db));
  if ("error" in priced) fail(priced.error);
  const p = priced as Exclude<typeof priced, { error: string }>;
  const tax = (await getSettings(ctx.db)).tax;
  const gross = invGross({ items: [{ amount: p.base }], tax });
  return { sku, title: "خرید سرور ابری", summary: p.title + "، " + p.meta + " — پرداخت از کیف پول (با " + fa(tax) + "٪ مالیات بر ارزش افزوده)", resource: p.title, cost: gross, costNote: a.hourly ? "پیش‌پرداخت یک ماه؛ بعد از آن ساعتی از کیف پول." : "هزینه یک ماه، شامل مالیات." };
}

async function resizeQuote(ctx: Ctx, a: Json): Promise<Quote> {
  const s = await needServer(ctx, a.server_id);
  const [p] = await ctx.db.select().from(plans).where(and(eq(plans.id, S(a.plan_id)), eq(plans.kind, "cloud")));
  if (!p || !PLAN_NUMS[S(a.plan_id)]) fail("پلن پیدا نشد.");
  const plan = p!.data as { name: string; price: number };
  // the same proration as servers.resize
  const days = s.paidUntil ? Math.max(0, Math.ceil((s.paidUntil.getTime() - Date.now()) / 86400_000)) : 0;
  const diff = s.billing === "monthly" ? Math.max(0, Math.round(((plan.price - s.price) * days) / 30 / 1000) * 1000) : 0;
  return { title: "ارتقای سرور", summary: "سرور «" + s.name + "» از پلن " + s.plan + " به پلن " + plan.name + " ارتقا می‌یابد (" + PLAN_NUMS[S(a.plan_id)].join("/") + " هسته/گیگ رم/گیگ دیسک). قیمت ماهانه جدید: " + fa(plan.price) + " تومان.", resource: s.name, cost: diff || plan.price - s.price > 0 ? diff : null, costNote: diff ? "مابه‌التفاوت " + fa(days) + " روز باقی‌مانده، به‌صورت صورتحساب." : s.billing === "hourly" ? "از این پس ساعتی با قیمت پلن جدید." : "" };
}

/** what set_disk_layout would do, with the RPC's own rules (planLayout); a rebuild needs an active OS template and the
    account owner (the card replaces the typed hostname, which a team member is not trusted to skip) */
async function layoutPlan(ctx: Ctx, a: Json) {
  const s = await needServer(ctx, a.server_id);
  const sizes = Array.isArray(a.sizes) ? a.sizes.map((x) => Number(x)) : [];
  if (!sizes.length || sizes.some((x) => !Number.isInteger(x) || x < 1 || x > 100_000) || sizes.length > 16) fail("اندازه دیسک‌ها را به گیگابایت (عدد صحیح) بدهید.");
  const l = await rpc<{ allowanceGb: number; maxDisks: number; disks: { sizeGb: number }[] }>(ctx, "servers.layout", s.id);
  const before = l.disks.map((d) => d.sizeGb);
  const mode = planLayout(before, sizes, l.allowanceGb, l.maxDisks);
  let os = "";
  if (mode === "rebuild") {
    if (ctx.auth!.uid !== ctx.auth!.user.id) fail("بازسازی دیسک‌ها (که همه داده‌ها را پاک می‌کند) با دستیار فقط برای صاحب حساب ممکن است؛ از صفحه سرور و با نوشتن hostname انجام دهید.", 403);
    const tpls = await ctx.db.select({ name: osTemplates.name }).from(osTemplates).where(eq(osTemplates.on, true));
    if (!S(a.os)) fail("این چیدمان سرور را از نو می‌سازد؛ سیستم‌عاملی را که نصب شود مشخص کنید. گزینه‌ها: " + tpls.map((t) => t.name).join("، "));
    if (!tpls.some((t) => t.name === S(a.os))) fail("سیستم‌عامل «" + S(a.os) + "» در دسترس نیست. گزینه‌ها: " + tpls.map((t) => t.name).join("، "));
    os = S(a.os);
  }
  return { s, sizes, before, mode, os };
}

const PANEL: AssistantTool[] = [
  { name: "list_cloud_plans", description: "Cloud server (VPS) plans with cpu, ram, disk, traffic and the monthly price in Toman, plus the locations customers can order in. Use it before recommending or buying a server.",
    inputSchema: { type: "object", properties: {} }, risk: fixed("read"), perm: "servers.list", label: L("در حال خواندن پلن‌ها و قیمت‌های سرور ابری…"), run: cloudPlans,
    brief: (o) => fa((o as { plans: unknown[] }).plans.length) + " پلن سرور ابری" },
  { name: "server_stats", description: "CPU, RAM, disk and network usage of a cloud server over 1h, 24h, 7d or 30d (averages and peaks, percent).",
    inputSchema: { type: "object", properties: { ...sid, range: str("1h, 24h (default), 7d or 30d", { enum: ["1h", "24h", "7d", "30d"] }) }, required: ["server_id"] }, risk: fixed("read"), perm: "servers.stats",
    label: async (c, a) => "در حال خواندن نمودار مصرف سرور " + (await serverName(c, a.server_id)) + "…",
    run: async (ctx, a) => {
      const r = await rpc<{ points: { cpu: number; ram: number; disk: number; netIn: number; netOut: number }[]; source: string }>(ctx, "servers.stats", S(a.server_id), ["1h", "24h", "7d", "30d"].includes(S(a.range)) ? S(a.range) : "24h");
      const k = (f: "cpu" | "ram" | "disk") => { const v = r.points.map((p) => p[f]); return v.length ? { avg: Math.round(v.reduce((x, y) => x + y, 0) / v.length), max: Math.round(Math.max(...v)) } : null; };
      return { range: a.range || "24h", samples: r.points.length, cpu_percent: k("cpu"), ram_percent: k("ram"), disk_percent: k("disk") };
    },
    brief: (o) => { const x = o as { cpu_percent: { avg: number; max: number } | null; ram_percent: { avg: number } | null }; return x.cpu_percent ? "میانگین CPU " + fa(x.cpu_percent.avg) + "٪ (اوج " + fa(x.cpu_percent.max) + "٪)، رم " + fa(x.ram_percent?.avg ?? 0) + "٪" : "هنوز داده مصرفی ثبت نشده است."; } },
  { name: "server_logs", description: "Recent events of a cloud server (tasks, hypervisor actions, detected changes), newest first.",
    inputSchema: { type: "object", properties: sid, required: ["server_id"] }, risk: fixed("read"), perm: "servers.logs",
    label: async (c, a) => "در حال خواندن رویدادهای سرور " + (await serverName(c, a.server_id)) + "…",
    run: async (ctx, a) => { const r = await rpc<{ items: { at: string; status: string; text: string }[] }>(ctx, "servers.logs", S(a.server_id), {}); return { items: r.items.map((i) => ({ at: i.at, status: i.status, text: i.text })) }; },
    brief: (o) => fa((o as { items: unknown[] }).items.length) + " رویداد" },
  { name: "spending_summary", description: "This month's spending (Tehran calendar month): wallet balance, total charged, by kind (usage, payments), unpaid invoices and their total.",
    inputSchema: { type: "object", properties: {} }, risk: fixed("read"), perm: "billing.list", label: L("در حال محاسبه هزینه‌های این ماه…"),
    run: async (ctx) => {
      const { month } = tehranStarts();
      const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, uid(ctx)));
      const rows = await ctx.db.select({ type: transactions.type, total: sql<number>`coalesce(sum(-${transactions.amount}),0)::bigint`, n: sql<number>`count(*)::int` }).from(transactions)
        .where(and(eq(transactions.userId, uid(ctx)), gte(transactions.createdAt, month), lt(transactions.amount, 0))).groupBy(transactions.type);
      const open = await ctx.db.select().from(invoices).where(and(eq(invoices.userId, uid(ctx)), or(eq(invoices.status, "unpaid"), eq(invoices.status, "overdue"))));
      const items = open.length ? await ctx.db.select().from(invoiceItems) : [];
      const unpaid = open.reduce((s, i) => s + invGross({ items: items.filter((x) => x.invoiceId === i.id), tax: i.taxRate }), 0);
      const by = rows.map((r) => ({ kind: r.type, toman: Number(r.total), count: r.n }));
      return { balance_toman: u?.balance ?? 0, month_spent_toman: by.reduce((s, r) => s + r.toman, 0), by_kind: by, unpaid_invoices: open.length, unpaid_total_toman: unpaid };
    },
    brief: (o) => { const x = o as { month_spent_toman: number; balance_toman: number }; return "هزینه این ماه " + fa(x.month_spent_toman) + " تومان، موجودی " + fa(x.balance_toman) + " تومان"; } },
  { name: "set_server_hostname", description: "Changes a cloud server's hostname (e.g. web1.example.com).",
    inputSchema: { type: "object", properties: { ...sid, hostname: str("New hostname") }, required: ["server_id", "hostname"] }, risk: fixed("safe"), perm: "servers.setHostname",
    label: async (c, a) => "تغییر hostname سرور " + (await serverName(c, a.server_id)) + "…", run: (ctx, a) => rpc(ctx, "servers.setHostname", S(a.server_id), S(a.hostname)), brief: (_o, a) => "hostname به " + S(a.hostname) + " تغییر کرد." },
  { name: "create_server_snapshot", description: "Takes a snapshot (point-in-time backup) of a cloud server. Up to 5 manual snapshots per server.",
    inputSchema: { type: "object", properties: { ...sid, name: str("Optional name: letters, digits, dot, dash") }, required: ["server_id"] }, risk: fixed("safe"), perm: "servers.snapshot",
    label: async (c, a) => "ساخت اسنپ‌شات از سرور " + (await serverName(c, a.server_id)) + "…", run: (ctx, a) => rpc(ctx, "servers.snapshot", S(a.server_id), ...(a.name ? [S(a.name)] : [])), brief: done("اسنپ‌شات در حال ساخت است.") },
  { name: "backup_database", description: "Starts a manual backup of a managed database (by id or name from list_databases).",
    inputSchema: { type: "object", properties: { database: str("Database id or name") }, required: ["database"] }, risk: fixed("safe"), perm: "paas.backupDb", label: async (_c, a) => "پشتیبان‌گیری از پایگاه داده " + S(a.database) + "…",
    run: async (ctx, a) => {
      const [d] = await ctx.db.select({ id: paasDbs.id }).from(paasDbs).where(and(eq(paasDbs.userId, uid(ctx)), or(eq(paasDbs.id, S(a.database)), eq(paasDbs.name, S(a.database)))));
      if (!d) fail("پایگاه داده پیدا نشد.", 404);
      return { backup_id: await rpc(ctx, "paas.backupDb", d!.id) };
    }, brief: done("پشتیبان‌گیری آغاز شد.") },
  { name: "buy_cloud_server", description: "Orders a new cloud server on a plan from list_cloud_plans and pays it from the wallet. Costs money: the person must confirm.",
    inputSchema: { type: "object", properties: { plan_id: str("Plan id from list_cloud_plans"), location: str("Location id from list_cloud_plans (default thr = Tehran)"), os: str("ubuntu (default), debian, alma or win", { enum: ["ubuntu", "debian", "alma", "win"] }), hourly: { type: "boolean", description: "Hourly billing instead of monthly" } }, required: ["plan_id"] },
    risk: fixed("danger"), perm: "billing.checkout", label: L("آماده‌سازی سفارش سرور ابری…"), quote: buyQuote,
    run: async (ctx, a) => {
      const q = await buyQuote(ctx, a);
      const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, uid(ctx)));
      if ((u?.balance ?? 0) < (q.cost ?? 0)) fail("موجودی کیف پول برای این خرید کافی نیست (" + fa(q.cost ?? 0) + " تومان لازم است). ابتدا کیف پول را شارژ کنید.", 402);
      const inv = await rpc<{ id: string }>(ctx, "billing.checkout", [q.sku]);
      await rpc(ctx, "billing.pay", inv.id, "wallet");
      return { invoice: inv.id, paid_toman: q.cost, note: "The server is being provisioned; it appears in list_servers in a few minutes." };
    }, brief: (o) => "سفارش ثبت و از کیف پول پرداخت شد (" + S((o as Json).invoice) + ")." },
  { name: "delete_server", description: "Deletes a cloud server permanently with all its data. Irreversible: the person must confirm.",
    inputSchema: { type: "object", properties: sid, required: ["server_id"] }, risk: fixed("danger"), perm: "servers.remove", label: async (c, a) => "حذف سرور " + (await serverName(c, a.server_id)) + "…",
    quote: async (c, a) => { const s = await needServer(c, a.server_id); return plain("حذف دائمی سرور", "سرور «" + s.name + "» (" + (s.ip || "بدون IP") + "، " + s.plan + ") و همه داده‌هایش برای همیشه پاک می‌شود.", s.name); },
    run: (ctx, a) => rpc(ctx, "servers.remove", S(a.server_id)), brief: done("سرور حذف شد.") },
  { name: "reinstall_server", description: "Reinstalls the operating system of a cloud server; every file on it is erased and a new root password is created (shown once in the panel).",
    inputSchema: { type: "object", properties: { ...sid, os: str("OS template name, e.g. \"Ubuntu 24.04\"") }, required: ["server_id", "os"] }, risk: fixed("danger"), perm: "servers.reinstall", label: async (c, a) => "نصب مجدد سرور " + (await serverName(c, a.server_id)) + "…",
    quote: async (c, a) => {
      const s = await needServer(c, a.server_id);
      const tpls = await c.db.select({ name: osTemplates.name }).from(osTemplates).where(eq(osTemplates.on, true));
      if (!tpls.some((t) => t.name === S(a.os))) fail("سیستم‌عامل «" + S(a.os) + "» در دسترس نیست. گزینه‌ها: " + tpls.map((t) => t.name).join("، "));
      return plain("نصب مجدد سیستم‌عامل", "روی سرور «" + s.name + "» سیستم‌عامل " + S(a.os) + " نصب می‌شود و همه فایل‌های فعلی پاک می‌شوند.", s.name);
    },
    run: (ctx, a) => rpc(ctx, "servers.reinstall", S(a.server_id), S(a.os)), brief: done("نصب مجدد آغاز شد؛ رمز root جدید یک‌بار در صفحه سرور نمایش داده می‌شود.") },
  { name: "resize_server", description: "Upgrades a running cloud server to a bigger plan from list_cloud_plans (the disk never shrinks). Monthly servers get an invoice for the remaining days.",
    inputSchema: { type: "object", properties: { ...sid, plan_id: str("Target plan id") }, required: ["server_id", "plan_id"] }, risk: fixed("danger"), perm: "servers.resize", label: async (c, a) => "ارتقای سرور " + (await serverName(c, a.server_id)) + "…",
    quote: resizeQuote, run: (ctx, a) => rpc(ctx, "servers.resize", S(a.server_id), S(a.plan_id)), brief: done("ارتقا انجام شد.") },
  { name: "reset_root_password", description: "Sets a new random root password on a cloud server. The password is never shown in the chat: it is shown once on the server's page.",
    inputSchema: { type: "object", properties: sid, required: ["server_id"] }, risk: fixed("danger"), perm: "servers.resetRootPassword", label: async (c, a) => "تغییر رمز root سرور " + (await serverName(c, a.server_id)) + "…",
    quote: async (c, a) => { const s = await needServer(c, a.server_id); return plain("تغییر رمز root", "رمز root سرور «" + s.name + "» با یک رمز تصادفی قوی عوض می‌شود؛ رمز فعلی دیگر کار نمی‌کند.", s.name); },
    run: async (ctx, a) => {
      const { randomBytes } = await import("node:crypto");
      const pass = "Gx" + randomBytes(12).toString("base64url").replace(/[-_]/g, "x") + "9";
      await rpc(ctx, "servers.resetRootPassword", S(a.server_id), pass);
      return { ok: true, where: "The new password is shown once on the server's page in the panel (and emailed)." };
    }, brief: done("رمز root عوض شد؛ آن را یک‌بار در صفحه سرور ببینید.") },
  { name: "get_disk_layout", description: "The disk layout of a cloud server: the plan's disk allowance (GB), each disk (primary first), purchased extra disks, the current OS, and any rebuild in progress.",
    inputSchema: { type: "object", properties: sid, required: ["server_id"] }, risk: fixed("read"), perm: "servers.layout",
    label: async (c, a) => "در حال خواندن چیدمان دیسک سرور " + (await serverName(c, a.server_id)) + "…",
    run: async (ctx, a) => {
      const s = await needServer(ctx, a.server_id);
      const l = await rpc<{ allowanceGb: number; disks: { sizeGb: number }[]; billed: { name: string; sizeGb: number }[]; relayout: unknown }>(ctx, "servers.layout", s.id);
      return { allowance_gb: l.allowanceGb, disks_gb: l.disks.map((d) => d.sizeGb), purchased_extra_disks: l.billed, os: s.os, rebuild_in_progress: l.relayout };
    },
    brief: (o) => { const x = o as { allowance_gb: number; disks_gb: number[] }; return "چیدمان " + x.disks_gb.map(fa).join(" + ") + " گیگ (سهم " + fa(x.allowance_gb) + " گیگ)"; } },
  { name: "set_disk_layout", description: "Changes how a cloud server's disk allowance is split into disks (GB per disk, primary first, summing to the allowance from get_disk_layout). Adding disks from unused allowance (append) or only growing disks (grow) keeps all data. Shrinking or removing a disk REBUILDS the server: it is recreated, ALL data is erased, the OS given in `os` is installed (required then) and the IP is kept when possible. The person must confirm.",
    inputSchema: { type: "object", properties: { ...sid, sizes: { type: "array", items: { type: "integer" }, description: "GB per disk, primary first; must sum to the allowance" }, os: str("OS template to install when the layout needs a rebuild, e.g. \"Ubuntu 24.04\"") }, required: ["server_id", "sizes"] },
    risk: fixed("danger"), perm: "servers.setLayout", label: async (c, a) => "تغییر چیدمان دیسک سرور " + (await serverName(c, a.server_id)) + "…",
    quote: async (c, a) => {
      const p = await layoutPlan(c, a);
      const sizes = p.before.map(fa).join(" + ") + " ← " + p.sizes.map(fa).join(" + ");
      const change = "دیسک‌های سرور «" + p.s.name + "» از " + p.before.map(fa).join(" + ") + " به " + p.sizes.map(fa).join(" + ") + " گیگابایت تغییر می‌کند";
      if (p.mode === "append") return plain("افزودن دیسک از سهم آزاد", change + ". دیسک‌های تازه از سهم استفاده‌نشده ساخته می‌شوند؛ هیچ داده‌ای پاک نمی‌شود.", p.s.name + " — " + sizes);
      if (p.mode === "grow") return plain("بزرگ کردن دیسک‌ها", change + ". دیسک‌ها در جای خود بزرگ می‌شوند و داده‌ها حفظ می‌شوند.", p.s.name + " — " + sizes);
      return plain("بازسازی سرور با چیدمان دیسک جدید",
        change + ". هشدار: این چیدمان فقط با ساخت دوباره سرور ممکن است؛ سرور از نو ساخته می‌شود و همه داده‌های همه دیسک‌ها برای همیشه پاک می‌شود. سیستم‌عامل " + p.os + " نصب می‌شود و رمز root جدید یک‌بار در صفحه سرور نمایش داده می‌شود. IP فعلی (" + (p.s.ip || "—") + ") در صورت امکان حفظ می‌شود.",
        p.s.name + " — " + sizes);
    },
    run: async (ctx, a) => {
      const p = await layoutPlan(ctx, a);
      // the RPC's typed-hostname confirmation is the card the owner just confirmed: the hostname comes from the row, never from the model
      const r = await rpc<{ mode: string }>(ctx, "servers.setLayout", p.s.id, { sizes: p.sizes, ...(p.mode === "rebuild" ? { os: p.os, confirm: p.s.hostname } : {}) });
      return { mode: r.mode, sizes_gb: p.sizes, note: r.mode === "rebuild" ? "The server is being recreated; it shows the progress on its page and the new root password is shown there once." : "Applied." };
    },
    brief: (o) => { const x = o as { mode: string; sizes_gb: number[] }; return x.mode === "rebuild" ? "بازسازی سرور با دیسک‌های " + x.sizes_gb.map(fa).join(" + ") + " گیگ آغاز شد." : "چیدمان دیسک به " + x.sizes_gb.map(fa).join(" + ") + " گیگ تغییر کرد."; } },
  { name: "transfer_wallet", description: "Moves money between the main wallet (\"\") and the account's project wallets.",
    inputSchema: { type: "object", properties: { from: str("Source wallet id, or \"\" for the main wallet"), to: str("Target wallet id, or \"\" for the main wallet"), amount: { type: "integer", description: "Toman (at least 1000)" } }, required: ["from", "to", "amount"] },
    risk: fixed("danger"), perm: "billing.transfer", label: L("انتقال وجه بین کیف پول‌ها…"),
    quote: async (c, a) => {
      const label = async (w: unknown) => { if (!S(w)) return "کیف پول اصلی"; const [x] = await c.db.select().from(subWallets).where(and(eq(subWallets.id, S(w)), eq(subWallets.userId, uid(c)))); if (!x) fail("کیف پول پیدا نشد.", 404); return "کیف پول «" + x!.name + "»"; };
      const amt = Math.floor(Number(a.amount));
      if (!Number.isFinite(amt) || amt < 1000) fail("مبلغ نامعتبر است.");
      return { title: "انتقال وجه", summary: "از " + (await label(a.from)) + " به " + (await label(a.to)), resource: "کیف پول", cost: amt, costNote: "این مبلغ جابه‌جا می‌شود (کارمزدی ندارد)." };
    },
    run: (ctx, a) => rpc(ctx, "billing.transfer", S(a.from), S(a.to), Math.floor(Number(a.amount)), "دستیار گره"), brief: done("انتقال انجام شد.") },
];

export const TOOLS: AssistantTool[] = [...fromMcp, ...PANEL];
export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** may this person use the tool here? team roles (fixed and custom); staff viewing a customer may only read */
export async function toolAllowed(ctx: Ctx, t: AssistantTool, risk: ToolRisk) {
  const a = ctx.auth!;
  if (readOnlyView(ctx) && risk !== "read") return false;
  return teamAllows(a.teamRole, t.perm) && (await customAllows(ctx.db, a, t.perm));
}
/** staff looking at a customer's panel: the assistant reads but never changes anything */
export const readOnlyView = (ctx: Ctx) => !!ctx.auth && ctx.auth.user.role === "admin" && ctx.auth.uid !== ctx.auth.user.id;

/** the context tools run in: the customer's own, never staff-wide (staff powers are dropped) */
export function toolCtx(ctx: Ctx): Ctx {
  const a = ctx.auth!;
  return { ...ctx, auth: { ...a, user: { ...a.user, role: "user", staffRole: null } } };
}

/** validates the required arguments, then runs the tool as the customer */
export async function execTool(ctx: Ctx, t: AssistantTool, args: Json): Promise<unknown> {
  for (const k of t.inputSchema.required ?? []) if (args[k] === undefined || args[k] === null || args[k] === "") throw new AppError("آرگومان «" + k + "» لازم است.", 422);
  return t.run(toolCtx(ctx), args);
}

/** OpenAI tool definitions of what this person may use */
export async function toolSpecs(ctx: Ctx) {
  const out: ToolSpec[] = [];
  for (const t of TOOLS) {
    // a tool whose risk depends on its arguments is offered when its mildest form is allowed
    const base = t.risk({});
    if (!(await toolAllowed(ctx, t, base))) continue;
    out.push({ type: "function", function: { name: t.name, description: t.description + (base === "danger" ? " [Runs only after the person confirms it in the panel.]" : ""), parameters: t.inputSchema } });
  }
  return out;
}

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Schema } };
/** a tool set and its rules: the customer's panel tools here, the staff console's in ./staff.ts */
export type Kit = {
  mode: AssistantMode;
  byName: (name: string) => AssistantTool | undefined;
  specs: (ctx: Ctx) => Promise<ToolSpec[]>;
  allowed: (ctx: Ctx, t: AssistantTool, risk: ToolRisk) => Promise<boolean>;
  exec: (ctx: Ctx, t: AssistantTool, args: Json) => Promise<unknown>;
  /** the context labels and quotes are computed in */
  view: (ctx: Ctx) => Ctx;
};
export const customerKit: Kit = { mode: "customer", byName: toolByName, specs: toolSpecs, allowed: toolAllowed, exec: execTool, view: toolCtx };
