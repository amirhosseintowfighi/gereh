/* Staff detail views: one order line decoded with its provisioning state and a per-order preflight,
   the customer 360 view (/admin/users/[id]) one tab at a time, and the global admin search. */
import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, like, lt, or, sql } from "drizzle-orm";
import { APPS, BILLING, HOSTING, OSES, VPS, type Plan, type Sku } from "@/lib/catalog";
import type { Check, LineState, OrderDetail, Pair, SearchHit, ServiceRow, Series, TxFilter, UserActivity, UserOrders, UserServices, UserSummary, UserUsage } from "@/lib/admin-detail";
import { fa, toEnDigits } from "@/lib/format";
import { faDate, faDateTime } from "@/lib/jalali";
import { invGross, invTotal } from "@/lib/money";
import type { DB } from "./db/client";
import * as t from "./db/schema";
import { BUDGET_SERVICES, accountMetaOf, creditForecast, LEVELS } from "./billing-extras";
import { getLocations, locationGroup } from "./locations";
import { lineAmount } from "./provisioning";
import { errorText, serverSpec, type Override } from "./worker/provision";
import type { FulfilItem } from "./rpc/fulfil";
import { virt } from "./virt/driver";
import { fail } from "./util";

const levelLabel = (l: string) => (LEVELS as Record<string, { label: string }>)[l]?.label ?? l;
const hostingPlans = () => HOSTING.linux.concat(HOSTING.wordpress);

/* ---------- order line ---------- */

/** the provisioning job behind "<invoice>:<index>" (latest, first phase only) */
export async function orderJob(db: DB, invoiceId: string, index: number) {
  const [job] = await db.select().from(t.jobs)
    .where(and(like(t.jobs.type, "provision.%"), sql`(${t.jobs.payload}->>'invoiceId') = ${invoiceId}`, sql`(${t.jobs.payload}->>'index')::int = ${index}`, sql`(${t.jobs.payload}->>'phase') is null`, sql`(${t.jobs.payload}->>'renew') is null`))
    .orderBy(desc(t.jobs.id)).limit(1);
  return job ?? null;
}
type JobPayload = { userId?: string; sku?: Sku; override?: Override; resolved?: { how: string; note?: string; by?: string; at?: string } };

async function planOf(db: DB, kind: "cloud" | "metal" | "hosting", id: string): Promise<Plan | undefined> {
  const [row] = await db.select().from(t.plans).where(and(eq(t.plans.id, id), eq(t.plans.kind, kind)));
  return (row?.data as Plan | undefined) ?? (kind === "hosting" ? hostingPlans() : kind === "cloud" ? VPS.cloud : VPS.metal).find((x) => x.id === id);
}

/** one fulfil item in Persian label/value pairs */
async function decodeItem(db: DB, userId: string, f: FulfilItem | undefined, override: Override = {}, hostname = "") {
  const empty = { type: "other" as const, title: "نامشخص", spec: [] as Pair[], editable: false, os: "", osid: 0, loc: "", plid: 0, short: "—" };
  if (!f) return empty;
  if (f.type === "renew") {
    const kind = { server: "سرور", hosting: "هاست", domain: "دامنه" }[f.kind];
    return { ...empty, type: "renew" as const, title: "تمدید " + kind, spec: [["سرویس", kind + " " + f.id], ["مدت", fa(f.months) + " ماه"]] as Pair[], short: "تمدید " + kind + " " + f.id + " (" + fa(f.months) + " ماه)" };
  }
  const sku = f.sku;
  if (sku.t === "plan" || sku.t === "custom") {
    const spec = await serverSpec(db, sku, override);
    const loc = (await getLocations(db)).find((l) => l.id === sku.loc);
    const [key] = await db.select({ name: t.sshKeys.name }).from(t.sshKeys).where(eq(t.sshKeys.userId, userId)).orderBy(asc(t.sshKeys.createdAt)).limit(1);
    const [u] = await db.select({ email: t.users.email }).from(t.users).where(eq(t.users.id, userId));
    const plan = sku.t === "plan" ? await planOf(db, sku.kind, sku.plan) : undefined;
    const app = APPS.find((a) => a.id === (sku.app ?? ""))?.label ?? sku.app ?? "";
    const hostBase = ((u?.email ?? "").split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() || "vps").slice(0, 12);
    const pairs: Pair[] = [
      ["نوع", sku.t === "custom" ? "سرور ابری سفارشی" : sku.kind === "cloud" ? "سرور ابری" : "سرور اختصاصی"],
      ...(sku.t === "plan" ? [["پلن", (plan?.name ?? sku.plan) + " (" + sku.plan + ")"] as Pair] : []),
      ["منابع", spec.cpu ? fa(spec.cpu) + " هسته، " + fa(spec.ram) + " گیگ رم، " + fa(spec.disk) + " گیگ دیسک، " + (spec.traffic ? fa(spec.traffic / 1000) + " ترابایت ترافیک" : "ترافیک نامحدود") : "در پلن مشخص نیست"],
      ["موقعیت", (loc?.label ?? sku.loc) + " (" + sku.loc + ")"],
      ["گروه سرور Virtualizor", spec.group || "تعیین نشده"],
      ["سیستم‌عامل", spec.osLabel + " ← " + (spec.tpl ? "قالب " + spec.tpl.name + " (OSID " + spec.tpl.osid + ")" : "قالب پیدا نشد") + (override.osid ? " — انتخاب پشتیبانی" : "")],
      ["اپلیکیشن یک‌کلیکی", app || "ندارد"],
      ["دوره پرداخت", sku.t === "plan" ? BILLING.find((b) => b.id === sku.cycle)?.label ?? sku.cycle : "ماهانه"],
      ["نوع پرداخت", sku.hourly ? "ساعتی (پیش‌پرداخت یک ماه به کیف پول)" : "دوره‌ای"],
      ["بکاپ", sku.t === "custom" ? (sku.backup ? "بکاپ روزانه" : "ندارد") : plan?.backup ?? "—"],
      ["IPv4 اضافه", sku.t === "custom" ? fa(sku.ips) + " عدد" : plan?.ipv4 ? plan.ipv4 + " (در پلن)" : "—"],
      ["کلید SSH", key?.name ?? "ندارد (رمز root ایمیل می‌شود)"],
      ["Hostname", hostname || hostBase + "-<شماره سرور>.gereh.net"],
      ["Plan ID در Virtualizor", spec.plid ? String(spec.plid) + (override.plid ? " — انتخاب پشتیبانی" : "") : "ندارد (منابع صریح)"],
      ["قیمت ماهانه", fa(spec.price) + " تومان"],
    ];
    if (spec.problems.length) pairs.push(["مشکلات پیکربندی", spec.problems.join("\n")]);
    const title = sku.t === "custom" ? "سرور ابری سفارشی" : (sku.kind === "cloud" ? "سرور ابری " : "سرور اختصاصی ") + (plan?.name ?? sku.plan);
    return { type: "server" as const, title, spec: pairs, editable: true, os: sku.os ?? "ubuntu", osid: spec.tpl?.osid ?? 0, loc: sku.loc, plid: spec.plid, short: title + "، " + (loc?.label ?? sku.loc) + "، " + spec.osLabel };
  }
  if (sku.t === "hosting") {
    const plan = await planOf(db, "hosting", sku.plan);
    const linux = HOSTING.linux.some((x) => x.id === sku.plan);
    const title = "هاست " + (plan?.name ?? sku.plan);
    return { ...empty, type: "hosting" as const, title, spec: [["پلن", (plan?.name ?? sku.plan) + " (" + sku.plan + ")"], ["نوع", linux ? "لینوکس" : "وردپرس"], ["دوره", sku.yearly ? "سالانه" : "ماهانه"], ["دامنه", sku.domain || "بدون دامنه (زیردامنه gereh.site ساخته می‌شود)"]] as Pair[], short: title + (sku.domain ? "، " + sku.domain : "") };
  }
  if (sku.t === "domain") {
    const ir = /\.ir$/.test(sku.name);
    const [c] = ir ? await db.select().from(t.domainContacts).where(eq(t.domainContacts.userId, userId)) : [];
    return { ...empty, type: "domain" as const, title: sku.name, spec: [["دامنه", sku.name], ["مدت ثبت", fa(sku.years) + " سال"], ["شناسه ایرنیک", ir ? c?.irnicHandle || "ثبت نشده" : "لازم نیست"]] as Pair[], short: "ثبت " + sku.name + " (" + fa(sku.years) + " سال)" };
  }
  if (sku.t === "ip") return { ...empty, type: "ip" as const, title: "IPv4 اضافه", spec: [["سرور", sku.serverName + " (" + sku.serverId + ")"]] as Pair[], short: "IPv4 اضافه برای " + sku.serverName };
  return { ...empty, spec: [["sku", JSON.stringify(sku)]] as Pair[] };
}

