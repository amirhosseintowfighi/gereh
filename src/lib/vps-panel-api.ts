/* Client calls for the cloud-server panel's Virtualizor tools (src/server/rpc/vps-panel.ts). Reads return a view
   the component keeps; writes also refresh the shared panel state (tasks, status). */
import { refresh } from "./store";

export type LayoutView = { allowanceGb: number; usedGb: number; maxDisks: number; disks: { slot: number; sizeGb: number; primary: boolean }[]; billed: { name: string; sizeGb: number }[] };
export type StatsRange = "1h" | "24h" | "7d" | "30d";
export type StatsPoint = { t: number; cpu: number; ram: number; disk: number; netIn: number; netOut: number; ioRead: number; ioWrite: number };
export type StatsView = { range: StatsRange; source: "site" | "virtualizor" | "none"; points: StatsPoint[] };
export type LogSource = "all" | "virtualizor" | "site" | "sync";
export type LogsView = { items: { id: string; source: Exclude<LogSource, "all">; at: string; ts: number; text: string; status: "done" | "running" | "failed" }[]; total: number; page: number; pages: number; vzError: string };
export type VzBackups = { enabled: boolean; error: string; list: { id: string; date: string; file: string; sizeMb: number }[] };
export type VzProcess = { pid: number; user: string; cpu: number; mem: number; command: string };
export type VzService = { name: string; running: boolean };

async function rpc<T = void>(name: string, args: unknown[], write = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/rpc/" + name, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ args }) });
  } catch {
    throw new Error("ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.");
  }
  const j = (await res.json().catch(() => ({}))) as { result?: T; error?: string };
  if (!res.ok) throw new Error(j.error || "خطای سرور؛ چند لحظه دیگر دوباره تلاش کنید.");
  if (write) await refresh();
  return j.result as T;
}
const read = <T>(name: string, ...args: unknown[]) => rpc<T>(name, args, false);
const write = <T = void>(name: string, ...args: unknown[]) => rpc<T>(name, args, true);

export const panelApi = {
  layout: (sid: string) => read<LayoutView>("servers.layout", sid),
  setLayout: (sid: string, req: { sizes: number[]; os?: string; confirm?: string }) => write<{ mode: "append" | "rebuild" }>("servers.setLayout", sid, req),
  stats: (sid: string, range: StatsRange) => read<StatsView>("servers.stats", sid, range),
  logs: (sid: string, f: { page: number; source: LogSource; q: string }) => read<LogsView>("servers.logs", sid, f),
  vzBackups: (sid: string) => read<VzBackups>("servers.vzBackups", sid),
  vzBackup: (sid: string) => write("servers.vzBackup", sid),
  vzRestore: (sid: string, backupId: string, confirm: string) => write("servers.vzRestore", sid, backupId, confirm),
  processes: (sid: string) => read<VzProcess[]>("servers.processes", sid),
  killProcesses: (sid: string, pids: number[]) => write("servers.killProcesses", sid, pids),
  services: (sid: string) => read<VzService[]>("servers.services", sid),
  serviceAction: (sid: string, names: string[], action: "start" | "stop" | "restart") => write("servers.serviceAction", sid, names, action),
  applySshKeys: (sid: string, keyIds: string[]) => write("servers.applySshKeys", sid, keyIds),
  ipv6: (sid: string) => read<string[]>("servers.ipv6", sid),
  setPtr6: (sid: string, addr: string, host: string) => write("servers.setPtr6", sid, addr, host),
};
