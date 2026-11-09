/* OptCall: what a call site hands to aiUpstream().chat(req, signal, headers, call) — the feature, an
   optional policy override and the customer's opt-in — and what it gets back: the optimizer's report.
   Billing: the customer pays for the request as the customer / feature built it. With content unchanged
   that is exactly the upstream's prompt_tokens (cached tokens included, at the normal price); when the
   optimizer removed content, the calibrated estimate of what it removed is added back. The savings, and
   any cache discount, stay with Gereh. Pure: no I/O. */
import { calibrated } from "./estimator";
import type { Feature, OptReport, Policy } from "./types";
import type { ChatUsage } from "../translate";

export class OptCall {
  report: OptReport | null = null;
  constructor(readonly feature: Feature, readonly o: { optIn?: boolean; policy?: Partial<Policy>; plan?: string } = {}) {}

  /** input tokens to bill: the original request's size. `fallback` is the call site's estimate of the original request, used when the upstream reports no usage */
  billedIn(usage: ChatUsage | null | undefined, fallback: number): number {
    return billedInput(this.report, usage, fallback);
  }
}

export function billedInput(report: OptReport | null, usage: ChatUsage | null | undefined, fallback: number): number {
  if (!usage) return fallback;
  if (!report || !report.changed) return usage.prompt_tokens;
  const removed = Math.max(0, report.origTokens - report.optTokens);
  return usage.prompt_tokens + calibrated(removed, report.factor);
}
