/* Account billing tools (project wallets and transfers, low-credit threshold, budgets, invoice
   profiles), account security and notification extras (recovery codes, Web Push), custom team
   roles with server transfer, and the staff side (levels, add-on prices, negative-balance grace). */
import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { toEnDigits } from "@/lib/format";
import { faDate, faDateTime } from "@/lib/jalali";
import { PERM_LEVELS, TEAM_SERVICES, type AccountExtrasView, type BillingExtrasView, type TeamRoleView } from "@/lib/vps-billing";
import { baseRole, newRecoveryCodes, pushEndpointOk, vapidPublic } from "../account-extras";
import { BUDGET_SERVICES, billingPolicy, creditForecast, LEVELS, monthSpend, POLICY_DEFAULTS, saveDoc, VPS_PRICE_DEFAULTS, vpsPrices } from "../billing-extras";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import {
  accountMeta, budgets, fwGroupServers, invoiceProfiles, invoices, pushSubscriptions, recoveryCodes, servers, subWallets, teamMemberRoles, teamMembers, teamRoles, users, vpsDisks, vpsIps, walletLinks, walletTransfers,
} from "../db/schema";
import { addTask, fail, logActivity, logAudit, notify, rid } from "../util";
import { validNationalCode } from "./billing";

const id = z.string().max(40);
const money = z.number().int().min(0).max(10_000_000_000);
/** only the account owner (not a team member working in it) */
const owner = (ctx: Ctx) => { const a = needUser(ctx); if (a.uid !== a.user.id) fail("فقط صاحب حساب می‌تواند این کار را انجام دهد.", 403); return a; };
const en = (s: string) => toEnDigits(s).replace(/\D/g, "");
const levelView = (lv: keyof typeof LEVELS) => ({ id: lv, label: LEVELS[lv].label, sla: LEVELS[lv].sla, support: LEVELS[lv].support });

async function ownWallet(ctx: Ctx, wid: string) {
  const a = needUser(ctx);
  const [w] = await ctx.db.select().from(subWallets).where(and(eq(subWallets.id, wid), eq(subWallets.userId, a.uid)));
  if (!w) fail("کیف پول پروژه پیدا نشد.", 404);
  return w!;
}

const profileSchema = z.object({ id: id.optional(), label: z.string().trim().max(40), name: z.string().trim().max(120), nationalId: z.string().max(20), economicCode: z.string().max(20), address: z.string().trim().max(300), postalCode: z.string().max(20), isDefault: z.boolean() });
/** same rules as an official invoice (billing.setOfficial) */
function checkProfile(p: z.infer<typeof profileSchema>) {
  const info = { label: p.label || p.name, name: p.name, nationalId: en(p.nationalId), economicCode: en(p.economicCode), address: p.address, postalCode: en(p.postalCode) };
  if (info.name.length < 2) fail("نام شخص یا شرکت را وارد کنید.");
  if (!/^\d{10}$|^\d{11}$/.test(info.nationalId)) fail("کد ملی ۱۰ رقم یا شناسه ملی شرکت ۱۱ رقم است.");
  if (info.nationalId.length === 10 && !validNationalCode(info.nationalId)) fail("کد ملی معتبر نیست.");
  if (info.economicCode && !/^\d{12}$|^\d{14}$/.test(info.economicCode)) fail("کد اقتصادی ۱۲ یا ۱۴ رقم است.");
  if (!/^\d{10}$/.test(info.postalCode)) fail("کد پستی ۱۰ رقم است.");
  if (info.address.length < 10) fail("نشانی کامل را وارد کنید.");
  return info;
}

