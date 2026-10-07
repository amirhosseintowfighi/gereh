import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { priceSku, type CatalogView, type Plan, type Sku } from "@/lib/catalog";
import { couponDiscount, invGross } from "@/lib/money";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import type { DB, Tx } from "../db/client";
import { coupons, invoiceItems, invoices, payments, plans, tlds, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { gatewayById, gatewaysFor } from "../pay/gateways";
import { getSettings } from "../state";
import { AppError, fail, logActivity, logAudit, nextId, notify, rid } from "../util";
import { fulfil, type FulfilItem } from "./fulfil";

export async function catalog(db: DB | Tx): Promise<CatalogView> {
  const [ps, ts] = await Promise.all([db.select().from(plans), db.select().from(tlds)]);
  const out: CatalogView = { plans: { cloud: [], metal: [], hosting: [] }, tlds: ts.map((x) => ({ tld: x.tld, reg: x.reg, renew: x.renew, transfer: x.transfer, cat: x.cat, hot: x.hot, promo: x.promo })) };
  for (const p of ps.sort((a, b) => a.position - b.position)) out.plans[p.kind].push(p.data as Plan);
  return out;
}

/** issues an invoice; `fulfil` says what to activate or extend once it is paid */
export async function createInvoice(db: DB | Tx, userId: string, items: { desc: string; amount: number }[], opts: { dueDays?: number; fulfil?: FulfilItem[]; coupon?: string | null } = {}) {
  const id = await nextId(db, "INV", 14200);
  const tax = (await getSettings(db as DB)).tax;
  await db.insert(invoices).values({ id, userId, status: "unpaid", taxRate: tax, fulfil: opts.fulfil ?? [], coupon: opts.coupon ?? null, dueAt: new Date(Date.now() + (opts.dueDays ?? 7) * 86400_000) });
  if (items.length) await db.insert(invoiceItems).values(items.map((i) => ({ invoiceId: id, desc: i.desc, amount: i.amount })));
  await notify(db, userId, "file-search", "صورتحساب " + id + " صادر شد");
  return id;
}

export async function loadInvoice(db: DB | Tx, id: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) return null;
  const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
  return { ...inv, items, gross: invGross({ items, tax: inv.taxRate }) };
}

/** marks paid, records the payment, then activates/extends what the invoice was for (same transaction) */
export async function settleInvoice(tx: Tx, invoiceId: string, method: string, opts: { wallet?: boolean } = {}) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
  if (!inv) fail("صورتحساب پیدا نشد.", 404);
  if (inv!.status === "paid" || inv!.status === "refunded") fail("این صورتحساب قبلا پرداخت شده است.");
  const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  const gross = invGross({ items, tax: inv!.taxRate });
  if (opts.wallet) {
    const [u] = await tx.update(users).set({ balance: sql`${users.balance} - ${gross}` }).where(and(eq(users.id, inv!.userId), sql`${users.balance} >= ${gross}`)).returning({ id: users.id });
    if (!u) fail("موجودی کیف پول کافی نیست. ابتدا کیف پول را شارژ کنید.");
  }
  await tx.update(invoices).set({ status: "paid", paidAt: new Date() }).where(eq(invoices.id, invoiceId));
  await tx.insert(transactions).values({ id: rid("TX"), userId: inv!.userId, type: "payment", amount: -gross, method, desc: "پرداخت " + invoiceId });
  await logActivity(tx, inv!.userId, "circle-check", "پرداخت صورتحساب " + invoiceId);
  await fulfil(tx, inv!.userId, invoiceId, (inv!.fulfil || []) as FulfilItem[]);
  await payCommission(tx, inv!.userId, invoiceId, items.reduce((s, i) => s + i.amount, 0));
  await enqueue(tx, "notify.send", { userId: inv!.userId, kind: "billing", subject: "پرداخت " + invoiceId, text: "پرداخت صورتحساب " + invoiceId + " به مبلغ " + gross.toLocaleString("fa-IR") + " تومان ثبت شد." });
}

