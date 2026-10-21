/* Client calls for «توضیح بده و درستش کن» (src/server/rpc/explain.ts). Both refresh the shared panel state
   (the wallet balance, the fixed resource). */
import type { ExplainKind, Explanation, FixResult } from "./explain";
import { refresh } from "./store";

async function rpc<T>(name: string, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc/" + name, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ args }) });
  } catch {
    throw new Error("ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.");
  }
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(j.error || "خطای سرور؛ چند لحظه دیگر دوباره تلاش کنید.");
  await refresh();
  return j.result as T;
}

export const explainApi = {
  explain: (kind: ExplainKind, resourceId: string, errorRef: string) => rpc<Explanation>("ai.explain", [kind, resourceId, errorRef]),
  applyFix: (explanationId: string, actionId: string, confirm?: boolean, input?: string) => rpc<FixResult>("ai.applyFix", [explanationId, actionId, !!confirm, ...(input !== undefined ? [input] : [])]),
};
