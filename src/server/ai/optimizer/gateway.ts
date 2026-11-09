/* The wrapper around aiUpstream().chat: every call site's request passes through optimizeRequest with the
   policy of its feature (OptCall), then safe transport fields are added (OpenRouter: usage accounting).
   The response is returned exactly as the upstream sent it — streams pass through unchanged. Any failure of
   the optimizer sends the original request; AI_OPTIMIZER=0 skips all of it. */
import "server-only";
import { getDb } from "../../db/client";
import type { ChatRequest } from "../translate";
import type { Upstream } from "../upstream";
import { familyOf } from "./cache";
import { OptCall } from "./call";
import { budgetMsDefault, calibrationOf, envEnabled, expectedReuse, explicitCacheAllowed, familiesOf, isOpenRouter, optimizerSettings, overridesOf } from "./config";
import { libreTranslate } from "./language";
import { optimizeRequest } from "./optimize";
import { resolvePolicy } from "./policy";
import { emptyReport, type OptReport } from "./types";

/** the optimized request and its report (the wrapper's work, without the network call) */
export async function prepare(req: ChatRequest, call: OptCall): Promise<{ req: ChatRequest; report: OptReport }> {
  const model = String(req.model ?? "");
  if (!envEnabled()) return { req, report: { ...emptyReport(call.feature, model), fallback: "disabled" } };
  try {
    const db = await getDb();
    const s = await optimizerSettings(db);
    if (!s.enabled) return { req, report: { ...emptyReport(call.feature, model), fallback: "disabled" } };
    const json = !!req.response_format && (req.response_format as { type?: string }).type !== "text";
    const policy = resolvePolicy({ feature: call.feature, model, plan: call.o.plan, requestType: { json, tools: !!req.tools?.length }, call: { budgetMs: budgetMsDefault(), ...(call.o.policy ?? {}) } }, overridesOf(s));
    const family = familyOf(model, familiesOf(s));
    const url = process.env.AI_OPT_TRANSLATE_URL;
    const r = await optimizeRequest(req, { ...policy, expectedReuse: expectedReuse(call.feature, family?.name ?? "", policy.expectedReuse) }, {
      feature: call.feature, model, factor: (await calibrationOf(db, model)).factor, family, explicitCache: explicitCacheAllowed(s),
      ...(url && policy.translate ? { translator: libreTranslate(url, process.env.AI_OPT_TRANSLATE_KEY || ""), translate: s.translate } : {}),
    });
    return r;
  } catch (e) {
    console.warn("[ai-opt] skipped: " + (e as Error).message);
    return { req, report: { ...emptyReport(call.feature, model), fallback: "error" } };
  }
}

/** safe transport-level additions: OpenRouter reports usage.cost and cache details when asked */
export function transport(req: ChatRequest): ChatRequest {
  if (!envEnabled() || !isOpenRouter() || req.usage !== undefined) return req;
  return { ...req, usage: { include: true } };
}

/** wraps an upstream so chat() optimizes; everything else passes through */
export function withOptimizer(raw: Upstream): Upstream {
  const u: Upstream = {
    name: raw.name,
    models: () => raw.models(),
    async chat(req, signal, headers, call) {
      if (!envEnabled()) return raw.chat(req, signal, headers);
      const c = call ?? new OptCall("playground");
      const p = await prepare(req, c);
      c.report = p.report;
      return raw.chat(transport(p.req), signal, headers);
    },
  };
  if (raw.post) u.post = raw.post.bind(raw);
  if (raw.form) u.form = raw.form.bind(raw);
  return u;
}
