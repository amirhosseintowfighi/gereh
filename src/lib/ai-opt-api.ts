/* Client calls for «بهینه‌ساز توکن» (src/server/rpc/ai-opt.ts), staff only. */
import type { BenchRow, OfflineRow, OptSettings, OptSettingsView, OptStats } from "./ai-opt";

async function rpc<T>(name: string, args: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc/" + name, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ args }) });
  } catch {
    throw new Error("ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.");
  }
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(j.error || "خطای سرور؛ چند لحظه دیگر دوباره تلاش کنید.");
  return j.result as T;
}

export const aiOptApi = {
  stats: (days: number) => rpc<OptStats>("aiOpt.stats", [days]),
  settings: () => rpc<OptSettingsView>("aiOpt.settings", []),
  saveSettings: (patch: Partial<OptSettings>) => rpc<OptSettings>("aiOpt.saveSettings", [patch]),
  offline: () => rpc<OfflineRow[]>("aiOpt.offline", []),
  benchStart: (model: string, budgetUsd: number, judge: boolean) => rpc<string>("aiOpt.benchStart", [model, budgetUsd, judge]),
  benchList: () => rpc<BenchRow[]>("aiOpt.benchList", []),
};
