/* Chats linked to «دستیار گره»: the one-time /start code (10 minutes, single use, bound to the person and the account
   they work in), the link row, and its revocation. A link holds only while the person is active, still in the team
   and has the same password as when it was made; anything else revokes it on its next use. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, like, sql } from "drizzle-orm";
import type { Auth, UserRow } from "../auth";
import type { DB, Tx } from "../db/client";
import { assistantBotButtons, assistantBotChats, kv, notifyChannels, teamMembers, users } from "../db/schema";
import { logActivity, rid, sha256 } from "../util";
import { BOT_NAME, type BotKind } from "./api";

export const LINK_TTL_MS = 10 * 60_000;
export type BotLink = typeof assistantBotChats.$inferSelect;
type Code = { userId: string; accountId: string; kind: BotKind; exp: number };

export async function newLinkCode(db: DB, who: { userId: string; accountId: string }, kind: BotKind) {
  await db.delete(kv).where(and(like(kv.key, "botlink:%"), sql`coalesce((${kv.value}->>'exp')::bigint, 0) < ${Date.now()}`));
  const code = randomBytes(12).toString("base64url");
  const exp = Date.now() + LINK_TTL_MS;
  await db.insert(kv).values({ key: "botlink:" + code, value: { userId: who.userId, accountId: who.accountId, kind, exp } satisfies Code });
  return { code, exp };
}

/** takes the code (deleting it, so a second /start with it fails) */
export async function claimCode(db: DB, kind: BotKind, code: string): Promise<Code | null> {
  if (!/^[\w-]{8,64}$/.test(code)) return null;
  const [row] = await db.delete(kv).where(eq(kv.key, "botlink:" + code)).returning();
  const v = row?.value as Code | undefined;
  return v && v.kind === kind && v.exp > Date.now() && v.userId ? { ...v, accountId: v.accountId || v.userId } : null;
}

export const credMark = (u: Pick<UserRow, "id" | "passwordHash">) => sha256("bot-cred\n" + u.id + "\n" + (u.passwordHash ?? ""));

export async function linkByChat(db: DB, kind: BotKind, chatId: string) {
  const [l] = await db.select().from(assistantBotChats).where(and(eq(assistantBotChats.kind, kind), eq(assistantBotChats.chatId, chatId)));
  return l ?? null;
}

/** removes the link, the notification channel it feeds and its open buttons */
export async function revokeLink(db: DB | Tx, l: BotLink, why: string) {
  await db.delete(assistantBotChats).where(eq(assistantBotChats.id, l.id));
  if (l.notifyChannelId) await db.delete(notifyChannels).where(eq(notifyChannels.id, l.notifyChannelId));
  await db.update(assistantBotButtons).set({ usedAt: new Date() }).where(and(eq(assistantBotButtons.kind, l.kind), eq(assistantBotButtons.chatId, l.chatId), isNull(assistantBotButtons.usedAt)));
  await logActivity(db, l.accountId, "send", "قطع اتصال " + BOT_NAME[l.kind] + " از دستیار گره (" + why + ")");
}

/** the person the chat acts as, checked again on every use; null (and revoked) when the link no longer holds */
export async function liveAuth(db: DB, l: BotLink): Promise<Auth | null> {
  const [u] = await db.select().from(users).where(eq(users.id, l.userId));
  let why = "";
  if (!u) why = "حساب حذف شد";
  else if (u.status === "suspended" && u.role !== "admin") why = "حساب غیرفعال شد";
  else if (credMark(u) !== l.credMark) why = "رمز عبور تغییر کرد";
  let teamRole: Auth["teamRole"];
  if (!why && l.accountId !== l.userId) {
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.ownerId, l.accountId), eq(teamMembers.memberId, l.userId)));
    if (!m) why = "عضویت در تیم پایان یافت";
    else teamRole = m.role;
  }
  if (why) { await revokeLink(db, l, why); return null; }
  return { sessionId: "bot:" + l.id, user: u!, uid: l.accountId, ...(teamRole ? { teamRole } : {}) };
}

/** links the chat to the person of the code; one chat belongs to one person (linking again replaces it). The
    account owner's chat also receives the account's notifications (a notify_channels row). */
export async function linkChat(db: DB, kind: BotKind, chatId: string, label: string, v: Code): Promise<{ user: UserRow; link: BotLink } | null> {
  const [u] = await db.select().from(users).where(eq(users.id, v.userId));
  if (!u || (u.status === "suspended" && u.role !== "admin")) return null;
  if (v.accountId !== v.userId) {
    const [m] = await db.select().from(teamMembers).where(and(eq(teamMembers.ownerId, v.accountId), eq(teamMembers.memberId, v.userId)));
    if (!m) return null;
  }
  const old = await linkByChat(db, kind, chatId);
  if (old) await revokeLink(db, old, "اتصال دوباره");
  let notifyChannelId: string | null = null;
  if (v.accountId === v.userId) {
    const [dup] = await db.select({ id: notifyChannels.id }).from(notifyChannels).where(and(eq(notifyChannels.userId, v.userId), eq(notifyChannels.kind, kind), eq(notifyChannels.target, chatId)));
    if (dup) { await db.update(notifyChannels).set({ active: true }).where(eq(notifyChannels.id, dup.id)); notifyChannelId = dup.id; }
    else {
      notifyChannelId = "ch-" + randomBytes(6).toString("hex");
      await db.insert(notifyChannels).values({ id: notifyChannelId, userId: v.userId, kind, target: chatId, label: BOT_NAME[kind] + (label ? " " + label : "") });
    }
  }
  const [link] = await db.insert(assistantBotChats).values({ id: rid("bch"), kind, chatId, userId: v.userId, accountId: v.accountId, label: label.slice(0, 60), notifyChannelId, credMark: credMark(u), lastAt: new Date() }).returning();
  await logActivity(db, v.accountId, "send", "اتصال " + BOT_NAME[kind] + " به دستیار گره" + (v.accountId !== v.userId ? " (" + u.name + ")" : ""));
  return { user: u, link };
}

/** a notification channel that a revoked link fed stops with it */
export async function channelStillLinked(db: DB, channelId: string) {
  const [l] = await db.select().from(assistantBotChats).where(eq(assistantBotChats.notifyChannelId, channelId));
  return !l || !!(await liveAuth(db, l));
}

/** the person's chats in the account they work in (revoked ones are dropped on the way) */
export async function listLinks(db: DB, a: Auth) {
  const rows = await db.select().from(assistantBotChats).where(and(eq(assistantBotChats.userId, a.user.id), eq(assistantBotChats.accountId, a.uid)));
  const out: BotLink[] = [];
  for (const l of rows) if (await liveAuth(db, l)) out.push(l);
  return out;
}
