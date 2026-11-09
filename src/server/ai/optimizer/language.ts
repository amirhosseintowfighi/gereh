/* Optional Persian→English adapter, OFF by default. Persian takes roughly twice the tokens of the same
   English text, so long Persian context can be cheaper in English — but only through a local /
   self-hosted LibreTranslate-compatible endpoint (AI_OPT_TRANSLATE_URL), never a paid LLM call.
   Per message:
     - cost-benefit: the estimated saving must beat a minimum, or nothing is sent to the translator;
     - masking: protected blocks and spans (code, URLs, paths, ids, numbers…) travel as ⟦n⟧ placeholders;
     - fidelity: every placeholder comes back exactly once, every number survives, the length ratio is
       sane, and the translator's confidence (when it reports one) is high enough — otherwise that message
       stays Persian;
     - the original Persian is never lost: input objects are not mutated and stored conversations keep it;
     - an instruction tells the model to answer in Persian, and answerLanguageOk() checks the answer. */
import { normDigits, protectedSpans, segments } from "./analyzer";
import { estimateText } from "./estimator";
import type { ChatMessage } from "./types";

export type Translation = { text: string; confidence?: number };
export type Translator = (texts: string[], signal: AbortSignal) => Promise<Translation[]>;

/** LibreTranslate-compatible: POST {url}/translate { q: [...], source: "fa", target: "en", format: "text" } */
export function libreTranslate(url: string, apiKey = "", fetchImpl: typeof fetch = fetch): Translator {
  const endpoint = url.replace(/\/$/, "").replace(/\/translate$/, "") + "/translate";
  return async (texts, signal) => {
    const res = await fetchImpl(endpoint, { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ q: texts, source: "fa", target: "en", format: "text", ...(apiKey ? { api_key: apiKey } : {}) }) });
    if (!res.ok) throw new Error("translator " + res.status);
    const j = (await res.json()) as { translatedText?: string | string[]; detectedLanguage?: { confidence?: number } | { confidence?: number }[] };
    const out = Array.isArray(j.translatedText) ? j.translatedText : [j.translatedText ?? ""];
    const conf = Array.isArray(j.detectedLanguage) ? j.detectedLanguage : texts.map(() => j.detectedLanguage as { confidence?: number } | undefined);
    return texts.map((_, i) => ({ text: String(out[i] ?? ""), confidence: typeof conf[i]?.confidence === "number" ? conf[i]!.confidence! / (conf[i]!.confidence! > 1 ? 100 : 1) : undefined }));
  };
}

/** share of letters in Arabic script */
export function persianRatio(text: string): number {
  let fa = 0, letters = 0;
  for (const ch of text) {
    if (/[؀-ۿ]/.test(ch) && !/[۰-۹،؛؟]/.test(ch)) { fa++; letters++; }
    else if (/\p{L}/u.test(ch)) letters++;
  }
  return letters ? fa / letters : 0;
}

/** protected parts → ⟦n⟧; returns the masked text and the values */
export function mask(text: string): { masked: string; values: string[] } {
  const values: string[] = [];
  const put = (v: string) => { values.push(v); return "⟦" + (values.length - 1) + "⟧"; };
  let masked = segments(text).map((s) => (s.kind === "prose" ? s.text : put(s.text))).join("");
  for (const sp of protectedSpans(masked)) if (!/⟦\d+⟧/.test(sp)) masked = masked.split(sp).join(put(sp));
  masked = masked.replace(/⟦\d+⟧|[0-9۰-۹٠-٩]+(?:[.,٫٬][0-9۰-۹٠-٩]+)*/g, (n) => (n.startsWith("⟦") ? n : put(n)));
  return { masked, values };
}
/** placeholders → values; null unless every placeholder comes back exactly as often as it went (masked) */
export function unmask(text: string, values: string[], masked?: string): string | null {
  for (let i = 0; i < values.length; i++) {
    const want = masked ? masked.split("⟦" + i + "⟧").length : 2;
    if (text.split("⟦" + i + "⟧").length !== want) return null;
  }
  if (/⟦\d+⟧/.test(text.replace(/⟦(\d+)⟧/g, (m, n) => (Number(n) < values.length ? "" : m)))) return null;
  return text.replace(/⟦(\d+)⟧/g, (_, n) => values[Number(n)]);
}

export type TranslateOptions = { translator: Translator; minSavingTokens: number; minConfidence: number; timeoutMs: number; includeLatest: boolean };
export type TranslateResult = { messages: ChatMessage[]; translated: number; skipped: string };

export const ANSWER_IN_PERSIAN = "Some earlier messages in this conversation were machine-translated from Persian to English to save space. The user writes in Persian (فارسی): always answer in Persian unless the user explicitly asks for another language.";

const numbersOf = (s: string) => (normDigits(s).match(/\d+(?:[.,]\d+)*/g) ?? []).sort().join(" ");

export async function translateMessages(msgs: ChatMessage[], o: TranslateOptions): Promise<TranslateResult> {
  const latest = msgs.map((m) => m.role).lastIndexOf("user");
  const cands: { i: number; text: string; masked: string; values: string[]; saving: number }[] = [];
  msgs.forEach((m, i) => {
    if (typeof m.content !== "string" || m.role === "tool" || (i === latest && !o.includeLatest)) return;
    const text = m.content;
    if (text.length < 200 || persianRatio(text) < 0.6) return;
    const { masked, values } = mask(text);
    // English needs about 0.45× the tokens of Persian for the same content (conservative)
    const saving = estimateText(text) - Math.ceil(estimateText(masked) * 0.45) - values.length;
    if (saving > 0) cands.push({ i, text, masked, values, saving });
  });
  const total = cands.reduce((n, c) => n + c.saving, 0);
  if (!cands.length || total < o.minSavingTokens) return { messages: msgs, translated: 0, skipped: "not-worth" };
  let res: Translation[];
  try { res = await o.translator(cands.map((c) => c.masked), AbortSignal.timeout(o.timeoutMs)); } catch (e) { return { messages: msgs, translated: 0, skipped: "translator: " + ((e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message).slice(0, 60) }; }
  const out = msgs.slice();
  let translated = 0, low = 0;
  cands.forEach((c, k) => {
    const r = res[k];
    if (!r || (r.confidence !== undefined && r.confidence < o.minConfidence)) { low++; return; }
    const back = unmask(r.text, c.values, c.masked);
    if (back === null) { low++; return; }
    const ratio = back.length / c.text.length;
    if (ratio < 0.5 || ratio > 3 || persianRatio(back) > 0.2 || numbersOf(back) !== numbersOf(c.text)) { low++; return; }
    out[c.i] = { ...msgs[c.i], content: back };
    translated++;
  });
  if (!translated) return { messages: msgs, translated: 0, skipped: low ? "low-confidence" : "none" };
  let first = 0;
  while (first < out.length && out[first].role === "system") first++;
  out.splice(first, 0, { role: "system", content: ANSWER_IN_PERSIAN });
  return { messages: out, translated, skipped: "" };
}

/** is the answer in the expected language? (code-only and very short answers pass) */
export function answerLanguageOk(answer: string, expected: "fa" | ""): boolean {
  if (!expected) return true;
  const prose = segments(answer).filter((s) => s.kind === "prose").map((s) => s.text).join(" ");
  if (prose.replace(/\s+/g, "").length < 20) return true;
  return persianRatio(prose) >= 0.3;
}
