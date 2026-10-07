import "server-only";
import { createHash } from "node:crypto";
import { and, eq, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_RE, PHONE_RE, strength, toEnDigits } from "@/lib/format";
import { verifyTotp } from "@/lib/totp";
import { rateLimit } from "../auth";
import { method, needUser } from "../ctx";
import { apiTokens, notifications, sessions, sshKeys, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../password";
import { fail, logActivity, randomSecret, rid, sha256 } from "../util";

const SSH_RE = /^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) ([A-Za-z0-9+/]{40,}={0,3})( .*)?$/;
/** OpenSSH-style "SHA256:…" fingerprint of the key blob */
export function fingerprint(pub: string) {
  const m = SSH_RE.exec(pub.trim());
  if (!m) return null;
  const blob = Buffer.from(m[5], "base64");
  return "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
}
const TOKEN_TTL: Record<string, number | null> = { "۳۰ روز": 30, "۹۰ روز": 90, "یک سال": 365, "بدون انقضا": null };

export const accountRpc = {
  "account.updateProfile": method(z.tuple([z.object({ name: z.string().max(80).optional(), email: z.string().max(120).optional(), phone: z.string().max(20).optional(), company: z.string().max(120).optional() })]), async (ctx, [p]) => {
    const a = needUser(ctx);
    const patch: Partial<typeof users.$inferInsert> = {};
    if (p.name !== undefined) { if (p.name.trim().length < 2) fail("نام را وارد کنید."); patch.name = p.name.trim(); }
    if (p.company !== undefined) patch.company = p.company.trim();
    if (p.email !== undefined) { const e = p.email.trim().toLowerCase(); if (!EMAIL_RE.test(e)) fail("ایمیل معتبر نیست."); patch.email = e; }
    if (p.phone !== undefined) { const ph = toEnDigits(p.phone.trim()); if (!PHONE_RE.test(ph)) fail("شماره موبایل معتبر نیست."); patch.phone = ph; }
    if (patch.email || patch.phone) {
      const [dup] = await ctx.db.select({ id: users.id }).from(users).where(and(ne(users.id, a.uid), or(patch.email ? eq(sql`lower(${users.email})`, patch.email) : undefined, patch.phone ? eq(users.phone, patch.phone) : undefined))).limit(1);
      if (dup) fail("این ایمیل یا موبایل متعلق به حساب دیگری است.");
    }
    await ctx.db.update(users).set(patch).where(eq(users.id, a.uid));
  }),

  "account.changePassword": method(z.tuple([z.string().max(200), z.string().max(200)]), async (ctx, [cur, next]) => {
    const a = needUser(ctx);
    if (a.uid !== a.user.id) fail("هنگام ورود به‌جای کاربر نمی‌توان رمز را تغییر داد.", 403);
    if (!cur) fail("رمز فعلی را وارد کنید.");
    if (next.length < 8 || strength(next) < 2) fail("رمز جدید باید حداقل ۸ کاراکتر با عدد یا حروف بزرگ باشد.");
    await rateLimit(ctx.db, "pw:" + a.user.id, 5, 900);
    if (!(await verifyPassword(cur, a.user.passwordHash))) fail("رمز فعلی درست نیست.");
    await ctx.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, a.user.id));
    // sign out every other device
    await ctx.db.delete(sessions).where(and(eq(sessions.userId, a.user.id), ne(sessions.id, a.sessionId)));
    await logActivity(ctx.db, a.user.id, "lock", "تغییر رمز عبور", ctx.ip);
  }),

  /** enable: valid code for the new secret; disable: valid code for the stored one */
  "account.setTwofa": method(z.tuple([z.boolean(), z.string().max(64).optional(), z.string().max(10).optional()]), async (ctx, [on, secret, code]) => {
    const a = needUser(ctx);
    if (a.uid !== a.user.id) fail("هنگام ورود به‌جای کاربر نمی‌توان این تنظیم را تغییر داد.", 403);
    await rateLimit(ctx.db, "2fa:" + a.user.id, 10, 900);
    const check = on ? secret : a.user.twofaSecret;
    if (on && !/^[A-Z2-7]{32}$/.test(secret || "")) fail("کلید نامعتبر است؛ دوباره تلاش کنید.");
    if (!(check && code && (await verifyTotp(check, toEnDigits(code))))) fail("کد واردشده درست نیست؛ کد فعلی اپلیکیشن را وارد کنید.");
    await ctx.db.update(users).set({ twofaSecret: on ? check : null }).where(eq(users.id, a.user.id));
    await logActivity(ctx.db, a.user.id, "shield-check", on ? "فعال‌سازی ورود دومرحله‌ای" : "غیرفعال‌سازی ورود دومرحله‌ای", ctx.ip);
  }),

  "account.revokeSession": method(z.tuple([z.string().min(8).max(16)]), async (ctx, [prefix]) => {
    const a = needUser(ctx);
    if (!/^[0-9a-f]+$/.test(prefix)) fail("نشست پیدا نشد.");
    await ctx.db.delete(sessions).where(and(eq(sessions.userId, a.user.id), like(sessions.id, prefix + "%"), ne(sessions.id, a.sessionId)));
  }),

  "account.setNotif": method(z.tuple([z.string().regex(/^[a-z]+_(email|sms)$/), z.boolean()]), async (ctx, [key, val]) => {
    const a = needUser(ctx);
    await ctx.db.update(users).set({ notifPrefs: sql`${users.notifPrefs} || ${JSON.stringify({ [key]: val })}::jsonb` }).where(eq(users.id, a.uid));
  }),

  "account.addKey": method(z.tuple([z.object({ name: z.string().max(60), pub: z.string().max(16_000) })]), async (ctx, [k]) => {
    const a = needUser(ctx);
    if (!k.name.trim()) fail("یک نام برای کلید بنویسید.");
    const fp = fingerprint(k.pub);
    if (!fp) fail("کلید عمومی معتبر نیست؛ باید با ssh-ed25519 یا ssh-rsa شروع شود.");
    const [dup] = await ctx.db.select({ id: sshKeys.id }).from(sshKeys).where(and(eq(sshKeys.userId, a.uid), eq(sshKeys.fingerprint, fp!)));
    if (dup) fail("این کلید قبلا اضافه شده است.");
    await ctx.db.insert(sshKeys).values({ id: rid("key"), userId: a.uid, name: k.name.trim(), fingerprint: fp!, publicKey: k.pub.trim() });
  }),
  "account.removeKey": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    const a = needUser(ctx);
    await ctx.db.delete(sshKeys).where(and(eq(sshKeys.id, id), eq(sshKeys.userId, a.uid)));
  }),

  /** the plain token is returned once; only its SHA-256 is stored */
  "account.createToken": method(z.tuple([z.object({ name: z.string().max(41), scope: z.enum(["read", "read-write"]), expires: z.string().max(20) })]), async (ctx, [t]) => {
    const a = needUser(ctx);
    const name = t.name.trim();
    if (!/^[a-z0-9][a-z0-9-_.]{1,40}$/i.test(name)) fail("نام توکن فقط حروف انگلیسی، عدد و خط تیره.");
    if (!(t.expires in TOKEN_TTL)) fail("مدت اعتبار نامعتبر است.");
    const days = TOKEN_TTL[t.expires];
    const secret = "grh_" + randomSecret(40, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    await ctx.db.insert(apiTokens).values({ id: rid("tok"), userId: a.uid, name, scope: t.scope, tokenHash: sha256(secret), expiresAt: days ? new Date(Date.now() + days * 86400_000) : null });
    await logActivity(ctx.db, a.uid, "code-xml", "ساخت توکن API " + name, ctx.ip);
    return secret;
  }),
  "account.revokeToken": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    const a = needUser(ctx);
    await ctx.db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, a.uid)));
  }),

  "account.readAll": method(z.tuple([]), async (ctx) => {
    const a = needUser(ctx);
    await ctx.db.update(notifications).set({ read: true }).where(eq(notifications.userId, a.uid));
  }),
  "account.readOne": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    const a = needUser(ctx);
    await ctx.db.update(notifications).set({ read: true }).where(and(eq(notifications.id, id), eq(notifications.userId, a.uid)));
  }),
};
