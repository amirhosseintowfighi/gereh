/* Staff: order detail (with per-order preflight and spec edits before a retry), the customer 360 view
   one tab at a time, the global admin search and the account fixes that view offers. */
import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { actor, isStaff, method, needStaff, type Area, type Ctx } from "../ctx";
import { recoveryCodes, users } from "../db/schema";
import { adminSearch, editOrder, orderDetail, orderPreflight, userActivity, userOrders, userServices, userSummary, userTransactions, userUsage } from "../admin-detail";
import { fail, logActivity, logAudit, notify } from "../util";

const uid = z.string().min(1).max(40);
const invoiceId = z.string().min(1).max(40).regex(/^[\w-]+$/);
const index = z.number().int().min(0).max(200);
const txFilter = z.object({
  type: z.enum(["topup", "payment", "refund", "commission", "usage"]).optional(), product: z.string().max(20).optional(), q: z.string().max(80).optional(),
  days: z.number().int().min(1).max(3650).optional(), offset: z.number().int().min(0).max(100_000).optional(), limit: z.number().int().min(1).max(100).optional(),
});

/** staff with any of the areas (the first one names the refusal) */
function needAny(ctx: Ctx, areas: Area[]) {
  for (const a of areas) if (isStaff(ctx, a)) return ctx.auth!;
  return needStaff(ctx, areas[0]);
}
async function customer(ctx: Ctx, id: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, id));
  if (!u) fail("کاربر پیدا نشد.", 404);
  return u!;
}

export const adminDetailRpc = {
  "admin.orderDetail": method(z.tuple([invoiceId, index]), async (ctx, [inv, i]) => {
    needAny(ctx, ["services", "billing"]);
    return orderDetail(ctx.db, inv, i);
  }),

  "admin.orderPreflight": method(z.tuple([invoiceId, index]), async (ctx, [inv, i]) => {
    needAny(ctx, ["services", "billing"]);
    return orderPreflight(ctx.db, inv, i);
  }),

  /** another OS (catalog id or a synced template), location or Plan ID for this order before a retry */
  "admin.orderEdit": method(z.tuple([invoiceId, index, z.object({
    os: z.string().max(20).optional(), osid: z.number().int().min(0).max(1_000_000).optional(), loc: z.string().max(10).optional(), plid: z.number().int().min(0).max(1_000_000).optional(),
  })]), async (ctx, [inv, i, patch]) => {
    needStaff(ctx, "services");
    const r = await editOrder(ctx.db, inv, i, patch);
    await logAudit(ctx.db, actor(ctx), "ویرایش مشخصات سفارش پیش از تلاش دوباره (" + r.changes.join("، ") + ")", inv + ":" + i, ctx.ip);
    return r.changes;
  }),

  "admin.userDetail": method(z.tuple([uid, z.enum(["summary", "orders", "services", "usage", "activity"]), z.object({ offset: z.number().int().min(0).max(100_000).optional(), tx: txFilter.optional() }).optional()]), async (ctx, [id, tab, opts]) => {
    needStaff(ctx, "users");
    await customer(ctx, id);
    if (tab === "summary") return userSummary(ctx.db, id);
    if (tab === "orders") return userOrders(ctx.db, id, opts?.offset ?? 0);
    if (tab === "services") return userServices(ctx.db, id);
    if (tab === "usage") return userUsage(ctx.db, id, opts?.tx ?? {});
    return userActivity(ctx.db, id, opts?.offset ?? 0);
  }),

  /** every matching wallet transaction as CSV (UTF-8 with BOM so spreadsheet apps read Persian) */
  "admin.userTxCsv": method(z.tuple([uid, txFilter]), async (ctx, [id, f]) => {
    needAny(ctx, ["billing", "users"]);
    const u = await customer(ctx, id);
    const rows = await userTransactions(ctx.db, id, f);
    const cell = (v: string | number) => { const s = String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) && typeof v === "string" ? "'" : "") + s.replace(/"/g, '""') + '"' : s; };
    const lines = [["id", "date", "type", "amount", "method", "product", "description"].join(","), ...rows.map((r) => [r.id, r.at, r.type, r.amount, r.method, r.product, r.desc].map(cell).join(","))];
    await logAudit(ctx.db, actor(ctx), "خروجی تراکنش‌های کاربر (" + rows.length + " ردیف)", u.id, ctx.ip);
    return "﻿" + lines.join("\n");
  }),

  "admin.search": method(z.tuple([z.string().max(120)]), async (ctx, [q]) => {
    needAny(ctx, ["users", "services", "billing"]);
    return adminSearch(ctx.db, q);
  }),

  "admin.resetTwofa": method(z.tuple([uid]), async (ctx, [id]) => {
    needStaff(ctx, "users");
    const u = await customer(ctx, id);
    if (u.role === "admin") fail("ورود دومرحله‌ای کارمندان را فقط خودشان تغییر می‌دهند.");
    if (!u.twofaSecret) fail("ورود دومرحله‌ای این کاربر فعال نیست.");
    await ctx.db.update(users).set({ twofaSecret: null }).where(and(eq(users.id, id), eq(users.role, "user")));
    await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, id));
    await logActivity(ctx.db, id, "shield-check", "ورود دومرحله‌ای توسط پشتیبانی غیرفعال شد", ctx.ip);
    await notify(ctx.db, id, "shield-check", "ورود دومرحله‌ای حساب شما توسط پشتیبانی غیرفعال شد؛ در اولین فرصت دوباره فعالش کنید");
    await logAudit(ctx.db, actor(ctx), "غیرفعال کردن ورود دومرحله‌ای", id, ctx.ip);
  }),

  "admin.notifyUser": method(z.tuple([uid, z.string().max(300)]), async (ctx, [id, text]) => {
    needStaff(ctx, "users");
    await customer(ctx, id);
    const msg = text.trim();
    if (msg.length < 3) fail("متن اعلان را بنویسید.");
    await notify(ctx.db, id, "megaphone", msg);
    await logAudit(ctx.db, actor(ctx), "ارسال اعلان به کاربر: " + msg.slice(0, 80), id, ctx.ip);
  }),
};
