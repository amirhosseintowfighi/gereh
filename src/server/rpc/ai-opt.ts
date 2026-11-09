/* «بهینه‌ساز توکن» (group "aiOpt"), staff only: analytics, the settings (kv overrides per feature, model and
   plan), the offline benchmark and the admin-triggered live benchmark (src/server/ai/optimizer). */
import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { offlineBenchmark, startBenchmark } from "../ai/optimizer/benchmark";
import { envEnabled, explicitCacheAllowed, isOpenRouter, optimizerSettings, saveOptimizerSettings, SETTINGS } from "../ai/optimizer/config";
import { FEATURE_DEFAULTS, resolvePolicy } from "../ai/optimizer/policy";
import { optStats } from "../ai/optimizer/stats";
import { OPT_FEATURES } from "../ai/optimizer/types";
import { actor, method, needStaff } from "../ctx";
import { aiModels, aiOptBenchmarks } from "../db/schema";
import { fail, logAudit } from "../util";

export const aiOptRpc = {
  "aiOpt.stats": method(z.tuple([z.number().int().min(1).max(90)]), async (ctx, [days]) => {
    needStaff(ctx, "ai");
    return optStats(ctx.db, days);
  }),

  "aiOpt.settings": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "ai");
    const s = await optimizerSettings(ctx.db);
    return {
      settings: s, envEnabled: envEnabled(), openRouter: isOpenRouter(), cacheControlActive: explicitCacheAllowed(s), translateConfigured: !!process.env.AI_OPT_TRANSLATE_URL,
      // the effective policy of every feature with the current overrides (the public API: as without opt-in, and with it)
      effective: Object.fromEntries(OPT_FEATURES.map((f) => [f, resolvePolicy({ feature: f }, { features: s.features, models: s.models, plans: s.plans })])),
      optInPolicy: resolvePolicy({ feature: "api", optIn: true }, { features: s.features }),
      defaults: FEATURE_DEFAULTS,
    };
  }),

  "aiOpt.saveSettings": method(z.tuple([SETTINGS.partial()]), async (ctx, [patch]) => {
    needStaff(ctx, "settings");
    const next = await saveOptimizerSettings(ctx.db, patch);
    await logAudit(ctx.db, actor(ctx), "تنظیمات بهینه‌ساز توکن", Object.keys(patch).join("، "), ctx.ip);
    return next;
  }),

  "aiOpt.offline": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "ai");
    return offlineBenchmark();
  }),

  /** the live benchmark: admin-triggered only, never automatic; budget in USD, capped by the settings */
  "aiOpt.benchStart": method(z.tuple([z.string().max(80), z.number().min(0.01).max(1000), z.boolean()]), async (ctx, [modelId, budgetUsd, judge]) => {
    const a = needStaff(ctx, "settings");
    const [m] = await ctx.db.select().from(aiModels).where(eq(aiModels.id, modelId));
    if (!m || m.kind !== "chat") fail("مدل گفتگو پیدا نشد.", 404);
    let id = "";
    try { id = await startBenchmark(ctx.db, { model: m!, budgetUsd, judge, by: a.user.id }); } catch (e) { fail((e as Error).message, 409); }
    await logAudit(ctx.db, actor(ctx), "اجرای محک بهینه‌ساز توکن", modelId + " · سقف " + budgetUsd + " دلار", ctx.ip);
    return id;
  }),

  "aiOpt.benchList": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "ai");
    const rows = await ctx.db.select().from(aiOptBenchmarks).orderBy(desc(aiOptBenchmarks.createdAt)).limit(20);
    return rows.map((r) => ({ id: r.id, model: r.model, status: r.status, budgetUsd: r.budgetUsd, spentUsd: r.spentUsd, report: r.report, error: r.error, createdAt: r.createdAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }));
  }),
};
