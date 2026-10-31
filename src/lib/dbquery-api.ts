/* Client calls for «پرسش از دیتابیس» (src/server/rpc/dbquery.ts). Questions and runs leave the shared panel state
   alone; a charged question or analysis refreshes it (the wallet). */
import type { DbqAnalysis, DbqAnswer, DbqChart, DbqOverview, DbqResult } from "./dbquery";
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
  if (reload) void refresh();
  return j.result as T;
}

export type DbqRun = { historyId: string; query: string; result: DbqResult; chart: DbqChart };
export const dbqueryApi = {
  overview: (dbId: string, database?: string) => rpc<DbqOverview>("dbquery.overview", database ? [dbId, database] : [dbId]),
  ask: (dbId: string, database: string, question: string) => rpc<DbqAnswer>("dbquery.ask", [dbId, { database, question }], true),
  run: (dbId: string, database: string, query: string, historyId?: string) => rpc<DbqRun>("dbquery.run", [dbId, { database, query, ...(historyId ? { historyId } : {}) }]),
  analyze: (historyId: string) => rpc<DbqAnalysis>("dbquery.analyze", [historyId, true], true),
  setSamples: (dbId: string, on: boolean) => rpc<{ samples: boolean }>("dbquery.setSamples", [dbId, on]),
  save: (historyId: string, saved: boolean, title = "") => rpc<null>("dbquery.save", [historyId, saved, title]),
  remove: (historyId: string) => rpc<null>("dbquery.remove", [historyId]),
};
