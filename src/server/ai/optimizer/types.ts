/* Shared types of the token optimizer (src/server/ai/optimizer). Pure: no I/O, no server-only imports, so
   every module is unit-tested on its own. */
import type { ChatMessage, ChatRequest } from "../translate";

export type { ChatMessage, ChatRequest };

/** who builds the request; decides the default policy (policy.ts) */
export const OPT_FEATURES = ["api", "playground", "panel-chat", "assistant", "builder", "support-ai", "explain", "advisor", "monitor", "dbquery", "model-test", "benchmark"] as const;
export type Feature = (typeof OPT_FEATURES)[number];

/** 0 = transport only (prompt caching), 1 = safe (whitespace, exact duplicates, old tool results),
    2 = balanced (+ deterministic summary of old turns, query-relevant document sections),
    3 = aggressive (the same steps with smaller windows and thresholds) */
export type Level = 0 | 1 | 2 | 3;

export type Policy = {
  enabled: boolean;
  level: Level;
  /** turns (a user message and what follows it) kept verbatim at the end, besides the latest user message */
  recentTurns: number;
  /** input budget (estimated tokens, 0 = none). Never met by dropping critical context: the safe version goes and the report says "over budget" */
  maxInputTokens: number;
  /** an older tool result longer than this many lines is shrunk to head/tail and key lines */
  maxToolLines: number;
  /** a single-line older tool result longer than this many characters is shrunk to head/tail */
  maxToolChars: number;
  /** summarize turns before the verbatim window (level ≥ 2) when they are over summarizeOverTokens or the request is over budget */
  summarize: boolean;
  summarizeOverTokens: number;
  /** pick query-relevant sections of large Markdown documents (level ≥ 2) */
  sections: boolean;
  /** a document is "large" from this many estimated tokens */
  docMinTokens: number;
  /** also dedupe instructions that differ only in formatting (case, punctuation, spacing, letter forms) */
  nearDedupe: boolean;
  /** prompt-caching breakpoints / stable prefix */
  cache: boolean;
  /** optional Persian→English adapter (language.ts); needs AI_OPT_TRANSLATE_URL */
  translate: boolean;
  /** time budget of the optimization itself; when exceeded the original request goes */
  budgetMs: number;
  /** prior probability that the cached prefix is read again before it expires (cost-aware caching) */
  expectedReuse: number;
};

export type CacheInfo = {
  family: string;
  /** explicit cache_control breakpoints added */
  breakpoints: number;
  /** why no breakpoint was added ("" when one was) */
  skipped: string;
  /** estimated tokens before the last breakpoint (or of system + tools) */
  prefixTokens: number;
  /** hash of tools + leading system messages: equal hashes between turns mean a stable prefix */
  prefixHash: string;
};

/** what the optimizer did to one request. No message content: counts and hashes only. */
export type OptReport = {
  feature: Feature;
  model: string;
  /** policy summary, e.g. "assistant:L2" */
  policy: string;
  /** message content differs from the original (cache markers and transport fields do not count) */
  changed: boolean;
  /** estimated input tokens of the original and of the optimized request (same heuristic, uncalibrated) */
  origTokens: number;
  optTokens: number;
  /** calibration factor (actual / estimated) used for this model when the request was optimized */
  factor: number;
  /** transformation counts, e.g. { whitespace: 2, toolShrink: 1 } */
  steps: Record<string, number>;
  validatorFailures: number;
  /** "" | "error" | "timeout" | "disabled" */
  fallback: string;
  overBudget: boolean;
  cache: CacheInfo;
  translated: number;
  translateSkipped: string;
  /** the answer is expected in this language (set when content was translated) */
  expectLanguage: "" | "fa";
  latencyMs: number;
};

export const emptyReport = (feature: Feature, model: string, policy = feature + ":off"): OptReport => ({
  feature, model, policy, changed: false, origTokens: 0, optTokens: 0, factor: 1, steps: {}, validatorFailures: 0, fallback: "", overBudget: false,
  cache: { family: "", breakpoints: 0, skipped: "disabled", prefixTokens: 0, prefixHash: "" }, translated: 0, translateSkipped: "", expectLanguage: "", latencyMs: 0,
});
