/* Client calls for the staff order detail, customer 360 view and admin search. Reads return a view the
   component keeps; fixes also refresh the shared panel state. */
import { refresh } from "./store";
import type { Check, OrderDetail, SearchHit, TxFilter, UserActivity, UserOrders, UserServices, UserSummary, UserUsage } from "./admin-detail";

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

export const adminDetailApi = {
  order: (invoiceId: string, index: number) => read<OrderDetail>("admin.orderDetail", invoiceId, index),
  preflight: (invoiceId: string, index: number) => read<Check[]>("admin.orderPreflight", invoiceId, index),
  editOrder: (invoiceId: string, index: number, patch: { os?: string; osid?: number; loc?: string; plid?: number }) => write<string[]>("admin.orderEdit", invoiceId, index, patch),
  summary: (id: string) => read<UserSummary>("admin.userDetail", id, "summary"),
  orders: (id: string, offset = 0) => read<UserOrders>("admin.userDetail", id, "orders", { offset }),
  services: (id: string) => read<UserServices>("admin.userDetail", id, "services"),
  usage: (id: string, tx: TxFilter) => read<UserUsage>("admin.userDetail", id, "usage", { tx }),
  activity: (id: string, offset = 0) => read<UserActivity>("admin.userDetail", id, "activity", { offset }),
  txCsv: (id: string, tx: TxFilter) => read<string>("admin.userTxCsv", id, tx),
  search: (q: string) => read<SearchHit[]>("admin.search", q),
  resetTwofa: (id: string) => write("admin.resetTwofa", id),
  notifyUser: (id: string, text: string) => write("admin.notifyUser", id, text),
};
