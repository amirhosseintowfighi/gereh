import "server-only";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { AI_DISCOUNT, rulePrice } from "@/lib/ai";
import { createKey, resolveModel, runChat, syncUpstreamModels } from "../ai/service";
import { aiUpstream } from "../ai/upstream";
import { actor, method, needStaff, needUser } from "../ctx";
import { aiKeys, aiModels } from "../db/schema";
import { fail, logActivity, logAudit } from "../util";

const modelId = z.string().trim().regex(/^[\w.:/@-]{2,80}$/);
const keyFields = z.object({
  name: z.string().trim().min(2).max(40),
  models: z.array(modelId).max(100),
  dailyCap: z.number().int().min(0).max(1_000_000_000),
  monthlyCap: z.number().int().min(0).max(10_000_000_000),
  rpm: z.number().int().min(1).max(600),
  expiresDays: z.number().int().min(0).max(365),
});

async function ownKey(ctx: Parameters<typeof needUser>[0], id: string) {
  const a = needUser(ctx);
  const [k] = await ctx.db.select().from(aiKeys).where(and(eq(aiKeys.id, id), eq(aiKeys.userId, a.uid)));
  if (!k) fail("کلید پیدا نشد.", 404);
  return { a, k: k! };
}

export const aiMethods = {
  /** returns the full key once; only its hash is kept */
  "ai.createKey": method(z.tuple([keyFields]), async (ctx, [k]) => {
    const a = needUser(ctx);
    const [{ n }] = await ctx.db.select({ n: count() }).from(aiKeys).where(and(eq(aiKeys.userId, a.uid), eq(aiKeys.status, "active")));
    if (n >= 20) fail("حداکثر ۲۰ کلید فعال؛ کلیدهای بی‌استفاده را باطل کنید.");
    const r = await createKey(ctx.db, a.uid, k);
    await logActivity(ctx.db, a.uid, "key-round", "ساخت کلید API هوش مصنوعی «" + k.name + "»", ctx.ip);
    return r.key;
  }),

  "ai.updateKey": method(z.tuple([z.string().max(40), keyFields.omit({ expiresDays: true }).partial()]), async (ctx, [id, patch]) => {
    const { k } = await ownKey(ctx, id);
    if (k.status !== "active") fail("کلید باطل‌شده قابل ویرایش نیست.");
    await ctx.db.update(aiKeys).set(patch).where(eq(aiKeys.id, id));
  }),

  "ai.revokeKey": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    const { a, k } = await ownKey(ctx, id);
    await ctx.db.update(aiKeys).set({ status: "revoked" }).where(eq(aiKeys.id, id));
    await logActivity(ctx.db, a.uid, "key-round", "ابطال کلید API هوش مصنوعی «" + k.name + "»", ctx.ip);
  }),

  /** the panel playground: same metered path as the API (billed from the wallet) */
  "ai.playground": method(z.tuple([modelId, z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(20_000) })).min(1).max(40), z.number().int().min(16).max(4096)]), async (ctx, [model, messages, maxTokens]) => {
    const a = needUser(ctx);
    const m = await resolveModel(ctx.db, model, []);
    if ("http" in m) fail(m.message, m.http);
    const res = await runChat({
      db: ctx.db, caller: { userId: a.uid, keyId: null, dailyCap: 0, monthlyCap: 0 }, model: m as Exclude<typeof m, { http: number }>, format: "panel",
      chat: { model, messages, max_tokens: maxTokens }, render: { json: (r) => r, stream: () => { throw new Error("no stream"); } },
    });
    if (res.kind === "error") fail(res.error.message, res.error.http);
    const r = res as Extract<typeof res, { kind: "json" }>;
    const out = r.body as { text: string; usage: { prompt_tokens: number; completion_tokens: number } | null };
    return { text: out.text, charged: r.charged, inTokens: out.usage?.prompt_tokens ?? 0, outTokens: out.usage?.completion_tokens ?? 0 };
  }),

  /* ---------- staff ---------- */
  "ai.adminModel": method(z.tuple([modelId, z.object({
    name: z.string().trim().min(2).max(60).optional(), vendor: z.string().trim().min(2).max(30).optional(), upstream: z.string().trim().max(120).regex(/^[\w.:/@-]*$/).optional(),
    inPrice: z.number().int().min(0).max(1_000_000_000).optional(), outPrice: z.number().int().min(0).max(1_000_000_000).optional(),
    refIn: z.number().int().min(0).max(1_000_000_000).optional(), refOut: z.number().int().min(0).max(1_000_000_000).optional(),
    context: z.number().int().min(1024).max(10_000_000).optional(), active: z.boolean().optional(),
  })]), async (ctx, [id, patch]) => {
    needStaff(ctx, "ai");
    const [m] = await ctx.db.select().from(aiModels).where(eq(aiModels.id, id));
    if (!m) fail("مدل پیدا نشد.", 404);
    if (patch.active && !(patch.inPrice ?? m!.inPrice) && !(patch.outPrice ?? m!.outPrice)) fail("پیش از فعال‌سازی، قیمت مدل را تعیین کنید.");
    await ctx.db.update(aiModels).set(patch).where(eq(aiModels.id, id));
    await logAudit(ctx.db, actor(ctx), "ویرایش مدل هوش مصنوعی", id + " " + JSON.stringify(patch), ctx.ip);
  }),

  "ai.adminAddModel": method(z.tuple([z.object({ id: modelId, name: z.string().trim().min(2).max(60), vendor: z.string().trim().min(2).max(30), upstream: z.string().trim().max(120).regex(/^[\w.:/@-]*$/), inPrice: z.number().int().min(1), outPrice: z.number().int().min(1), context: z.number().int().min(1024).max(10_000_000) })]), async (ctx, [m]) => {
    needStaff(ctx, "ai");
    const r = await ctx.db.insert(aiModels).values({ ...m, active: false, position: 900 }).onConflictDoNothing().returning({ id: aiModels.id });
    if (!r.length) fail("مدلی با این شناسه وجود دارد.");
    await logAudit(ctx.db, actor(ctx), "افزودن مدل هوش مصنوعی", m.id, ctx.ip);
  }),

  /** imports models the upstream lists but the catalog lacks (inactive until priced) */
  "ai.adminSync": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "ai");
    try { return await syncUpstreamModels(ctx.db); } catch (e) { fail("دریافت فهرست مدل‌ها از سرویس‌دهنده ناموفق بود: " + (e as Error).message, 502); }
  }),

  /** reprices every model that has a competitor reference: reference (or market average) minus the discount */
  "ai.adminApplyRule": method(z.tuple([z.number().min(0).max(0.5)]), async (ctx, [discount]) => {
    needStaff(ctx, "ai");
    const rows = await ctx.db.select().from(aiModels);
    let n = 0;
    for (const m of rows) {
      if (!m.refIn && !m.refOut) continue;
      await ctx.db.update(aiModels).set({ inPrice: rulePrice(m.refIn, 0, discount), outPrice: rulePrice(m.refOut, 0, discount) }).where(eq(aiModels.id, m.id));
      n++;
    }
    await logAudit(ctx.db, actor(ctx), "اعمال قاعده قیمت هوش مصنوعی", Math.round(discount * 100) + "% زیر مرجع، " + n + " مدل", ctx.ip);
    return n;
  }),

  "ai.adminTest": method(z.tuple([modelId]), async (ctx, [id]) => {
    needStaff(ctx, "ai");
    const [m] = await ctx.db.select().from(aiModels).where(eq(aiModels.id, id));
    if (!m) fail("مدل پیدا نشد.", 404);
    const t0 = Date.now();
    try {
      const res = await aiUpstream().chat({ model: m!.upstream || m!.id, messages: [{ role: "user", content: "Reply with: OK" }], max_tokens: 8 }, AbortSignal.timeout(60_000));
      const body = await res.text();
      if (!res.ok) return { ok: false, ms: Date.now() - t0, detail: "HTTP " + res.status + " " + body.slice(0, 200) };
      const j = JSON.parse(body) as { model?: string; usage?: unknown; choices?: { message?: { content?: string } }[] };
      return { ok: true, ms: Date.now() - t0, detail: "پاسخ: " + (j.choices?.[0]?.message?.content ?? "").slice(0, 80) + " | مدل برگشتی: " + (j.model ?? "—") + " | usage: " + (j.usage ? "دارد" : "ندارد") };
    } catch (e) { return { ok: false, ms: Date.now() - t0, detail: (e as Error).message }; }
  }),

  "ai.adminDefaults": method(z.tuple([]), async (ctx) => { needStaff(ctx, "ai"); return { discount: AI_DISCOUNT, upstream: aiUpstream().name }; }),
};
