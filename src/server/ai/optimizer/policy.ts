/* Budget / policy: what the optimizer may do, per feature, model, plan and request type.
   Whether customers' requests (public API, playground) are optimized is the admin's choice alone
   (admin › API هوش مصنوعی › بهینه‌ساز توکن): on by default at the balanced level, and invisible to the
   customer — they are billed on, and shown, the size of the request they sent. Overrides layer on top in
   this order: feature defaults → admin feature override → admin model override (model id prefix) →
   admin plan override → request type (a JSON-mode request keeps its system prompt's exact layout). */
import type { Feature, Level, Policy } from "./types";

const BASE: Policy = {
  enabled: true, level: 1, recentTurns: 6, maxInputTokens: 0, maxToolLines: 60, maxToolChars: 6000, summarize: false, summarizeOverTokens: 6000,
  sections: false, docMinTokens: 3000, nearDedupe: false, cache: true, translate: false, budgetMs: 50, expectedReuse: 0.5,
};

/** the level presets; a feature default or an admin override can still set any field */
export const LEVELS: Record<Level, Partial<Policy>> = {
  0: { level: 0, summarize: false, sections: false, nearDedupe: false },
  1: { level: 1, summarize: false, sections: false, nearDedupe: false },
  2: { level: 2, summarize: true, sections: true, nearDedupe: true },
  3: { level: 3, summarize: true, sections: true, nearDedupe: true, recentTurns: 3, maxToolLines: 30, maxToolChars: 3000, summarizeOverTokens: 3000, docMinTokens: 2000 },
};

export const FEATURE_DEFAULTS: Record<Feature, Partial<Policy>> = {
  // customers' own requests: the balanced level, the last 6 turns always verbatim
  api: { ...LEVELS[2], recentTurns: 6, summarizeOverTokens: 8000, expectedReuse: 0.6 },
  playground: { ...LEVELS[2], recentTurns: 6, summarizeOverTokens: 8000, expectedReuse: 0.2 },
  "panel-chat": { ...LEVELS[2], recentTurns: 6, maxInputTokens: 24_000, summarizeOverTokens: 6000, expectedReuse: 0.7 },
  // long histories with many tool results
  assistant: { ...LEVELS[2], recentTurns: 2, maxToolLines: 40, maxToolChars: 3000, maxInputTokens: 30_000, summarizeOverTokens: 5000, expectedReuse: 0.8 },
  // skills blocks are instructions: no section selection, only safe rewrites
  builder: { ...LEVELS[1], expectedReuse: 0.5 },
  "support-ai": { ...LEVELS[2], recentTurns: 6, summarizeOverTokens: 4000, expectedReuse: 0.3 },
  explain: { ...LEVELS[1], expectedReuse: 0.2 },
  advisor: { ...LEVELS[1], expectedReuse: 0.2 },
  monitor: { ...LEVELS[1], expectedReuse: 0.2 },
  dbquery: { ...LEVELS[1], expectedReuse: 0.3 },
  "model-test": { ...LEVELS[0], cache: false },
  benchmark: { ...LEVELS[2] },
};

export type PolicyOverrides = {
  features?: Partial<Record<Feature, Partial<Policy>>>;
  /** keyed by model id prefix, e.g. "claude-" or "anthropic/" */
  models?: Record<string, Partial<Policy>>;
  plans?: Record<string, Partial<Policy>>;
};
export type PolicyInput = { feature: Feature; model?: string; plan?: string; requestType?: { json?: boolean; tools?: boolean }; call?: Partial<Policy> };

const clamp = (p: Policy): Policy => ({
  ...p,
  level: (Math.max(0, Math.min(3, Math.round(p.level))) as Level),
  recentTurns: Math.max(1, Math.min(50, Math.round(p.recentTurns))),
  maxInputTokens: Math.max(0, Math.round(p.maxInputTokens)),
  maxToolLines: Math.max(8, Math.round(p.maxToolLines)),
  maxToolChars: Math.max(800, Math.round(p.maxToolChars)),
  summarizeOverTokens: Math.max(500, Math.round(p.summarizeOverTokens)),
  docMinTokens: Math.max(500, Math.round(p.docMinTokens)),
  budgetMs: Math.max(1, Math.min(2000, Math.round(p.budgetMs))),
  expectedReuse: Math.max(0, Math.min(1, p.expectedReuse)),
});

const levelOf = (p: Partial<Policy> | undefined) => (p && p.level !== undefined ? LEVELS[p.level as Level] ?? {} : {});
/** a layer's level preset first, then its explicit fields */
const layer = (p: Partial<Policy> | undefined): Partial<Policy> => ({ ...levelOf(p), ...(p ?? {}) });

export function resolvePolicy(i: PolicyInput, o: PolicyOverrides = {}): Policy {
  let p: Policy = { ...BASE, ...FEATURE_DEFAULTS[i.feature] };
  const fo = o.features?.[i.feature];
  if (fo) p = { ...p, ...layer(fo) };
  if (i.model && o.models) for (const [prefix, mo] of Object.entries(o.models)) if (prefix && i.model.startsWith(prefix)) p = { ...p, ...layer(mo) };
  if (i.plan && o.plans?.[i.plan]) p = { ...p, ...layer(o.plans[i.plan]) };
  if (i.call) p = { ...p, ...layer(i.call) };
  if (i.requestType?.json) p = { ...p, nearDedupe: false, sections: false };
  return clamp(p);
}

export const policyName = (f: Feature, p: Policy) => f + ":L" + (p.enabled ? p.level : "off") + (p.translate ? "+tr" : "");
