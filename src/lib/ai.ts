/* AI API (api.gereh.dev): model catalog, prices and helpers shared by the gateway, panels and site.
   Prices are Toman per 1M tokens. The pricing rule: the market average of Iranian resellers that name
   their models, never above the leading competitor (Paasta) and by default a little under it. */

export type AiModelDef = {
  id: string; name: string; vendor: string; context: number; vision?: boolean;
  /** competitor reference, Toman per 1M tokens (input, output) */
  ref: [number, number];
};

export const AI_VENDORS: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", qwen: "Qwen", zai: "Z.ai", moonshot: "Moonshot", xai: "xAI", bytedance: "ByteDance", meta: "Meta",
};

/** the catalog: exactly the models the upstream serves (ids as the upstream names them); the admin panel edits prices and imports whatever else the upstream offers */
export const AI_MODELS: AiModelDef[] = [
  { id: "claude-fable-5.1", name: "Claude Fable 5.1", vendor: "anthropic", context: 1_000_000, vision: true, ref: [2_400_000, 12_000_000] },
  { id: "claude-fable-5", name: "Claude Fable 5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [2_400_000, 12_000_000] },
  { id: "claude-mythos-preview", name: "Claude Mythos Preview", vendor: "anthropic", context: 1_000_000, vision: true, ref: [2_400_000, 12_000_000] },
  { id: "claude-opus-5.5", name: "Claude Opus 5.5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [1_920_000, 9_600_000] },
  { id: "claude-opus-5", name: "Claude Opus 5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [2_400_000, 12_000_000] },
  { id: "claude-opus-4.8", name: "Claude Opus 4.8", vendor: "anthropic", context: 1_000_000, vision: true, ref: [1_200_000, 6_000_000] },
  { id: "claude-opus-4.7", name: "Claude Opus 4.7", vendor: "anthropic", context: 1_000_000, vision: true, ref: [1_200_000, 6_000_000] },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", vendor: "anthropic", context: 1_000_000, vision: true, ref: [1_200_000, 6_000_000] },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [960_000, 4_800_000] },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", vendor: "openai", context: 1_050_000, vision: true, ref: [1_200_000, 7_200_000] },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", vendor: "openai", context: 1_050_000, vision: true, ref: [480_000, 2_880_000] },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", vendor: "openai", context: 1_050_000, vision: true, ref: [96_000, 576_000] },
  { id: "gpt-5.5-pro", name: "GPT-5.5 Pro", vendor: "openai", context: 1_050_000, vision: true, ref: [7_200_000, 57_600_000] },
  { id: "gpt-5.5", name: "GPT-5.5", vendor: "openai", context: 1_050_000, vision: true, ref: [2_400_000, 14_400_000] },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", vendor: "google", context: 1_048_576, vision: true, ref: [960_000, 5_760_000] },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", vendor: "google", context: 1_048_576, vision: true, ref: [360_000, 1_800_000] },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", vendor: "google", context: 1_048_576, vision: true, ref: [240_000, 1_200_000] },
  { id: "gemma-2-2b", name: "Gemma 2 2B", vendor: "google", context: 8_192, ref: [9_600, 9_600] },
  { id: "grok-4.6", name: "Grok 4.6", vendor: "xai", context: 2_000_000, vision: true, ref: [960_000, 4_800_000] },
  { id: "grok-4.5", name: "Grok 4.5", vendor: "xai", context: 2_000_000, vision: true, ref: [960_000, 4_800_000] },
  { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro Max", vendor: "deepseek", context: 1_048_576, ref: [288_000, 2_400_000] },
  { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro (0813)", vendor: "deepseek", context: 1_048_576, ref: [192_000, 2_016_000] },
  { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash (0731)", vendor: "deepseek", context: 1_048_576, ref: [144_000, 576_000] },
  { id: "qwen3.8-max", name: "Qwen3.8 Max", vendor: "qwen", context: 1_000_000, ref: [960_000, 2_880_000] },
  { id: "qwen3.7-max", name: "Qwen3.7 Max", vendor: "qwen", context: 1_000_000, ref: [960_000, 2_880_000] },
  { id: "qwen3.8-27b", name: "Qwen3.8 27B", vendor: "qwen", context: 262_144, ref: [96_000, 480_000] },
  { id: "glm-5.3", name: "GLM-5.3", vendor: "zai", context: 200_000, ref: [288_000, 1_200_000] },
  { id: "glm-5.2", name: "GLM-5.2", vendor: "zai", context: 200_000, ref: [288_000, 1_200_000] },
  { id: "kimi-k3", name: "Kimi K3", vendor: "moonshot", context: 262_144, vision: true, ref: [480_000, 2_400_000] },
  { id: "kimi-k2.6", name: "Kimi K2.6", vendor: "moonshot", context: 262_144, ref: [288_000, 1_200_000] },
  { id: "seed-2.1-pro", name: "Seed 2.1 Pro", vendor: "bytedance", context: 256_000, vision: true, ref: [384_000, 1_920_000] },
  { id: "seed-2.1-turbo", name: "Seed 2.1 Turbo", vendor: "bytedance", context: 256_000, vision: true, ref: [96_000, 480_000] },
  { id: "muse-spark-1.1", name: "Muse Spark 1.1", vendor: "meta", context: 1_000_000, vision: true, ref: [480_000, 2_400_000] },
];

/** default discount under the competitor reference */
export const AI_DISCOUNT = 0.05;
const round100 = (n: number) => Math.max(100, Math.round(n / 100) * 100);
/** price from the rule: market average if known, capped at the reference, then the discount */
export function rulePrice(ref: number, marketAvg = 0, discount = AI_DISCOUNT) {
  const base = marketAvg > 0 && ref > 0 ? Math.min(marketAvg, ref) : ref || marketAvg;
  return round100(base * (1 - discount));
}

/** Toman for a request; at least 1 Toman for any non-empty request */
export const costOf = (inTokens: number, outTokens: number, m: { inPrice: number; outPrice: number }) =>
  inTokens + outTokens > 0 ? Math.max(1, Math.ceil((inTokens * m.inPrice + outTokens * m.outPrice) / 1_000_000)) : 0;

/** rough token estimate when the upstream reports no usage (≈3.5 characters per token, Persian-safe) */
export const estimateTokens = (chars: number) => Math.ceil(chars / 3.5);

export const AI_KEY_RE = /^gk-[A-Za-z0-9]{40}$/;
export const AI_FORMAT_LABEL: Record<string, string> = {
  openai: "OpenAI", responses: "OpenAI Responses", anthropic: "Anthropic", gemini: "Gemini", panel: "پنل",
  embeddings: "Embeddings", images: "تصویر", speech: "تبدیل متن به گفتار", transcription: "تبدیل گفتار به متن", rerank: "Rerank", kb: "پایگاه دانش",
};

/* ---------- model kinds and their price units ---------- */
export type AiKind = "chat" | "embedding" | "image" | "tts" | "stt" | "rerank";
export const AI_KINDS: AiKind[] = ["chat", "embedding", "image", "tts", "stt", "rerank"];
export const AI_KIND_LABEL: Record<AiKind, string> = { chat: "گفتگو", embedding: "Embedding", image: "تصویر", tts: "متن به گفتار", stt: "گفتار به متن", rerank: "Rerank" };
/** which price fields a kind uses, with their unit labels; in/out are per 1M (tokens, or characters for tts), unit is per unit */
export const AI_KIND_PRICE: Record<AiKind, { in?: string; out?: string; unit?: string }> = {
  chat: { in: "ورودی / ۱M توکن", out: "خروجی / ۱M توکن" },
  embedding: { in: "ورودی / ۱M توکن" },
  image: { unit: "هر تصویر" },
  tts: { in: "هر ۱M نویسه" },
  stt: { unit: "هر دقیقه صوت" },
  rerank: { unit: "هر ۱۰۰۰ جست‌وجو" },
};
/** the endpoint each kind is served on */
export const AI_KIND_PATH: Record<AiKind, string> = {
  chat: "/v1/chat/completions", embedding: "/v1/embeddings", image: "/v1/images/generations", tts: "/v1/audio/speech", stt: "/v1/audio/transcriptions", rerank: "/v1/rerank",
};
type Priced = { inPrice: number; outPrice: number; unitPrice: number };
/** a model is sellable once the price fields of its kind are set */
export const isPriced = (kind: AiKind, m: Priced) => {
  const p = AI_KIND_PRICE[kind];
  return (p.in ? m.inPrice > 0 : true) && (p.unit ? m.unitPrice > 0 : true) && (p.out ? m.outPrice > 0 : true);
};
/** Toman for a non-chat request; quantities: tokens (embedding), images, characters (tts), seconds (stt), searches (rerank) */
export function kindCost(kind: AiKind, m: Priced, q: { tokens?: number; images?: number; chars?: number; seconds?: number; searches?: number }) {
  const atLeast1 = (n: number, raw: number) => (n > 0 ? Math.max(1, Math.ceil(raw)) : 0);
  switch (kind) {
    case "embedding": return costOf(q.tokens ?? 0, 0, m);
    case "image": return (q.images ?? 0) * m.unitPrice;
    case "tts": return atLeast1(q.chars ?? 0, ((q.chars ?? 0) * m.inPrice) / 1_000_000);
    case "stt": return atLeast1(q.seconds ?? 0, ((q.seconds ?? 0) * m.unitPrice) / 60);
    case "rerank": return atLeast1(q.searches ?? 0, ((q.searches ?? 0) * m.unitPrice) / 1000);
    default: return costOf(q.tokens ?? 0, 0, m);
  }
}

export type AiRouting = "" | "price" | "throughput" | "latency";
export const AI_ROUTING: { value: AiRouting; label: string }[] = [
  { value: "", label: "پیش‌فرض" }, { value: "price", label: "ارزان‌ترین" }, { value: "throughput", label: "بیشترین سرعت تولید" }, { value: "latency", label: "کمترین تأخیر" },
];

/* ---------- vectors and chunking (knowledge base, embedding playground) ---------- */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** splits text into ~size-character chunks on paragraph, then sentence, boundaries, with a small overlap */
export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const pieces: string[] = [];
  for (const para of clean.split(/\n\n/)) {
    if (para.length <= size) { pieces.push(para); continue; }
    let cur = "";
    for (const s of para.split(/(?<=[.!?؟。])\s+/)) {
      if (s.length > size) { if (cur) { pieces.push(cur); cur = ""; } for (let i = 0; i < s.length; i += size - overlap) pieces.push(s.slice(i, i + size)); continue; }
      if (cur && cur.length + s.length + 1 > size) { pieces.push(cur); cur = ""; }
      cur = cur ? cur + " " + s : s;
    }
    if (cur) pieces.push(cur);
  }
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > size) {
      out.push(cur);
      const tail = cur.length > overlap ? cur.slice(-overlap).replace(/^\S*\s/, "") : "";
      cur = tail ? tail + "\n\n" + p : p;
    } else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) out.push(cur);
  return out;
}
