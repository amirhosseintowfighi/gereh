/* What «پشتیبانی AI» knows about a ticket: read-only, as the customer, through the assistant's own read tools
   (src/server/assistant/tools.ts, which run the RPC and public-API methods with the customer's permissions and
   never staff powers). A tool that is not a pure read is refused here, so nothing can ever change on the account.
   Every string is redacted with the error explainer's helpers before it reaches a prompt. */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { toolByName, execTool } from "../assistant/tools";
import { redact } from "../ai/explain";
import { systemCtx } from "../builder/deploy";
import { suggest } from "../chat";
import type { DB } from "../db/client";
import { ticketMessages, type tickets } from "../db/schema";
import { AUTO_REPLY_NAME } from "../worker/ops";
import type { Facts } from "./sim";

type Json = Record<string, unknown>;
const S = (v: unknown) => String(v ?? "");
const rows = (out: unknown): Json[] => { const d = (out as { data?: unknown })?.data; return Array.isArray(d) ? (d as Json[]) : []; };
const BILLING = /صورتحساب|فاکتور|پرداخت|کیف پول|موجودی|invoice|شارژ|هزینه|تراکنش|کسر|بازگشت وجه|پول|مالی|billing|refund/i;

/** the customer-visible thread: customer and staff messages, never the AI's drafts or staff notes (they live in
    support_ai_runs), without the automatic acknowledgement */
export async function ticketThread(db: DB, ticketId: string) {
  const msgs = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticketId)).orderBy(asc(ticketMessages.id));
  return msgs.filter((m) => m.name !== AUTO_REPLY_NAME).map((m) => ({ id: m.id, from: m.from === "user" ? ("customer" as const) : ("support" as const), text: redact(m.text).slice(0, 3000), ai: m.ai }));
}

/** runs one read tool as the customer; anything but a read is refused, failures become an empty result */
async function read(ctx: Awaited<ReturnType<typeof systemCtx>>, name: string, args: Json = {}): Promise<unknown> {
  const t = toolByName(name);
  if (!t || t.risk(args) !== "read") throw new Error("support-ai: " + name + " is not a read tool");
  try { return await execTool(ctx, t, args); } catch { return null; }
}

export async function gatherFacts(db: DB, t: typeof tickets.$inferSelect, thread: Facts["thread"]): Promise<Facts> {
  const customerText = [t.subject, ...thread.filter((m) => m.from === "customer").map((m) => m.text)].join("\n");
  const ctx = await systemCtx(db, t.userId);
  const [srv, apps, dbs, doms] = await Promise.all([read(ctx, "list_servers"), read(ctx, "list_apps"), read(ctx, "list_databases"), read(ctx, "list_domains")]);
  const services: Facts["services"] = [
    ...rows(srv).map((s) => ({ kind: "server" as const, id: S(s.id), name: S(s.name), status: S(s.status), detail: [S(s.ipv4), S(s.plan)].filter(Boolean).join("، "), link: "/panel/servers/" + S(s.id) })),
    ...rows(apps).map((a) => ({ kind: "app" as const, id: S(a.id), name: S(a.name), status: S(a.status), detail: (a.latest_deployment as Json | null)?.status ? "آخرین استقرار: " + S((a.latest_deployment as Json).status) : "", link: "/panel/apps/" + S(a.id) })),
    ...rows(dbs).map((d) => ({ kind: "database" as const, id: S(d.id), name: S(d.name), status: S(d.status), detail: S(d.engine), link: "/panel/databases/" + S(d.id) })),
    ...rows(doms).map((d) => ({ kind: "domain" as const, id: S(d.id), name: S(d.name), status: S(d.status), detail: d.expires_at ? "انقضا " + S(d.expires_at).slice(0, 10) : "", link: "/panel/domains/" + S(d.id) })),
  ].slice(0, 40);

  const lower = customerText.toLowerCase();
  const named = services.find((s) => s.id === t.service) ?? services.find((s) => s.name.length >= 3 && lower.includes(s.name.toLowerCase())) ?? null;
  const problems: string[] = [];
  for (const a of rows(apps)) {
    const dep = a.latest_deployment as Json | null;
    if (dep && S(dep.status) === "failed") problems.push("استقرار " + S(dep.id) + " اپ " + S(a.name) + " ناموفق بود (" + S(dep.created_at).slice(0, 16).replace("T", " ") + ").");
    if (["crashed", "failed"].includes(S(a.status))) problems.push("اپ " + S(a.name) + " در وضعیت " + S(a.status) + " است.");
  }
  // server events: the one the ticket is about, else the ones that are not running (at most three)
  const looked = services.filter((s) => s.kind === "server" && (s.id === named?.id || s.status !== "running")).slice(0, 3);
  for (const s of looked) {
    const logs = (await read(ctx, "server_logs", { server_id: s.id })) as { items?: { at: string; status: string; text: string }[] } | null;
    for (const i of (logs?.items ?? []).filter((x) => /fail|error/i.test(x.status)).slice(0, 3)) problems.push("سرور " + s.name + ": «" + i.text + "» ناموفق (" + i.at + ").");
  }
  const delayed = rows(srv).filter((s) => S(s.status) === "provisioning");
  for (const s of delayed) problems.push("سرور " + S(s.name) + " هنوز در حال آماده‌سازی است.");

  let billing: Facts["billing"] = null;
  if (BILLING.test(customerText) || t.dept === "مالی") {
    const [sum, inv] = await Promise.all([read(ctx, "spending_summary"), read(ctx, "list_invoices")]);
    const s = (sum ?? {}) as Json;
    billing = {
      balance: Number(s.balance_toman) || 0, monthSpent: Number(s.month_spent_toman) || 0, unpaidInvoices: Number(s.unpaid_invoices) || 0, unpaidTotal: Number(s.unpaid_total_toman) || 0,
      invoices: rows(inv).slice(0, 5).map((i) => ({ id: S(i.id), status: S(i.status), total: Number(i.total_toman ?? i.total) || 0 })),
    };
  }
  const kb = suggest(customerText, 3).map((a) => ({ title: a.title, slug: a.slug, description: a.description }));
  return {
    subject: redact(t.subject), thread, services: services.map((s) => ({ ...s, detail: redact(s.detail) })), problems: problems.slice(0, 8).map((p) => redact(p).slice(0, 300)), billing, kb,
    resource: named,
  };
}

/** a live chat knows only the help center: a visitor's token is not an account session */
export function chatFacts(subject: string, thread: Facts["thread"]): Facts {
  const text = thread.filter((m) => m.from === "customer").map((m) => m.text).join("\n");
  return { subject, thread, services: [], problems: [], billing: null, kb: suggest(text, 3).map((a) => ({ title: a.title, slug: a.slug, description: a.description })), resource: null };
}
