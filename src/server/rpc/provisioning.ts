/* Admin › سفارش‌های تحویل‌نشده: retry, manual delivery, refund and manual assignment of services,
   plus the Virtualizor "dry run" that checks every plan, location, group and OS mapping. */
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { BILLING, type Sku } from "@/lib/catalog";
import { faDateTime, addMonths } from "@/lib/jalali";
import { actor, method, needStaff, type Ctx } from "../ctx";
import { hosting, jobs, planMap, plans, servers, transactions, users, domains, osTemplates, vpsRelayout } from "../db/schema";
import { enqueue } from "../jobs";
import { getLocations, locationGroup } from "../locations";
import { lineAmount, listUndelivered } from "../provisioning";
import { virt } from "../virt/driver";
import { retryRelayout } from "../virt/relayout";
import { addTask, fail, logActivity, logAudit, nextId, notify, rid } from "../util";
import { NS, errorText, sendCredentials, serverSpec } from "../worker/provision";

const key = z.string().max(80).regex(/^[\w-]+:\d+$/);
const HOST_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IP_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;
const vpsid = z.number().int().min(1).max(2_000_000_000);
const delivery = z.object({ vpsid: vpsid.optional(), ip: z.string().max(45).optional(), hostname: z.string().max(253).optional(), rootpass: z.string().max(128).optional(), note: z.string().max(300).optional() });
type Delivery = z.infer<typeof delivery>;

/** the job and the order line behind a key "<invoice>:<index>" */
async function order(ctx: Ctx, k: string) {
  const i = k.lastIndexOf(":");
  const invoiceId = k.slice(0, i), index = Number(k.slice(i + 1));
  const [job] = await ctx.db.select().from(jobs)
    .where(and(sql`${jobs.type} like 'provision.%'`, sql`(${jobs.payload}->>'invoiceId') = ${invoiceId}`, sql`(${jobs.payload}->>'index')::int = ${index}`, sql`(${jobs.payload}->>'phase') is null`))
    .orderBy(desc(jobs.id)).limit(1);
  const [srv] = await ctx.db.select().from(servers).where(eq(servers.orderRef, k));
  if (!job && !srv) fail("سفارش پیدا نشد.", 404);
  const p = (job?.payload ?? {}) as { userId?: string; sku?: Sku; resolved?: unknown };
  return { invoiceId, index, job: (job as typeof job | undefined) ?? null, srv: (srv as typeof srv | undefined) ?? null, userId: p.userId ?? srv!.userId, sku: p.sku ?? null, resolved: !!p.resolved };
}
/** closes the job so the worker never runs it again; the note says who closed it and how */
async function closeJob(ctx: Ctx, jobId: number | undefined, how: string, note = "") {
  if (!jobId) return;
  const resolved = { how, note, by: actor(ctx), at: new Date().toISOString() };
  await ctx.db.update(jobs).set({ status: "done", lockedAt: null, payload: sql`${jobs.payload} || ${JSON.stringify({ resolved })}::jsonb` }).where(eq(jobs.id, jobId));
}
const cycleMonths = (sku: Sku | null) => (sku?.t === "plan" ? BILLING.find((b) => b.id === sku.cycle)?.months ?? 1 : 1);

async function retryOne(ctx: Ctx, k: string) {
  const o = await order(ctx, k);
  if (o.resolved) fail("این سفارش قبلا بسته شده است.");
  // a disk-layout rebuild that could not recreate the VPS continues from its stored step (never the original order)
  if (o.srv && (await retryRelayout(ctx.db, o.srv.id))) return;
  if (o.srv?.vpsid && o.srv.status === "building") {
    // build timed out: poll the hypervisor again with the original root password
    const [w] = await ctx.db.select().from(jobs).where(and(eq(jobs.type, "provision.server"), sql`(${jobs.payload}->>'serverId') = ${o.srv.id}`)).orderBy(desc(jobs.id)).limit(1);
    await ctx.db.update(servers).set({ provisionError: null }).where(eq(servers.id, o.srv.id));
    await enqueue(ctx.db, "provision.server", { phase: "wait", serverId: o.srv.id, rootpass: (w?.payload as { rootpass?: string } | undefined)?.rootpass ?? "", tries: 0 });
    return;
  }
  if (o.job) await ctx.db.update(jobs).set({ status: "pending", attempts: 0, runAt: new Date(), lockedAt: null }).where(eq(jobs.id, o.job.id));
  else if (o.sku) await enqueue(ctx.db, "provision.server", { userId: o.userId, invoiceId: o.invoiceId, index: o.index, sku: o.sku });
  else fail("کار تحویل این سفارش پیدا نشد؛ تحویل دستی یا بازگشت وجه را انجام دهید.");
}

