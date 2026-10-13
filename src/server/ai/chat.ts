/* Web chat in the panel («چت»): saved conversations per customer, streamed answers over the same
   metered path as the API (format "panel"), optional knowledge-base context and attachments.
   The stream is OpenAI chat chunks plus our own events: {"gereh":{"sources":[…]}} first and
   {"gereh":{"charged":n,"messageId":id}} last. */
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { aiChatMessages, aiChats, aiUsage } from "../db/schema";
import { isAiError } from "./endpoints";
import { kbContext, kbQuery } from "./kb";
import { panelCaller, resolveModel, runChat, type AiError } from "./service";
import { ChatStream, type ChatMessage } from "./translate";

export const NEW_CHAT_TITLE = "گفتگوی جدید";
export type Attachment = { name: string; type: "image" | "text"; data: string };
export const MAX_ATTACH = 4, MAX_IMAGE = 1_500_000, MAX_TEXT_FILE = 100_000;
const HISTORY = 40;
const enc = new TextEncoder();
const event = (o: unknown) => enc.encode("data: " + JSON.stringify(o) + "\n\n");

export async function ownChat(db: DB, userId: string, id: string) {
  const [c] = await db.select().from(aiChats).where(and(eq(aiChats.id, id), eq(aiChats.userId, userId)));
  return c ?? null;
}

export function validAttachments(list: Attachment[], vision: boolean): string | null {
  if (list.length > MAX_ATTACH) return "حداکثر " + MAX_ATTACH.toLocaleString("fa-IR") + " پیوست در هر پیام.";
  for (const a of list) {
    if (a.type === "image") {
      if (!vision) return "مدل انتخاب‌شده تصویر نمی‌پذیرد؛ مدلی با پشتیبانی تصویر انتخاب کنید.";
      if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(a.data)) return "تصویر «" + a.name + "» معتبر نیست (png، jpeg، webp یا gif).";
      if (a.data.length > MAX_IMAGE) return "حجم تصویر «" + a.name + "» بیش از حد مجاز است (حدود ۱ مگابایت).";
    } else if (a.data.length > MAX_TEXT_FILE) return "فایل «" + a.name + "» بیش از ۱۰۰ هزار نویسه است.";
  }
  return null;
}

/** one stored message → the OpenAI content the model sees */
function toModel(m: { role: "user" | "assistant"; content: string; attachments: Attachment[] }): ChatMessage {
  const texts = m.attachments.filter((a) => a.type === "text").map((a) => "\n\n--- " + a.name + " ---\n" + a.data).join("");
  const images = m.attachments.filter((a) => a.type === "image");
  if (!images.length) return { role: m.role, content: m.content + texts };
  return { role: m.role, content: [{ type: "text", text: m.content + texts }, ...images.map((a) => ({ type: "image_url", image_url: { url: a.data } }))] };
}

/** appends the user's message and streams the answer; the answer is saved when the stream completes */
export async function chatSend(db: DB, userId: string, chatId: string, content: string, attachments: Attachment[]): Promise<Response | AiError> {
  const chat = await ownChat(db, userId, chatId);
  if (!chat) return { http: 404, code: "not_found", message: "گفتگو پیدا نشد." };
  const model = await resolveModel(db, chat.model, [], "chat");
  if (isAiError(model)) return model;
  const bad = validAttachments(attachments, model.vision);
  if (bad) return { http: 400, code: "invalid_request", message: bad };
  const caller = await panelCaller(db, userId);

  let system = chat.system.trim();
  let sources: { document: string; score: number; text: string }[] = [];
  if (chat.kbId) {
    const r = await kbQuery(db, caller, chat.kbId, content, 5);
    if (isAiError(r)) return r;
    sources = r.hits.map((h) => ({ document: h.docName, score: Math.round(h.score * 1000) / 1000, text: h.text.slice(0, 300) }));
    if (r.hits.length) system = (system ? system + "\n\n" : "") + kbContext(r.hits);
  }

  await db.insert(aiChatMessages).values({ chatId, role: "user", content, attachments });
  const history = (await db.select().from(aiChatMessages).where(eq(aiChatMessages.chatId, chatId)).orderBy(desc(aiChatMessages.id)).limit(HISTORY)).reverse();
  const messages: ChatMessage[] = [...(system ? [{ role: "system" as const, content: system }] : []), ...history.map((m) => toModel(m))];
  if (chat.title === NEW_CHAT_TITLE) await db.update(aiChats).set({ title: content.replace(/\s+/g, " ").trim().slice(0, 60) || NEW_CHAT_TITLE }).where(eq(aiChats.id, chatId));

  let tx: ChatStream | null = null;
  const run = await runChat({
    db, caller, model, format: "panel",
    chat: { model: model.id, messages, stream: true, temperature: chat.temperature, max_tokens: 4096 },
    render: { json: (r) => r, stream: () => (tx = new ChatStream(model.id, false)) },
  });
  if (run.kind === "error") return run.error;
  if (run.kind !== "stream") return { http: 500, code: "internal", message: "پاسخ غیرمنتظره." };
  const requestId = run.requestId;
  const out = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      ctrl.enqueue(event({ gereh: { requestId, sources } }));
      const reader = run.stream.getReader();
      try {
        for (;;) { const { value, done } = await reader.read(); if (done) break; ctrl.enqueue(value); }
        const text = (tx as ChatStream | null)?.result().text ?? "";
        const [u] = await db.select({ charged: aiUsage.charged }).from(aiUsage).where(eq(aiUsage.id, requestId));
        const [saved] = await db.insert(aiChatMessages).values({ chatId, role: "assistant", content: text, charged: u?.charged ?? 0 }).returning({ id: aiChatMessages.id });
        await db.update(aiChats).set({ updatedAt: new Date() }).where(eq(aiChats.id, chatId));
        ctrl.enqueue(event({ gereh: { charged: u?.charged ?? 0, messageId: saved.id } }));
        ctrl.close();
      } catch (e) {
        try { ctrl.error(e); } catch { /* closed */ }
      }
    },
    cancel(reason) { return run.stream.cancel(reason); },
  });
  return new Response(out, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

export async function chatMessages(db: DB, chatId: string) {
  return db.select().from(aiChatMessages).where(eq(aiChatMessages.chatId, chatId)).orderBy(asc(aiChatMessages.id));
}
