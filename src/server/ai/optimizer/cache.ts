/* Prompt caching. Providers cache a request prefix: OpenAI and DeepSeek do it automatically when the prefix
   is byte-identical, Anthropic and Gemini models (through OpenRouter) need explicit cache_control
   breakpoints. So: the system prompt and tools come first and stay unchanged between turns (the optimizer
   never reorders messages, and the summary window moves in blocks), and breakpoints are added only for a
   family that supports them, only above its minimum cacheable size, and only when the expected reads are
   worth the write premium. A request that already carries cache_control is left as the customer built it. */
import { estimateMessage, estimateTools } from "./estimator";
import type { CacheInfo, ChatMessage, ChatRequest } from "./types";

export type CacheFamily = {
  name: string;
  /** matched against the upstream model id (e.g. anthropic/claude-…, google/gemini-…) */
  match: string;
  /** needs cache_control breakpoints (false: automatic prefix caching) */
  explicit: boolean;
  /** smallest cacheable prefix, tokens */
  minTokens: number;
  /** price multipliers of a cache write and a cache read, relative to the normal input price */
  write: number;
  read: number;
  maxBreakpoints: number;
};

/** defaults; admin › بهینه‌ساز توکن overrides minTokens and the multipliers per family */
export const DEFAULT_FAMILIES: CacheFamily[] = [
  { name: "anthropic", match: "claude|anthropic", explicit: true, minTokens: 1024, write: 1.25, read: 0.1, maxBreakpoints: 4 },
  { name: "gemini", match: "gemini|gemma|google/", explicit: true, minTokens: 2048, write: 1.0, read: 0.25, maxBreakpoints: 1 },
  { name: "openai", match: "gpt|openai|^o\\d", explicit: false, minTokens: 1024, write: 1, read: 0.5, maxBreakpoints: 0 },
  { name: "deepseek", match: "deepseek", explicit: false, minTokens: 64, write: 1, read: 0.1, maxBreakpoints: 0 },
  { name: "grok", match: "grok|x-ai", explicit: false, minTokens: 1024, write: 1, read: 0.25, maxBreakpoints: 0 },
];

export function familyOf(model: string, families = DEFAULT_FAMILIES): CacheFamily | null {
  for (const f of families) { try { if (new RegExp(f.match, "i").test(model)) return f; } catch { /* a bad admin pattern matches nothing */ } }
  return null;
}

/** worth caching: the expected saving on reads beats the premium on the write */
export const worthCaching = (f: Pick<CacheFamily, "write" | "read">, expectedReuse: number) => expectedReuse * (1 - f.read) > f.write - 1;

/** FNV-1a 32-bit ×2, hex — a cheap stable hash (no content leaves this function) */
export function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995); }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export const hasCacheControl = (req: ChatRequest) => req.messages.some((m) => Array.isArray(m.content) && (m.content as { cache_control?: unknown }[]).some((p) => p && p.cache_control));

const EPHEMERAL = { type: "ephemeral" };
/** the message with a breakpoint on its last text part (string content becomes one text part) */
function mark(m: ChatMessage): ChatMessage | null {
  if (typeof m.content === "string") return m.content ? { ...m, content: [{ type: "text", text: m.content, cache_control: EPHEMERAL }] } : null;
  if (!Array.isArray(m.content)) return null;
  const parts = (m.content as Record<string, unknown>[]).slice();
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]?.type === "text" && typeof parts[i].text === "string" && parts[i].text) { parts[i] = { ...parts[i], cache_control: EPHEMERAL }; return { ...m, content: parts }; }
  }
  return null;
}

/** adds breakpoints (returns a new request) and reports what it did */
export function placeCache(req: ChatRequest, o: { family: CacheFamily | null; explicitAllowed: boolean; expectedReuse: number }): { req: ChatRequest; info: CacheInfo } {
  const msgs = req.messages;
  let firstConv = 0;
  while (firstConv < msgs.length && msgs[firstConv].role === "system") firstConv++;
  const toolsT = estimateTools(req.tools);
  const prefixHash = hash(JSON.stringify(req.tools ?? null) + "\u0000" + JSON.stringify(msgs.slice(0, firstConv).map((m) => m.content)));
  const info: CacheInfo = { family: o.family?.name ?? "", breakpoints: 0, skipped: "", prefixTokens: 0, prefixHash };
  // cumulative prefix size up to each message
  const cum: number[] = [];
  let acc = toolsT;
  for (const m of msgs) { acc += estimateMessage(m); cum.push(acc); }
  info.prefixTokens = firstConv ? cum[firstConv - 1] : toolsT;
  const f = o.family;
  if (!f) return { req, info: { ...info, skipped: "family" } };
  if (!f.explicit) return { req, info: { ...info, skipped: "automatic" } };
  if (!o.explicitAllowed) return { req, info: { ...info, skipped: "upstream" } };
  if (hasCacheControl(req)) return { req, info: { ...info, skipped: "customer" } };
  if (!worthCaching(f, o.expectedReuse)) return { req, info: { ...info, skipped: "not-worth" } };

  // candidates: the last leading system message (covers tools + system), and the last message before the latest user message (the conversation so far)
  const latest = msgs.map((m) => m.role).lastIndexOf("user");
  const cands: number[] = [];
  if (firstConv > 0) cands.push(firstConv - 1);
  for (let i = latest - 1; i >= firstConv; i--) { if (msgs[i].role === "user" || msgs[i].role === "assistant" || msgs[i].role === "system") { if (mark(msgs[i])) { cands.push(i); break; } } }
  const ok = [...new Set(cands)].filter((i) => cum[i] >= f.minTokens).sort((a, b) => a - b);
  if (!ok.length) return { req, info: { ...info, skipped: "below-min", prefixTokens: Math.max(info.prefixTokens, latest > 0 ? cum[latest - 1] : 0) } };
  const chosen = f.maxBreakpoints <= 1 ? [ok[ok.length - 1]] : ok.slice(-Math.min(f.maxBreakpoints, 2));
  const out = msgs.slice();
  for (const i of chosen) out[i] = mark(out[i]) ?? out[i];
  return { req: { ...req, messages: out }, info: { ...info, breakpoints: chosen.length, prefixTokens: cum[chosen[chosen.length - 1]] } };
}
