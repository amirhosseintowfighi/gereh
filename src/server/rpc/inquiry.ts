import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { inquiryDef } from "@/lib/inquiry";
import { actor, method, needStaff, needUser } from "../ctx";
import { inquiryAccounts, inquiryGrants, inquiryServices } from "../db/schema";
import { createAccount, revealSecret, rotateSecret, runInquiry } from "../inquiry/service";
import { inquiryProvider } from "../inquiry/provider";
import { enqueue } from "../jobs";
import { fail, logActivity, logAudit, notify } from "../util";

const sid = z.string().regex(/^[a-z0-9_]{2,40}$/);
const IP_RULE = /^(\d{1,3}\.){3}\d{1,3}(\/(3[0-2]|[12]?\d))?$|^[0-9a-f:]{2,39}$/i;

async function ownAccount(ctx: Parameters<typeof needUser>[0]) {
  const a = needUser(ctx);
  const [acct] = await ctx.db.select().from(inquiryAccounts).where(eq(inquiryAccounts.userId, a.uid));
  if (!acct) fail("ابتدا دسترسی API را فعال کنید.", 404);
  return { a, acct: acct! };
}

export const inquiryMethods = {
  /** creates API credentials; personal-data services need a verified (KYC) account */
  "inquiry.activate": method(z.tuple([]), async (ctx) => {
    const a = needUser(ctx);
    if (a.user.kyc !== "verified") fail("برای فعال‌سازی API ابتدا احراز هویت حساب (تنظیمات حساب) را کامل کنید؛ سرویس‌های استعلام فقط به حساب‌های احرازشده ارائه می‌شوند.", 403);
    await createAccount(ctx.db, a.uid);
    await logActivity(ctx.db, a.uid, "key-round", "فعال‌سازی API استعلام", ctx.ip);
  }),

  "inquiry.reveal": method(z.tuple([]), async (ctx) => {
    const { a, acct } = await ownAccount(ctx);
    await logActivity(ctx.db, a.uid, "eye", "مشاهده رمز API استعلام", ctx.ip);
    return revealSecret(acct.secretEnc);
  }),

  "inquiry.rotate": method(z.tuple([]), async (ctx) => {
    const { a } = await ownAccount(ctx);
    await rotateSecret(ctx.db, a.uid);
    await logActivity(ctx.db, a.uid, "key-round", "ساخت رمز جدید API استعلام", ctx.ip);
  }),

  "inquiry.setIps": method(z.tuple([z.array(z.string().trim().max(45)).max(20)]), async (ctx, [ips]) => {
    const { a } = await ownAccount(ctx);
    const clean = [...new Set(ips.filter(Boolean))];
    const bad = clean.find((ip) => !IP_RULE.test(ip));
    if (bad) fail("«" + bad + "» آدرس IP یا بازه معتبر نیست (مثل 185.1.2.3 یا 185.1.2.0/24).");
    await ctx.db.update(inquiryAccounts).set({ ipAllow: clean }).where(eq(inquiryAccounts.userId, a.uid));
    await logActivity(ctx.db, a.uid, "shield-check", clean.length ? "محدودیت IP برای API استعلام: " + clean.join("، ") : "حذف محدودیت IP API استعلام", ctx.ip);
  }),

  "inquiry.requestAccess": method(z.tuple([sid, z.string().trim().min(20).max(600)]), async (ctx, [serviceId, useCase]) => {
    const { a } = await ownAccount(ctx);
    const [svc] = await ctx.db.select().from(inquiryServices).where(eq(inquiryServices.id, serviceId));
    if (!svc?.active) fail("سرویس پیدا نشد.", 404);
    if (!svc!.approval) fail("این سرویس نیاز به درخواست ندارد و برای شما فعال است.");
    const [g] = await ctx.db.select().from(inquiryGrants).where(and(eq(inquiryGrants.userId, a.uid), eq(inquiryGrants.serviceId, serviceId)));
    if (g?.status === "approved") fail("این سرویس برای شما فعال است.");
    if (g?.status === "pending") fail("درخواست قبلی شما در حال بررسی است.");
    await ctx.db.insert(inquiryGrants).values({ userId: a.uid, serviceId, useCase })
      .onConflictDoUpdate({ target: [inquiryGrants.userId, inquiryGrants.serviceId], set: { status: "pending", useCase, note: "", createdAt: new Date(), decidedAt: null } });
    await enqueue(ctx.db, "notify.send", { to: process.env.CONTACT_INBOX || "hello@gereh.net", subject: "درخواست دسترسی API استعلام: " + svc!.name, text: a.user.name + " <" + a.user.email + "> برای «" + svc!.name + "» درخواست دسترسی داده است:\n\n" + useCase });
  }),

  /** the panel playground: same path as the API (and the same billing unless sandbox) */
  "inquiry.test": method(z.tuple([sid, z.record(z.string(), z.unknown()), z.boolean()]), async (ctx, [serviceId, body, sandbox]) => {
    const { a, acct } = await ownAccount(ctx);
    if (acct.status !== "active") fail("دسترسی API این حساب معلق است.", 403);
    const r = await runInquiry(ctx.db, { userId: a.uid, serviceId, body, sandbox, source: "panel", ip: ctx.ip });
    return { http: r.http, body: r.body };
  }),

  /* ---------- staff ---------- */
  "inquiry.adminService": method(z.tuple([sid, z.object({ name: z.string().trim().min(3).max(80).optional(), price: z.number().int().min(0).max(10_000_000).optional(), active: z.boolean().optional(), approval: z.boolean().optional(), upstream: z.string().trim().max(120).regex(/^[\w./-]*$/).optional() })]), async (ctx, [serviceId, patch]) => {
    needStaff(ctx, "inquiry");
    if (!inquiryDef(serviceId)) fail("سرویس ناشناخته است.", 404);
    await ctx.db.update(inquiryServices).set(patch).where(eq(inquiryServices.id, serviceId));
    await logAudit(ctx.db, actor(ctx), "ویرایش سرویس استعلام", serviceId + " " + JSON.stringify(patch), ctx.ip);
  }),

  "inquiry.decide": method(z.tuple([z.number().int(), z.boolean(), z.string().trim().max(400)]), async (ctx, [grantId, approve, note]) => {
    needStaff(ctx, "inquiry");
    if (!approve && note.length < 5) fail("دلیل رد را برای مشتری بنویسید.");
    const [g] = await ctx.db.update(inquiryGrants).set({ status: approve ? "approved" : "rejected", note, decidedAt: new Date() }).where(eq(inquiryGrants.id, grantId)).returning();
    if (!g) fail("درخواست پیدا نشد.", 404);
    const name = inquiryDef(g!.serviceId)?.name ?? g!.serviceId;
    await notify(ctx.db, g!.userId, approve ? "circle-check" : "circle-alert", approve ? "دسترسی «" + name + "» برای API استعلام فعال شد" : "درخواست دسترسی «" + name + "» رد شد: " + note);
    await logAudit(ctx.db, actor(ctx), approve ? "تأیید دسترسی استعلام" : "رد دسترسی استعلام", g!.userId + " " + g!.serviceId, ctx.ip);
  }),

  "inquiry.adminAccount": method(z.tuple([z.string().max(40), z.enum(["active", "suspended"])]), async (ctx, [userId, status]) => {
    needStaff(ctx, "inquiry");
    const r = await ctx.db.update(inquiryAccounts).set({ status }).where(eq(inquiryAccounts.userId, userId)).returning({ u: inquiryAccounts.userId });
    if (!r.length) fail("حساب API پیدا نشد.", 404);
    if (status === "suspended") await notify(ctx.db, userId, "circle-alert", "دسترسی API استعلام شما معلق شد؛ با پشتیبانی تماس بگیرید");
    await logAudit(ctx.db, actor(ctx), status === "active" ? "رفع تعلیق API استعلام" : "تعلیق API استعلام", userId, ctx.ip);
  }),

  "inquiry.adminProvider": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "inquiry");
    return { provider: inquiryProvider().name };
  }),
};