/** referral programme: the referrer earns affiliateRate % of the net invoice during the customer's first year */
async function payCommission(tx: Tx, userId: string, invoiceId: string, net: number) {
  const [u] = await tx.select({ referredBy: users.referredBy, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  if (!u?.referredBy || Date.now() - u.createdAt.getTime() > 365 * 86400_000) return;
  const rate = (await getSettings(tx as unknown as DB)).affiliateRate ?? 0;
  const amount = Math.floor((net * rate) / 100 / 1000) * 1000;
  if (amount <= 0) return;
  await tx.update(users).set({ balance: sql`${users.balance} + ${amount}` }).where(eq(users.id, u.referredBy));
  await tx.insert(transactions).values({ id: rid("TX"), userId: u.referredBy, type: "commission", amount, method: "کیف پول", desc: "پورسانت معرفی (" + invoiceId + ")" });
  await notify(tx, u.referredBy, "gift", "پورسانت معرفی " + amount.toLocaleString("fa-IR") + " تومان به کیف پول شما اضافه شد");
}

const amount = z.number().int().safe();
const skuSchema: z.ZodType<Sku> = z.discriminatedUnion("t", [
  z.object({ t: z.literal("plan"), kind: z.enum(["cloud", "metal"]), plan: z.string().max(20), loc: z.string().max(10), cycle: z.enum(["m", "q", "y"]), os: z.string().max(20).optional(), app: z.string().max(30).optional(), hourly: z.boolean().optional() }),
  z.object({ t: z.literal("custom"), cpu: z.number().int(), ram: z.number().int(), disk: z.number().int(), loc: z.string().max(10), os: z.string().max(20), ips: z.number().int(), backup: z.boolean(), app: z.string().max(30).optional(), hourly: z.boolean().optional() }),
  z.object({ t: z.literal("hosting"), plan: z.string().max(20), yearly: z.boolean(), domain: z.string().max(253).optional() }),
  z.object({ t: z.literal("domain"), name: z.string().max(253), years: z.number().int() }),
  z.object({ t: z.literal("ip"), serverId: z.string().max(40), serverName: z.string().max(60) }),
]);

async function couponRule(db: DB | Tx, raw: string, lock = false) {
  const code = raw.trim().toUpperCase();
  const q = db.select().from(coupons).where(eq(coupons.code, code));
  const [c] = lock ? await q.for("update") : await q;
  if (!c || !c.active) fail("کد تخفیف معتبر نیست.");
  if (c!.limit && c!.used >= c!.limit) fail("ظرفیت این کد تخفیف تمام شده است.");
  if (c!.expiresAt && c!.expiresAt < new Date()) fail("این کد تخفیف منقضی شده است.");
  return c!;
}

async function startPayment(ctx: Ctx, userId: string, amountToman: number, invoiceId: string | null, description: string, origin: string) {
  const settings = await getSettings(ctx.db);
  const gw = gatewaysFor(settings)[0];
  if (!gw) fail("درگاه پرداخت آنلاین موقتا غیرفعال است.");
  const [u] = await ctx.db.select({ phone: users.phone, email: users.email }).from(users).where(eq(users.id, userId));
  const pid = rid("pay");
  await ctx.db.insert(payments).values({ id: pid, userId, invoiceId, amount: amountToman, gateway: gw!.id });
  try {
    const r = await gw!.start({ paymentId: pid, amount: amountToman, callback: origin + "/api/pay/callback/" + gw!.id, description, mobile: u?.phone || undefined, email: u?.email });
    await ctx.db.update(payments).set({ authority: r.authority }).where(eq(payments.id, pid));
    return { redirect: r.redirect };
  } catch (e) {
    await ctx.db.update(payments).set({ status: "failed" }).where(eq(payments.id, pid));
    console.error("[pay] start failed", e);
    throw new AppError("اتصال به درگاه پرداخت برقرار نشد؛ چند دقیقه دیگر دوباره تلاش کنید.", 502);
  }
}

/** gateway callback → verify → settle; idempotent on repeated callbacks */
export async function completePayment(db: DB, gatewayId: string, authority: string, params: URLSearchParams): Promise<{ ok: boolean; invoiceId: string | null; message: string }> {
  const gw = gatewayById(gatewayId);
  const [p] = await db.select().from(payments).where(and(eq(payments.gateway, gatewayId), eq(payments.authority, authority)));
  if (!gw || !p) return { ok: false, invoiceId: null, message: "تراکنش پیدا نشد." };
  if (p.status === "paid") return { ok: true, invoiceId: p.invoiceId, message: "پرداخت قبلا ثبت شده است." };
  if (p.status === "failed") return { ok: false, invoiceId: p.invoiceId, message: "این تراکنش ناموفق بوده است." };
  const v = await gw.verify(authority, p.amount, params);
  if (!v.ok) {
    await db.update(payments).set({ status: "failed", verifiedAt: new Date() }).where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
    return { ok: false, invoiceId: p.invoiceId, message: v.reason };
  }
  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(payments).set({ status: "paid", refId: v.refId, verifiedAt: new Date() }).where(and(eq(payments.id, p.id), eq(payments.status, "pending"))).returning();
    if (!claimed) return; // a concurrent callback already settled it
    if (p.invoiceId) {
      const [inv] = await tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, p.invoiceId));
      if (inv?.status === "paid") {
        // invoice was paid another way meanwhile → keep the money as wallet credit
        await tx.update(users).set({ balance: sql`${users.balance} + ${p.amount}` }).where(eq(users.id, p.userId));
        await tx.insert(transactions).values({ id: rid("TX"), userId: p.userId, type: "topup", amount: p.amount, method: gw.label, desc: "واریز اضافه " + p.invoiceId + " (کد پیگیری " + v.refId + ")" });
      } else await settleInvoice(tx, p.invoiceId, gw.label + " (کد پیگیری " + v.refId + ")");
    } else {
      await tx.update(users).set({ balance: sql`${users.balance} + ${p.amount}` }).where(eq(users.id, p.userId));
      await tx.insert(transactions).values({ id: rid("TX"), userId: p.userId, type: "topup", amount: p.amount, method: gw.label, desc: "شارژ کیف پول (کد پیگیری " + v.refId + ")" });
      await logActivity(tx, p.userId, "wallet", "شارژ کیف پول به مبلغ " + p.amount.toLocaleString("fa-IR") + " تومان");
    }
  });
  return { ok: true, invoiceId: p.invoiceId, message: "پرداخت با موفقیت انجام شد. کد پیگیری: " + v.refId };
}