type Delivered = { kind: "server" | "hosting" | "domain"; id: string; userId: string; status: string; vpsid?: number | null };
/** what happened to one order line */
function stateOf(invStatus: string, f: FulfilItem | undefined, job: typeof t.jobs.$inferSelect | null, row: Delivered | undefined, key: string): LineState {
  if (f?.type === "renew") return { state: "renewal", label: invStatus === "paid" ? "تمدید اعمال شد" : "تمدید (پرداخت‌نشده)", href: "", key };
  const p = (job?.payload ?? {}) as JobPayload;
  if (row && !(row.kind === "server" && (!row.vpsid || row.status === "provisioning" || row.status === "building"))) {
    const href = row.kind === "domain" ? "/admin/domains" : "/admin/services";
    return { state: "delivered", label: "تحویل شد" + (p.resolved?.how === "manual" ? " (دستی)" : ""), href, key };
  }
  if (p.resolved) return p.resolved.how === "refund" ? { state: "refunded", label: "وجه بازگردانده شد", href: "", key } : { state: "closed", label: "بسته شد", href: "", key };
  if (!f) return { state: "none", label: "—", href: "", key };
  if (invStatus !== "paid") return { state: "none", label: "پرداخت‌نشده", href: "", key };
  if (!job) return row ? { state: "pending", label: "در حال ساخت", href: "/admin/orders", key } : { state: "none", label: "کار تحویل پیدا نشد", href: "/admin/orders", key };
  if (job.status === "done") return f.sku.t === "ip" ? { state: "delivered", label: "تیکت تخصیص باز شد", href: "/admin/tickets", key } : row ? { state: "pending", label: "در حال ساخت", href: "/admin/orders", key } : { state: "closed", label: "پایان کار بدون سرویس", href: "/admin/orders", key };
  if (job.status === "failed" || job.attempts > 0 || row?.kind === "server") return { state: "failed", label: job.status === "failed" ? "ناموفق" : "در حال تلاش دوباره", href: "/admin/orders", key };
  return { state: "pending", label: "در صف", href: "/admin/orders", key };
}

async function deliveredRows(db: DB, refs: string[]) {
  if (!refs.length) return new Map<string, Delivered>();
  const [s, h, d] = await Promise.all([
    db.select({ id: t.servers.id, userId: t.servers.userId, status: t.servers.status, vpsid: t.servers.vpsid, ref: t.servers.orderRef }).from(t.servers).where(inArray(t.servers.orderRef, refs)),
    db.select({ id: t.hosting.id, userId: t.hosting.userId, status: t.hosting.status, ref: t.hosting.orderRef }).from(t.hosting).where(inArray(t.hosting.orderRef, refs)),
    db.select({ id: t.domains.id, userId: t.domains.userId, status: t.domains.status, ref: t.domains.orderRef }).from(t.domains).where(inArray(t.domains.orderRef, refs)),
  ]);
  const m = new Map<string, Delivered>();
  for (const r of s) m.set(r.ref!, { kind: "server", ...r });
  for (const r of h) m.set(r.ref!, { kind: "hosting", ...r });
  for (const r of d) m.set(r.ref!, { kind: "domain", ...r });
  return m;
}

