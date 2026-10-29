/* Client calls for «مشاور هزینه» (src/server/rpc/advisor.ts). Reads leave the shared panel state alone; apply refreshes
   it (the wallet and the changed resource). */
import type { AdvisorAdminStats, AdvisorBrief, AdvisorReport, ApplyResult } from "./advisor";
import { refresh } from "./store";

async function rpc<T>(name: string, args: unknown[], reload = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc/" + name, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ args }) });
  } catch {
    throw new Error("ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.");
  }
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(j.error || "خطای سرور؛ چند لحظه دیگر دوباره تلاش کنید.");
  if (reload) await refresh();
  return j.result as T;
}

export const advisorApi = {
  report: (refresh = false) => rpc<AdvisorReport>("advisor.report", refresh ? [true] : []),
  brief: () => rpc<AdvisorBrief>("advisor.brief", []),
  apply: (id: string, typed?: string) => rpc<ApplyResult>("advisor.apply", [id, true, ...(typed !== undefined ? [typed] : [])], true),
  ignore: (id: string) => rpc<null>("advisor.ignore", [id]),
  setMute: (muted: boolean) => rpc<null>("advisor.setMute", [muted]),
  adminStats: () => rpc<AdvisorAdminStats>("advisor.adminStats", []),
  adminSettings: (patch: { dailyCap?: number; notifyMin?: number }) => rpc<{ dailyCap: number; notifyMin: number }>("advisor.adminSettings", [patch]),
};