/** creates or updates the customer's server row as delivered */
async function deliverServer(ctx: Ctx, o: Awaited<ReturnType<typeof order>>, d: Delivery, extra: { plan?: string; cpu?: number; ram?: number; disk?: number; loc?: string; os?: string; price?: number; billing?: "monthly" | "hourly"; months?: number } = {}) {
  let info = { ip: (d.ip ?? "").trim(), ipv6: "", hostname: (d.hostname ?? "").trim().toLowerCase(), status: "running" as string };
  if (d.vpsid) {
    const [taken] = await ctx.db.select({ id: servers.id }).from(servers).where(eq(servers.vpsid, d.vpsid));
    if (taken && taken.id !== o.srv?.id) fail("VPS " + d.vpsid + " قبلا به سرور " + taken.id + " وصل شده است.");
    let v;
    try { v = await (await virt()).getVps(d.vpsid); } catch (e) { fail("خواندن VPS از Virtualizor ناموفق بود: " + errorText(e)); }
    if (!v) fail("VPS " + d.vpsid + " در Virtualizor پیدا نشد.");
    info = { ip: info.ip || v!.ip, ipv6: v!.ipv6, hostname: info.hostname || v!.hostname, status: v!.status === "stopped" ? "stopped" : v!.status === "suspended" ? "suspended" : "running" };
  }
  if (!IP_RE.test(info.ip)) fail("آدرس IPv4 معتبر نیست.");
  if (!HOST_RE.test(info.hostname)) fail("hostname معتبر نیست.");
  const months = extra.months ?? cycleMonths(o.sku);
  let sid = o.srv?.id;
  if (o.srv) {
    const billing = extra.billing ?? o.srv.billing;
    // delivered by hand: a failed disk-layout rebuild is closed with it
    await ctx.db.delete(vpsRelayout).where(eq(vpsRelayout.serverId, o.srv.id));
    await ctx.db.update(servers).set({ vpsid: d.vpsid ?? null, ip: info.ip, ipv6: info.ipv6, hostname: info.hostname, status: info.status, provisionError: null,
      paidUntil: billing === "hourly" ? null : addMonths(new Date(), months) }).where(eq(servers.id, o.srv.id));
  } else {
    let spec = { name: extra.plan ?? "سفارشی", cpu: extra.cpu ?? 0, ram: extra.ram ?? 0, disk: extra.disk ?? 0, price: extra.price ?? 0, os: extra.os ?? "", hourly: extra.billing === "hourly" };
    const sku = o.sku;
    if (sku && (sku.t === "plan" || sku.t === "custom")) { const s = await serverSpec(ctx.db, sku); spec = { name: s.name, cpu: s.cpu, ram: s.ram, disk: s.disk, price: s.price, os: s.tpl?.name ?? s.osLabel, hourly: s.hourly }; }
    sid = await nextId(ctx.db, "srv", 2000);
    await ctx.db.insert(servers).values({
      id: sid, userId: o.userId, name: info.hostname.split(".")[0].slice(0, 40) || sid, plan: spec.name, cpu: spec.cpu, ram: spec.ram, disk: spec.disk,
      loc: extra.loc ?? (sku && "loc" in sku ? sku.loc : "thr"), os: spec.os || "Linux", ip: info.ip, ipv6: info.ipv6, status: info.status, price: spec.price,
      billing: spec.hourly ? "hourly" : "monthly", vpsid: d.vpsid ?? null, hostname: info.hostname, paidUntil: spec.hourly ? null : addMonths(new Date(), months),
      orderRef: o.job ? o.invoiceId + ":" + o.index : null,
    });
  }
  await addTask(ctx.db, sid!, "تحویل دستی توسط پشتیبانی");
  await logActivity(ctx.db, o.userId, "server", "سرور " + info.hostname + " تحویل شد");
  await notify(ctx.db, o.userId, "server", "سرور " + info.hostname + " آماده است");
  if (d.rootpass) await sendCredentials(ctx.db, { id: sid!, userId: o.userId, name: info.hostname, ip: info.ip, hostname: info.hostname }, d.rootpass);
  return sid!;
}

