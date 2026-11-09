/* optimizeRequest(req, policy, ctx) → { req, report }: the whole pipeline for one chat request.
     1. system prompt: whitespace + instruction dedupe (rewrite-checked), then query-relevant sections of a
        large document (extract-checked);
     2. older messages (never the latest user message or anything after it): whitespace, repeated
        paragraphs, large documents (checked the same way);
     3. history: duplicates and long tool results, then the deterministic summary of old turns;
     4. optional Persian→English adapter (its own fidelity checks);
     5. prompt-caching breakpoints.
   Every step is validated per message; a failing message reverts to its state before the step and the
   failure is counted. Any exception, or running past the time budget, sends the original request. The
   input request is never mutated. */
import { analyzeRequest } from "./analyzer";
import { placeCache, type CacheFamily } from "./cache";
import { messageText, shrinkOlder, summarizeOlder } from "./context";
import { estimateRequest } from "./estimator";
import { translateMessages, type Translator } from "./language";
import { dedupeParagraphs, selectSections } from "./markdown";
import { policyName } from "./policy";
import { normalizeWhitespace, optimizeSystemText } from "./prompt";
import { emptyReport, type ChatMessage, type ChatRequest, type Feature, type OptReport, type Policy } from "./types";
import { check, type Check } from "./validator";

export type OptimizeContext = {
  feature: Feature;
  model: string;
  /** calibration factor of the model (estimator.ts) */
  factor?: number;
  family?: CacheFamily | null;
  /** the upstream accepts cache_control (OpenRouter, or AI_OPT_CACHE_CONTROL=1) */
  explicitCache?: boolean;
  translator?: Translator;
  translate?: { minSavingTokens: number; minConfidence: number; timeoutMs: number; includeLatest: boolean };
  now?: () => number;
  /** tests: lets a step return something else, to prove the validator catches it */
  hook?: (stage: string, before: string, after: string) => string;
};

class OutOfTime extends Error {}

/** applies fn to the text of a message (string content, or each text part; other parts untouched) */
function mapText(m: ChatMessage, fn: (t: string) => string): ChatMessage {
  if (typeof m.content === "string") { const t = fn(m.content); return t === m.content ? m : { ...m, content: t }; }
  if (!Array.isArray(m.content)) return m;
  let changed = false;
  const parts = (m.content as Record<string, unknown>[]).map((p) => {
    if (p?.type !== "text" || typeof p.text !== "string") return p;
    const t = fn(p.text);
    if (t === p.text) return p;
    changed = true;
    return { ...p, text: t };
  });
  return changed ? { ...m, content: parts } : m;
}

