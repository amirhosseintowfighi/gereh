/* «توضیح بده و درستش کن» (group "ai"): explain an error of the caller's own resource, then run an offered fix
   through the real RPC with the caller's context (src/server/ai/explain.ts). */
import "server-only";
import { z } from "zod";
import { EXPLAIN_KINDS, type ExplainKind } from "@/lib/explain";
import { applyFix, explainError } from "../ai/explain";
import { method } from "../ctx";

export const explainRpc = {
  /** errorRef: a deployment / task / import id, "ev-<event>", "provision", "relayout", "status", or an error toast's sealed ref */
  "ai.explain": method(z.tuple([z.enum(EXPLAIN_KINDS as [ExplainKind, ...ExplainKind[]]), z.string().min(1).max(80), z.string().min(1).max(4000)]), async (ctx, [kind, resourceId, errorRef]) =>
    explainError(ctx, kind, resourceId, errorRef)),

  /** confirm: required for costly fixes (the price was shown first); input: the value the fix asks for */
  "ai.applyFix": method(z.tuple([z.string().max(40), z.string().max(40), z.boolean().optional(), z.string().max(32_768).optional()]), async (ctx, [explanationId, actionId, confirm, input]) =>
    applyFix(ctx, explanationId, actionId, !!confirm, input ?? "")),
};