export const walletRpc = {
  /* ---------- billing (owner and billing members) ---------- */
  "billing.extras": method(z.tuple([]), async (ctx): Promise<BillingExtrasView> => {
    const a = needUser(ctx);
    const [f, policy, wallets, links, transfers, profiles, caps] = await Promise.all([
      creditForecast(ctx.db, a.uid), billingPolicy(ctx.db),
      ctx.db.select().from(subWallets).where(eq(subWallets.userId, a.uid)).orderBy(subWallets.createdAt),
      ctx.db.select({ walletId: walletLinks.walletId, id: servers.id, name: servers.name }).from(walletLinks).innerJoin(servers, eq(servers.id, walletLinks.serverId)).where(eq(servers.userId, a.uid)),
      ctx.db.select().from(walletTransfers).where(eq(walletTransfers.userId, a.uid)).orderBy(desc(walletTransfers.createdAt)).limit(30),
      ctx.db.select().from(invoiceProfiles).where(eq(invoiceProfiles.userId, a.uid)).orderBy(invoiceProfiles.createdAt),
      ctx.db.select().from(budgets).where(eq(budgets.userId, a.uid)),
    ]);
    const wname = (wid: string) => (wid ? wallets.find((w) => w.id === wid)?.name ?? "کیف پول حذف‌شده" : "کیف پول اصلی");
    return {
      balance: f.balance,
      forecast: { burn: f.burn, days: f.days === null ? null : Math.floor(f.days), until: f.until ? faDate(f.until) : "", threshold: f.threshold, auto: f.auto, manual: f.manual },
      policy: { negativeGrace: policy.negativeGrace },
      level: levelView(f.level),
      wallets: wallets.map((w) => ({ id: w.id, name: w.name, balance: w.balance, servers: links.filter((l) => l.walletId === w.id).map((l) => ({ id: l.id, name: l.name })) })),
      transfers: transfers.map((t) => ({ id: t.id, from: wname(t.fromWallet), to: wname(t.toWallet), amount: t.amount, note: t.note, at: faDateTime(t.createdAt) })),
      profiles: profiles.map((p) => ({ id: p.id, label: p.label, name: p.name, nationalId: p.nationalId, economicCode: p.economicCode, address: p.address, postalCode: p.postalCode, isDefault: p.isDefault })),
      budgets: await Promise.all(caps.map(async (b) => ({ service: b.service, label: BUDGET_SERVICES[b.service]?.label ?? b.service, monthlyCap: b.monthlyCap, alertPct: b.alertPct, block: b.block, spent: await monthSpend(ctx.db, a.uid, b.service) }))),
      services: Object.entries(BUDGET_SERVICES).map(([k, v]) => ({ id: k, label: v.label })),
    };
  }),

  "billing.createWallet": method(z.tuple([z.string().trim().max(40)]), async (ctx, [name]) => {
    const a = needUser(ctx);
    if (name.length < 2) fail("نام پروژه را بنویسید.");
    const [{ n }] = await ctx.db.select({ n: count() }).from(subWallets).where(eq(subWallets.userId, a.uid));
    if (n >= 10) fail("حداکثر ۱۰ کیف پول پروژه.");
    const wid = rid("wal");
    await ctx.db.insert(subWallets).values({ id: wid, userId: a.uid, name });
    await logActivity(ctx.db, a.uid, "wallet", "ساخت کیف پول پروژه " + name, ctx.ip);
    return wid;
  }),

  /** the remaining balance returns to the main wallet */
  "billing.deleteWallet": method(z.tuple([id]), async (ctx, [wid]) => {
    const w = await ownWallet(ctx, wid);
    await ctx.db.transaction(async (tx) => {
      const [gone] = await tx.delete(subWallets).where(eq(subWallets.id, w.id)).returning({ balance: subWallets.balance });
      if (gone && gone.balance > 0) {
        await tx.update(users).set({ balance: sql`${users.balance} + ${gone.balance}` }).where(eq(users.id, w.userId));
        await tx.insert(walletTransfers).values({ id: rid("wt"), userId: w.userId, fromWallet: w.id, toWallet: "", amount: gone.balance, note: "بستن کیف پول " + w.name });
      }
    });
    await logActivity(ctx.db, w.userId, "wallet", "بستن کیف پول پروژه " + w.name, ctx.ip);
  }),

  /** moves money between the main wallet ("") and project wallets */
  "billing.transfer": method(z.tuple([z.string().max(40), z.string().max(40), z.number().int().min(1000).max(10_000_000_000), z.string().trim().max(100).default("")]), async (ctx, [from, to, amount, note]) => {
    const a = needUser(ctx);
    if (from === to) fail("مبدأ و مقصد یکی است.");
    if (from) await ownWallet(ctx, from);
    if (to) await ownWallet(ctx, to);
    await ctx.db.transaction(async (tx) => {
      const out = from
        ? await tx.update(subWallets).set({ balance: sql`${subWallets.balance} - ${amount}` }).where(and(eq(subWallets.id, from), eq(subWallets.userId, a.uid), sql`${subWallets.balance} >= ${amount}`)).returning({ id: subWallets.id })
        : await tx.update(users).set({ balance: sql`${users.balance} - ${amount}` }).where(and(eq(users.id, a.uid), sql`${users.balance} >= ${amount}`)).returning({ id: users.id });
      if (!out.length) fail("موجودی مبدأ کافی نیست.");
      if (to) await tx.update(subWallets).set({ balance: sql`${subWallets.balance} + ${amount}` }).where(and(eq(subWallets.id, to), eq(subWallets.userId, a.uid)));
      else await tx.update(users).set({ balance: sql`${users.balance} + ${amount}` }).where(eq(users.id, a.uid));
      await tx.insert(walletTransfers).values({ id: rid("wt"), userId: a.uid, fromWallet: from, toWallet: to, amount, note });
    });
    await logActivity(ctx.db, a.uid, "wallet", "انتقال " + amount.toLocaleString("fa-IR") + " تومان بین کیف پول‌ها", ctx.ip);
  }),

  /** project wallet that pays a server's hourly costs first (null = main wallet) */
  "billing.linkServer": method(z.tuple([id, id.nullable()]), async (ctx, [sid, wid]) => {
    const a = needUser(ctx);
    const [s] = await ctx.db.select({ id: servers.id }).from(servers).where(and(eq(servers.id, sid), eq(servers.userId, a.uid)));
    if (!s) fail("سرور پیدا نشد.", 404);
    if (!wid) { await ctx.db.delete(walletLinks).where(eq(walletLinks.serverId, sid)); return; }
    await ownWallet(ctx, wid);
    await ctx.db.insert(walletLinks).values({ serverId: sid, walletId: wid }).onConflictDoUpdate({ target: walletLinks.serverId, set: { walletId: wid } });
  }),

  "billing.setLowCredit": method(z.tuple([z.object({ auto: z.boolean(), amount: money })]), async (ctx, [l]) => {
    const a = needUser(ctx);
    await ctx.db.insert(accountMeta).values({ userId: a.uid, lowCreditAuto: l.auto, lowCredit: l.amount }).onConflictDoUpdate({ target: accountMeta.userId, set: { lowCreditAuto: l.auto, lowCredit: l.amount, lowCreditAlertedAt: null, updatedAt: new Date() } });
  }),

  "billing.setBudget": method(z.tuple([z.object({ service: z.string().max(20), monthlyCap: z.number().int().min(10_000).max(10_000_000_000), alertPct: z.number().int().min(10).max(99), block: z.boolean() })]), async (ctx, [b]) => {
    const a = needUser(ctx);
    if (!(b.service in BUDGET_SERVICES)) fail("سرویس نامعتبر است.");
    await ctx.db.insert(budgets).values({ id: rid("bud"), userId: a.uid, ...b }).onConflictDoUpdate({ target: [budgets.userId, budgets.service], set: { monthlyCap: b.monthlyCap, alertPct: b.alertPct, block: b.block, alertedLevel: 0, alertedMonth: "" } });
  }),
  "billing.removeBudget": method(z.tuple([z.string().max(20)]), async (ctx, [service]) => {
    const a = needUser(ctx);
    await ctx.db.delete(budgets).where(and(eq(budgets.userId, a.uid), eq(budgets.service, service)));
  }),

  "billing.saveProfile": method(z.tuple([profileSchema]), async (ctx, [p]) => {
    const a = needUser(ctx);
    const info = checkProfile(p);
    if (p.isDefault) await ctx.db.update(invoiceProfiles).set({ isDefault: false }).where(eq(invoiceProfiles.userId, a.uid));
    if (p.id) {
      const r = await ctx.db.update(invoiceProfiles).set({ ...info, isDefault: p.isDefault }).where(and(eq(invoiceProfiles.id, p.id), eq(invoiceProfiles.userId, a.uid))).returning({ id: invoiceProfiles.id });
      if (!r.length) fail("پروفایل پیدا نشد.", 404);
      return p.id;
    }
    const [{ n }] = await ctx.db.select({ n: count() }).from(invoiceProfiles).where(eq(invoiceProfiles.userId, a.uid));
    if (n >= 10) fail("حداکثر ۱۰ پروفایل صورتحساب.");
    const pid = rid("ip");
    await ctx.db.insert(invoiceProfiles).values({ id: pid, userId: a.uid, ...info, isDefault: p.isDefault || n === 0 });
    return pid;
  }),
  "billing.deleteProfile": method(z.tuple([id]), async (ctx, [pid]) => {
    const a = needUser(ctx);
    await ctx.db.delete(invoiceProfiles).where(and(eq(invoiceProfiles.id, pid), eq(invoiceProfiles.userId, a.uid)));
  }),
  /** stamps an invoice with one saved buyer identity (official invoice) */
  "billing.useProfile": method(z.tuple([id, id]), async (ctx, [invId, pid]) => {
    const a = needUser(ctx);
    const [p] = await ctx.db.select().from(invoiceProfiles).where(and(eq(invoiceProfiles.id, pid), eq(invoiceProfiles.userId, a.uid)));
    if (!p) fail("پروفایل پیدا نشد.", 404);
    const r = await ctx.db.update(invoices).set({ official: { name: p!.name, nationalId: p!.nationalId, economicCode: p!.economicCode, address: p!.address, postalCode: p!.postalCode } }).where(and(eq(invoices.id, invId), eq(invoices.userId, a.uid))).returning({ id: invoices.id });
    if (!r.length) fail("صورتحساب پیدا نشد.", 404);
  }),

  /* ---------- staff ---------- */
  "billing.adminSetLevel": method(z.tuple([id, z.enum(["developer", "startup", "enterprise"])]), async (ctx, [uid, level]) => {
    needStaff(ctx, "users");
    const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, uid));
    if (!u) fail("کاربر پیدا نشد.", 404);
    await ctx.db.insert(accountMeta).values({ userId: uid, level }).onConflictDoUpdate({ target: accountMeta.userId, set: { level, updatedAt: new Date() } });
    await notify(ctx.db, uid, "badge-check", "سطح حساب شما به «" + LEVELS[level].label + "» تغییر کرد");
    await logAudit(ctx.db, actor(ctx), "تغییر سطح حساب به " + level, uid, ctx.ip);
  }),
  "billing.adminLevels": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "users");
    const rows = await ctx.db.select({ userId: accountMeta.userId, level: accountMeta.level }).from(accountMeta);
    return Object.fromEntries(rows.map((r) => [r.userId, r.level])) as Record<string, keyof typeof LEVELS>;
  }),
  "billing.adminPrices": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "products");
    return { prices: await vpsPrices(ctx.db), policy: await billingPolicy(ctx.db) };
  }),
  "billing.adminSavePrices": method(z.tuple([z.object({ ip: money, diskGb: money, snapshotGb: money, packGb: z.number().int().min(10).max(100_000), packPrice: money, maxIps: z.number().int().min(0).max(64), maxDisks: z.number().int().min(0).max(16), maxDiskGb: z.number().int().min(10).max(100_000) })]), async (ctx, [p]) => {
    needStaff(ctx, "products");
    await saveDoc(ctx.db, "vps_prices", { ...VPS_PRICE_DEFAULTS, ...p });
    await logAudit(ctx.db, actor(ctx), "تغییر قیمت افزونه‌های سرور", JSON.stringify(p), ctx.ip);
  }),
  "billing.adminSavePolicy": method(z.tuple([z.object({ negativeGrace: z.number().int().min(0).max(1_000_000_000) })]), async (ctx, [p]) => {
    needStaff(ctx, "billing");
    await saveDoc(ctx.db, "billing_policy", { ...POLICY_DEFAULTS, ...p });
    await logAudit(ctx.db, actor(ctx), "تغییر سقف بدهی مجاز کیف پول", p.negativeGrace.toLocaleString("fa-IR") + " تومان", ctx.ip);
  }),

  /* ---------- account (owner only) ---------- */
  "account.extras": method(z.tuple([]), async (ctx): Promise<AccountExtrasView> => {
    const a = needUser(ctx);
    const [[left], push, f] = await Promise.all([
      ctx.db.select({ n: count() }).from(recoveryCodes).where(and(eq(recoveryCodes.userId, a.user.id), isNull(recoveryCodes.usedAt))),
      ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, a.user.id)),
      creditForecast(ctx.db, a.uid),
    ]);
    return { twofa: !!a.user.twofaSecret, recoveryLeft: left.n, pushKey: vapidPublic(), pushDevices: push.map((p) => ({ id: p.id, device: p.device || "مرورگر", at: faDate(p.createdAt) })), level: levelView(f.level) };
  }),
  "account.recoveryCodes": method(z.tuple([]), async (ctx) => {
    const a = owner(ctx);
    if (!a.user.twofaSecret) fail("ابتدا ورود دومرحله‌ای را فعال کنید.");
    const codes = await newRecoveryCodes(ctx.db, a.user.id);
    await logActivity(ctx.db, a.user.id, "shield-check", "ساخت کدهای بازیابی ورود دومرحله‌ای", ctx.ip);
    return codes;
  }),
  "account.pushSubscribe": method(z.tuple([z.object({ endpoint: z.string().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })]), async (ctx, [s]) => {
    const a = owner(ctx);
    if (!pushEndpointOk(s.endpoint)) fail("سرویس اعلان مرورگر پشتیبانی نمی‌شود.");
    if (!/^[A-Za-z0-9_-]+$/.test(s.keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(s.keys.auth)) fail("کلید اشتراک نامعتبر است.");
    const [{ n }] = await ctx.db.select({ n: count() }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, a.user.id));
    if (n >= 10) fail("حداکثر ۱۰ مرورگر.");
    await ctx.db.insert(pushSubscriptions).values({ id: rid("push"), userId: a.user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, device: ctx.device })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: a.user.id, p256dh: s.keys.p256dh, auth: s.keys.auth, device: ctx.device } });
  }),
  "account.pushRemove": method(z.tuple([id]), async (ctx, [pid]) => {
    const a = owner(ctx);
    await ctx.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, pid), eq(pushSubscriptions.userId, a.user.id)));
  }),

  /* ---------- team: custom roles and transfers (owner only) ---------- */
  "team.roles": method(z.tuple([]), async (ctx): Promise<TeamRoleView[]> => {
    const a = owner(ctx);
    const [roles, assigned] = await Promise.all([
      ctx.db.select().from(teamRoles).where(eq(teamRoles.ownerId, a.uid)).orderBy(teamRoles.createdAt),
      ctx.db.select({ roleId: teamMemberRoles.roleId, memberId: teamMembers.memberId }).from(teamMemberRoles).innerJoin(teamMembers, eq(teamMembers.id, teamMemberRoles.memberRowId)).where(eq(teamMembers.ownerId, a.uid)),
    ]);
    return roles.map((r) => ({ id: r.id, name: r.name, perms: r.perms, members: assigned.filter((x) => x.roleId === r.id).map((x) => x.memberId) }));
  }),
  "team.saveRole": method(z.tuple([z.object({ id: id.optional(), name: z.string().trim().max(40), perms: z.record(z.string().max(20), z.enum(PERM_LEVELS)) })]), async (ctx, [r]) => {
    const a = owner(ctx);
    if (r.name.length < 2) fail("نام نقش را بنویسید.");
    const perms = Object.fromEntries(Object.entries(r.perms).filter(([k, v]) => k in TEAM_SERVICES && v !== "none"));
    if (!Object.keys(perms).length) fail("دست‌کم برای یک سرویس دسترسی تعیین کنید.");
    if (r.id) {
      const res = await ctx.db.update(teamRoles).set({ name: r.name, perms }).where(and(eq(teamRoles.id, r.id), eq(teamRoles.ownerId, a.uid))).returning({ id: teamRoles.id });
      if (!res.length) fail("نقش پیدا نشد.", 404);
      // members keep a base role wide enough for the new levels
      const rows = await ctx.db.select({ rowId: teamMemberRoles.memberRowId }).from(teamMemberRoles).where(eq(teamMemberRoles.roleId, r.id));
      if (rows.length) await ctx.db.update(teamMembers).set({ role: baseRole(perms) }).where(inArray(teamMembers.id, rows.map((x) => x.rowId)));
      return r.id;
    }
    const [{ n }] = await ctx.db.select({ n: count() }).from(teamRoles).where(eq(teamRoles.ownerId, a.uid));
    if (n >= 20) fail("حداکثر ۲۰ نقش سفارشی.");
    const rid2 = rid("role");
    await ctx.db.insert(teamRoles).values({ id: rid2, ownerId: a.uid, name: r.name, perms });
    return rid2;
  }),
  "team.deleteRole": method(z.tuple([id]), async (ctx, [roleId]) => {
    const a = owner(ctx);
    await ctx.db.delete(teamRoles).where(and(eq(teamRoles.id, roleId), eq(teamRoles.ownerId, a.uid)));
  }),
  /** a custom role for a member (null = back to the plain fixed role) */
  "team.assignRole": method(z.tuple([id, id.nullable()]), async (ctx, [memberId, roleId]) => {
    const a = owner(ctx);
    const [m] = await ctx.db.select().from(teamMembers).where(and(eq(teamMembers.ownerId, a.uid), eq(teamMembers.memberId, memberId)));
    if (!m) fail("عضو پیدا نشد.", 404);
    if (!roleId) { await ctx.db.delete(teamMemberRoles).where(eq(teamMemberRoles.memberRowId, m!.id)); return; }
    const [r] = await ctx.db.select().from(teamRoles).where(and(eq(teamRoles.id, roleId), eq(teamRoles.ownerId, a.uid)));
    if (!r) fail("نقش پیدا نشد.", 404);
    await ctx.db.insert(teamMemberRoles).values({ memberRowId: m!.id, roleId }).onConflictDoUpdate({ target: teamMemberRoles.memberRowId, set: { roleId } });
    await ctx.db.update(teamMembers).set({ role: baseRole(r!.perms) }).where(eq(teamMembers.id, m!.id));
  }),
  /** hands servers (with their IPs and disks) to a team member's own account; requires typing the member's email */
  "team.transferServers": method(z.tuple([z.array(id).min(1).max(50), id, z.string().max(120)]), async (ctx, [ids, memberId, confirm]) => {
    const a = owner(ctx);
    const [m] = await ctx.db.select({ email: users.email, name: users.name }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.memberId)).where(and(eq(teamMembers.ownerId, a.uid), eq(teamMembers.memberId, memberId)));
    if (!m) fail("فقط به اعضای تیم می‌توان سرویس منتقل کرد.", 404);
    if (confirm.trim().toLowerCase() !== m!.email.toLowerCase()) fail("برای تأیید، ایمیل عضو مقصد را بنویسید.");
    const list = await ctx.db.select().from(servers).where(and(eq(servers.userId, a.uid), inArray(servers.id, ids)));
    if (list.length !== new Set(ids).size) fail("برخی سرورها پیدا نشد.", 404);
    if (list.some((s) => s.status === "suspended")) fail("سرور معلق را نمی‌توان منتقل کرد؛ ابتدا بدهی را تسویه کنید.");
    const sids = list.map((s) => s.id);
    await ctx.db.transaction(async (tx) => {
      await tx.update(servers).set({ userId: memberId }).where(inArray(servers.id, sids));
      await tx.update(vpsIps).set({ userId: memberId }).where(inArray(vpsIps.serverId, sids));
      await tx.update(vpsDisks).set({ userId: memberId }).where(inArray(vpsDisks.serverId, sids));
      await tx.delete(walletLinks).where(inArray(walletLinks.serverId, sids));
      await tx.delete(fwGroupServers).where(inArray(fwGroupServers.serverId, sids));
    });
    for (const s of list) await addTask(ctx.db, s.id, "انتقال مالکیت به " + m!.name);
    await logActivity(ctx.db, a.uid, "users-round", "انتقال " + list.length.toLocaleString("fa-IR") + " سرور به " + m!.name, ctx.ip);
    await notify(ctx.db, memberId, "server", a.user.name + " مالکیت " + list.map((s) => s.name).join("، ") + " را به حساب شما منتقل کرد");
    await logAudit(ctx.db, a.user.name, "انتقال مالکیت سرور", sids.join(",") + " → " + memberId, ctx.ip);
  }),
};
