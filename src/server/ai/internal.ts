/* The model of Gereh's own site features: the panel assistant (customers, staff and the Telegram/Bale bots),
   support-AI drafts, error explanations, the monitor, the cost advisor, advanced watch checks and database
   questions. With AI_INTERNAL_URL + AI_INTERNAL_MODEL set they all run on that OpenAI-compatible model, e.g. Ollama
   or llama.cpp on Gereh's own machine, and nothing else: no paid fallback. The AI API sold to customers (gateway,
   panel chat, knowledge bases) and «بافت» keep using AI_UPSTREAM_URL / AI_UPSTREAM_KEY.

   The internal model is not in the sales catalog: it is never listed to customers or billable through the API.
   It costs Gereh nothing, so its token price is 0; the features' own minimum fees still apply. */
import "server-only";
import { withOptimizer } from "./optimizer/gateway";
import type { ResolvedModel } from "./service";
import { aiUpstream, HttpUpstream, type Upstream } from "./upstream";

export const INTERNAL_VENDOR = "gereh-internal";

export const internalEnabled = () => !!process.env.AI_INTERNAL_URL?.trim() && !!process.env.AI_INTERNAL_MODEL?.trim();

/** the internal model as a catalog-shaped row (price 0), or null when it is not configured */
export function internalModel(): ResolvedModel | null {
  if (!internalEnabled()) return null;
  const id = process.env.AI_INTERNAL_MODEL!.trim();
  return {
    id, name: id, vendor: INTERNAL_VENDOR, upstream: "", kind: "chat", active: true, position: 0,
    inPrice: 0, outPrice: 0, refIn: 0, refOut: 0, unitPrice: 0, costIn: 0, costOut: 0,
    context: Number(process.env.AI_INTERNAL_CONTEXT) || 32_768,
    vision: false, tools: true,
  };
}

export const isInternal = (m: { vendor: string } | null | undefined) => m?.vendor === INTERNAL_VENDOR;

/** AI_INTERNAL_BODY: a JSON object merged into every request, for provider switches (invalid JSON is ignored) */
function extraBody(): Record<string, unknown> {
  const raw = process.env.AI_INTERNAL_BODY?.trim();
  if (!raw) return {};
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
  catch { return {}; }
}

let internal: Upstream | null = null;
const internalUpstream = (): Upstream => (internal ??= withOptimizer(new HttpUpstream(
  () => process.env.AI_INTERNAL_URL!.trim().replace(/\/$/, ""),
  () => process.env.AI_INTERNAL_KEY?.trim() || "",
  extraBody,
)));
/** tests swap the internal provider */
export const setInternalUpstream = (u: Upstream | null) => { internal = u ? withOptimizer(u) : null; };

/** the provider that serves `m`: the internal one for the internal model, the paid one for everything else */
export const upstreamFor = (m: { vendor: string } | null | undefined): Upstream => (isInternal(m) ? internalUpstream() : aiUpstream());

/** who the site's conversational features say they are, whatever model runs them */
export const IDENTITY = "Your name is «دستیار هوش مصنوعی گره» (Gereh's AI assistant). If anyone asks who or what you are, which AI or model you are, or who made, built or trained you, answer only: «من دستیار هوش مصنوعی گره هستم.» (in the asker's language). Never name the underlying model, its version or the company behind it, and do not say that you run on another company's model.";
