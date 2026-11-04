/* Real dashboard figures (src/server/dashboard.ts) and the demo-seed diagnostic (src/server/demo-seed.ts):
   types and client calls. */
import { refresh } from "./store";

export type AdminDashboardStats = {
  signups: { period: string; labels: string[]; counts: number[]; total: number };
  customers: { total: number; active: number };
  /** gross (with VAT) of paid invoices per Jalali month, Toman */
  revenue: { period: string; labels: string[]; gross: number[]; total: number };
  /** null when no ticket was answered in the period */
  firstResponse: { period: string; minutes: number | null; tickets: number };
};
export type TrafficSummary = { days: { day: string; inGb: number; outGb: number }[]; totalGb: number; servers: number; empty: string };
export type SeedItem = { key: string; label: string; count: number; sample: string[] };
export type SeedReport = { items: SeedItem[]; total: number; users: { id: string; email: string }[]; keptUsers: string[]; fakeVirt: boolean; warnings: string[]; posts: number };

/** «هنوز داده‌ای ثبت نشده» plus why and when it will appear */
export const NO_DATA = "هنوز داده‌ای ثبت نشده";

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

export const dashboardApi = {
  admin: () => rpc<AdminDashboardStats>("admin.dashboardStats", []),
  traffic: () => rpc<TrafficSummary>("servers.trafficSummary", []),
  seedRows: () => rpc<SeedReport>("admin.seedRows", []),
  testEmail: () => rpc<{ to: string }>("admin.testEmail", []),
  removeSeedRows: (confirm: string) => rpc<{ removed: Record<string, number>; total: number; keptUsers: string[] }>("admin.removeSeedRows", [confirm], true),
};