export async function orderDetail(db: DB, invoiceId: string, index: number): Promise<OrderDetail> {
  const [inv] = await db.select().from(t.invoices).where(eq(t.invoices.id, invoiceId));
  if (!inv) fail("صورتحساب پیدا نشد.", 404);
  const items = await db.select().from(t.invoiceItems).where(eq(t.invoiceItems.invoiceId, invoiceId)).orderBy(asc(t.invoiceItems.id));
  const fulfil = (inv!.fulfil as FulfilItem[])[index];
  if (!fulfil && !items[index]) fail("این ردیف در صورتحساب نیست.", 404);
  const key = invoiceId + ":" + index;
  const job = await orderJob(db, invoiceId, index);
  const p = (job?.payload ?? {}) as JobPayload;
  const f: FulfilItem | undefined = p.sku ? { type: "order", sku: p.sku } : fulfil;
  const [srv] = await db.select().from(t.servers).where(eq(t.servers.orderRef, key));
  const [u] = await db.select().from(t.users).where(eq(t.users.id, inv!.userId));
  const meta = await accountMetaOf(db, inv!.userId);
  const [pay] = await db.select().from(t.payments).where(and(eq(t.payments.invoiceId, invoiceId), eq(t.payments.status, "paid"))).orderBy(desc(t.payments.createdAt)).limit(1);
  const [tx] = await db.select().from(t.transactions).where(and(eq(t.transactions.userId, inv!.userId), eq(t.transactions.desc, "پرداخت " + invoiceId))).limit(1);
  const decoded = await decodeItem(db, inv!.userId, f, p.override, srv?.hostname);
  const tasks = srv ? await db.select().from(t.serverTasks).where(eq(t.serverTasks.serverId, srv.id)).orderBy(asc(t.serverTasks.createdAt)) : [];
  const ticketId = srv?.provisionTicket ?? null;
  const [tk] = ticketId ? await db.select().from(t.tickets).where(eq(t.tickets.id, ticketId)) : [];
  const delivered = await deliveredRows(db, [key]);
  const positive = items.filter((i) => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const discount = -items.filter((i) => i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const total = invGross({ items, tax: inv!.taxRate });
  const [locs, tpls] = await Promise.all([getLocations(db), db.select().from(t.osTemplates).orderBy(asc(t.osTemplates.name))]);
  return {
    key, invoiceId, index,
    customer: { id: u?.id ?? inv!.userId, name: u?.name ?? "", email: u?.email ?? "", phone: u?.phone ?? "", level: levelLabel(meta.level), balance: u?.balance ?? 0, kyc: u?.kyc ?? "", status: u?.status ?? "" },
    invoice: {
      id: inv!.id, status: inv!.status, created: faDateTime(inv!.createdAt), paid: inv!.paidAt ? faDateTime(inv!.paidAt) : "", coupon: inv!.coupon ?? "", taxRate: inv!.taxRate,
      method: tx?.method ?? (pay ? "درگاه" : ""), gateway: pay?.gateway ?? "", refId: pay?.refId ?? "",
      lines: items.map((i, n) => ({ desc: i.desc, amount: i.amount, mine: n === index })), subtotal: positive, discount, tax: total - invTotal({ items }), total,
      lineAmount: (await lineAmount(db, invoiceId, index)).amount,
    },
    item: { type: decoded.type, title: decoded.title, spec: decoded.spec, raw: f ?? null, editable: decoded.editable && !!job && job.type === "provision.server" && !p.resolved && !srv?.vpsid, os: decoded.os, osid: decoded.osid, loc: decoded.loc, plid: decoded.plid },
    job: job ? { id: job.id, type: job.type, status: job.status, attempts: job.attempts, runAt: faDateTime(job.runAt), created: faDateTime(job.createdAt), error: job.lastError ?? "",
      resolved: p.resolved ? p.resolved.how + (p.resolved.by ? " — " + p.resolved.by : "") + (p.resolved.note ? " (" + p.resolved.note + ")" : "") : "" } : null,
    server: srv ? { id: srv.id, name: srv.name, hostname: srv.hostname, status: srv.status, vpsid: srv.vpsid, error: srv.provisionError ?? "", ticket: srv.provisionTicket } : null,
    tasks: tasks.map((x) => ({ action: x.action, status: x.status, progress: x.progress, at: faDateTime(x.createdAt) })),
    ticket: tk ? { id: tk.id, subject: tk.subject, status: tk.status, updated: faDateTime(tk.updatedAt) } : null,
    state: stateOf(inv!.status, f, job, delivered.get(key), key),
    options: {
      oses: OSES.map((o) => ({ id: o.id, label: o.label })),
      templates: tpls.map((x) => ({ osid: x.osid, name: x.name, on: x.on })),
      locs: locs.filter((l) => l.active !== false).map((l) => ({ id: l.id, label: l.label, group: locationGroup(l, f?.type === "order" && f.sku.t === "plan" ? f.sku.kind : "cloud") })),
    },
  };
}

/** the same validation the Virtualizor dry run does, for this order's sku only */
export async function orderPreflight(db: DB, invoiceId: string, index: number): Promise<Check[]> {
  const [inv] = await db.select().from(t.invoices).where(eq(t.invoices.id, invoiceId));
  if (!inv) fail("صورتحساب پیدا نشد.", 404);
  const job = await orderJob(db, invoiceId, index);
  const p = (job?.payload ?? {}) as JobPayload;
  const f = (inv!.fulfil as FulfilItem[])[index];
  const sku = p.sku ?? (f?.type === "order" ? f.sku : null);
  if (!sku) fail("این ردیف سفارش جدید نیست و بررسی ندارد.");
  const [u] = await db.select().from(t.users).where(eq(t.users.id, inv!.userId));
  const userHref = "/admin/users/" + inv!.userId;
  const out: Check[] = [];
  out.push({ key: "account", label: "حساب مشتری", ok: u?.status !== "suspended", warn: u?.status !== "active", detail: u ? "وضعیت حساب: " + u.status : "کاربر پیدا نشد", hint: u?.status === "suspended" ? "حساب معلق است؛ پیش از تحویل وضعیت را بررسی کنید." : "", href: userHref });
  if (sku!.t === "plan" || sku!.t === "custom") {
    const v = await virt();
    let vPlans: { plid: number }[] = [], vGroups: { sgid: number; name: string }[] = [], vOs: { osid: number }[] = [];
    try {
      const ver = (await v.test()).version;
      [vPlans, vGroups, vOs] = await Promise.all([v.plans(), v.groups(), v.osTemplates()]);
      out.push({ key: "conn", label: "اتصال Virtualizor", ok: true, warn: v.name === "simulator", detail: ver + (v.name === "simulator" ? " (شبیه‌ساز)" : ""), hint: "", href: "/admin/virtualizor" });
    } catch (e) {
      out.push({ key: "conn", label: "اتصال Virtualizor", ok: false, detail: errorText(e), hint: "اتصال را در «اتصال Virtualizor» آزمایش کنید.", href: "/admin/virtualizor" });
      return out;
    }
    const spec = await serverSpec(db, sku!, p.override);
    if (spec.plid) {
      const ok = vPlans.some((x) => x.plid === spec.plid);
      out.push({ key: "plan", label: "نگاشت پلن", ok, detail: "Plan ID " + spec.plid + (ok ? " در Virtualizor هست" : " در Virtualizor وجود ندارد"), hint: ok ? "" : "در «اتصال Virtualizor › نگاشت پلن‌ها» Plan ID درست را بگذارید یا در همین صفحه برای این سفارش Plan ID دیگری انتخاب کنید.", href: "/admin/virtualizor" });
    } else out.push({ key: "plan", label: "نگاشت پلن", ok: spec.cpu > 0, warn: true, detail: spec.cpu ? "بدون Plan ID؛ با منابع صریح (" + spec.cpu + " هسته، " + spec.ram + " گیگ رم، " + spec.disk + " گیگ دیسک) ساخته می‌شود" : "نه Plan ID دارد نه منابع مشخص", hint: spec.cpu ? "" : "پلن را در «اتصال Virtualizor › نگاشت پلن‌ها» به یک Plan ID وصل کنید.", href: "/admin/virtualizor" });
    const g = spec.group;
    const groupOk = !!g && (/^\d+$/.test(g) ? vGroups.some((x) => x.sgid === Number(g)) : vGroups.some((x) => x.name.toLowerCase() === g.toLowerCase()));
    out.push({ key: "loc", label: "گروه سرور موقعیت", ok: groupOk, detail: g ? "گروه «" + g + "»" + (groupOk ? " در Virtualizor هست" : " در Virtualizor نیست؛ موجود: " + (vGroups.map((x) => x.name).join("، ") || "هیچ")) : "برای موقعیت " + sku!.loc + " گروهی تعیین نشده", hint: groupOk ? "" : "Server Group موقعیت را در «زیرساخت › موقعیت‌ها» درست کنید یا موقعیت این سفارش را تغییر دهید.", href: "/admin/infra" });
    const osOk = !!spec.tpl && vOs.some((x) => x.osid === spec.tpl!.osid);
    out.push({ key: "os", label: "قالب سیستم‌عامل", ok: osOk, detail: spec.tpl ? spec.tpl.name + " (OSID " + spec.tpl.osid + ")" + (osOk ? "" : " در Virtualizor وجود ندارد") : "برای «" + spec.osLabel + "» قالب فعالی نیست", hint: osOk ? "" : "قالب‌ها را در «اتصال Virtualizor» همگام کنید یا برای این سفارش یک قالب همگام‌شده انتخاب کنید.", href: "/admin/virtualizor" });
    out.push({ key: "virtuser", label: "کاربر Virtualizor", ok: true, warn: !u?.virtUid, detail: u?.virtUid ? "uid " + u.virtUid : "هنوز ساخته نشده؛ در اولین تلاش با ایمیل " + (u?.email ?? "") + " ساخته می‌شود", hint: "", href: userHref });
  } else if (sku!.t === "hosting") {
    const plan = await planOf(db, "hosting", sku!.plan);
    out.push({ key: "hosting", label: "پلن هاست", ok: !!plan && plan.active !== false, detail: plan ? plan.name + (plan.active === false ? " (غیرفعال)" : "") : "پلن " + sku!.plan + " پیدا نشد", hint: plan ? "" : "پلن را در «محصولات و قیمت» بررسی کنید.", href: "/admin/products" });
  } else if (sku!.t === "domain") {
    const name = sku!.name.toLowerCase();
    const tld = name.slice(name.indexOf("."));
    const [tl] = await db.select().from(t.tlds).where(eq(t.tlds.tld, tld));
    out.push({ key: "tld", label: "پسوند", ok: !!tl, detail: tl ? tld + " پشتیبانی می‌شود" : tld + " در فهرست پسوندها نیست", hint: tl ? "" : "پسوند را در «محصولات و قیمت» اضافه کنید.", href: "/admin/products" });
    const [ex] = await db.select().from(t.domains).where(eq(t.domains.name, name));
    out.push({ key: "domain", label: "آزاد بودن دامنه در گره", ok: !ex || ex.orderRef === invoiceId + ":" + index, detail: ex ? "قبلا ثبت شده (" + ex.id + ")" : "در گره ثبت نشده است", hint: ex ? "وجه را بازگردانید یا با مشتری هماهنگ کنید." : "", href: "/admin/domains" });
    if (/\.ir$/.test(name)) {
      const [c] = await db.select().from(t.domainContacts).where(eq(t.domainContacts.userId, inv!.userId));
      out.push({ key: "irnic", label: "شناسه ایرنیک", ok: !!c?.irnicHandle, detail: c?.irnicHandle || "ثبت نشده", hint: c?.irnicHandle ? "" : "مشتری باید شناسه ایرنیک را در بخش دامنه‌ها ثبت کند.", href: userHref });
    }
  }
  return out;
}

export type OrderPatch = { os?: string; osid?: number; loc?: string; plid?: number };
/** staff fix before a retry: another OS/template, location or Plan ID for this order only; returns what changed */
export async function editOrder(db: DB, invoiceId: string, index: number, patch: OrderPatch) {
  const job = await orderJob(db, invoiceId, index);
  if (!job) fail("کار تحویل این سفارش پیدا نشد.");
  if (job!.type !== "provision.server") fail("فقط مشخصات سفارش سرور قابل ویرایش است.");
  const p = job!.payload as JobPayload & Record<string, unknown>;
  if (p.resolved) fail("این سفارش قبلا بسته شده است.");
  if (job!.status === "running") fail("تحویل این سفارش همین الان در حال اجراست؛ چند لحظه بعد دوباره امتحان کنید.");
  const key = invoiceId + ":" + index;
  const [srv] = await db.select().from(t.servers).where(eq(t.servers.orderRef, key));
  if (srv?.vpsid) fail("VPS این سفارش ساخته شده است؛ تغییر مشخصات فقط پیش از ساخت ممکن است.");
  const sku = p.sku;
  if (!sku || (sku.t !== "plan" && sku.t !== "custom")) fail("مشخصات سرور در این سفارش نیست.");
  const s = { ...(sku as Extract<Sku, { t: "plan" } | { t: "custom" }>) };
  const o: Override = { ...(p.override ?? {}) };
  const changes: string[] = [];
  if (patch.os !== undefined && patch.os !== (s.os ?? "ubuntu")) {
    if (!OSES.some((x) => x.id === patch.os)) fail("سیستم‌عامل معتبر نیست.");
    changes.push("os " + (s.os ?? "ubuntu") + "→" + patch.os);
    s.os = patch.os;
    if (patch.osid === undefined) delete o.osid;
  }
  if (patch.osid !== undefined && patch.osid !== (o.osid ?? 0)) {
    if (patch.osid) {
      const [tpl] = await db.select().from(t.osTemplates).where(eq(t.osTemplates.osid, patch.osid));
      if (!tpl) fail("این قالب در فهرست همگام‌شده نیست؛ ابتدا قالب‌ها را همگام کنید.");
      o.osid = patch.osid;
    } else delete o.osid;
    changes.push("osid→" + (patch.osid || "خودکار"));
  }
  if (patch.loc !== undefined && patch.loc !== s.loc) {
    const l = (await getLocations(db)).find((x) => x.id === patch.loc);
    if (!l || l.active === false) fail("موقعیت معتبر یا فعال نیست.");
    const kind = s.t === "plan" ? s.kind : "cloud";
    if (kind === "metal" && !l!.metal) fail("این موقعیت سرور اختصاصی ندارد.");
    if (!locationGroup(l, kind)) fail("برای این موقعیت گروه سرور Virtualizor تعیین نشده است.");
    changes.push("loc " + s.loc + "→" + patch.loc);
    s.loc = patch.loc;
  }
  if (patch.plid !== undefined && patch.plid !== (o.plid ?? 0)) {
    if (patch.plid) {
      let list: { plid: number }[] = [];
      try { list = await (await virt()).plans(); } catch (e) { fail("فهرست پلن‌های Virtualizor خوانده نشد: " + errorText(e)); }
      if (!list.some((x) => x.plid === patch.plid)) fail("Plan ID " + patch.plid + " در Virtualizor وجود ندارد.");
      o.plid = patch.plid;
    } else delete o.plid;
    changes.push("plid→" + (patch.plid || "نگاشت پلن"));
  }
  if (!changes.length) fail("تغییری انتخاب نشده است.");
  await db.update(t.jobs).set({ payload: { ...p, sku: s, override: o } }).where(eq(t.jobs.id, job!.id));
  if (srv && srv.loc !== s.loc) await db.update(t.servers).set({ loc: s.loc }).where(eq(t.servers.id, srv.id));
  return { changes, userId: p.userId ?? srv?.userId ?? "" };
}

/* ---------- customer 360 ---------- */

export async function userSummary(db: DB, uid: string): Promise<UserSummary> {
  const [u] = await db.select().from(t.users).where(eq(t.users.id, uid));
  if (!u) fail("کاربر پیدا نشد.", 404);
  const [meta, fc, wallets, members, memberOf, [sess], overdue] = await Promise.all([
    accountMetaOf(db, uid), creditForecast(db, uid),
    db.select().from(t.subWallets).where(eq(t.subWallets.userId, uid)).orderBy(asc(t.subWallets.createdAt)),
    db.select({ id: t.users.id, name: t.users.name, email: t.users.email, role: t.teamMembers.role }).from(t.teamMembers).innerJoin(t.users, eq(t.users.id, t.teamMembers.memberId)).where(eq(t.teamMembers.ownerId, uid)),
    db.select({ id: t.users.id, name: t.users.name, role: t.teamMembers.role }).from(t.teamMembers).innerJoin(t.users, eq(t.users.id, t.teamMembers.ownerId)).where(eq(t.teamMembers.memberId, uid)),
    db.select().from(t.sessions).where(eq(t.sessions.userId, uid)).orderBy(desc(t.sessions.lastSeenAt)).limit(1),
    db.select({ n: count() }).from(t.invoices).where(and(eq(t.invoices.userId, uid), eq(t.invoices.status, "overdue"))),
  ]);
  const n = async (tbl: typeof t.servers | typeof t.hosting | typeof t.domains | typeof t.paasApps | typeof t.paasDbs | typeof t.storageBuckets | typeof t.mailDomains | typeof t.geoZones | typeof t.aiKeys | typeof t.builderProjects | typeof t.tickets) =>
    (await db.select({ n: count() }).from(tbl).where(eq(tbl.userId, uid)))[0].n;
  const counts: Record<string, number> = {
    servers: await n(t.servers), hosting: await n(t.hosting), domains: await n(t.domains), apps: await n(t.paasApps), dbs: await n(t.paasDbs), buckets: await n(t.storageBuckets),
    mail: await n(t.mailDomains), geo: await n(t.geoZones), aiKeys: await n(t.aiKeys), builder: await n(t.builderProjects), tickets: await n(t.tickets),
  };
  const [pending] = await db.select({ n: count() }).from(t.servers).where(and(eq(t.servers.userId, uid), or(eq(t.servers.status, "provisioning"), sql`${t.servers.provisionError} is not null`)));
  const flags = [
    u!.status === "suspended" && "حساب معلق است",
    u!.status === "pending" && "حساب در انتظار تأیید",
    u!.kyc === "pending" && "احراز هویت در انتظار بررسی",
    u!.balance < 0 && "موجودی منفی",
    u!.role === "admin" && "کارمند گره",
    overdue[0].n > 0 && fa(overdue[0].n) + " صورتحساب سررسیدگذشته",
    pending.n > 0 && fa(pending.n) + " سرور تحویل‌نشده",
    fc.days !== null && fc.days < 3 && "اعتبار کمتر از ۳ روز",
  ].filter(Boolean) as string[];
  return {
    tab: "summary",
    user: { id: u!.id, name: u!.name, email: u!.email, phone: u!.phone, company: u!.company, role: u!.role, status: u!.status, kyc: u!.kyc, balance: u!.balance, joined: faDate(u!.createdAt), twofa: !!u!.twofaSecret, autoPay: u!.autoPay, referralCode: u!.referralCode, virtUid: u!.virtUid },
    level: levelLabel(meta.level), wallets: wallets.map((w) => ({ id: w.id, name: w.name, balance: w.balance })),
    forecast: { burn: fc.burn, days: fc.days === null ? null : Math.floor(fc.days), until: fc.until ? faDate(fc.until) : "", threshold: fc.threshold },
    team: { members, memberOf },
    lastLogin: sess ? { at: faDateTime(sess.lastSeenAt), ip: sess.ip, device: sess.device } : null,
    counts, flags,
  };
}

export async function userOrders(db: DB, uid: string, offset = 0, limit = 15): Promise<UserOrders> {
  const [{ n }] = await db.select({ n: count() }).from(t.invoices).where(eq(t.invoices.userId, uid));
  const invs = await db.select().from(t.invoices).where(eq(t.invoices.userId, uid)).orderBy(desc(t.invoices.createdAt), desc(t.invoices.id)).limit(limit).offset(offset);
  const ids = invs.map((i) => i.id);
  const items = ids.length ? await db.select().from(t.invoiceItems).where(inArray(t.invoiceItems.invoiceId, ids)).orderBy(asc(t.invoiceItems.id)) : [];
  const jobRows = ids.length ? await db.select().from(t.jobs).where(and(like(t.jobs.type, "provision.%"), inArray(sql`${t.jobs.payload}->>'invoiceId'`, ids), sql`(${t.jobs.payload}->>'phase') is null`, sql`(${t.jobs.payload}->>'renew') is null`)).orderBy(asc(t.jobs.id)) : [];
  const refs = invs.flatMap((i) => (i.fulfil as unknown[]).map((_, n) => i.id + ":" + n));
  const rows = await deliveredRows(db, refs);
  const out: UserOrders["invoices"] = [];
  for (const inv of invs) {
    const its = items.filter((x) => x.invoiceId === inv.id);
    const ff = inv.fulfil as FulfilItem[];
    const lines = [];
    for (const [n, it] of its.entries()) {
      const key = inv.id + ":" + n;
      const job = jobRows.filter((j) => (j.payload as { invoiceId?: string; index?: number }).invoiceId === inv.id && (j.payload as { index?: number }).index === n).pop() ?? null;
      const f = ff[n];
      lines.push({ index: n, desc: it.desc, amount: it.amount, decoded: f ? (await decodeItem(db, uid, f)).short : "", state: stateOf(inv.status, f, job, rows.get(key), key) });
    }
    out.push({ id: inv.id, status: inv.status, created: faDateTime(inv.createdAt), paid: inv.paidAt ? faDateTime(inv.paidAt) : "", total: invGross({ items: its, tax: inv.taxRate }), coupon: inv.coupon ?? "", lines });
  }
  return { tab: "orders", total: n, invoices: out };
}

export async function userServices(db: DB, uid: string): Promise<UserServices> {
  const [srv, hst, dom, apps, dbs, bld, bkt, mail, keys, zones, inq, aPlans, sPlans] = await Promise.all([
    db.select().from(t.servers).where(eq(t.servers.userId, uid)).orderBy(asc(t.servers.createdAt)),
    db.select().from(t.hosting).where(eq(t.hosting.userId, uid)),
    db.select().from(t.domains).where(eq(t.domains.userId, uid)),
    db.select().from(t.paasApps).where(eq(t.paasApps.userId, uid)),
    db.select().from(t.paasDbs).where(eq(t.paasDbs.userId, uid)),
    db.select().from(t.builderProjects).where(eq(t.builderProjects.userId, uid)),
    db.select().from(t.storageBuckets).where(eq(t.storageBuckets.userId, uid)),
    db.select().from(t.mailDomains).where(eq(t.mailDomains.userId, uid)),
    db.select().from(t.aiKeys).where(eq(t.aiKeys.userId, uid)),
    db.select().from(t.geoZones).where(eq(t.geoZones.userId, uid)),
    db.select().from(t.inquiryAccounts).where(eq(t.inquiryAccounts.userId, uid)),
    db.select().from(t.paasPlans),
    db.select().from(t.storagePlans),
  ]);
  const plan = (id: string) => aPlans.find((p) => p.id === id)?.name ?? id;
  const sus = (st: string) => (st === "suspended" ? ["unsuspend"] : ["suspend"]) as ServiceRow["actions"];
  const gb = (b: number) => (b / 1e9).toFixed(b < 1e9 ? 2 : 1);
  const rows: ServiceRow[] = [
    ...srv.map((s) => ({ kind: "server", id: s.id, name: s.name, status: s.status, href: "/admin/services",
      info: s.cpu + "C / " + s.ram + "G / " + s.disk + "G · " + (s.ip || "بدون IP") + " · " + s.loc + " · " + (s.billing === "hourly" ? "ساعتی" : "تا " + faDate(s.paidUntil)) + (s.provisionError ? " · خطای تحویل" : ""),
      actions: s.status === "provisioning" ? [] : [...sus(s.status), "delete"] as ServiceRow["actions"] })),
    ...hst.map((h) => ({ kind: "hosting", id: h.id, name: h.domain, status: h.status, href: "/admin/services", info: h.plan + " · تا " + faDate(h.expiresAt) + " · " + h.server, actions: sus(h.status) })),
    ...dom.map((d) => ({ kind: "domain", id: d.id, name: d.name, status: d.status, href: "/admin/domains", info: "انقضا " + faDate(d.expiresAt) + (d.autoRenew ? " · تمدید خودکار" : ""), actions: [] })),
    ...apps.map((a) => ({ kind: "app", id: a.id, name: a.name, status: a.status, href: "/admin/paas", info: a.stack + " · " + plan(a.planId) + " · " + fa(a.instances) + " نمونه", actions: sus(a.status) })),
    ...dbs.map((d) => ({ kind: "db", id: d.id, name: d.name, status: d.status, href: "/admin/paas", info: d.engine + " " + d.version + " · " + plan(d.planId), actions: sus(d.status) })),
    ...bld.map((b) => ({ kind: "builder", id: b.id, name: b.name, status: b.status, href: "", info: (b.stack === "node" ? "Node" : "استاتیک") + " · نسخه " + fa(b.version) + (b.appId ? " · اپ " + b.appId : ""), actions: [] })),
    ...bkt.map((b) => ({ kind: "bucket", id: b.id, name: b.name, status: b.status, href: "/admin/storage", info: (sPlans.find((p) => p.id === b.planId)?.name ?? b.planId) + " · " + gb(b.usedBytes) + " گیگ · " + fa(b.objects) + " شیء", actions: sus(b.status) })),
    ...mail.map((m) => ({ kind: "mail", id: m.id, name: m.domain, status: m.status, href: "/admin/mail", info: (m.mode === "live" ? "ارسال واقعی" : "حالت آزمایشی") + " · " + m.planId, actions: sus(m.status) })),
    ...keys.map((k) => ({ kind: "aikey", id: k.id, name: k.name, status: k.status, href: "/admin/ai", info: k.prefix + "… · آخرین استفاده " + (k.lastUsedAt ? faDateTime(k.lastUsedAt) : "—"), actions: [] })),
    ...zones.map((z) => ({ kind: "geo", id: z.id, name: z.domain, status: z.status, href: "/admin/geo", info: z.planId + " · تا " + faDate(z.paidUntil) + (z.nsOk ? "" : " · NS تنظیم نشده"), actions: [...sus(z.status), "extend"] as ServiceRow["actions"] })),
    ...inq.map((a) => ({ kind: "inquiry", id: a.userId, name: "حساب استعلام #" + a.accountNo, status: a.status, href: "/admin/inquiry", info: "کلید " + a.apiKey.slice(0, 8) + "…", actions: sus(a.status) })),
  ];
  return { tab: "services", rows };
}

const PRODUCT_LABEL: Record<string, string> = { ...Object.fromEntries(Object.entries(BUDGET_SERVICES).filter(([k]) => k !== "all").map(([k, v]) => [k, v.label])), other: "سایر" };
const productOf = (d: string) => Object.entries(BUDGET_SERVICES).find(([k, v]) => k !== "all" && v.match?.test(d))?.[0] ?? "other";
const dayKeys = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86400_000).toISOString().slice(0, 10));
const dayLabel = (k: string) => new Date(k + "T12:00:00Z").toLocaleDateString("fa-IR", { month: "numeric", day: "numeric", timeZone: "Asia/Tehran" });
function series(rows: { day: string; v: number | string | null }[], n = 30): Series {
  const keys = dayKeys(n), m = new Map(rows.map((r) => [r.day, Number(r.v ?? 0)]));
  return { labels: keys.map(dayLabel), data: keys.map((k) => Math.round((m.get(k) ?? 0) * 100) / 100) };
}
const dayOf = (col: unknown) => sql<string>`to_char(${col}, 'YYYY-MM-DD')`;

