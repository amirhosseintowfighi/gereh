/* Client calls for «پایش هوشمند» (src/server/rpc/monitor.ts). Actions refresh the shared panel state (the server's
   status, snapshots, firewall). */
import type { ActResult, ChannelPrefs, MonitorActionId, MonitorAdminIncident, MonitorAdminStats, MonitorBadge, MonitorBrief, MonitorReport, ResourceKind, Sensitivity } from "./monitor";
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

export const monitorApi = {
  report: () => rpc<MonitorReport>("monitor.report", []),
  brief: () => rpc<MonitorBrief>("monitor.brief", []),
  badge: (kind: ResourceKind, id: string) => rpc<MonitorBadge>("monitor.badge", [kind, id]),
  feedback: (id: string, f: "false_positive" | "useful") => rpc<null>("monitor.feedback", [id, f]),
  mute: (id: string, hours: number) => rpc<null>("monitor.mute", [id, hours]),
  setResource: (kind: ResourceKind, id: string, patch: { sensitivity?: Sensitivity; muteHours?: number }) => rpc<null>("monitor.setResource", [kind, id, patch]),
  setPrefs: (p: ChannelPrefs) => rpc<null>("monitor.setPrefs", [p]),
  act: (id: string, action: MonitorActionId, typed?: string) => rpc<ActResult>("monitor.act", [id, action, true, ...(typed !== undefined ? [typed] : [])], true),
  adminIncidents: () => rpc<MonitorAdminIncident[]>("monitor.adminIncidents", []),
  adminStats: () => rpc<MonitorAdminStats>("monitor.adminStats", []),
  staffAct: (id: string, action: "suspend" | "contact", text?: string) => rpc<ActResult>("monitor.staffAct", [id, action, true, ...(text !== undefined ? [text] : [])]),
  adminSettings: (patch: { dailyCap?: number; autoSuspendAbuse?: boolean }) => rpc<{ dailyCap: number; autoSuspendAbuse: boolean }>("monitor.adminSettings", [patch]),
};
