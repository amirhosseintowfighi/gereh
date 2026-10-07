import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_RE, PHONE_RE, strength, toEnDigits } from "@/lib/format";
import { verifyTotp } from "@/lib/totp";
import { checkOtp, clearRateLimit, createSession, destroySession, issueOtp, rateLimit } from "../auth";
import { actor, method, needStaff, type Ctx } from "../ctx";
import { sessions, users } from "../db/schema";
import { sendEmail, sendOtpSms } from "../messaging";
import { hashPassword, verifyPassword } from "../password";
import { getSettings } from "../state";
import { fail, logActivity, logAudit, randomSecret, rid } from "../util";

const str = (max = 200) => z.string().max(max);
const refCode = () => randomSecret(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
/** the UI shows a TOTP field when it sees this exact message */
export const TWOFA_REQUIRED = "TWOFA_REQUIRED";

async function startSession(ctx: Ctx, user: typeof users.$inferSelect, how: string) {
  await createSession(ctx.db, user.id, { ip: ctx.ip, device: ctx.device });
  await logActivity(ctx.db, user.id, "lock", "ورود موفق به حساب (" + how + ")", ctx.ip);
  return { userId: user.id, role: user.role, name: user.name };
}

export const authRpc = {
  "auth.login": method(z.tuple([str(), str(), str(10).optional()]), async (ctx, [rawId, password, code]) => {
    const id = toEnDigits(rawId.trim()).toLowerCase();
    if (!id || !password) fail("ایمیل یا موبایل و رمز عبور را وارد کنید.");
    await rateLimit(ctx.db, "login:ip:" + ctx.ip, 30, 600);
    await rateLimit(ctx.db, "login:id:" + id, 8, 900);
    const [user] = await ctx.db.select().from(users).where(or(eq(sql`lower(${users.email})`, id), eq(users.phone, id))).limit(1);
    if (!(await verifyPassword(password, user?.passwordHash))) fail("ایمیل، موبایل یا رمز عبور درست نیست.", 401);
    if (user!.status === "suspended" && user!.role !== "admin") fail("حساب شما معلق است؛ با پشتیبانی تماس بگیرید.", 403);
    if (user!.twofaSecret) {
      if (!code) fail(TWOFA_REQUIRED, 401);
      if (!(await verifyTotp(user!.twofaSecret, toEnDigits(code!)))) fail("کد ورود دومرحله‌ای درست نیست.", 401);
    }
    await clearRateLimit(ctx.db, "login:id:" + id);
    return startSession(ctx, user!, "رمز عبور");
  }),

  "auth.sendOtp": method(z.tuple([str(20)]), async (ctx, [raw]) => {
    const phone = toEnDigits(raw.trim());
    if (!PHONE_RE.test(phone)) fail("شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود.");
    await rateLimit(ctx.db, "otp:ip:" + ctx.ip, 10, 3600);
    await rateLimit(ctx.db, "otp:phone:" + phone, 3, 600);
    const [user] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    // do not reveal whether the number is registered: only registered numbers get an SMS
    if (user) await sendOtpSms(phone, await issueOtp(ctx.db, phone));
    return true;
  }),

  "auth.verifyOtp": method(z.tuple([str(20), str(10)]), async (ctx, [raw, code]) => {
    const phone = toEnDigits(raw.trim());
    if (toEnDigits(code).length !== 6) fail("کد ۶ رقمی را کامل وارد کنید.");
    await rateLimit(ctx.db, "otpv:ip:" + ctx.ip, 30, 600);
    await checkOtp(ctx.db, phone, toEnDigits(code));
    const [user] = await ctx.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user) fail("کد واردشده درست نیست.");
    if (user!.status === "suspended" && user!.role !== "admin") fail("حساب شما معلق است؛ با پشتیبانی تماس بگیرید.", 403);
    return startSession(ctx, user!, "کد پیامکی");
  }),

  "auth.register": method(z.tuple([z.object({ name: str(80), email: str(120), phone: str(20), password: str(200), ref: str(20).optional() })]), async (ctx, [d]) => {
    if (!(await getSettings(ctx.db)).registration) fail("ثبت‌نام کاربران جدید موقتا بسته است.");
    const email = d.email.trim().toLowerCase(), phone = toEnDigits(d.phone.trim()), name = d.name.trim();
    if (name.length < 2) fail("نام را وارد کنید.");
    if (!EMAIL_RE.test(email)) fail("ایمیل معتبر نیست.");
    if (!PHONE_RE.test(phone)) fail("شماره موبایل معتبر نیست.");
    if (strength(d.password) < 2 || d.password.length < 8) fail("رمز ضعیف است؛ حداقل ۸ کاراکتر با عدد یا حروف بزرگ.");
    await rateLimit(ctx.db, "register:ip:" + ctx.ip, 5, 3600);
    const [dup] = await ctx.db.select({ id: users.id }).from(users).where(or(eq(sql`lower(${users.email})`, email), eq(users.phone, phone))).limit(1);
    if (dup) fail("با این ایمیل یا موبایل قبلا حساب ساخته شده است.");
    let referredBy: string | null = null;
    if (d.ref) {
      const [r] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.referralCode, d.ref.trim().toUpperCase())).limit(1);
      referredBy = r?.id ?? null;
    }
    const [user] = await ctx.db.insert(users).values({ id: rid("u"), name, email, phone, passwordHash: await hashPassword(d.password), referralCode: refCode(), referredBy,
      notifPrefs: { billing_email: true, billing_sms: true, service_email: true, service_sms: true, security_email: true, security_sms: true, news_email: false } }).returning();
    await sendEmail(email, "به گره خوش آمدید", "سلام " + name + "،\nحساب شما در گره ساخته شد. برای خرید سرویس وارد پنل شوید: https://gereh.cloud/panel");
    return startSession(ctx, user, "ثبت‌نام");
  }),

  "auth.forgot": method(z.tuple([str(120)]), async (ctx, [raw]) => {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) fail("یک ایمیل معتبر وارد کنید.");
    await rateLimit(ctx.db, "forgot:ip:" + ctx.ip, 5, 3600);
    const [user] = await ctx.db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    if (user) {
      // a single-use password: the user signs in with it and changes it in the panel
      const temp = randomSecret(12, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789");
      await ctx.db.update(users).set({ passwordHash: await hashPassword(temp) }).where(eq(users.id, user.id));
      await ctx.db.delete(sessions).where(eq(sessions.userId, user.id));
      await sendEmail(user.email, "بازیابی رمز عبور گره", "رمز موقت شما: " + temp + "\nپس از ورود، از بخش تنظیمات حساب رمز را تغییر دهید. اگر این درخواست از طرف شما نبوده، با پشتیبانی تماس بگیرید.");
    }
    return true; // same answer either way
  }),

  "auth.logout": method(z.tuple([]), async (ctx) => { await destroySession(ctx.db); }),

  /** POST /admin/users/:id/impersonate */
  "admin.impersonate": method(z.tuple([str(40)]), async (ctx, [id]) => {
    const a = needStaff(ctx, "users");
    const [u] = await ctx.db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id));
    if (!u || u.role !== "user") fail("کاربر پیدا نشد.", 404);
    await ctx.db.update(sessions).set({ actingAs: id }).where(and(eq(sessions.id, a.sessionId), eq(sessions.userId, a.user.id)));
    await logAudit(ctx.db, a.user.name, "ورود به‌جای کاربر", id, ctx.ip);
  }),
  "admin.stopImpersonate": method(z.tuple([]), async (ctx) => {
    const a = ctx.auth;
    if (!a || a.user.role !== "admin") return;
    await ctx.db.update(sessions).set({ actingAs: null }).where(eq(sessions.id, a.sessionId));
    await logAudit(ctx.db, actor(ctx), "پایان ورود به‌جای کاربر", a.uid, ctx.ip);
  }),
};
