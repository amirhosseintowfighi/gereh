import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { cosine } from "@/lib/ai";
import { faDateTime } from "@/lib/jalali";
import { chatMessages, NEW_CHAT_TITLE, ownChat } from "../ai/chat";
import { embedTexts, isAiError } from "../ai/endpoints";
import { kbAddDocument, kbQuery, KB_MAX_FILE, ownKb } from "../ai/kb";
import { aiLogBody, aiLogs, aiReport } from "../ai/reports";
import { panelCaller, resolveModel } from "../ai/service";
import { method, needUser } from "../ctx";
import { aiChats, aiKbDocs, aiKbs, aiKeys, aiProjects, aiSettings } from "../db/schema";
import { fail, logActivity, rid } from "../util";

/* web chat, embedding playground, knowledge bases, projects, logs, reports and settings of the AI API */
const id40 = z.string().max(40);
const modelId = z.string().trim().regex(/^[\w.:/@-]{2,80}$/);
const chatPatch = z.object({ title: z.string().trim().min(1).max(80), model: modelId, system: z.string().max(8000), temperature: z.number().min(0).max(2), kbId: id40.nullable() }).partial();

async function checkKb(db: Parameters<typeof ownKb>[0], uid: string, kbId: string | null | undefined) {
  if (kbId && !(await ownKb(db, uid, kbId))) fail("پایگاه دانش پیدا نشد.", 404);
}
function failAi(e: { message: string; http: number }): never { return fail(e.message, e.http); }