function txWhere(uid: string, f: TxFilter) {
  const q = f.q?.trim();
  return and(
    eq(t.transactions.userId, uid),
    f.type ? eq(t.transactions.type, f.type) : undefined,
    f.days ? gte(t.transactions.createdAt, new Date(Date.now() - f.days * 86400_000)) : undefined,
    q ? or(ilike(t.transactions.desc, "%" + q + "%"), ilike(t.transactions.id, "%" + q + "%")) : undefined,
  );
}
/** wallet transactions matching the filter (product filtering by description, like budgets) */
export async function userTransactions(db: DB, uid: string, f: TxFilter, max = 5000) {
  const rows = await db.select().from(t.transactions).where(txWhere(uid, f)).orderBy(desc(t.transactions.createdAt), desc(t.transactions.id)).limit(max);
  return rows.map((x) => ({ id: x.id, type: x.type, amount: x.amount, method: x.method, desc: x.desc, at: faDateTime(x.createdAt), product: productOf(x.desc) }))
    .filter((x) => !f.product || x.product === f.product);
}

export async function userUsage(db: DB, uid: string, f: TxFilter): Promise<UserUsage> {
  const all = await userTransactions(db, uid, f);
  const offset = f.offset ?? 0, limit = f.limit ?? 25;
  const since30 = new Date(Date.now() - 30 * 86400_000);
  const since6m = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1));
  const spent = await db.select({ amount: t.transactions.amount, desc: t.transactions.desc, at: t.transactions.createdAt }).from(t.transactions)
    .where(and(eq(t.transactions.userId, uid), gte(t.transactions.createdAt, since6m), lt(t.transactions.amount, 0), inArray(t.transactions.type, ["usage", "payment"])));
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(since6m.getUTCFullYear(), since6m.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  const byProduct = new Map<string, Map<string, number>>();
  for (const r of spent) {
    const p = productOf(r.desc), m = r.at.toISOString().slice(0, 7);
    const pm = byProduct.get(p) ?? new Map<string, number>();
    pm.set(m, (pm.get(m) ?? 0) - r.amount);
    byProduct.set(p, pm);
  }
  const monthly = [...byProduct.entries()].map(([product, pm]) => ({ product, label: PRODUCT_LABEL[product] ?? product, months: months.map((m) => ({ month: m, amount: pm.get(m) ?? 0 })) }))
    .sort((a, b) => b.months.reduce((s, x) => s + x.amount, 0) - a.months.reduce((s, x) => s + x.amount, 0));
  const appIds = (await db.select({ id: t.paasApps.id }).from(t.paasApps).where(eq(t.paasApps.userId, uid))).map((a) => a.id);
  const bucketIds = (await db.select({ id: t.storageBuckets.id }).from(t.storageBuckets).where(eq(t.storageBuckets.userId, uid))).map((b) => b.id);
  const day30 = dayKeys(30)[0];
  const [hourly, aiModel, aiDay, spend, traffic, storage, mail, inquiry] = await Promise.all([
    db.select({ day: dayOf(t.transactions.createdAt), v: sql<string>`sum(-${t.transactions.amount})` }).from(t.transactions).where(and(eq(t.transactions.userId, uid), eq(t.transactions.type, "usage"), gte(t.transactions.createdAt, since30))).groupBy(dayOf(t.transactions.createdAt)),
    db.select({ model: t.aiUsage.model, calls: count(), charged: sql<string>`coalesce(sum(${t.aiUsage.charged}), 0)`, tokens: sql<string>`coalesce(sum(${t.aiUsage.inTokens} + ${t.aiUsage.outTokens}), 0)` }).from(t.aiUsage).where(and(eq(t.aiUsage.userId, uid), gte(t.aiUsage.createdAt, since30))).groupBy(t.aiUsage.model),
    db.select({ day: dayOf(t.aiUsage.createdAt), v: sql<string>`sum(${t.aiUsage.charged})` }).from(t.aiUsage).where(and(eq(t.aiUsage.userId, uid), gte(t.aiUsage.createdAt, since30))).groupBy(dayOf(t.aiUsage.createdAt)),
    appIds.length ? db.select({ month: t.paasSpend.month, amount: sql<string>`sum(${t.paasSpend.amount})` }).from(t.paasSpend).where(inArray(t.paasSpend.appId, appIds)).groupBy(t.paasSpend.month).orderBy(asc(t.paasSpend.month)) : [],
    appIds.length ? db.select({ day: t.paasTraffic.day, v: sql<string>`sum(${t.paasTraffic.bytes}) / 1048576.0` }).from(t.paasTraffic).where(and(inArray(t.paasTraffic.appId, appIds), gte(t.paasTraffic.day, day30))).groupBy(t.paasTraffic.day) : [],
    bucketIds.length ? db.select({ day: t.storageUsage.day, v: sql<string>`sum(${t.storageUsage.sizeBytes}) / 1e9` }).from(t.storageUsage).where(and(inArray(t.storageUsage.bucketId, bucketIds), gte(t.storageUsage.day, day30))).groupBy(t.storageUsage.day) : [],
    db.select({ day: dayOf(t.mailMessages.createdAt), v: sql<string>`sum(${t.mailMessages.recipients})` }).from(t.mailMessages).where(and(eq(t.mailMessages.userId, uid), eq(t.mailMessages.direction, "out"), gte(t.mailMessages.createdAt, since30))).groupBy(dayOf(t.mailMessages.createdAt)),
    db.select({ day: dayOf(t.inquiryCalls.createdAt), v: count() }).from(t.inquiryCalls).where(and(eq(t.inquiryCalls.userId, uid), gte(t.inquiryCalls.createdAt, since30))).groupBy(dayOf(t.inquiryCalls.createdAt)),
  ]);
  return {
    tab: "usage", total: all.length, tx: all.slice(offset, offset + limit), monthly, months,
    hourly: series(hourly),
    ai: { byModel: aiModel.map((m) => ({ model: m.model, calls: m.calls, charged: Number(m.charged), tokens: Number(m.tokens) })).sort((a, b) => b.charged - a.charged), daily: series(aiDay) },
    paas: { spend: spend.map((s) => ({ month: s.month, amount: Number(s.amount) })), traffic: series(traffic) },
    storage: series(storage), mail: series(mail), inquiry: series(inquiry),
  };
}

