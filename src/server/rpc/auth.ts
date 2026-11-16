import "server-only";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_RE, PHONE_RE, strength, toEnDigits } from "@/lib/format";
import { verifyTotp } from "@/lib/totp";
import { redeemRecoveryCode } from "../account-extras";
import { checkOtp, clearRateLimit, createSession, destroySession, issueOtp, rateLimit } from "../auth";
import { actor, method, needStaff, type Ctx } from "../ctx";
import { otpCodes, sessions, users } from "../db/schema";
import { sendEmail, sendOtpSms } from "../messaging";
import { hashPassword, verifyPassword } from "../password";
import { getSettings } from "../state";
import { fail, logActivity, logAudit, randomSecret, rid } from "../util";

const str = (max = 200) => z.string().max(max);
const refCode = () => randomSecret(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
/** the UI shows a TOTP field when it sees this exact message */
export const TWOFA_REQUIRED = "TWOFA_REQUIRED";
/** temporary passwords live in otp_codes under this key (the table is keyed by text), next to the SMS codes */
const resetKey = (userId: string) => "reset:" + userId;
const RESET_TTL_MS = 30 * 60_000;

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
    let temp: string | null = null; // the hash of a temporary password from «فراموشی رمز», when that is what was typed
    if (!(await verifyPassword(password, user?.passwordHash))) {
      const [r] = user ? await ctx.db.select().from(otpCodes).where(and(eq(otpCodes.phone, resetKey(user.id)), gt(otpCodes.expiresAt, new Date()))) : [];
      if (!r || !(await verifyPassword(password, r.codeHash))) fail("ایمیل، موبایل یا رمز عبور درست نیست.", 401);
      temp = r!.codeHash;
    }
    if (user!.status === "suspended" && user!.role !== "admin") fail("حساب شما معلق است؛ با پشتیبانی تماس بگیرید.", 403);
    if (user!.twofaSecret) {
      if (!code) fail(TWOFA_REQUIRED, 401);
      // a one-time recovery code (XXXX-XXXX) stands in for the app code
      if (!(await verifyTotp(user!.twofaSecret, toEnDigits(code!))) && !(await redeemRecoveryCode(ctx.db, user!.id, code!))) fail("کد ورود دومرحله‌ای درست نیست.", 401);
    }
    if (temp) {
      // only now, with the mailbox (and 2FA) proven, does the temporary password replace the old one and sign other devices out
      await ctx.db.update(users).set({ passwordHash: temp }).where(eq(users.id, user!.id));
      await ctx.db.delete(sessions).where(eq(sessions.userId, user!.id));
      await ctx.db.delete(otpCodes).where(eq(otpCodes.phone, resetKey(user!.id)));
    }
    await clearRateLimit(ctx.db, "login:id:" + id);
    return startSession(ctx, user!, temp ? "رمز موقت" : "رمز عبور");
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
    await sendEmail(email, "به گره خوش آمدید", "سلام " + name + "،\nحساب شما در گره ساخته شد. برای خرید سرویس وارد پنل شوید: https://gereh.net/panel");
    return startSession(ctx, user, "ثبت‌نام");
  }),

  "auth.forgot": method(z.tuple([str(120)]), async (ctx, [raw]) => {
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) fail("یک ایمیل معتبر وارد کنید.");
    await rateLimit(ctx.db, "forgot:ip:" + ctx.ip, 5, 3600);
    const [user] = await ctx.db.select().from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
    if (user) {
      // a temporary password, valid for 30 minutes. The current password and sessions stay as they are until someone
      // signs in with it: otherwise anyone who knows an email address could lock its owner out of the account
      // per account as well as per IP; answered like any other request, so the limit does not reveal that the account exists
      try { await rateLimit(ctx.db, "forgot:id:" + user.id, 3, 3600); } catch { return true; }
      const temp = randomSecret(12, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789");
      const row = { phone: resetKey(user.id), codeHash: await hashPassword(temp), attempts: 0, expiresAt: new Date(Date.now() + RESET_TTL_MS) };
      await ctx.db.insert(otpCodes).values(row).onConflictDoUpdate({ target: otpCodes.phone, set: row });
      await sendEmail(user.email, "بازیابی رمز عبور گره", "رمز موقت شما: " + temp + "\nاین رمز ۳۰ دقیقه معتبر است و رمز فعلی شما تا زمان ورود با آن تغییر نمی‌کند.\nپس از ورود، از بخش تنظیمات حساب رمز را تغییر دهید. اگر این درخواست از طرف شما نبوده، با پشتیبانی تماس بگیرید.");
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