export const provisioningRpc = {
  "provisioning.list": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "services");
    return (await listUndelivered(ctx.db)).map((u) => ({ ...u, at: faDateTime(new Date(u.createdAt)), ageMin: Math.round((Date.now() - new Date(u.createdAt).getTime()) / 60_000) }));
  }),

  "provisioning.retry": method(z.tuple([key]), async (ctx, [k]) => {
    needStaff(ctx, "services");
    await retryOne(ctx, k);
    await logAudit(ctx.db, actor(ctx), "تلاش دوباره برای تحویل سفارش", k, ctx.ip);
  }),

  "provisioning.retryAll": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "services");
    let n = 0;
    for (const u of await listUndelivered(ctx.db)) { try { await retryOne(ctx, u.key); n++; } catch { /* listed again on the page */ } }
    await logAudit(ctx.db, actor(ctx), "تلاش دوباره برای همه سفارش‌های تحویل‌نشده", String(n), ctx.ip);
    return n;
  }),

  /** manual server delivery: an existing Virtualizor vpsid and/or hand-entered details */
  "provisioning.deliverServer": method(z.tuple([key, delivery]), async (ctx, [k, d]) => {
    needStaff(ctx, "services");
    const o = await order(ctx, k);
    if (o.resolved) fail("این سفارش قبلا بسته شده است.");
    if (o.job && o.job.type !== "provision.server") fail("این سفارش سرور نیست.");
    if (!d.vpsid && (!d.ip || !d.hostname)) fail("شناسه VPS یا آدرس IP و hostname را وارد کنید.");
    const sid = await deliverServer(ctx, o, d);
    await closeJob(ctx, o.job?.id, "manual", d.note);
    await logAudit(ctx.db, actor(ctx), "تحویل دستی سرور" + (d.vpsid ? " (VPS " + d.vpsid + ")" : ""), k + " → " + sid, ctx.ip);
    return sid;
  }),

  /** manual hosting/domain delivery */
  "provisioning.deliverOther": method(z.tuple([key, z.object({
    domain: z.string().max(253), username: z.string().max(32).optional(), password: z.string().max(128).optional(), server: z.string().max(80).optional(), years: z.number().int().min(1).max(10).optional(), note: z.string().max(300).optional(),
  })]), async (ctx, [k, d]) => {
    needStaff(ctx, "services");
    const o = await order(ctx, k);
    if (o.resolved || !o.job) fail("این سفارش قبلا بسته شده یا پیدا نشد.");
    const name = d.domain.trim().toLowerCase();
    if (!HOST_RE.test(name) || !name.includes(".")) fail("دامنه معتبر نیست.");
    const sku = o.sku;
    if (o.job!.type === "provision.hosting" && sku?.t === "hosting") {
      if (!d.username || !/^[a-z][a-z0-9]{1,15}$/.test(d.username)) fail("نام کاربری cPanel معتبر نیست.");
      const [p] = await ctx.db.select().from(plans).where(and(eq(plans.id, sku.plan), eq(plans.kind, "hosting")));
      const plan = (p?.data as { name: string; price: number } | undefined) ?? { name: sku.plan, price: 0 };
      const hid = await nextId(ctx.db, "hst", 500);
      await ctx.db.insert(hosting).values({ id: hid, userId: o.userId, domain: name, plan: plan.name, diskTotal: 10, bwTotal: 200, price: plan.price, server: d.server?.trim() || "", username: d.username!, expiresAt: addMonths(new Date(), sku.yearly ? 12 : 1), orderRef: k }).onConflictDoNothing();
      if (d.password) await enqueue(ctx.db, "notify.send", { userId: o.userId, kind: "service", subject: "هاست " + name + " آماده است", text: "هاست شما فعال شد.\n\nدامنه: " + name + "\nنام کاربری cPanel: " + d.username + "\nرمز: " + d.password + "\nنام‌سرورها: " + NS.join(" و "), secret: true });
      await notify(ctx.db, o.userId, "layers", "هاست " + name + " آماده است");
    } else if (o.job!.type === "provision.domain" && sku?.t === "domain") {
      const [exists] = await ctx.db.select({ id: domains.id }).from(domains).where(eq(domains.name, name));
      if (exists) fail("این دامنه قبلا در گره ثبت شده است.");
      const did = await nextId(ctx.db, "dom", 700);
      await ctx.db.insert(domains).values({ id: did, userId: o.userId, name, registeredAt: new Date(), expiresAt: addMonths(new Date(), 12 * (d.years ?? sku.years)), ns: NS, orderRef: k });
      await notify(ctx.db, o.userId, "globe", "دامنه " + name + " ثبت شد");
    } else fail("برای این نوع سفارش از تحویل سرور استفاده کنید.");
    await logActivity(ctx.db, o.userId, "circle-check", "سفارش " + k + " تحویل شد");
    await closeJob(ctx, o.job!.id, "manual", d.note);
    await logAudit(ctx.db, actor(ctx), "تحویل دستی سفارش", k + " → " + name, ctx.ip);
  }),

  /** refunds the order line (incl. VAT, minus its coupon share) to the wallet and closes the order */
  "provisioning.refund": method(z.tuple([key, z.string().max(300)]), async (ctx, [k, note]) => {
    needStaff(ctx, "billing");
    const o = await order(ctx, k);
    if (o.resolved) fail("این سفارش قبلا بسته شده است.");
    if (o.srv?.vpsid) fail("برای این سفارش VPS ساخته شده است؛ ابتدا سرور را از «سرویس‌ها» حذف کنید.");
    const { amount, desc: item } = await lineAmount(ctx.db, o.invoiceId, o.index);
    if (amount <= 0) fail("مبلغ این ردیف صورتحساب پیدا نشد.");
    await ctx.db.transaction(async (tx) => {
      if (o.job) {
        const r = await tx.update(jobs).set({ status: "done", lockedAt: null, payload: sql`${jobs.payload} || ${JSON.stringify({ resolved: { how: "refund", amount, note, by: actor(ctx), at: new Date().toISOString() } })}::jsonb` })
          .where(and(eq(jobs.id, o.job.id), sql`(${jobs.payload}->>'resolved') is null`)).returning({ id: jobs.id });
        if (!r.length) fail("این سفارش قبلا بسته شده است.");
      }
      if (o.srv) await tx.delete(servers).where(eq(servers.id, o.srv.id));
      await tx.update(users).set({ balance: sql`${users.balance} + ${amount}` }).where(eq(users.id, o.userId));
      await tx.insert(transactions).values({ id: rid("TX"), userId: o.userId, type: "refund", amount, method: "کیف پول", desc: "بازگشت وجه سفارش تحویل‌نشده " + o.invoiceId + (item ? " (" + item + ")" : "") });
      await notify(tx, o.userId, "wallet", "مبلغ " + amount.toLocaleString("fa-IR") + " تومان بابت سفارش تحویل‌نشده به کیف پول بازگشت");
    });
    await enqueue(ctx.db, "notify.send", { userId: o.userId, kind: "billing", subject: "بازگشت وجه سفارش " + o.invoiceId, text: "سفارش «" + item + "» قابل تحویل نبود و مبلغ " + amount.toLocaleString("fa-IR") + " تومان به کیف پول شما بازگشت." + (note ? "\n\n" + note : "") });
    await logAudit(ctx.db, actor(ctx), "بازگشت وجه سفارش تحویل‌نشده (" + amount + " تومان)", k, ctx.ip);
    return amount;
  }),

  /** gives a customer a server without an order (existing vpsid or hand-entered details) */
  "provisioning.assign": method(z.tuple([z.object({
    email: z.string().max(120), vpsid: vpsid.optional(), ip: z.string().max(45).optional(), hostname: z.string().max(253).optional(), rootpass: z.string().max(128).optional(),
    plan: z.string().max(60), cpu: z.number().int().min(1).max(512), ram: z.number().int().min(1).max(4096), disk: z.number().int().min(1).max(100_000), loc: z.string().max(10), os: z.string().max(80),
    price: z.number().int().min(0).max(10_000_000_000), billing: z.enum(["monthly", "hourly"]), months: z.number().int().min(0).max(36),
  })]), async (ctx, [a]) => {
    needStaff(ctx, "services");
    const [u] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${a.email.trim().toLowerCase()}`);
    if (!u) fail("کاربری با این ایمیل پیدا نشد.");
    if (!(await getLocations(ctx.db)).some((l) => l.id === a.loc)) fail("موقعیت معتبر نیست.");
    if (!a.vpsid && (!a.ip || !a.hostname)) fail("شناسه VPS یا آدرس IP و hostname را وارد کنید.");
    const sid = await deliverServer(ctx, { invoiceId: "", index: 0, job: null, srv: null, userId: u!.id, sku: null, resolved: false }, a,
      { plan: a.plan.trim() || "سفارشی", cpu: a.cpu, ram: a.ram, disk: a.disk, loc: a.loc, os: a.os.trim(), price: a.price, billing: a.billing, months: a.months });
    if (a.months === 0 && a.billing === "monthly") await ctx.db.update(servers).set({ paidUntil: new Date() }).where(eq(servers.id, sid));
    await logAudit(ctx.db, actor(ctx), "تخصیص دستی سرور به " + u!.email, sid, ctx.ip);
    return sid;
  }),

  /** checks every mapping a real order needs; returns the problems in Persian */
  "provisioning.dryRun": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "virtualizor");
    const out: { level: "error" | "warn" | "ok"; text: string }[] = [];
    const v = await virt();
    let vPlans: { plid: number }[] = [], vGroups: { sgid: number; name: string }[] = [], vOs: { osid: number }[] = [];
    try {
      out.push({ level: "ok", text: "اتصال: " + (await v.test()).version + (v.name === "simulator" ? " (شبیه‌ساز — سفارش‌ها روی Virtualizor واقعی ساخته نمی‌شوند)" : "") });
      [vPlans, vGroups, vOs] = await Promise.all([v.plans(), v.groups(), v.osTemplates()]);
    } catch (e) { out.push({ level: "error", text: "اتصال به Virtualizor برقرار نشد: " + errorText(e) }); return out; }
    const locs = (await getLocations(ctx.db)).filter((l) => l.active !== false);
    const groupOk = (g: string) => /^\d+$/.test(g) ? vGroups.some((x) => x.sgid === Number(g)) : vGroups.some((x) => x.name.toLowerCase() === g.toLowerCase());
    for (const l of locs) for (const kind of ["cloud", "metal"] as const) {
      if (kind === "metal" && !l.metal) continue;
      const g = locationGroup(l, kind);
      if (!g) out.push({ level: "error", text: `موقعیت «${l.label}»: گروه سرور ${kind === "metal" ? "اختصاصی" : "ابری"} تعیین نشده است (زیرساخت › موقعیت‌ها).` });
      else if (!groupOk(g)) out.push({ level: "error", text: `موقعیت «${l.label}»: گروه سرور «${g}» در Virtualizor نیست. گروه‌های موجود: ${vGroups.map((x) => x.name + " (" + x.sgid + ")").join("، ") || "هیچ"}.` });
    }
    const rows = await ctx.db.select().from(plans);
    const maps = await ctx.db.select().from(planMap);
    const loc = locs[0]?.id ?? "thr";
    for (const r of rows.filter((x) => x.kind !== "hosting")) {
      const pl = r.data as { name: string; active?: boolean };
      if (pl.active === false) continue;
      const s = await serverSpec(ctx.db, { t: "plan", kind: r.kind as "cloud" | "metal", plan: r.id, loc, cycle: "m" });
      for (const p of s.problems.filter((x) => x.startsWith("پلن"))) out.push({ level: "error", text: p });
      const m = maps.find((x) => x.id === r.id);
      if (m?.plid && !vPlans.some((x) => x.plid === m.plid)) out.push({ level: "error", text: `پلن «${pl.name}»: Plan ID ${m.plid} در Virtualizor وجود ندارد.` });
      else if (!m?.plid && s.cpu) out.push({ level: "warn", text: `پلن «${pl.name}» Plan ID ندارد؛ VPS با منابع صریح (${s.cpu} هسته، ${s.ram} گیگ رم، ${s.disk} گیگ دیسک) ساخته می‌شود.` });
    }
    const custom = maps.find((x) => x.id === "custom");
    if (custom?.plid && !vPlans.some((x) => x.plid === custom.plid)) out.push({ level: "error", text: `پیکربندی سفارشی: Plan ID ${custom.plid} در Virtualizor وجود ندارد.` });
    const on = await ctx.db.select().from(osTemplates).where(eq(osTemplates.on, true));
    if (!on.length) out.push({ level: "error", text: "هیچ قالب سیستم‌عاملی فعال نیست." });
    for (const t of on) if (!vOs.some((x) => x.osid === t.osid)) out.push({ level: "error", text: `قالب «${t.name}» (OSID ${t.osid}) فعال است اما در Virtualizor وجود ندارد؛ آن را خاموش کنید و قالب‌ها را همگام کنید.` });
    for (const label of ["Ubuntu 24.04", "Debian 12", "AlmaLinux 9", "Windows 2022"]) {
      const distro = label.split(" ")[0].toLowerCase();
      if (!on.some((t) => t.name === label || t.distro === distro || t.name.toLowerCase().startsWith(distro))) out.push({ level: "warn", text: `برای «${label}» که در فرم سفارش هست، قالب فعالی نیست؛ سفارش آن تحویل نمی‌شود.` });
    }
    if (!out.some((x) => x.level !== "ok")) out.push({ level: "ok", text: "همه نگاشت‌ها درست است." });
    await logAudit(ctx.db, actor(ctx), "بررسی آزمایشی Virtualizor", String(out.filter((x) => x.level === "error").length), ctx.ip);
    return out;
  }),
};