export async function userActivity(db: DB, uid: string, offset = 0): Promise<UserActivity> {
  const [u] = await db.select({ email: t.users.email }).from(t.users).where(eq(t.users.id, uid));
  if (!u) fail("کاربر پیدا نشد.", 404);
  const idsOf = async (tbl: typeof t.servers | typeof t.hosting | typeof t.domains | typeof t.invoices | typeof t.paasApps | typeof t.storageBuckets | typeof t.mailDomains | typeof t.geoZones | typeof t.tickets) =>
    (await db.select({ id: tbl.id }).from(tbl).where(eq(tbl.userId, uid)).limit(1000)).map((r) => r.id);
  const doms = (await db.select({ name: t.domains.name }).from(t.domains).where(eq(t.domains.userId, uid))).map((d) => d.name);
  const ids = [uid, u!.email, ...doms, ...(await Promise.all([t.servers, t.hosting, t.domains, t.invoices, t.paasApps, t.storageBuckets, t.mailDomains, t.geoZones, t.tickets].map(idsOf))).flat()];
  const head = sql`split_part(split_part(${t.audit.target}, ' ', 1), ':', 1)`;
  const [tks, acts, aud, notes] = await Promise.all([
    db.select().from(t.tickets).where(eq(t.tickets.userId, uid)).orderBy(desc(t.tickets.updatedAt)).limit(100),
    db.select().from(t.activity).where(eq(t.activity.userId, uid)).orderBy(desc(t.activity.createdAt)).limit(50).offset(offset),
    db.select().from(t.audit).where(or(inArray(t.audit.target, ids), inArray(head, ids))).orderBy(desc(t.audit.createdAt)).limit(100),
    db.select().from(t.notifications).where(eq(t.notifications.userId, uid)).orderBy(desc(t.notifications.createdAt)).limit(100),
  ]);
  return {
    tab: "activity",
    tickets: tks.map((x) => ({ id: x.id, subject: x.subject, status: x.status, priority: x.priority, updated: faDateTime(x.updatedAt) })),
    activity: acts.map((a) => ({ text: a.text, icon: a.icon, ip: a.ip, at: faDateTime(a.createdAt) })),
    audit: aud.map((a) => ({ actor: a.actor, action: a.action, target: a.target, at: faDateTime(a.createdAt) })),
    notifications: notes.map((n) => ({ text: n.text, icon: n.icon, read: n.read, at: faDateTime(n.createdAt) })),
  };
}

