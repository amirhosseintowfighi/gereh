/* Knowledge bases (RAG): documents are turned into text, chunked, embedded through the metered
   gateway path (billed like any embedding request) and stored via the vector store. Queries embed the
   question with the base's model and return the closest chunks; the web chat adds them as context. */
import "server-only";
import { and, count, eq } from "drizzle-orm";
import { chunkText } from "@/lib/ai";
import type { DB } from "../db/client";
import { aiKbChunks, aiKbDocs, aiKbs } from "../db/schema";
import { rid } from "../util";
import { embedTexts, isAiError } from "./endpoints";
import { extractText, fileKind } from "./extract";
import { aiErr, resolveModel, type AiError, type Caller } from "./service";
import { vectorStore, type Hit } from "./vectors";

export const KB_MAX_FILE = 5 * 1024 * 1024;
export const KB_MAX_CHARS = 400_000;
export const KB_MAX_CHUNKS = 5000;

export async function ownKb(db: DB, userId: string, kbId: string) {
  const [kb] = await db.select().from(aiKbs).where(and(eq(aiKbs.id, kbId), eq(aiKbs.userId, userId)));
  return kb ?? null;
}

/** adds one file: text → chunks → embeddings → vectors; nothing is kept when embedding fails */
export async function kbAddDocument(db: DB, caller: Caller, kbId: string, file: { name: string; mime: string; data: Buffer }): Promise<{ docId: string; chunks: number; charged: number } | AiError> {
  const kb = await ownKb(db, caller.userId, kbId);
  if (!kb) return aiErr(404, "kb_not_found", "پایگاه دانش پیدا نشد.");
  const kind = fileKind(file.name, file.mime);
  if (!kind) return aiErr(400, "unsupported_file", "فقط فایل‌های txt، md، csv، json، html و pdf پشتیبانی می‌شوند.");
  if (file.data.length > KB_MAX_FILE) return aiErr(413, "file_too_large", "حداکثر حجم هر فایل ۵ مگابایت است.");
  const text = extractText(kind, file.data).slice(0, KB_MAX_CHARS);
  if (text.replace(/\s/g, "").length < 20) return aiErr(400, "no_text", kind === "pdf" ? "متنی از این PDF استخراج نشد (احتمالاً اسکن‌شده است یا فونت آن متن قابل خواندن ندارد)؛ نسخه متنی آن را بارگذاری کنید." : "فایل متنی کافی ندارد.");
  const chunks = chunkText(text);
  const [{ n }] = await db.select({ n: count() }).from(aiKbChunks).where(eq(aiKbChunks.kbId, kbId));
  if (n + chunks.length > KB_MAX_CHUNKS) return aiErr(400, "kb_full", "ظرفیت این پایگاه دانش (" + KB_MAX_CHUNKS.toLocaleString("fa-IR") + " قطعه) پر می‌شود؛ پایگاه جدیدی بسازید.");
  const model = await resolveModel(db, kb.model, [], "embedding");
  if (isAiError(model)) return model;
  const docId = rid("kd");
  await db.insert(aiKbDocs).values({ id: docId, kbId, name: file.name.slice(0, 120), mime: kind, chars: text.length });
  const emb = await embedTexts(db, caller, model, chunks, "kb");
  if (isAiError(emb)) { await db.delete(aiKbDocs).where(eq(aiKbDocs.id, docId)); return emb; }
  await vectorStore().add(db, chunks.map((t, idx) => ({ kbId, docId, idx, text: t, embedding: emb.vectors[idx] })));
  await db.update(aiKbDocs).set({ chunks: chunks.length, charged: emb.charged }).where(eq(aiKbDocs.id, docId));
  return { docId, chunks: chunks.length, charged: emb.charged };
}

/** the closest chunks to a question; the question's embedding is billed to the caller */
export async function kbQuery(db: DB, caller: Caller, kbId: string, query: string, topK = 5, allowed: string[] = []): Promise<{ hits: Hit[]; charged: number; model: string } | AiError> {
  const q = query.trim();
  if (!q) return aiErr(400, "invalid_request", "فیلد query لازم است.");
  if (q.length > 8000) return aiErr(400, "invalid_request", "query حداکثر ۸۰۰۰ نویسه است.");
  const kb = await ownKb(db, caller.userId, kbId);
  if (!kb) return aiErr(404, "kb_not_found", "پایگاه دانش پیدا نشد.");
  const model = await resolveModel(db, kb.model, allowed, "embedding");
  if (isAiError(model)) return model;
  const emb = await embedTexts(db, caller, model, [q], "kb");
  if (isAiError(emb)) return emb;
  const hits = await vectorStore().search(db, kbId, emb.vectors[0], Math.min(20, Math.max(1, topK)));
  return { hits, charged: emb.charged, model: model.id };
}

/** system-prompt block with the retrieved passages */
export const kbContext = (hits: Hit[]) =>
  "Answer using the following passages from the user's knowledge base when relevant. Cite the document name in brackets. If the passages do not contain the answer, say so.\n\n" +
  hits.map((h, i) => "[" + (i + 1) + "] (" + h.docName + ")\n" + h.text).join("\n\n");

export const hitOut = (h: Hit) => ({ text: h.text, score: Math.round(h.score * 1e4) / 1e4, document: h.docName, document_id: h.docId, chunk: h.idx });
