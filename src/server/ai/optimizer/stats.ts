/* Admin analytics of «بهینه‌ساز توکن»: ai_opt_events over a period, summarized with the formulas of
   analytics.ts, overall, per feature, per model and per Tehran day. */
import "server-only";
import { desc, gte, sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import { aiOptCalibration, aiOptEvents } from "../../db/schema";
import { groupSummaries, summarize, type EventRow, type OptSummary } from "./analytics";

export type OptStats = {
  days: number; since: string; total: OptSummary;
  byFeature: { key: string; summary: OptSummary }[];
  byModel: { key: string; summary: OptSummary }[];
  daily: { key: string; summary: OptSummary }[];
  calibration: { model: string; factor: number; samples: number }[];
  /** at most this many recent events are summarized */
  capped: boolean;
};

const CAP = 100_000;

export async function optStats(db: DB, days = 7): Promise<OptStats> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.select({
    feature: aiOptEvents.feature, model: aiOptEvents.model, day: sql<string>`to_char(${aiOptEvents.createdAt} at time zone 'Asia/Tehran', 'YYYY-MM-DD')`,
    changed: aiOptEvents.changed, origEst: aiOptEvents.origEst, optEst: aiOptEvents.optEst, billedIn: aiOptEvents.billedIn, actualIn: aiOptEvents.actualIn,
    cachedTokens: aiOptEvents.cachedTokens, outTokens: aiOptEvents.outTokens, usageReported: aiOptEvents.usageReported, charged: aiOptEvents.charged,
    actualCost: aiOptEvents.actualCost, unoptCost: aiOptEvents.unoptCost, costSource: aiOptEvents.costSource, validatorFailures: aiOptEvents.validatorFailures,
    fallback: aiOptEvents.fallback, overBudget: aiOptEvents.overBudget, cacheHit: aiOptEvents.cacheHit, cacheBreakpoints: aiOptEvents.cacheBreakpoints, langMismatch: aiOptEvents.langMismatch,
  }).from(aiOptEvents).where(gte(aiOptEvents.createdAt, since)).orderBy(desc(aiOptEvents.createdAt)).limit(CAP);
  const ev = rows as EventRow[];
  const calibration = await db.select({ model: aiOptCalibration.model, factor: aiOptCalibration.factor, samples: aiOptCalibration.samples }).from(aiOptCalibration).orderBy(desc(aiOptCalibration.samples)).limit(50);
  return {
    days, since: since.toISOString(), total: summarize(ev),
    byFeature: groupSummaries(ev, (r) => r.feature), byModel: groupSummaries(ev, (r) => r.model),
    daily: groupSummaries(ev, (r) => r.day ?? "").sort((a, b) => a.key.localeCompare(b.key)),
    calibration, capped: rows.length >= CAP,
  };
}
