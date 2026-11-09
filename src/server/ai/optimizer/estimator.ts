/* Token estimator. No tokenizer library ships in node_modules, so the baseline is a per-script heuristic
   (Persian/Arabic, Latin, digits, punctuation/code, CJK), and a per-model calibration factor
   (actual prompt_tokens / estimate, an EMA stored in ai_opt_calibration) corrects it from real usage.
   The same heuristic estimates the original and the optimized request, so their difference — what the
   optimizer removed — is calibrated with the same factor. */
import { segments } from "./analyzer";
import type { ChatMessage, ChatRequest } from "./types";

/** characters per token by script; code letters split into more tokens than prose */
export const CHARS_PER_TOKEN = { fa: 2.6, latin: 4.2, latinCode: 3.3, digit: 2.6, space: 8, punct: 1.7, cjk: 1.0, other: 2.0 };

export function estimateText(text: string): number {
  if (!text) return 0;
  let t = 0;
  for (const s of segments(text)) {
    const code = s.kind !== "prose";
    let fa = 0, latin = 0, digit = 0, space = 0, punct = 0, cjk = 0, other = 0;
    for (let i = 0; i < s.text.length; i++) {
      const k = s.text.charCodeAt(i);
      if ((k >= 65 && k <= 90) || (k >= 97 && k <= 122) || (k >= 0xc0 && k <= 0x24f)) latin++;
      else if (k === 32 || k === 10 || k === 9 || k === 13 || k === 0x200c || k === 0xa0) space++;
      else if ((k >= 48 && k <= 57) || (k >= 0x6f0 && k <= 0x6f9) || (k >= 0x660 && k <= 0x669)) digit++;
      else if ((k >= 0x600 && k <= 0x6ff) || (k >= 0x750 && k <= 0x77f) || (k >= 0xfb50 && k <= 0xfdff) || (k >= 0xfe70 && k <= 0xfeff)) fa++;
      else if ((k >= 0x3040 && k <= 0x30ff) || (k >= 0x3400 && k <= 0x9fff) || (k >= 0xac00 && k <= 0xd7af)) cjk++;
      else if (k < 128) punct++;
      else if (k >= 0xd800 && k <= 0xdbff) { other++; i++; }
      else other++;
    }
    const c = CHARS_PER_TOKEN;
    t += fa / c.fa + latin / (code ? c.latinCode : c.latin) + digit / c.digit + space / c.space + punct / c.punct + cjk / c.cjk + other / c.other;
  }
  return Math.ceil(t);
}

/** per-message overhead of the chat format (role, separators) */
export const MESSAGE_OVERHEAD = 4;
/** a typical image part (providers bill images by size; this is only for budgets and ratios) */
export const IMAGE_TOKENS = 800;

export function estimateContent(content: unknown): number {
  if (typeof content === "string") return estimateText(content);
  if (!Array.isArray(content)) return 0;
  let t = 0;
  for (const p of content as { type?: string; text?: string }[]) {
    if (typeof p?.text === "string") t += estimateText(p.text);
    else if (p?.type === "image_url" || p?.type === "image" || p?.type === "input_image") t += IMAGE_TOKENS;
    else t += estimateText(JSON.stringify(p ?? ""));
  }
  return t;
}

export function estimateMessage(m: ChatMessage): number {
  let t = MESSAGE_OVERHEAD + estimateContent(m.content);
  if (m.tool_calls?.length) t += estimateText(JSON.stringify(m.tool_calls));
  if (m.name) t += 1;
  return t;
}

export const estimateTools = (tools: unknown) => (Array.isArray(tools) && tools.length ? estimateText(JSON.stringify(tools)) : 0);

/** estimated input tokens of a whole request (messages and tool definitions) */
export function estimateRequest(req: Pick<ChatRequest, "messages" | "tools">): number {
  return req.messages.reduce((n, m) => n + estimateMessage(m), 3) + estimateTools(req.tools);
}

/* ---------- calibration ---------- */

export type Calibration = { factor: number; samples: number };
export const CALIBRATION_ALPHA = 0.1;
/** a sample further than this from 1 is noise (a provider quirk, images, a wrong usage field) */
const SAMPLE_RANGE: [number, number] = [0.25, 4];

/** the next calibration after one real request: a running mean for the first 1/alpha samples, then an EMA */
export function calibrate(prev: Calibration | null, actualTokens: number, estimatedTokens: number, alpha = CALIBRATION_ALPHA): Calibration {
  const p = prev ?? { factor: 1, samples: 0 };
  if (!(actualTokens > 0) || !(estimatedTokens > 0)) return p;
  const sample = actualTokens / estimatedTokens;
  if (sample < SAMPLE_RANGE[0] || sample > SAMPLE_RANGE[1]) return p;
  const w = Math.max(alpha, 1 / (p.samples + 1));
  return { factor: Math.round((p.factor * (1 - w) + sample * w) * 10_000) / 10_000, samples: p.samples + 1 };
}

/** calibrated tokens for an estimate */
export const calibrated = (estimate: number, factor: number) => Math.max(0, Math.round(estimate * (factor > 0 ? factor : 1)));
