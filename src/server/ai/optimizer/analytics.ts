/* Cost model and analytics formulas (pure).
     Token Reduction % = (original − optimized) / original      — estimated input tokens, same heuristic;
                                                                  cached tokens are NOT removed tokens
     Cost Savings %    = (cost if unoptimized − actual cost) / cost if unoptimized
                                                                — both on the same price basis, the actual
                                                                  cost with cache read/write pricing
     Margin            = customer charge − Gereh's actual upstream cost (rows with a known cost only)
     Cache hit rate    = requests with cached_tokens > 0 / requests whose usage was reported */

export type Prices = { in: number; out: number };
export type CacheRates = { read: number; write: number };
export type UsageCounts = { prompt: number; cached: number; cacheWrite: number; out: number };

/** what the upstream charged for this usage, at `p` (per 1M tokens), cache reads and writes priced by `c` */
export function upstreamCost(p: Prices, u: UsageCounts, c: CacheRates): number {
  const cached = Math.min(u.cached, u.prompt);
  const write = Math.min(u.cacheWrite, u.prompt - cached);
  const plain = Math.max(0, u.prompt - cached - write);
  return (plain * p.in + cached * p.in * c.read + write * p.in * c.write + u.out * p.out) / 1_000_000;
}
/** what the original request would have cost without the optimizer and without caching */
export const unoptimizedCost = (p: Prices, originalIn: number, out: number) => (originalIn * p.in + out * p.out) / 1_000_000;

export type CostInput = {
  /** Gereh's own cost per 1M (ai_models.cost_in/out), 0 = unknown */
  cost: Prices;
  /** sale price per 1M: the proxy when the cost is unknown (ratios only) */
  sale: Prices;
  cache: CacheRates;
  usage: UsageCounts;
  /** input tokens of the original request (billed) */
  originalIn: number;
  /** provider-reported cost (USD) and the USD→Toman rate, when known */
  reportedUsd?: number;
  usdToman?: number;
};
export type CostOut = { actual: number; unopt: number; source: "reported" | "model" | "sale-proxy" };

export function costs(i: CostInput): CostOut {
  const known = i.cost.in > 0 || i.cost.out > 0;
  const basis = known ? i.cost : i.sale;
  const modeled = upstreamCost(basis, i.usage, i.cache);
  const unopt = unoptimizedCost(basis, i.originalIn, i.usage.out);
  if (i.reportedUsd !== undefined && i.usdToman && i.usdToman > 0) {
    const actual = i.reportedUsd * i.usdToman;
    // the unoptimized cost scales the provider's real figure by the modeled ratio
    return { actual, unopt: modeled > 0 ? actual * (unopt / modeled) : actual, source: "reported" };
  }
  return { actual: modeled, unopt, source: known ? "model" : "sale-proxy" };
}

export type EventRow = {
  feature: string; model: string; day?: string; changed: boolean; origEst: number; optEst: number; billedIn: number; actualIn: number; cachedTokens: number; outTokens: number;
  usageReported: boolean; charged: number; actualCost: number; unoptCost: number; costSource: string; validatorFailures: number; fallback: string; overBudget: boolean;
  cacheHit: boolean; cacheBreakpoints: number; langMismatch: boolean;
};

export type OptSummary = {
  requests: number; optimized: number; origTokens: number; optTokens: number; tokenReductionPct: number;
  actualIn: number; billedIn: number; cachedTokens: number; cacheHitRate: number; breakpointRequests: number;
  unoptCost: number; actualCost: number; costSavingsPct: number;
  charged: number; knownCostRequests: number; knownCharged: number; knownCost: number; margin: number; marginPct: number;
  fallbacks: number; fallbackRate: number; validatorFailures: number; overBudget: number; langMismatch: number;
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10_000) / 100 : 0);

export function summarize(rows: EventRow[]): OptSummary {
  const s = { requests: rows.length, optimized: 0, origTokens: 0, optTokens: 0, actualIn: 0, billedIn: 0, cachedTokens: 0, hits: 0, reported: 0, breakpointRequests: 0, unoptCost: 0, actualCost: 0, charged: 0, knownCostRequests: 0, knownCharged: 0, knownCost: 0, fallbacks: 0, validatorFailures: 0, overBudget: 0, langMismatch: 0 };
  for (const r of rows) {
    if (r.changed) s.optimized++;
    s.origTokens += r.origEst; s.optTokens += r.optEst; s.actualIn += r.actualIn; s.billedIn += r.billedIn; s.cachedTokens += r.cachedTokens;
    if (r.usageReported) { s.reported++; if (r.cacheHit) s.hits++; }
    if (r.cacheBreakpoints > 0) s.breakpointRequests++;
    s.unoptCost += r.unoptCost; s.actualCost += r.actualCost; s.charged += r.charged;
    if (r.costSource !== "sale-proxy") { s.knownCostRequests++; s.knownCharged += r.charged; s.knownCost += r.actualCost; }
    if (r.fallback && r.fallback !== "disabled") s.fallbacks++;
    s.validatorFailures += r.validatorFailures;
    if (r.overBudget) s.overBudget++;
    if (r.langMismatch) s.langMismatch++;
  }
  const margin = s.knownCharged - s.knownCost;
  return {
    requests: s.requests, optimized: s.optimized, origTokens: s.origTokens, optTokens: s.optTokens, tokenReductionPct: pct(s.origTokens - s.optTokens, s.origTokens),
    actualIn: s.actualIn, billedIn: s.billedIn, cachedTokens: s.cachedTokens, cacheHitRate: pct(s.hits, s.reported), breakpointRequests: s.breakpointRequests,
    unoptCost: Math.round(s.unoptCost * 100) / 100, actualCost: Math.round(s.actualCost * 100) / 100, costSavingsPct: pct(s.unoptCost - s.actualCost, s.unoptCost),
    charged: s.charged, knownCostRequests: s.knownCostRequests, knownCharged: s.knownCharged, knownCost: Math.round(s.knownCost * 100) / 100, margin: Math.round(margin * 100) / 100, marginPct: pct(margin, s.knownCharged),
    fallbacks: s.fallbacks, fallbackRate: pct(s.fallbacks, s.requests), validatorFailures: s.validatorFailures, overBudget: s.overBudget, langMismatch: s.langMismatch,
  };
}

/** summaries grouped by a key (feature, model, day) */
export function groupSummaries(rows: EventRow[], key: (r: EventRow) => string): { key: string; summary: OptSummary }[] {
  const g = new Map<string, EventRow[]>();
  for (const r of rows) { const k = key(r); if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
  return [...g.entries()].map(([k, v]) => ({ key: k, summary: summarize(v) })).sort((a, b) => b.summary.requests - a.summary.requests);
}
