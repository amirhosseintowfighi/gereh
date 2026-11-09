/* «بهینه‌ساز توکن» on the client: the shapes the aiOpt RPC group returns (src/server/rpc/ai-opt.ts) and labels. */

export const OPT_FEATURE_LABEL: Record<string, string> = {
  api: "API عمومی (کلید gk-)", playground: "زمین بازی پنل", "panel-chat": "چت پنل", assistant: "دستیار گره", builder: "بافت", "support-ai": "پشتیبانی AI",
  explain: "توضیح خطا", advisor: "مشاور هزینه", monitor: "پایش هوشمند", dbquery: "پرسش از دیتابیس", "model-test": "تست مدل", benchmark: "محک",
};
export const OPT_LEVEL_LABEL = ["فقط کش پرامپت", "ایمن", "متعادل", "تهاجمی"];

export type OptSummary = {
  requests: number; optimized: number; origTokens: number; optTokens: number; tokenReductionPct: number;
  actualIn: number; billedIn: number; cachedTokens: number; cacheHitRate: number; breakpointRequests: number;
  unoptCost: number; actualCost: number; costSavingsPct: number;
  charged: number; knownCostRequests: number; knownCharged: number; knownCost: number; margin: number; marginPct: number;
  fallbacks: number; fallbackRate: number; validatorFailures: number; overBudget: number; langMismatch: number;
};
export type OptStats = {
  days: number; since: string; total: OptSummary;
  byFeature: { key: string; summary: OptSummary }[]; byModel: { key: string; summary: OptSummary }[]; daily: { key: string; summary: OptSummary }[];
  calibration: { model: string; factor: number; samples: number }[]; capped: boolean;
};
export type OptPolicy = {
  enabled: boolean; level: 0 | 1 | 2 | 3; recentTurns: number; maxInputTokens: number; maxToolLines: number; maxToolChars: number; summarize: boolean; summarizeOverTokens: number;
  sections: boolean; docMinTokens: number; nearDedupe: boolean; cache: boolean; translate: boolean; budgetMs: number; expectedReuse: number;
};
export type OptSettings = {
  enabled: boolean; features: Record<string, Partial<OptPolicy>>; models: Record<string, Partial<OptPolicy>>; plans: Record<string, Partial<OptPolicy>>;
  cacheControl: "auto" | "on" | "off"; families: Record<string, { minTokens?: number; write?: number; read?: number }>;
  translate: { minSavingTokens: number; minConfidence: number; timeoutMs: number; includeLatest: boolean }; usdToman: number; benchMaxUsd: number;
};
export type OptSettingsView = { settings: OptSettings; envEnabled: boolean; openRouter: boolean; cacheControlActive: boolean; translateConfigured: boolean; effective: Record<string, OptPolicy>; optInPolicy: OptPolicy };
export type OfflineRow = { id: string; workload: string; feature: string; policy: string; origTokens: number; optTokens: number; reductionPct: number; steps: Record<string, number>; validatorFailures: number; pass: boolean; latencyMs: number };
export type BenchRow = {
  id: string; model: string; status: "running" | "done" | "budget" | "failed"; budgetUsd: number; spentUsd: number; error: string; createdAt: string; finishedAt: string | null;
  report: { passRate?: number; meanActualReductionPct?: number; priceBasis?: string; stoppedForBudget?: boolean; results?: { id: string; workload: string; estReductionPct: number; actualReductionPct: number; original: { promptTokens: number; cachedTokens: number; usd: number }; optimized: { promptTokens: number; cachedTokens: number; usd: number }; check: { kind: string; pass: boolean; detail: string }; judge: boolean | null }[] };
};
