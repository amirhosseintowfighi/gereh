/* AI API (api.gereh.dev): model catalog, prices and helpers shared by the gateway, panels and site.
   Prices are Toman per 1M tokens. The pricing rule: the market average of Iranian resellers that name
   their models, never above the leading competitor (Paasta) and by default a little under it. */

export type AiModelDef = {
  id: string; name: string; vendor: string; context: number; vision?: boolean;
  /** competitor reference, Toman per 1M tokens (input, output) */
  ref: [number, number];
};

export const AI_VENDORS: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", google: "Google", deepseek: "DeepSeek", qwen: "Qwen", zai: "Z.ai", moonshot: "Moonshot", xai: "xAI",
};

/** starting catalog; the admin panel edits prices and imports whatever else the upstream offers */
export const AI_MODELS: AiModelDef[] = [
  { id: "claude-opus-5.5", name: "Claude Opus 5.5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [1_920_000, 9_600_000] },
  { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [960_000, 4_800_000] },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [960_000, 4_800_000] },
  { id: "claude-opus-5", name: "Claude Opus 5", vendor: "anthropic", context: 1_000_000, vision: true, ref: [2_400_000, 12_000_000] },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", vendor: "anthropic", context: 1_000_000, vision: true, ref: [1_440_000, 7_200_000] },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", vendor: "anthropic", context: 200_000, vision: true, ref: [480_000, 2_400_000] },
  { id: "gpt-6-sol", name: "GPT-6 Sol", vendor: "openai", context: 1_050_000, vision: true, ref: [960_000, 4_800_000] },
  { id: "gpt-6-luna", name: "GPT-6 Luna", vendor: "openai", context: 1_050_000, vision: true, ref: [48_000, 240_000] },
  { id: "gpt-5.5", name: "GPT-5.5", vendor: "openai", context: 1_050_000, vision: true, ref: [2_400_000, 14_400_000] },
  { id: "gpt-5.4", name: "GPT-5.4", vendor: "openai", context: 1_050_000, vision: true, ref: [1_200_000, 7_200_000] },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", vendor: "openai", context: 400_000, vision: true, ref: [360_000, 2_160_000] },
  { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", vendor: "openai", context: 400_000, ref: [96_000, 600_000] },
  { id: "gpt-4.1", name: "GPT-4.1", vendor: "openai", context: 1_047_576, vision: true, ref: [960_000, 3_840_000] },
  { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", vendor: "openai", context: 1_047_576, vision: true, ref: [192_000, 768_000] },
  { id: "gpt-4o", name: "GPT-4o", vendor: "openai", context: 128_000, vision: true, ref: [1_200_000, 4_800_000] },
  { id: "gpt-4o-mini", name: "GPT-4o mini", vendor: "openai", context: 128_000, vision: true, ref: [72_000, 288_000] },
  { id: "o3", name: "o3", vendor: "openai", context: 200_000, vision: true, ref: [960_000, 3_840_000] },
  { id: "gpt-oss-120b", name: "gpt-oss-120b", vendor: "openai", context: 131_072, ref: [72_000, 288_000] },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", vendor: "google", context: 1_048_576, vision: true, ref: [360_000, 1_800_000] },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", vendor: "google", context: 1_048_576, vision: true, ref: [960_000, 5_760_000] },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", vendor: "google", context: 1_048_576, vision: true, ref: [600_000, 4_800_000] },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", vendor: "google", context: 1_048_576, vision: true, ref: [144_000, 1_200_000] },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", vendor: "deepseek", context: 1_048_576, ref: [192_000, 2_016_000] },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", vendor: "deepseek", context: 1_048_576, ref: [144_000, 576_000] },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2", vendor: "deepseek", context: 163_840, ref: [134_400, 201_600] },
  { id: "deepseek-r1", name: "DeepSeek R1", vendor: "deepseek", context: 163_840, ref: [240_000, 1_032_000] },
  { id: "qwen3.8-max", name: "Qwen 3.8 Max", vendor: "qwen", context: 1_000_000, ref: [960_000, 2_880_000] },
  { id: "qwen3-coder", name: "Qwen3 Coder 480B", vendor: "qwen", context: 262_144, ref: [144_000, 480_000] },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", vendor: "zai", context: 1_310_720, ref: [72_000, 240_000] },
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
export const AI_FORMAT_LABEL: Record<string, string> = { openai: "OpenAI", responses: "OpenAI Responses", anthropic: "Anthropic", gemini: "Gemini", panel: "پنل" };