export const billingRpc = {
  /** POST /checkout/quote — validates a coupon and returns its rule (the cart prices it locally) */
  "billing.quote": method(z.tuple([z.string().max(40), amount]), async (ctx, [code, subtotal]) => {
    const c = await couponRule(ctx.db, code);
    const rule = { code: c.code, type: c.type, value: c.value };
    return { ...rule, discount: couponDiscount(rule, Math.max(0, subtotal)) };
  }),

  "billing.checkout": method(z.tuple([z.array(skuSchema).min(1).max(30), z.string().max(40).optional()]), async (ctx, [skus, coupon]) => {
    const a = needUser(ctx);
    const cat = await catalog(ctx.db);
    const priced = skus.map((s) => { const p = priceSku(s, cat); if ("error" in p) fail(p.error); return p as Exclude<typeof p, { error: string }>; });
    return ctx.db.transaction(async (tx) => {
      const items = priced.map((p) => ({ desc: p.title + (p.meta ? "، " + p.meta : ""), amount: p.base }));
      const subtotal = items.reduce((s, i) => s + i.amount, 0);
      let code: string | null = null;
      if (coupon) {
        const c = await couponRule(tx, coupon, true);
        const discount = couponDiscount({ code: c.code, type: c.type, value: c.value }, subtotal);
        if (discount) items.push({ desc: "کد تخفیف " + c.code, amount: -discount });
        await tx.update(coupons).set({ used: sql`${coupons.used} + 1` }).where(eq(coupons.id, c.id));
        code = c.code;
      }
      const id = await createInvoice(tx, a.uid, items, { dueDays: 3, coupon: code, fulfil: skus.map((sku) => ({ type: "order" as const, sku })) });
      const inv = await loadInvoice(tx, id);
      return { id, userId: a.uid, date: "", due: "", status: "unpaid", items: inv!.items.map((i) => ({ desc: i.desc, amount: i.amount })), tax: inv!.taxRate, official: false };
    });
  }),

  /** wallet → settles now; gateway → { redirect } to the bank page */
  "billing.pay": method(z.tuple([z.string().max(40), z.enum(["wallet", "gateway"]), z.string().url().max(200).optional()]), async (ctx, [invId, how, origin]) => {
    const a = needUser(ctx);
    const settings = await getSettings(ctx.db);
    const inv = await loadInvoice(ctx.db, invId);
    if (!inv || inv.userId !== a.uid) fail("صورتحساب پیدا نشد.", 404);
    if (inv!.status === "paid" || inv!.status === "refunded") fail("این صورتحساب قبلا پرداخت شده است.");
    if (how === "wallet") {
      if (!settings.gateways.wallet) fail("پرداخت با کیف پول موقتا غیرفعال است.");
      await ctx.db.transaction((tx) => settleInvoice(tx, invId, "کیف پول", { wallet: true }));
      return { paid: true };
    }
    return startPayment(ctx, a.uid, inv!.gross, invId, "پرداخت صورتحساب " + invId, origin || "");
  }),

  "billing.topup": method(z.tuple([amount, z.string().url().max(200).optional()]), async (ctx, [amt, origin]) => {
    const a = needUser(ctx);
    if (amt < 100000) fail("حداقل مبلغ شارژ ۱۰۰٬۰۰۰ تومان است.");
    if (amt > 500_000_000) fail("حداکثر مبلغ شارژ ۵۰۰ میلیون تومان است.");
    return startPayment(ctx, a.uid, amt, null, "شارژ کیف پول گره", origin || "");
  }),

  "billing.markPaid": method(z.tuple([z.string().max(40)]), async (ctx, [invId]) => {
    needStaff(ctx, "billing");
    await ctx.db.transaction((tx) => settleInvoice(tx, invId, "ثبت دستی مدیر"));
    await logAudit(ctx.db, actor(ctx), "علامت‌گذاری پرداخت‌شده", invId, ctx.ip);
  }),

  "billing.refund": method(z.tuple([z.string().max(40)]), async (ctx, [invId]) => {
    needStaff(ctx, "billing");
    await ctx.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invId)).for("update");
      if (!inv || inv.status !== "paid") fail("فقط صورتحساب پرداخت‌شده قابل بازگشت وجه است.");
      const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invId));
      const gross = invGross({ items, tax: inv!.taxRate });
      await tx.update(invoices).set({ status: "refunded" }).where(eq(invoices.id, invId));
      await tx.update(users).set({ balance: sql`${users.balance} + ${gross}` }).where(eq(users.id, inv!.userId));
      await tx.insert(transactions).values({ id: rid("TX"), userId: inv!.userId, type: "refund", amount: gross, method: "کیف پول", desc: "بازگشت وجه " + invId });
      await notify(tx, inv!.userId, "wallet", "مبلغ صورتحساب " + invId + " به کیف پول بازگشت");
    });
    await logAudit(ctx.db, actor(ctx), "بازگشت وجه", invId, ctx.ip);
  }),

  "billing.createInvoice": method(z.tuple([z.object({ userId: z.string().max(40), due: z.string().max(20).optional(), items: z.array(z.object({ desc: z.string().min(1).max(200), amount })).min(1).max(50) })]), async (ctx, [d]) => {
    needStaff(ctx, "billing");
    const [u] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, d.userId));
    if (!u) fail("مشتری پیدا نشد.");
    if (d.items.some((i) => i.amount <= 0)) fail("مبلغ هر ردیف باید مثبت باشد.");
    const id = await createInvoice(ctx.db, d.userId, d.items.map((i) => ({ desc: i.desc.trim(), amount: i.amount })), { dueDays: 7 });
    await logAudit(ctx.db, actor(ctx), "صدور صورتحساب دستی", d.userId + " / " + id, ctx.ip);
  }),
};
