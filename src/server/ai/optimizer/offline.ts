/* The offline benchmark of one fixture (pure, deterministic): the policy its feature gets in production,
   the estimated reduction, and every integrity check — validator, latest user message, tool definitions,
   tool calls and image parts byte-identical. These are ESTIMATES of input tokens, not billed numbers. */
import { optimizeRequest } from "./optimize";
import { resolvePolicy } from "./policy";
import type { ChatMessage, ChatRequest, Feature } from "./types";

export type Fixture = {
  id: string; workload: string; feature: Feature; optIn?: boolean; description: string;
  request: Pick<ChatRequest, "messages"> & { tools?: Record<string, unknown>[] };
  check: { kind: "tool" | "json" | "code" | "contains" | "exact" | "free"; expect?: string[] };
};

export type OfflineResult = {
  id: string; workload: string; feature: Feature; policy: string; origTokens: number; optTokens: number; reductionPct: number;
  steps: Record<string, number>; validatorFailures: number; fallback: string;
  latestIntact: boolean; toolsIntact: boolean; imagesIntact: boolean; toolCallsIntact: boolean; pass: boolean; latencyMs: number;
};

const images = (msgs: ChatMessage[]) => JSON.stringify(msgs.flatMap((m) => (Array.isArray(m.content) ? (m.content as { type?: string }[]).filter((p) => p?.type !== "text") : [])));
const calls = (msgs: ChatMessage[]) => JSON.stringify(msgs.flatMap((m) => m.tool_calls ?? []));

export async function offlineOne(fx: Fixture): Promise<OfflineResult> {
  const req: ChatRequest = { model: "benchmark-model", ...fx.request };
  const policy = resolvePolicy({ feature: fx.feature, optIn: fx.optIn, call: { budgetMs: 2000 } });
  const { req: out, report } = await optimizeRequest(req, policy, { feature: fx.feature, model: "benchmark-model" });
  const latest = req.messages.map((m) => m.role).lastIndexOf("user");
  const outLatest = out.messages.map((m) => m.role).lastIndexOf("user");
  const latestIntact = JSON.stringify(req.messages[latest]) === JSON.stringify(out.messages[outLatest]) && JSON.stringify(req.messages.slice(latest)) === JSON.stringify(out.messages.slice(outLatest));
  const toolsIntact = JSON.stringify(req.tools ?? null) === JSON.stringify(out.tools ?? null);
  // summarized turns drop their image parts and tool calls together with the turn; what is kept must be identical
  const imagesIntact = report.steps.summary ? images(out.messages).length <= images(req.messages).length : images(out.messages) === images(req.messages);
  const toolCallsIntact = report.steps.summary ? true : calls(out.messages) === calls(req.messages);
  const pass = report.validatorFailures === 0 && !report.fallback && latestIntact && toolsIntact && imagesIntact && toolCallsIntact;
  return {
    id: fx.id, workload: fx.workload, feature: fx.feature, policy: report.policy, origTokens: report.origTokens, optTokens: report.optTokens,
    reductionPct: report.origTokens ? Math.round(((report.origTokens - report.optTokens) / report.origTokens) * 1000) / 10 : 0,
    steps: report.steps, validatorFailures: report.validatorFailures, fallback: report.fallback, latestIntact, toolsIntact, imagesIntact, toolCallsIntact, pass, latencyMs: report.latencyMs,
  };
}
