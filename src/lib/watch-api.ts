/* Client calls for «پایش پیشرفته» (src/server/rpc/watch.ts). */
import type { WatchAdminView, WatchCheckView, WatchHistory, WatchKind, WatchPlanMode, WatchReport, WatchSettings } from "./watch";

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

export const watchApi = {
  report: () => rpc<WatchReport>("watch.report", []),
  history: (kind: WatchKind, id: string) => rpc<WatchHistory>("watch.history", [kind, id]),
  enable: (kind: WatchKind, id: string, mode: WatchPlanMode) => rpc<{ message: string }>("watch.enable", [kind, id, mode]),
  renew: (kind: WatchKind, id: string, on: boolean) => rpc<{ message: string }>("watch.renew", [kind, id, on]),
  options: (kind: WatchKind, id: string, o: { autoFix?: boolean; uptimeUrl?: string }) => rpc<{ message: string }>("watch.options", [kind, id, o]),
  checkNow: (kind: WatchKind, id: string) => rpc<WatchCheckView & { ai: boolean }>("watch.checkNow", [kind, id]),
  admin: () => rpc<WatchAdminView>("watch.admin", []),
  adminSettings: (patch: Partial<WatchSettings>) => rpc<WatchAdminView>("watch.adminSettings", [patch]),
};