export async function optimizeRequest(req: ChatRequest, policy: Policy, ctx: OptimizeContext): Promise<{ req: ChatRequest; report: OptReport }> {
  const now = ctx.now ?? (() => performance.now());
  const t0 = now();
  const report = emptyReport(ctx.feature, ctx.model, policyName(ctx.feature, policy));
  report.factor = ctx.factor && ctx.factor > 0 ? ctx.factor : 1;
  const done = (r: ChatRequest) => { report.latencyMs = Math.round((now() - t0) * 10) / 10; return { req: r, report }; };
  if (!policy.enabled) { report.fallback = "disabled"; return done(req); }
  try {
    report.origTokens = estimateRequest(req);
    const deadline = t0 + policy.budgetMs;
    const tick = () => { if (now() > deadline) throw new OutOfTime(); };
    const steps = report.steps;
    const bump = (k: string, n = 1) => { if (n) steps[k] = (steps[k] ?? 0) + n; };
    const info = analyzeRequest(req);
    const latest = info.latestUser;
    let msgs = req.messages.slice();

    /** one validated text step on message i */
    const step = (i: number, stage: string, kind: Check, fn: (t: string) => string) => {
      const before = msgs[i];
      let failed = false;
      const after = mapText(before, (t) => {
        let o = fn(t);
        if (ctx.hook) o = ctx.hook(stage, t, o);
        if (o === t) return t;
        if (check(kind, t, o)) { failed = true; return t; }
        return o;
      });
      if (failed) { report.validatorFailures++; bump("reverted"); msgs[i] = before; return false; }
      if (after !== before) { msgs[i] = after; bump(stage); return true; }
      return false;
    };

    if (policy.level >= 1 && latest >= 0) {
      const query = messageText(req.messages[latest]);
      const seenRules = new Set<string>(), seenParas = new Set<string>();
      let first = 0;
      while (first < msgs.length && msgs[first].role === "system") first++;
      // 1. the system prompt
      for (let i = 0; i < first; i++) {
        step(i, "system", "rewrite", (t) => optimizeSystemText(t, { near: policy.nearDedupe, seen: seenRules }).text);
        step(i, "repeated", "extract", (t) => dedupeParagraphs(t, seenParas).text);
        if (policy.sections) step(i, "sections", "extract", (t) => selectSections(t, query, { minTokens: policy.docMinTokens, budget: policy.docMinTokens }).text);
        tick();
      }
      // 2. older messages, before the latest user message
      for (let i = first; i < latest; i++) {
        const m = msgs[i];
        if (m.role !== "tool") step(i, "whitespace", "rewrite", normalizeWhitespace);
        if (m.role !== "tool") step(i, "repeated", "extract", (t) => dedupeParagraphs(t, seenParas).text);
        if (policy.sections && m.role === "user") step(i, "sections", "extract", (t) => selectSections(t, query, { minTokens: policy.docMinTokens, budget: policy.docMinTokens }).text);
        if (i % 16 === 0) tick();
      }
      tick();
      // 3. history
      const shrunk = shrinkOlder(msgs, policy);
      for (let i = 0; i < msgs.length; i++) {
        if (shrunk.messages[i] === msgs[i]) continue;
        const a = messageText(msgs[i]);
        let b = messageText(shrunk.messages[i]);
        if (ctx.hook) b = ctx.hook("history", a, b);
        if (check("extract", a, b)) { report.validatorFailures++; bump("reverted"); continue; }
        msgs[i] = { ...shrunk.messages[i], content: b };
      }
      for (const [k, n] of Object.entries(shrunk.steps)) bump(k, n);
      tick();
      const over = policy.maxInputTokens > 0 && estimateRequest({ messages: msgs, tools: req.tools }) > policy.maxInputTokens;
      // the summary sees the request as it was before steps 2-3, so every kept sentence is the customer's own
      const sum = summarizeOlder(msgs, req.messages, policy, over);
      if (sum) {
        const text = ctx.hook ? ctx.hook("summary", sum.source, sum.summary) : sum.summary;
        if (check("extract", sum.source, text)) { report.validatorFailures++; bump("reverted"); }
        else { msgs = sum.messages; msgs[sum.summaryIndex] = { role: "system", content: text }; bump("summary"); steps.summarizedMessages = sum.summarized; }
      }
      tick();
    }

    // 4. optional translation (its own time budget: the translator is a network call)
    if (policy.translate && ctx.translator && ctx.translate) {
      const r = await translateMessages(msgs, { translator: ctx.translator, ...ctx.translate });
      report.translateSkipped = r.skipped;
      if (r.translated) { msgs = r.messages; report.translated = r.translated; report.expectLanguage = "fa"; bump("translated", r.translated); }
    }

    const changed = msgs.length !== req.messages.length || msgs.some((m, i) => m !== req.messages[i]);
    let out: ChatRequest = changed ? { ...req, messages: msgs } : req;
    report.changed = changed;
    report.optTokens = changed ? estimateRequest(out) : report.origTokens;
    report.overBudget = policy.maxInputTokens > 0 && report.optTokens > policy.maxInputTokens;

    // 5. prompt caching (transport: the text is unchanged)
    if (policy.cache) {
      const c = placeCache(out, { family: ctx.family ?? null, explicitAllowed: !!ctx.explicitCache, expectedReuse: policy.expectedReuse });
      out = c.req;
      report.cache = c.info;
    } else report.cache = { ...report.cache, skipped: "policy" };
    if (now() > deadline && !report.translated) throw new OutOfTime();
    return done(out);
  } catch (e) {
    const fresh = emptyReport(ctx.feature, ctx.model, report.policy);
    Object.assign(report, { ...fresh, origTokens: report.origTokens, factor: report.factor, fallback: e instanceof OutOfTime ? "timeout" : "error" });
    report.optTokens = report.origTokens;
    return done(req);
  }
}
