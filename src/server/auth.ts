/* Sessions: a random 256-bit token in an HttpOnly, SameSite=Lax, Secure cookie; the DB stores only its
   SHA-256. Sliding expiry (30 days, refreshed at most every 10 minutes). Staff impersonation is
   recorded on the session row (acting_as), so the staff identity is never lost. */
import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DB } from "./db/client";
import { otpCodes, rateLimits, sessions, teamMembers, users } from "./db/schema";
import { AppError, fail, sha256 } from "./util";

export const COOKIE = "gereh_sid";
const TTL_MS = 30 * 86400_000;
const TOUCH_MS = 10 * 60_000;

export type UserRow = typeof users.$inferSelect;
export type Auth = {
  sessionId: string;
  user: UserRow;
  /** the customer whose data the panel shows: acting_as while impersonating or working in a team account */
  uid: string;
  /** set while a team member works in someone else's account */
  teamRole?: "admin" | "tech" | "billing";
};

/** Secure cookies in production; COOKIE_SECURE=0 only for a site served over plain HTTP (no domain/SSL yet) */
const secureCookie = () => process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "0" : process.env.NODE_ENV === "production";

export async function createSession(db: DB, userId: string, meta: { ip: string; device: string }) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: sha256(token), userId, ip: meta.ip, device: meta.device, expiresAt: new Date(Date.now() + TTL_MS) });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookie(), path: "/", maxAge: TTL_MS / 1000 });
}

export async function destroySession(db: DB) {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

export async function readAuth(db: DB): Promise<Auth | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const [row] = await db.select({ s: sessions, u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row || row.u.status === "suspended" && row.u.role !== "admin") return null;
  if (Date.now() - row.s.lastSeenAt.getTime() > TOUCH_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + TTL_MS) }).where(eq(sessions.id, id));
  }
  if (row.s.actingAs && row.u.role === "admin") return { sessionId: id, user: row.u, uid: row.s.actingAs };
  if (row.s.actingAs) {
    // team membership is re-checked on every request, so removal takes effect immediately
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.ownerId, row.s.actingAs), eq(teamMembers.memberId, row.u.id)));
    if (m) return { sessionId: id, user: row.u, uid: m.ownerId, teamRole: m.role };
  }
  return { sessionId: id, user: row.u, uid: row.u.id };
}

/** fixed-window limiter in Postgres; throws a 429 AppError when exceeded */
export async function rateLimit(db: DB, key: string, max: number, windowSec: number) {
  const reset = new Date(Date.now() + windowSec * 1000);
  const [row] = await db.insert(rateLimits).values({ key, count: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} < now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} < now() then ${reset.toISOString()}::timestamptz else ${rateLimits.resetAt} end`,
      },
    }).returning();
  if (row.count > max) {
    const wait = Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 60_000));
    throw new AppError("تعداد تلاش‌ها زیاد است؛ " + wait.toLocaleString("fa-IR") + " دقیقه دیگر دوباره امتحان کنید.", 429);
  }
}
export const clearRateLimit = (db: DB, key: string) => db.delete(rateLimits).where(eq(rateLimits.key, key));
export const sweepRateLimits = (db: DB) => db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date()));

/* ---- one-time codes (SMS) ---- */
const OTP_TTL_MS = 2 * 60_000;
export async function issueOtp(db: DB, phone: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = { phone, codeHash: sha256(phone + ":" + code), attempts: 0, expiresAt: new Date(Date.now() + OTP_TTL_MS) };
  await db.insert(otpCodes).values(row).onConflictDoUpdate({ target: otpCodes.phone, set: row });
  return code;
}
export async function checkOtp(db: DB, phone: string, code: string) {
  const [row] = await db.select().from(otpCodes).where(eq(otpCodes.phone, phone));
  if (!row || row.expiresAt < new Date()) fail("کد منقضی شده است؛ دوباره درخواست دهید.");
  if (row!.attempts >= 5) fail("تعداد تلاش زیاد بود؛ کد جدید بگیرید.", 429);
  if (row!.codeHash !== sha256(phone + ":" + code)) {
    await db.update(otpCodes).set({ attempts: row!.attempts + 1 }).where(eq(otpCodes.phone, phone));
    fail("کد واردشده درست نیست.");
  }
  await db.delete(otpCodes).where(eq(otpCodes.phone, phone));
}
