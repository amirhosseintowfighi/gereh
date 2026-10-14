import "server-only";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Plan } from "@/lib/catalog";
import { EMAIL_RE, PHONE_RE, toEnDigits } from "@/lib/format";
import { faDateTime, parseJalali } from "@/lib/jalali";
import { actor, method, needStaff } from "../ctx";
import { announcements, coupons, incidents, incidentUpdates, kv, nodes, osTemplates, planMap, plans, servers, tlds, transactions, users, virtLog } from "../db/schema";
import { getLocations, saveLocations } from "../locations";
import { COMPONENTS } from "../status";
import { enqueue } from "../jobs";
import { sendEmail } from "../messaging";
import { hashPassword } from "../password";
import { seal } from "../secrets";
import { getSettings, getVirt, STAFF_ROLE_BY_LABEL } from "../state";
import { fail, genPassword, logAudit, notify, randomSecret, rid } from "../util";
import { resetVirt, virt, VirtualizorDriver } from "../virt/driver";
import { normalizeHost } from "../virt/virtualizor";

const id = z.string().max(40);
const money = z.number().int().min(0).max(10_000_000_000);
const refCode = () => randomSecret(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");

export const adminRpc = {
  "admin.updateUser": method(z.tuple([id, z.object({ status: z.enum(["active", "pending", "suspended"]).optional(), kyc: z.enum(["verified", "pending", "none"]).optional() })]), async (ctx, [uid, patch]) => {
    needStaff(ctx, "users");
    const [u] = await ctx.db.update(users).set(patch).where(and(eq(users.id, uid), eq(users.role, "user"))).returning({ id: users.id });
    if (!u) fail("کاربر پیدا نشد.", 404);
    if (patch.kyc === "verified") await notify(ctx.db, uid, "fingerprint", "احراز هویت شما تأیید شد");
    await logAudit(ctx.db, actor(ctx), "ویرایش کاربر " + Object.entries(patch).map(([k, v]) => k + "=" + v).join(","), uid, ctx.ip);
  }),

  "admin.adjustBalance": method(z.tuple([id, z.number().int().safe(), z.string().max(200)]), async (ctx, [uid, amount, reason]) => {
    needStaff(ctx, "billing");
    if (!amount) fail("مبلغ معتبر وارد کنید.");
    if (!reason.trim()) fail("دلیل را بنویسید.");
    await ctx.db.transaction(async (tx) => {
      const [u] = await tx.update(users).set({ balance: sql`${users.balance} + ${amount}` }).where(and(eq(users.id, uid), sql`${users.balance} + ${amount} >= 0`)).returning({ id: users.id });
      if (!u) fail("موجودی نمی‌تواند منفی شود.");
      await tx.insert(transactions).values({ id: rid("TX"), userId: uid, type: amount > 0 ? "topup" : "payment", amount, method: "اصلاح دستی", desc: reason.trim() });
    });
    await logAudit(ctx.db, actor(ctx), "تغییر موجودی " + amount.toLocaleString("fa-IR") + " تومان (" + reason.trim() + ")", uid, ctx.ip);
  }),

  "admin.createUser": method(z.tuple([z.object({ name: z.string().max(80), email: z.string().max(120), phone: z.string().max(20) })]), async (ctx, [u]) => {
    needStaff(ctx, "users");
    const v = { name: u.name.trim(), email: u.email.trim().toLowerCase(), phone: toEnDigits(u.phone.trim()) };
    if (v.name.length < 2 || !EMAIL_RE.test(v.email)) fail("نام و ایمیل معتبر لازم است.");
    if (v.phone && !PHONE_RE.test(v.phone)) fail("شماره موبایل معتبر نیست.");
    const [dup] = await ctx.db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, v.email));
    if (dup) fail("کاربری با این ایمیل وجود دارد.");
    const pass = genPassword();
    await ctx.db.insert(users).values({ id: rid("u"), ...v, passwordHash: await hashPassword(pass), referralCode: refCode() });
    await sendEmail(v.email, "حساب گره شما ساخته شد", "سلام " + v.name + "،\nحساب شما در گره ساخته شد.\nایمیل: " + v.email + "\nرمز موقت: " + pass + "\nپس از ورود رمز را تغییر دهید.");
    await logAudit(ctx.db, actor(ctx), "ساخت کاربر", v.email, ctx.ip);
  }),

  "admin.updatePlan": method(z.tuple([z.enum(["cloud", "metal", "hosting"]), id, z.object({ name: z.string().max(60).optional(), price: money.optional(), popular: z.boolean().optional(), active: z.boolean().optional() })]), async (ctx, [kind, pid, patch]) => {
    needStaff(ctx, "products");
    const [p] = await ctx.db.select().from(plans).where(and(eq(plans.id, pid), eq(plans.kind, kind)));
    if (!p) fail("پلن پیدا نشد.", 404);
    if (patch.name !== undefined && !patch.name.trim()) fail("نام و قیمت لازم است.");
    if (patch.price !== undefined && patch.price <= 0) fail("نام و قیمت لازم است.");
    await ctx.db.update(plans).set({ data: { ...(p!.data as Plan), ...patch, ...(patch.name ? { name: patch.name.trim() } : {}) } }).where(eq(plans.id, pid));
    await logAudit(ctx.db, actor(ctx), "ویرایش محصول", pid, ctx.ip);
  }),

  "admin.updateTld": method(z.tuple([z.string().max(20), z.object({ reg: money.optional(), renew: money.optional(), transfer: money.optional(), promo: z.boolean().optional() })]), async (ctx, [tld, patch]) => {
    needStaff(ctx, "products");
    if ((patch.reg !== undefined && !patch.reg) || (patch.renew !== undefined && !patch.renew)) fail("قیمت ثبت و تمدید لازم است.");
    const r = await ctx.db.update(tlds).set(patch).where(eq(tlds.tld, tld)).returning({ tld: tlds.tld });
    if (!r.length) fail("پسوند پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "ویرایش قیمت پسوند", tld, ctx.ip);
  }),

  "admin.toggleNode": method(z.tuple([id]), async (ctx, [nid]) => {
    needStaff(ctx, "infra");
    const [n] = await ctx.db.select().from(nodes).where(eq(nodes.id, nid));
    if (!n) fail("نود پیدا نشد.", 404);
    await ctx.db.update(nodes).set({ status: n!.status === "online" ? "maintenance" : "online" }).where(eq(nodes.id, nid));
    await logAudit(ctx.db, actor(ctx), "تغییر حالت نود", nid, ctx.ip);
  }),
  "admin.addNode": method(z.tuple([z.object({ id: z.string().max(40), loc: z.string().max(10), model: z.string().max(80) })]), async (ctx, [n]) => {
    needStaff(ctx, "infra");
    const nid = n.id.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,}$/.test(nid)) fail("شناسه نود معتبر نیست.");
    if (!(await getLocations(ctx.db)).some((l) => l.id === n.loc)) fail("لوکیشن پیدا نشد.");
    const [dup] = await ctx.db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, nid));
    if (dup) fail("نودی با این شناسه وجود دارد.");
    await ctx.db.insert(nodes).values({ id: nid, loc: n.loc, model: n.model.trim() });
    await logAudit(ctx.db, actor(ctx), "افزودن نود", nid, ctx.ip);
  }),
  /** move a node to another location and/or fix its hardware label */
  "admin.updateNode": method(z.tuple([id, z.object({ loc: z.string().max(10).optional(), model: z.string().max(80).optional() })]), async (ctx, [nid, patch]) => {
    needStaff(ctx, "infra");
    if (patch.loc !== undefined && !(await getLocations(ctx.db)).some((l) => l.id === patch.loc)) fail("لوکیشن پیدا نشد.");
    const r = await ctx.db.update(nodes).set({ ...(patch.loc !== undefined ? { loc: patch.loc } : {}), ...(patch.model !== undefined ? { model: patch.model.trim() } : {}) }).where(eq(nodes.id, nid)).returning({ id: nodes.id });
    if (!r.length) fail("نود پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "ویرایش نود", nid + (patch.loc ? " → " + patch.loc : ""), ctx.ip);
  }),
  /** removes the node from Gereh's list only; the server in Virtualizor is untouched (the next sync re-adds it if it still exists) */
  "admin.deleteNode": method(z.tuple([id]), async (ctx, [nid]) => {
    needStaff(ctx, "infra");
    const r = await ctx.db.delete(nodes).where(eq(nodes.id, nid)).returning({ id: nodes.id });
    if (!r.length) fail("نود پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "حذف نود", nid, ctx.ip);
  }),

  /** create or edit a datacenter location and the Virtualizor server groups it provisions into */
  "admin.saveLocation": method(z.tuple([z.object({
    id: z.string().max(10), label: z.string().max(40), sub: z.string().max(60), ping: z.number().int().min(0).max(1000), up: z.number().min(0).max(100), speed: z.number().int().min(0).max(100_000),
    metal: z.boolean(), foreign: z.boolean(), active: z.boolean(), groupCloud: z.string().max(60), groupMetal: z.string().max(60), isNew: z.boolean().optional(),
  })]), async (ctx, [l]) => {
    needStaff(ctx, "infra");
    const lid = l.id.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,10}$/.test(lid)) fail("شناسه لوکیشن: ۲ تا ۱۰ حرف کوچک انگلیسی، عدد یا خط تیره (مثل thr یا ist).");
    if (!l.label.trim()) fail("نام لوکیشن لازم است.");
    if (!l.groupCloud.trim()) fail("Server Group ابری در Virtualizor را مشخص کنید.");
    if (l.metal && !l.groupMetal.trim()) fail("برای سرور اختصاصی، Server Group اختصاصی را هم مشخص کنید.");
    const list = await getLocations(ctx.db);
    const at = list.findIndex((x) => x.id === lid);
    if (l.isNew && at >= 0) fail("لوکیشنی با این شناسه وجود دارد.");
    if (!l.isNew && at < 0) fail("لوکیشن پیدا نشد.", 404);
    const { isNew: _n, ...rest } = l;
    const item = { ...rest, id: lid, label: l.label.trim(), sub: l.sub.trim(), groupCloud: l.groupCloud.trim(), groupMetal: l.metal ? l.groupMetal.trim() : "" };
    const next = at >= 0 ? list.map((x, i) => (i === at ? item : x)) : [...list, item];
    if (!next.some((x) => x.active !== false)) fail("دست‌کم یک لوکیشن باید فعال بماند.");
    await saveLocations(ctx.db, next);
    await logAudit(ctx.db, actor(ctx), at >= 0 ? "ویرایش لوکیشن" : "افزودن لوکیشن", lid + " → " + item.groupCloud, ctx.ip);
  }),
  "admin.moveLocation": method(z.tuple([z.string().max(10), z.enum(["up", "down"])]), async (ctx, [lid, dir]) => {
    needStaff(ctx, "infra");
    const list = await getLocations(ctx.db);
    const i = list.findIndex((x) => x.id === lid), j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await saveLocations(ctx.db, list);
  }),
  /** only an empty location can be deleted: move its nodes first; servers living there block it (disable it instead) */
  "admin.deleteLocation": method(z.tuple([z.string().max(10)]), async (ctx, [lid]) => {
    needStaff(ctx, "infra");
    const list = await getLocations(ctx.db);
    if (!list.some((x) => x.id === lid)) fail("لوکیشن پیدا نشد.", 404);
    const [[s], [n]] = await Promise.all([
      ctx.db.select({ n: count() }).from(servers).where(eq(servers.loc, lid)),
      ctx.db.select({ n: count() }).from(nodes).where(eq(nodes.loc, lid)),
    ]);
    if (s.n) fail(s.n.toLocaleString("fa-IR") + " سرور مشتری در این لوکیشن است. به‌جای حذف، آن را غیرفعال کنید تا سفارش جدید نگیرد.");
    if (n.n) fail(n.n.toLocaleString("fa-IR") + " نود در این لوکیشن است. اول نودها را به لوکیشن دیگری منتقل یا حذف کنید.");
    const next = list.filter((x) => x.id !== lid);
    if (!next.some((x) => x.active !== false)) fail("دست‌کم یک لوکیشن باید فعال بماند.");
    await saveLocations(ctx.db, next);
    await logAudit(ctx.db, actor(ctx), "حذف لوکیشن", lid, ctx.ip);
  }),

  "admin.saveCoupon": method(z.tuple([z.object({ id: z.string().max(40).optional(), code: z.string().max(20), type: z.enum(["percent", "fixed"]).optional(), value: money.optional(), limit: z.number().int().min(0).optional(), expires: z.string().max(20).optional(), active: z.boolean().optional() }).passthrough()]), async (ctx, [c]) => {
    needStaff(ctx, "coupons");
    const code = c.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) fail("کد فقط حروف بزرگ انگلیسی و عدد، ۳ تا ۲۰ کاراکتر.");
    if (c.type === "percent" && (c.value ?? 0) > 100) fail("درصد تخفیف حداکثر ۱۰۰ است.");
    let expiresAt: Date | null | undefined;
    if (c.expires !== undefined) {
      const e = c.expires.trim();
      expiresAt = !e || e === "—" ? null : parseJalali(e);
      if (expiresAt === null && e && e !== "—") fail("تاریخ انقضا باید به شکل ۱۴۰۵/۰۱/۳۰ باشد.");
      if (expiresAt) expiresAt = new Date(expiresAt.getTime() + 86400_000 - 1); // valid through the end of that day
    }
    const [dup] = await ctx.db.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.code, code), c.id ? ne(coupons.id, c.id) : undefined));
    if (dup) fail("این کد قبلا تعریف شده است.");
    const row = { code, ...(c.type ? { type: c.type } : {}), ...(c.value !== undefined ? { value: c.value } : {}), ...(c.limit !== undefined ? { limit: c.limit } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}), ...(c.active !== undefined ? { active: c.active } : {}) };
    if (c.id) {
      const r = await ctx.db.update(coupons).set(row).where(eq(coupons.id, c.id)).returning({ id: coupons.id });
      if (!r.length) fail("کد پیدا نشد.", 404);
    } else {
      if (!c.value) fail("مقدار تخفیف را وارد کنید.");
      await ctx.db.insert(coupons).values({ id: rid("cp"), type: "percent", value: 0, limit: 0, active: true, ...row });
    }
    await logAudit(ctx.db, actor(ctx), "ذخیره کد تخفیف", code, ctx.ip);
  }),
  "admin.deleteCoupon": method(z.tuple([id]), async (ctx, [cid]) => {
    needStaff(ctx, "coupons");
    const [c] = await ctx.db.delete(coupons).where(eq(coupons.id, cid)).returning({ code: coupons.code });
    await logAudit(ctx.db, actor(ctx), "حذف کد تخفیف", c?.code || cid, ctx.ip);
  }),

  "admin.saveAnnouncement": method(z.tuple([z.object({ title: z.string().max(120), body: z.string().max(1000), level: z.enum(["info", "warning", "critical"]) })]), async (ctx, [a]) => {
    needStaff(ctx, "announcements");
    if (a.title.trim().length < 3 || a.body.trim().length < 10) fail("عنوان و متن کامل لازم است.");
    await ctx.db.insert(announcements).values({ id: rid("an"), title: a.title.trim(), body: a.body.trim(), level: a.level });
    await logAudit(ctx.db, actor(ctx), "انتشار اطلاعیه", a.title.trim(), ctx.ip);
  }),
  "admin.deleteAnnouncement": method(z.tuple([id]), async (ctx, [aid]) => {
    needStaff(ctx, "announcements");
    await ctx.db.delete(announcements).where(eq(announcements.id, aid));
    await logAudit(ctx.db, actor(ctx), "حذف اطلاعیه", aid, ctx.ip);
  }),

  /** tests the given (or stored) credentials against Virtualizor, then stores them encrypted */
  "admin.virtTest": method(z.tuple([z.object({ host: z.string().max(253), port: z.number().int().min(1).max(65535), key: z.string().max(200), pass: z.string().max(200).optional(), insecure: z.boolean().optional() })]), async (ctx, [cfg]) => {
    needStaff(ctx, "virtualizor");
    const nh = normalizeHost(cfg.host);
    cfg = { ...cfg, host: nh.host, port: nh.port ?? cfg.port };
    if (!cfg.host.trim() || !cfg.key.trim()) fail("آدرس و کلید API لازم است.");
    const cur = await getVirt(ctx.db);
    const pass = cfg.pass || (cur.passEnc ? (await import("../secrets")).open(String(cur.passEnc)) : null);
    if (!pass) fail("رمز Admin API لازم است.");
    let version = "";
    try {
      // outside production the simulator answers unless VIRTUALIZOR_LIVE=1 asks for a real connection test
      version = process.env.NODE_ENV !== "production" && process.env.VIRTUALIZOR_LIVE !== "1"
        ? "Simulator"
        : (await new VirtualizorDriver({ host: cfg.host.trim(), adminPort: cfg.port, key: cfg.key.trim(), pass: pass!, ...(cfg.insecure ? { tlsStrict: false } : {}) }).test()).version;
    } catch (e) {
      await ctx.db.insert(virtLog).values({ id: rid("vl"), kind: "تست اتصال", result: "error", detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      fail("اتصال برقرار نشد: " + (e instanceof Error ? e.message : "خطای ناشناخته"));
    }
    const next = { ...cur, host: cfg.host.trim(), port: cfg.port, key: cfg.key.trim(), passEnc: cfg.pass ? seal(cfg.pass) : cur.passEnc, passSet: true, connected: true, version, insecure: !!cfg.insecure };
    await ctx.db.insert(kv).values({ key: "virt", value: next }).onConflictDoUpdate({ target: kv.key, set: { value: next } });
    await ctx.db.insert(virtLog).values({ id: rid("vl"), kind: "تست اتصال", result: "ok", detail: cfg.host + ":" + cfg.port + " — " + version });
    resetVirt();
    await logAudit(ctx.db, actor(ctx), "اتصال Virtualizor", cfg.host, ctx.ip);
  }),

  "admin.virtSync": method(z.tuple([z.string().max(60)]), async (ctx, [label]) => {
    needStaff(ctx, "virtualizor");
    const v = await virt();
    let detail = "";
    if (/سرور|نود/.test(label)) {
      const list = await v.servers();
      const locs = await getLocations(ctx.db);
      // a node belongs to the location whose cloud/metal server group matches its Virtualizor group
      const locFor = (g: string) => locs.find((l) => l.groupCloud === g || l.groupMetal === g)?.id ?? locs.find((l) => l.id === g.split("-")[0])?.id ?? locs[0]?.id ?? "thr";
      for (const s of list) await ctx.db.insert(nodes).values({ id: s.name, loc: locFor(s.group), model: "", cpu: s.cpu, ram: s.ram, disk: s.disk, vms: s.vms }).onConflictDoUpdate({ target: nodes.id, set: { cpu: s.cpu, ram: s.ram, disk: s.disk, vms: s.vms } });
      const groups = [...new Set(list.map((s) => s.group).filter(Boolean))].sort();
      const cur = await getVirt(ctx.db);
      await ctx.db.insert(kv).values({ key: "virt", value: { ...cur, groups } }).onConflictDoUpdate({ target: kv.key, set: { value: { ...cur, groups } } });
      detail = list.length.toLocaleString("fa-IR") + " سرور";
    } else if (/قالب/.test(label)) {
      const list = await v.osTemplates();
      for (const o of list) await ctx.db.insert(osTemplates).values({ osid: o.osid, name: o.name, distro: o.distro, on: false }).onConflictDoUpdate({ target: osTemplates.osid, set: { name: o.name, distro: o.distro } });
      detail = list.length.toLocaleString("fa-IR") + " قالب (موارد جدید پنهان اضافه شدند)";
    } else if (/پلن/.test(label)) {
      detail = (await v.plans()).length.toLocaleString("fa-IR") + " پلن در Virtualizor";
    } else if (/ترافیک/.test(label)) {
      await enqueue(ctx.db, "usage.collect", {}, { dedupe: "usage.collect" });
      detail = "در صف جمع‌آوری";
    } else {
      await enqueue(ctx.db, "virt.reconcile", {}, { dedupe: "virt.reconcile" });
      detail = "تطبیق VPSها در صف اجرا";
    }
    const cur = await getVirt(ctx.db);
    await ctx.db.insert(kv).values({ key: "virt", value: { ...cur, lastSync: new Date().toISOString() } }).onConflictDoUpdate({ target: kv.key, set: { value: { ...cur, lastSync: new Date().toISOString() } } });
    await ctx.db.insert(virtLog).values({ id: rid("vl"), kind: "همگام‌سازی " + label, result: "ok", detail: detail + " — " + faDateTime(new Date()) });
    await logAudit(ctx.db, actor(ctx), "همگام‌سازی Virtualizor: " + label, "virtualizor", ctx.ip);
  }),

  /** upserts: every cloud/metal plan and "custom" (the configurator) can be mapped, also plans added later */
  "admin.savePlanMap": method(z.tuple([id, z.object({ plid: z.number().int().min(0).optional(), group: z.string().max(40).optional(), virt: z.enum(["", "kvm", "xen", "xenhvm", "openvz", "lxc", "proxk", "proxl", "vzk", "vzo"]).optional() })]), async (ctx, [pid, patch]) => {
    needStaff(ctx, "virtualizor");
    const [p] = pid === "custom" ? [{ data: { name: "پیکربندی سفارشی" } }] : await ctx.db.select().from(plans).where(and(eq(plans.id, pid), sql`${plans.kind} <> 'hosting'`));
    if (!p) fail("پلن پیدا نشد.");
    const name = (p!.data as { name: string }).name;
    await ctx.db.insert(planMap).values({ id: pid, name, plid: patch.plid ?? 0, group: patch.group ?? "", virt: patch.virt ?? "" })
      .onConflictDoUpdate({ target: planMap.id, set: { name, ...patch } });
    await logAudit(ctx.db, actor(ctx), "نگاشت پلن به Virtualizor", pid, ctx.ip);
  }),
  "admin.toggleTemplate": method(z.tuple([z.number().int()]), async (ctx, [osid]) => {
    needStaff(ctx, "virtualizor");
    await ctx.db.update(osTemplates).set({ on: sql`not ${osTemplates.on}` }).where(eq(osTemplates.osid, osid));
    await logAudit(ctx.db, actor(ctx), "تغییر نمایش قالب سیستم‌عامل", String(osid), ctx.ip);
  }),
  "admin.saveVirt": method(z.tuple([z.record(z.string(), z.union([z.string().max(253), z.number(), z.boolean()]))]), async (ctx, [patch]) => {
    needStaff(ctx, "virtualizor");
    const allowed = ["host", "port", "key", "insecure", "autoSync", "bandSuspend", "suspendUnpaid", "terminateUnpaid", "adminManaged"];
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    const cur = await getVirt(ctx.db);
    await ctx.db.insert(kv).values({ key: "virt", value: { ...cur, ...clean } }).onConflictDoUpdate({ target: kv.key, set: { value: { ...cur, ...clean } } });
    resetVirt();
    await logAudit(ctx.db, actor(ctx), "ویرایش تنظیمات Virtualizor", Object.keys(clean).join(","), ctx.ip);
  }),

  "admin.saveSettings": method(z.tuple([z.object({
    siteName: z.string().max(60).optional(), supportEmail: z.string().max(120).optional(), supportPhone: z.string().max(40).optional(),
    registration: z.boolean().optional(), maintenance: z.boolean().optional(), tax: z.number().int().min(0).max(100).optional(),
    gateways: z.record(z.string(), z.boolean()).optional(), smsProvider: z.string().max(40).optional(), smsKey: z.string().max(200).optional(),
    smtpHost: z.string().max(253).optional(), smtpPort: z.number().int().min(1).max(65535).optional(), smsKeySet: z.boolean().optional(),
    affiliateRate: z.number().int().min(0).max(50).optional(),
    legalName: z.string().max(120).optional(), sellerNationalId: z.string().regex(/^(\d{11})?$/).optional(), sellerEconomicCode: z.string().regex(/^(\d{12}|\d{14})?$/).optional(),
    sellerAddress: z.string().max(300).optional(), sellerPostalCode: z.string().regex(/^(\d{10})?$/).optional(),
    paasDomain: z.string().regex(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/).max(100).optional(),
  })]), async (ctx, [patch]) => {
    needStaff(ctx, patch.tax !== undefined || patch.gateways ? "billing" : "settings");
    if (patch.supportEmail !== undefined && !EMAIL_RE.test(patch.supportEmail)) fail("ایمیل پشتیبانی معتبر نیست.");
    if (patch.gateways && !Object.values(patch.gateways).some(Boolean)) fail("حداقل یک روش پرداخت باید فعال باشد.");
    if (patch.paasDomain) {
      // apps run customer code: sharing the site's cookie scope would expose sessions
      const site = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://gereh.net").hostname.replace(/^www\./, "");
      if (patch.paasDomain === site || patch.paasDomain.endsWith("." + site)) fail("دامنه اپ‌ها باید جدا از دامنه سایت باشد (مثلاً gereh.dev).");
    }
    const { smsKey, smsKeySet: _ignored, ...rest } = patch;
    const [row] = await ctx.db.select().from(kv).where(eq(kv.key, "settings"));
    const cur = { ...(await getSettings(ctx.db)), ...((row?.value as object) || {}) } as Record<string, unknown>;
    delete cur.payGateway;
    const next = { ...cur, ...rest, ...(smsKey ? { smsKeyEnc: seal(smsKey), smsKeySet: true } : {}) };
    await ctx.db.insert(kv).values({ key: "settings", value: next }).onConflictDoUpdate({ target: kv.key, set: { value: next } });
    await logAudit(ctx.db, actor(ctx), "ویرایش تنظیمات", Object.keys(patch).join(","), ctx.ip);
  }),

  /** create an incident, or post an update (and optionally resolve) on an existing one */
  "admin.saveIncident": method(z.tuple([z.object({ id: z.string().max(40).optional(), title: z.string().max(160), severity: z.enum(["minor", "major", "critical", "maintenance"]), status: z.enum(["investigating", "identified", "monitoring", "resolved", "scheduled"]), components: z.array(z.string().max(20)).min(1).max(20), text: z.string().max(4000) })]), async (ctx, [i]) => {
    needStaff(ctx, "infra");
    if (i.title.trim().length < 5) fail("عنوان رخداد را کامل بنویسید.");
    if (i.text.trim().length < 5) fail("متن به‌روزرسانی را بنویسید.");
    if (i.components.some((c) => !COMPONENTS.some((x) => x.id === c))) fail("بخش انتخابی نامعتبر است.");
    const id = i.id ?? rid("inc");
    await ctx.db.transaction(async (tx) => {
      if (i.id) {
        const r = await tx.update(incidents).set({ title: i.title.trim(), severity: i.severity, status: i.status, components: i.components, resolvedAt: i.status === "resolved" ? new Date() : null }).where(eq(incidents.id, i.id)).returning({ id: incidents.id });
        if (!r.length) fail("رخداد پیدا نشد.", 404);
      } else {
        await tx.insert(incidents).values({ id, title: i.title.trim(), severity: i.severity, status: i.status, components: i.components, resolvedAt: i.status === "resolved" ? new Date() : null });
      }
      await tx.insert(incidentUpdates).values({ incidentId: id, status: i.status, text: i.text.trim() });
    });
    await logAudit(ctx.db, actor(ctx), i.id ? "به‌روزرسانی رخداد" : "ثبت رخداد", id, ctx.ip);
  }),
  "admin.deleteIncident": method(z.tuple([id]), async (ctx, [iid]) => {
    needStaff(ctx, "infra");
    await ctx.db.delete(incidents).where(eq(incidents.id, iid));
    await logAudit(ctx.db, actor(ctx), "حذف رخداد", iid, ctx.ip);
  }),

  "admin.addStaff": method(z.tuple([z.object({ name: z.string().max(80), email: z.string().max(120), role: z.string().max(40) })]), async (ctx, [s]) => {
    needStaff(ctx, "staff");
    const email = s.email.trim().toLowerCase();
    if (s.name.trim().length < 2) fail("نام و ایمیل لازم است.");
    if (!EMAIL_RE.test(email)) fail("ایمیل معتبر نیست.");
    const role = STAFF_ROLE_BY_LABEL[s.role] as "owner" | "support" | "finance" | "sales" | "viewer" | undefined;
    if (!role) fail("نقش نامعتبر است.");
    const [ex] = await ctx.db.select().from(users).where(eq(sql`lower(${users.email})`, email));
    if (ex) {
      await ctx.db.update(users).set({ role: "admin", staffRole: role }).where(eq(users.id, ex.id));
    } else {
      const pass = genPassword();
      await ctx.db.insert(users).values({ id: rid("st"), name: s.name.trim(), email, role: "admin", staffRole: role, passwordHash: await hashPassword(pass), kyc: "verified", referralCode: refCode() });
      await sendEmail(email, "دسترسی مدیریت گره", "سلام " + s.name.trim() + "،\nبرای شما دسترسی «" + s.role + "» در پنل مدیریت گره ساخته شد.\nرمز موقت: " + pass + "\nپس از ورود رمز را تغییر دهید.");
    }
    await logAudit(ctx.db, actor(ctx), "افزودن مدیر (" + s.role + ")", email, ctx.ip);
  }),
  "admin.removeStaff": method(z.tuple([id]), async (ctx, [sid]) => {
    const a = needStaff(ctx, "staff");
    if (sid === a.user.id) fail("نمی‌توانید دسترسی خودتان را حذف کنید.");
    const [target] = await ctx.db.select().from(users).where(and(eq(users.id, sid), eq(users.role, "admin")));
    if (!target) fail("مدیر پیدا نشد.", 404);
    if (target!.staffRole === "owner") {
      const [{ n }] = await ctx.db.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.staffRole, "owner")));
      if (n <= 1) fail("حداقل یک مدیر کل باید باقی بماند.");
    }
    await ctx.db.update(users).set({ role: "user", staffRole: null }).where(eq(users.id, sid));
    const { sessions } = await import("../db/schema");
    await ctx.db.delete(sessions).where(eq(sessions.userId, sid));
    await logAudit(ctx.db, actor(ctx), "حذف مدیر", target!.email, ctx.ip);
  }),
};