/* ---------- global search ---------- */

/** email, phone, name, invoice id, server IP/name or any domain → the customer it belongs to */
export async function adminSearch(db: DB, raw: string): Promise<SearchHit[]> {
  const q = toEnDigits(raw.trim()).toLowerCase();
  if (q.length < 2) return [];
  const pat = "%" + q.replace(/[%_\\]/g, "\\$&") + "%";
  const [us, invs, srvs, ips, doms, hsts, mails, zones] = await Promise.all([
    db.select().from(t.users).where(or(ilike(t.users.email, pat), ilike(t.users.name, pat), like(t.users.phone, pat), eq(t.users.id, raw.trim()))).limit(10),
    db.select().from(t.invoices).where(sql`lower(${t.invoices.id}) = ${q}`).limit(5),
    db.select().from(t.servers).where(or(eq(t.servers.ip, q), eq(t.servers.ipv6, q), sql`lower(${t.servers.id}) = ${q}`, ilike(t.servers.hostname, pat))).limit(10),
    db.select({ ip: t.vpsIps.ip, serverId: t.vpsIps.serverId }).from(t.vpsIps).where(eq(t.vpsIps.ip, q)).limit(5),
    db.select().from(t.domains).where(ilike(t.domains.name, pat)).limit(10),
    db.select().from(t.hosting).where(ilike(t.hosting.domain, pat)).limit(10),
    db.select().from(t.mailDomains).where(ilike(t.mailDomains.domain, pat)).limit(5),
    db.select().from(t.geoZones).where(ilike(t.geoZones.domain, pat)).limit(5),
  ]);
  const extra = ips.length ? await db.select().from(t.servers).where(inArray(t.servers.id, ips.map((i) => i.serverId))) : [];
  const hits: SearchHit[] = [
    ...us.map((u) => ({ kind: "user" as const, label: u.name, sub: u.email + (u.phone ? " · " + u.phone : ""), userId: u.id })),
    ...invs.map((i) => ({ kind: "invoice" as const, label: i.id, sub: "صورتحساب · " + i.status, userId: i.userId })),
    ...[...srvs, ...extra].map((s) => ({ kind: "server" as const, label: s.name, sub: s.ip + " · " + s.id, userId: s.userId })),
    ...doms.map((d) => ({ kind: "domain" as const, label: d.name, sub: "دامنه", userId: d.userId })),
    ...hsts.map((h) => ({ kind: "hosting" as const, label: h.domain, sub: "هاست · " + h.plan, userId: h.userId })),
    ...mails.map((m) => ({ kind: "mail" as const, label: m.domain, sub: "سرویس ایمیل", userId: m.userId })),
    ...zones.map((z) => ({ kind: "geo" as const, label: z.domain, sub: "Geo DNS", userId: z.userId })),
  ];
  const seen = new Set<string>();
  return hits.filter((h) => { const k = h.kind + h.label + h.userId; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
}

