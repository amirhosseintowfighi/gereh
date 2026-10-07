import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_RE } from "@/lib/format";
import { method, needUser } from "../ctx";
import { sessions, teamInvites, teamMembers, users } from "../db/schema";
import { sendEmail } from "../messaging";
import { fail, logActivity, notify, rid, sha256 } from "../util";

const role = z.enum(["admin", "tech", "billing"]);
export const ROLE_LABEL: Record<string, string> = { admin: "مدیر حساب", tech: "فنی", billing: "مالی" };
/** only the account owner (not a member working in it) manages the team */
const owner = (ctx: Parameters<typeof needUser>[0]) => { const a = needUser(ctx); if (a.uid !== a.user.id) fail("فقط صاحب حساب می‌تواند تیم را مدیریت کند.", 403); return a; };

export const teamRpc = {
  "team.invite": method(z.tuple([z.string().max(120), role, z.string().url().max(200).optional()]), async (ctx, [raw, r, origin]) => {
    const a = owner(ctx);
    const email = raw.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) fail("ایمیل معتبر نیست.");
    if (email === a.user.email.toLowerCase()) fail("نمی‌توانید خودتان را دعوت کنید.");
    const [existing] = await ctx.db.select({ id: teamMembers.id }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.memberId)).where(and(eq(teamMembers.ownerId, a.uid), eq(sql`lower(${users.email})`, email)));
    if (existing) fail("این شخص عضو تیم است.");
    const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(teamMembers).where(eq(teamMembers.ownerId, a.uid));
    if (n >= 20) fail("حداکثر ۲۰ عضو برای هر حساب.");
    const token = randomBytes(24).toString("base64url");
    await ctx.db.delete(teamInvites).where(and(eq(teamInvites.ownerId, a.uid), eq(teamInvites.email, email)));
    await ctx.db.insert(teamInvites).values({ id: rid("inv"), ownerId: a.uid, email, role: r, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400_000) });
    const link = (origin || "https://gereh.net") + "/team/accept?token=" + token;
    await sendEmail(email, "دعوت به حساب " + a.user.name + " در گره", a.user.name + " شما را با نقش «" + ROLE_LABEL[r] + "» به حساب خود در گره دعوت کرده است.\n\nبرای پذیرش (تا ۷ روز): " + link + "\n\nاگر حساب ندارید، ابتدا با همین ایمیل ثبت‌نام کنید.");
  }),

  "team.cancelInvite": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    const a = owner(ctx);
    await ctx.db.delete(teamInvites).where(and(eq(teamInvites.id, id), eq(teamInvites.ownerId, a.uid)));
  }),

  "team.accept": method(z.tuple([z.string().max(100)]), async (ctx, [token]) => {
    const a = needUser(ctx);
    const [inv] = await ctx.db.select().from(teamInvites).where(and(eq(teamInvites.tokenHash, sha256(token)), gt(teamInvites.expiresAt, new Date())));
    if (!inv) fail("دعوت‌نامه نامعتبر یا منقضی است.");
    if (inv!.email !== a.user.email.toLowerCase()) fail("این دعوت برای ایمیل دیگری ارسال شده است؛ با همان ایمیل وارد شوید.", 403);
    if (inv!.ownerId === a.user.id) fail("نمی‌توانید عضو حساب خودتان شوید.");
    await ctx.db.insert(teamMembers).values({ id: rid("tm"), ownerId: inv!.ownerId, memberId: a.user.id, role: inv!.role }).onConflictDoUpdate({ target: [teamMembers.ownerId, teamMembers.memberId], set: { role: inv!.role } });
    await ctx.db.delete(teamInvites).where(eq(teamInvites.id, inv!.id));
    await notify(ctx.db, inv!.ownerId, "users-round", a.user.name + " به تیم شما پیوست");
    await logActivity(ctx.db, inv!.ownerId, "users-round", a.user.name + " با نقش " + ROLE_LABEL[inv!.role] + " به تیم پیوست", ctx.ip);
    await ctx.db.update(sessions).set({ actingAs: inv!.ownerId }).where(eq(sessions.id, a.sessionId));
    return { ownerId: inv!.ownerId };
  }),

  "team.setRole": method(z.tuple([z.string().max(40), role]), async (ctx, [memberId, r]) => {
    const a = owner(ctx);
    const res = await ctx.db.update(teamMembers).set({ role: r }).where(and(eq(teamMembers.ownerId, a.uid), eq(teamMembers.memberId, memberId))).returning({ id: teamMembers.id });
    if (!res.length) fail("عضو پیدا نشد.", 404);
  }),

  "team.remove": method(z.tuple([z.string().max(40)]), async (ctx, [memberId]) => {
    const a = owner(ctx);
    await ctx.db.delete(teamMembers).where(and(eq(teamMembers.ownerId, a.uid), eq(teamMembers.memberId, memberId)));
    await ctx.db.update(sessions).set({ actingAs: null }).where(and(eq(sessions.userId, memberId), eq(sessions.actingAs, a.uid)));
  }),

  /** member: work in a team account (ownerId) or go back to their own (null) */
  "team.switch": method(z.tuple([z.string().max(40).nullable()]), async (ctx, [ownerId]) => {
    const a = needUser(ctx);
    if (a.user.role === "admin") fail("مدیران از «ورود به‌جای کاربر» استفاده کنند.");
    if (ownerId) {
      const [m] = await ctx.db.select().from(teamMembers).where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.memberId, a.user.id)));
      if (!m) fail("عضو این حساب نیستید.", 403);
    }
    await ctx.db.update(sessions).set({ actingAs: ownerId }).where(eq(sessions.id, a.sessionId));
  }),

  "team.leave": method(z.tuple([z.string().max(40)]), async (ctx, [ownerId]) => {
    const a = needUser(ctx);
    await ctx.db.delete(teamMembers).where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.memberId, a.user.id)));
    await ctx.db.update(sessions).set({ actingAs: null }).where(and(eq(sessions.userId, a.user.id), eq(sessions.actingAs, ownerId)));
  }),
};