export const aiPlusMethods = {
  /* ---------- web chat ---------- */
  "ai.chats": method(z.tuple([]), async (ctx) => {
    const a = needUser(ctx);
    const rows = await ctx.db.select().from(aiChats).where(eq(aiChats.userId, a.uid)).orderBy(desc(aiChats.updatedAt)).limit(200);
    return rows.map((c) => ({ id: c.id, title: c.title, model: c.model, kbId: c.kbId, at: faDateTime(c.updatedAt) }));
  }),

  "ai.chatGet": method(z.tuple([id40]), async (ctx, [id]) => {
    const a = needUser(ctx);
    const c = await ownChat(ctx.db, a.uid, id);
    if (!c) fail("گفتگو پیدا نشد.", 404);
    const msgs = await chatMessages(ctx.db, id);
    return {
      id: c!.id, title: c!.title, model: c!.model, system: c!.system, temperature: c!.temperature, kbId: c!.kbId,
      // images are sent once; history shows their names only
      messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, charged: m.charged, attachments: m.attachments.map((x) => ({ name: x.name, type: x.type })), at: faDateTime(m.createdAt) })),
    };
  }),

  "ai.chatCreate": method(z.tuple([z.object({ model: modelId, system: z.string().max(8000).default(""), temperature: z.number().min(0).max(2).default(0.7), kbId: id40.nullable().default(null) })]), async (ctx, [o]) => {
    const a = needUser(ctx);
    const m = await resolveModel(ctx.db, o.model, [], "chat");
    if (isAiError(m)) failAi(m);
    await checkKb(ctx.db, a.uid, o.kbId);
    const [{ n }] = await ctx.db.select({ n: count() }).from(aiChats).where(eq(aiChats.userId, a.uid));
    if (n >= 500) fail("حداکثر ۵۰۰ گفتگو؛ گفتگوهای قدیمی را حذف کنید.");
    const id = rid("ch");
    await ctx.db.insert(aiChats).values({ id, userId: a.uid, title: NEW_CHAT_TITLE, model: o.model, system: o.system, temperature: o.temperature, kbId: o.kbId });
    return id;
  }),

  "ai.chatUpdate": method(z.tuple([id40, chatPatch]), async (ctx, [id, patch]) => {
    const a = needUser(ctx);
    if (!(await ownChat(ctx.db, a.uid, id))) fail("گفتگو پیدا نشد.", 404);
    if (patch.model) { const m = await resolveModel(ctx.db, patch.model, [], "chat"); if (isAiError(m)) failAi(m); }
    await checkKb(ctx.db, a.uid, patch.kbId);
    await ctx.db.update(aiChats).set(patch).where(eq(aiChats.id, id));
  }),

  "ai.chatDelete": method(z.tuple([id40]), async (ctx, [id]) => {
    const a = needUser(ctx);
    await ctx.db.delete(aiChats).where(and(eq(aiChats.id, id), eq(aiChats.userId, a.uid)));
  }),

  /* ---------- embedding playground ---------- */
  "ai.embedCompare": method(z.tuple([modelId, z.array(z.string().trim().min(1).max(4000)).min(1).max(50), z.string().trim().min(1).max(4000)]), async (ctx, [model, texts, query]) => {
    const a = needUser(ctx);
    const m = await resolveModel(ctx.db, model, [], "embedding");
    if (isAiError(m)) failAi(m);
    const r = await embedTexts(ctx.db, await panelCaller(ctx.db, a.uid), m as Exclude<typeof m, { code: string }>, [query, ...texts]);
    if (isAiError(r)) failAi(r);
    const { vectors, charged } = r as Exclude<typeof r, { code: string }>;
    const ranked = texts.map((text, i) => ({ text, score: Math.round(cosine(vectors[0], vectors[i + 1]) * 1e4) / 1e4 })).sort((x, y) => y.score - x.score);
    return { ranked, dims: vectors[0].length, charged };
  }),

  /* ---------- knowledge bases ---------- */
  "ai.kbCreate": method(z.tuple([z.string().trim().min(2).max(60), modelId]), async (ctx, [name, model]) => {
    const a = needUser(ctx);
    const m = await resolveModel(ctx.db, model, [], "embedding");
    if (isAiError(m)) failAi(m);
    const [{ n }] = await ctx.db.select({ n: count() }).from(aiKbs).where(eq(aiKbs.userId, a.uid));
    if (n >= 20) fail("حداکثر ۲۰ پایگاه دانش.");
    const id = rid("kb");
    await ctx.db.insert(aiKbs).values({ id, userId: a.uid, name, model });
    await logActivity(ctx.db, a.uid, "library", "ساخت پایگاه دانش «" + name + "»", ctx.ip);
    return id;
  }),

  "ai.kbRename": method(z.tuple([id40, z.string().trim().min(2).max(60)]), async (ctx, [id, name]) => {
    const a = needUser(ctx);
    if (!(await ownKb(ctx.db, a.uid, id))) fail("پایگاه دانش پیدا نشد.", 404);
    await ctx.db.update(aiKbs).set({ name }).where(eq(aiKbs.id, id));
  }),

  "ai.kbDelete": method(z.tuple([id40]), async (ctx, [id]) => {
    const a = needUser(ctx);
    const kb = await ownKb(ctx.db, a.uid, id);
    if (!kb) fail("پایگاه دانش پیدا نشد.", 404);
    await ctx.db.update(aiChats).set({ kbId: null }).where(and(eq(aiChats.userId, a.uid), eq(aiChats.kbId, id)));
    await ctx.db.delete(aiKbs).where(eq(aiKbs.id, id));
    await logActivity(ctx.db, a.uid, "library", "حذف پایگاه دانش «" + kb!.name + "»", ctx.ip);
  }),

  /** one file as base64; text is extracted, chunked and embedded right away (billed as embeddings) */
  "ai.kbUpload": method(z.tuple([id40, z.object({ name: z.string().trim().min(1).max(120), mime: z.string().max(100), data: z.string().max(Math.ceil(KB_MAX_FILE * 1.4)) })]), async (ctx, [kbId, f]) => {
    const a = needUser(ctx);
    const r = await kbAddDocument(ctx.db, await panelCaller(ctx.db, a.uid), kbId, { name: f.name, mime: f.mime, data: Buffer.from(f.data, "base64") });
    if (isAiError(r)) failAi(r);
    return r as Exclude<typeof r, { code: string }>;
  }),

  "ai.kbDocDelete": method(z.tuple([id40]), async (ctx, [docId]) => {
    const a = needUser(ctx);
    const [d] = await ctx.db.select({ id: aiKbDocs.id }).from(aiKbDocs).innerJoin(aiKbs, eq(aiKbs.id, aiKbDocs.kbId)).where(and(eq(aiKbDocs.id, docId), eq(aiKbs.userId, a.uid)));
    if (!d) fail("سند پیدا نشد.", 404);
    await ctx.db.delete(aiKbDocs).where(eq(aiKbDocs.id, docId));
  }),

  "ai.kbSearch": method(z.tuple([id40, z.string().trim().min(1).max(4000), z.number().int().min(1).max(20).default(5)]), async (ctx, [kbId, query, k]) => {
    const a = needUser(ctx);
    const r = await kbQuery(ctx.db, await panelCaller(ctx.db, a.uid), kbId, query, k);
    if (isAiError(r)) failAi(r);
    const ok = r as Exclude<typeof r, { code: string }>;
    return { charged: ok.charged, hits: ok.hits.map((h) => ({ document: h.docName, chunk: h.idx, score: Math.round(h.score * 1e4) / 1e4, text: h.text })) };
  }),

  /* ---------- projects ---------- */
  "ai.projectSave": method(z.tuple([z.object({ id: id40.optional(), name: z.string().trim().min(2).max(40), monthlyLimit: z.number().int().min(0).max(10_000_000_000) })]), async (ctx, [p]) => {
    const a = needUser(ctx);
    if (p.id) {
      const r = await ctx.db.update(aiProjects).set({ name: p.name, monthlyLimit: p.monthlyLimit }).where(and(eq(aiProjects.id, p.id), eq(aiProjects.userId, a.uid))).returning({ id: aiProjects.id });
      if (!r.length) fail("پروژه پیدا نشد.", 404);
      return p.id;
    }
    const [{ n }] = await ctx.db.select({ n: count() }).from(aiProjects).where(eq(aiProjects.userId, a.uid));
    if (n >= 50) fail("حداکثر ۵۰ پروژه.");
    const id = rid("pj");
    await ctx.db.insert(aiProjects).values({ id, userId: a.uid, name: p.name, monthlyLimit: p.monthlyLimit });
    return id;
  }),

  "ai.projectDelete": method(z.tuple([id40]), async (ctx, [id]) => {
    const a = needUser(ctx);
    const r = await ctx.db.delete(aiProjects).where(and(eq(aiProjects.id, id), eq(aiProjects.userId, a.uid))).returning({ id: aiProjects.id });
    if (!r.length) fail("پروژه پیدا نشد.", 404);
    await ctx.db.update(aiKeys).set({ projectId: null }).where(and(eq(aiKeys.userId, a.uid), eq(aiKeys.projectId, id)));
  }),

  /* ---------- logs, reports, settings ---------- */
  "ai.logs": method(z.tuple([z.object({ keyId: id40.optional(), model: z.string().max(90).optional(), status: z.enum(["success", "error", "denied", "cancelled"]).optional(), projectId: id40.optional(), days: z.number().int().min(1).max(60).default(7), q: z.string().trim().max(60).optional(), offset: z.number().int().min(0).max(100_000).optional() })]), async (ctx, [f]) => {
    const a = needUser(ctx);
    return aiLogs(ctx.db, a.uid, f);
  }),

  "ai.logBody": method(z.tuple([z.string().max(60)]), async (ctx, [id]) => {
    const a = needUser(ctx);
    return aiLogBody(ctx.db, a.uid, id);
  }),

  "ai.report": method(z.tuple([z.union([z.literal(7), z.literal(30), z.literal(60)])]), async (ctx, [days]) => {
    const a = needUser(ctx);
    return aiReport(ctx.db, a.uid, days);
  }),

  "ai.saveSettings": method(z.tuple([z.object({ retentionDays: z.union([z.literal(30), z.literal(60)]), logBodies: z.boolean(), lowBalance: z.number().int().min(0).max(10_000_000_000) })]), async (ctx, [s]) => {
    const a = needUser(ctx);
    await ctx.db.insert(aiSettings).values({ userId: a.uid, ...s, lowAlertedAt: null }).onConflictDoUpdate({ target: aiSettings.userId, set: { ...s, lowAlertedAt: null } });
    await logActivity(ctx.db, a.uid, "settings-2", "تنظیمات API هوش مصنوعی: نگهداری " + s.retentionDays + " روز، ثبت متن درخواست " + (s.logBodies ? "روشن" : "خاموش"), ctx.ip);
  }),
};
