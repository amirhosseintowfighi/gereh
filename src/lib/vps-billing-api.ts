/* Client calls for the cloud-server extras and the account billing tools. Reads return a view the
   component keeps; writes also refresh the shared panel state (balances, tasks, invoices). */
import { refresh } from "./store";
import type { AccountExtrasView, BillingExtrasView, FwRuleIn, InvoiceProfile, PermLevel, TeamRoleView, VncView, VpsExtrasView } from "./vps-billing";

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

export const vpsApi = {
  extras: (sid: string) => read<VpsExtrasView>("servers.extras", sid),
  addIp: (sid: string) => write<string>("servers.addIp", sid),
  removeIp: (sid: string, ipId: string) => write("servers.removeIp", sid, ipId),
  setPtr: (sid: string, ipId: string, host: string) => write("servers.setPtr", sid, ipId, host),
  networkReset: (sid: string) => write("servers.networkReset", sid),
  addDisk: (sid: string, d: { name: string; sizeGb: number }) => write<string>("servers.addDisk", sid, d),
  resizeDisk: (diskId: string, sizeGb: number) => write("servers.resizeDisk", diskId, sizeGb),
  detachDisk: (diskId: string) => write("servers.detachDisk", diskId),
  attachDisk: (diskId: string, sid: string) => write("servers.attachDisk", diskId, sid),
  deleteDisk: (diskId: string, confirm: string) => write("servers.deleteDisk", diskId, confirm),
  setSnapSchedule: (sid: string, s: { frequency: "daily" | "weekly"; retention: number; hour: number; weekday: number } | null) => write("servers.setSnapSchedule", sid, s),
  vnc: (sid: string) => read<VncView>("servers.vnc", sid),
  setTrafficAutoBuy: (sid: string, on: boolean) => write("servers.setTrafficAutoBuy", sid, on),
  buyTraffic: (sid: string, gb?: number) => write("servers.buyTraffic", sid, ...(gb ? [gb] : [])),
  changePlan: (sid: string, planId: string) => write("servers.changePlan", sid, planId),
  fwGroupSave: (g: { id?: string; name: string; rules: FwRuleIn[] }) => write<string>("servers.fwGroupSave", g),
  fwGroupDelete: (gid: string) => write("servers.fwGroupDelete", gid),
  fwGroupAttach: (gid: string, sid: string, on: boolean) => write("servers.fwGroupAttach", gid, sid, on),
};

export const billingApi = {
  extras: () => read<BillingExtrasView>("billing.extras"),
  createWallet: (name: string) => write<string>("billing.createWallet", name),
  deleteWallet: (id: string) => write("billing.deleteWallet", id),
  transfer: (from: string, to: string, amount: number, note = "") => write("billing.transfer", from, to, amount, note),
  linkServer: (sid: string, walletId: string | null) => write("billing.linkServer", sid, walletId),
  setLowCredit: (v: { auto: boolean; amount: number }) => write("billing.setLowCredit", v),
  setBudget: (b: { service: string; monthlyCap: number; alertPct: number; block: boolean }) => write("billing.setBudget", b),
  removeBudget: (service: string) => write("billing.removeBudget", service),
  saveProfile: (p: Omit<InvoiceProfile, "id"> & { id?: string }) => write<string>("billing.saveProfile", p),
  deleteProfile: (id: string) => write("billing.deleteProfile", id),
  useProfile: (invId: string, profileId: string) => write("billing.useProfile", invId, profileId),
  adminSetLevel: (uid: string, level: string) => write("billing.adminSetLevel", uid, level),
  adminLevels: () => read<Record<string, string>>("billing.adminLevels"),
  adminPrices: () => read<{ prices: VpsExtrasView["prices"]; policy: { negativeGrace: number } }>("billing.adminPrices"),
  adminSavePrices: (p: VpsExtrasView["prices"]) => write("billing.adminSavePrices", p),
  adminSavePolicy: (p: { negativeGrace: number }) => write("billing.adminSavePolicy", p),
};

export const accountApi = {
  extras: () => read<AccountExtrasView>("account.extras"),
  recoveryCodes: () => read<string[]>("account.recoveryCodes"),
  pushSubscribe: (s: { endpoint: string; keys: { p256dh: string; auth: string } }) => write("account.pushSubscribe", s),
  pushRemove: (id: string) => write("account.pushRemove", id),
  setNotif: (key: string, on: boolean) => write("account.setNotif", key, on),
};

export const teamApi = {
  roles: () => read<TeamRoleView[]>("team.roles"),
  saveRole: (r: { id?: string; name: string; perms: Record<string, PermLevel> }) => write<string>("team.saveRole", r),
  deleteRole: (id: string) => write("team.deleteRole", id),
  assignRole: (memberId: string, roleId: string | null) => write("team.assignRole", memberId, roleId),
  transferServers: (ids: string[], memberId: string, confirm: string) => write("team.transferServers", ids, memberId, confirm),
};
