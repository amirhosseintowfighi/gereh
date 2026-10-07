/* Live chat between site visitors and staff. A visitor starts a chat and gets a random token (kept in
   localStorage); only its SHA-256 is stored, and every visitor call is authorised by that token alone,
   so a chat id leaking does not expose the conversation. Staff answer from /admin/chats. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import { KB } from "@/content/kb";
import { faDateTime } from "@/lib/jalali";
import { plain } from "@/lib/markdown";
import { rateLimit } from "./auth";
import type { Ctx } from "./ctx";
import { chatMessages, chats } from "./db/schema";
import { sendEmail } from "./messaging";
import { getSettings } from "./state";
import { AppError, fail, rid, sha256 } from "./util";

export const START = z.object({ name: z.string().trim().min(2).max(60), email: z.string().trim().max(120).optional().default(""), text: z.string().trim().min(1).max(2000), page: z.string().max(200).optional().default("") });
export const SEND = z.object({ text: z.string().trim().min(1).max(2000) });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** up to two knowledge-base articles whose title/description share words with the question */
export function suggest(text: string) {
  const words = text.toLowerCase().split(/[\s،,.?؟!]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  return KB.map((a) => {
    const hay = (a.title + " " + a.description + " " + plain(a.body)).toLowerCase();
    return { a, score: words.filter((w) => hay.includes(w)).length };
  }).filter((x) => x.score >= Math.min(2, words.length)).sort((x, y) => y.score - x.score).slice(0, 2).map((x) => x.a);
}

const readToken = (header: string | null) => {
  const t = header?.trim() || "";
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(t)) throw new AppError("گفتگو پیدا نشد.", 404);
  return sha256(t);
};
async function byToken(ctx: Ctx, header: string | null) {
  const [c] = await ctx.db.select().from(chats).where(eq(chats.tokenHash, readToken(header)));
  if (!c) throw new AppError("گفتگو پیدا نشد.", 404);
  return c;
}

export async function startChat(ctx: Ctx, input: z.input<typeof START>, origin: string) {
  const b = START.parse(input);
  await rateLimit(ctx.db, "chat:start:" + (ctx.ip || "anon"), 5, 3600);
  const u = ctx.auth?.user;
  const email = (b.email || u?.email || "").toLowerCase();
  if (email && !EMAIL_RE.test(email)) fail("ایمیل معتبر نیست.");
  const token = randomBytes(32).toString("base64url");
  const id = rid("chat");
  const tips = suggest(b.text);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(chats).values({ id, tokenHash: sha256(token), userId: ctx.auth?.uid ?? null, name: b.name, email, page: b.page, ip: ctx.ip });
    await tx.insert(chatMessages).values([
      { chatId: id, from: "visitor", author: b.name, text: b.text },
      { chatId: id, from: "system", text: "پیام شما به پشتیبانی رسید؛ معمولاً در چند دقیقه پاسخ می‌دهیم." + (tips.length ? " تا آن موقع شاید این راهنماها کمک کنند: " + tips.map((a) => "[" + a.title + "](/kb/" + a.slug + ")").join("، ") : "") },
    ]);
  });
  const s = await getSettings(ctx.db);
  void sendEmail(s.supportEmail, "گفتگوی آنلاین جدید: " + b.name, b.name + (email ? " <" + email + ">" : "") + "\n\n" + b.text + "\n\n" + origin + "/admin/chats?id=" + id).catch(() => {});
  return { token, ...(await visitorView(ctx, token, 0)) };
}

export async function visitorView(ctx: Ctx, header: string | null, after: number) {
  const c = await byToken(ctx, header);
  const msgs = await ctx.db.select().from(chatMessages).where(and(eq(chatMessages.chatId, c.id), gt(chatMessages.id, after))).orderBy(asc(chatMessages.id)).limit(200);
  return { status: c.status, agent: c.agent, messages: msgs.map((m) => ({ id: m.id, from: m.from, author: m.from === "visitor" ? "" : m.author, text: m.text, at: faDateTime(m.createdAt) })) };
}

export async function visitorSend(ctx: Ctx, header: string | null, input: unknown) {
  const { text } = SEND.parse(input);
  const c = await byToken(ctx, header);
  await rateLimit(ctx.db, "chat:msg:" + c.id, 20, 60);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(chatMessages).values({ chatId: c.id, from: "visitor", author: c.name, text });
    await tx.update(chats).set({ status: "open", unread: true, lastAt: new Date() }).where(eq(chats.id, c.id));
  });
}

/** visitor ends the chat; a transcript goes to their email if they left one */
export async function visitorClose(ctx: Ctx, header: string | null) {
  const c = await byToken(ctx, header);
  if (c.status === "closed") return;
  await ctx.db.update(chats).set({ status: "closed" }).where(eq(chats.id, c.id));
  await ctx.db.insert(chatMessages).values({ chatId: c.id, from: "system", text: "گفتگو توسط کاربر بسته شد." });
  if (c.email) {
    const msgs = await ctx.db.select().from(chatMessages).where(and(eq(chatMessages.chatId, c.id), ne(chatMessages.from, "system"))).orderBy(asc(chatMessages.id));
    const lines = msgs.map((m) => "[" + faDateTime(m.createdAt) + "] " + (m.from === "visitor" ? "شما" : m.author || "پشتیبانی") + ": " + m.text);
    void sendEmail(c.email, "متن گفتگوی شما با پشتیبانی گره", lines.join("\n\n")).catch(() => {});
  }
}
