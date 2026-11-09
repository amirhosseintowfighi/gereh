/* After a metered chat request settles: one ai_opt_events row (counts, costs, hashes — never content), the
   model's estimator calibration and the observed cache hit rate. Never fails the request: errors are logged. */
import "server-only";
import type { DB } from "../../db/client";
import { aiOptEvents } from "../../db/schema";
import type { ChatUsage } from "../translate";
import { costs } from "./analytics";
import { familyOf } from "./cache";
import type { OptCall } from "./call";
import { familiesOf, noteCacheHit, optimizerSettings, updateCalibration } from "./config";
import { answerLanguageOk } from "./language";

export type RecordInput = {
  requestId: string; status: string; format: string;
  model: { id: string; upstream?: string; inPrice: number; outPrice: number; costIn?: number; costOut?: number };
  call: OptCall; usage: ChatUsage | null | undefined; billedIn: number; outTokens: number; charged: number; answer?: string;
};

export async function recordOptEvent(db: DB, i: RecordInput) {
  const r = i.call.report;
  if (!r || i.status === "error") return;
  try {
    const s = await optimizerSettings(db);
    const upstreamModel = i.model.upstream || i.model.id;
    const fam = familyOf(upstreamModel, familiesOf(s));
    const u = i.usage;
    const usage = { prompt: u?.prompt_tokens ?? 0, cached: u?.cached_tokens ?? 0, cacheWrite: u?.cache_write_tokens ?? 0, out: u?.completion_tokens ?? i.outTokens };
    // without reported usage the estimate of what was sent stands in for it
    if (!u) usage.prompt = Math.round(r.optTokens * r.factor);
    const c = costs({
      cost: { in: i.model.costIn ?? 0, out: i.model.costOut ?? 0 }, sale: { in: i.model.inPrice, out: i.model.outPrice },
      cache: { read: fam?.read ?? 1, write: fam?.write ?? 1 }, usage, originalIn: i.billedIn,
      ...(u?.cost !== undefined ? { reportedUsd: u.cost, usdToman: s.usdToman } : {}),
    });
    const hit = usage.cached > 0;
    const langMismatch = !!r.expectLanguage && typeof i.answer === "string" && !answerLanguageOk(i.answer, r.expectLanguage);
    await db.insert(aiOptEvents).values({
      id: i.requestId, feature: r.feature, model: i.model.id, format: i.format, policy: r.policy, status: i.status, changed: r.changed,
      origEst: r.origTokens, optEst: r.optTokens, billedIn: i.billedIn, actualIn: usage.prompt, cachedTokens: usage.cached, cacheWriteTokens: usage.cacheWrite, outTokens: usage.out,
      usageReported: !!u, charged: i.charged, actualCost: c.actual, unoptCost: c.unopt, costSource: c.source, upstreamUsdMicros: u?.cost !== undefined ? Math.round(u.cost * 1e6) : 0,
      latencyMs: r.latencyMs, validatorFailures: r.validatorFailures + (langMismatch ? 1 : 0), fallback: r.fallback, overBudget: r.overBudget,
      cacheFamily: r.cache.family, cacheBreakpoints: r.cache.breakpoints, cacheSkipped: r.cache.skipped, cacheHit: hit, prefixHash: r.cache.prefixHash,
      translated: r.translated, langMismatch, steps: r.steps,
    }).onConflictDoNothing();
    if (u && i.status === "success") {
      if (r.fallback === "" && r.optTokens > 0) await updateCalibration(db, i.model.id, u.prompt_tokens, r.optTokens);
      if (fam && (!fam.explicit || r.cache.breakpoints > 0)) noteCacheHit(r.feature, fam.name, hit);
    }
  } catch (e) {
    console.warn("[ai-opt] event not recorded: " + (e as Error).message);
  }
}
