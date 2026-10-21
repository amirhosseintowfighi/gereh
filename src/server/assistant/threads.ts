/* Conversations of «دستیار گره»: stored per person and account, the model's view of one (a window of the
   latest turns plus a cheap summary of what fell out of it) and the panel's view. */
import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { ASSISTANT, type AssistantMessageView, type AssistantThreadView, type AssistantToolActivity } from "@/lib/assistant";
import { faDateTime } from "@/lib/jalali";
import type { Auth } from "../auth";
import type { DB } from "../db/client";
import { assistantMessages, assistantThreads } from "../db/schema";
import { rid } from "../util";

export type Thread = typeof assistantThreads.$inferSelect;
export type Row = typeof assistantMessages.$inferSelect;

/** the person chatting and the account the tools act on */
export const who = (a: Auth) => ({ userId: a.user.id, accountId: a.uid });

export async function ownThread(db: DB, a: Auth, id: string) {
  const w = who(a);
  const [t] = await db.select().from(assistantThreads).where(and(eq(assistantThreads.id, id), eq(assistantThreads.userId, w.userId), eq(assistantThreads.accountId, w.accountId)));
  return t ?? null;
}

export async function newThread(db: DB, a: Auth) {
  const [t] = await db.insert(assistantThreads).values({ id: rid("ast"), ...who(a), title: ASSISTANT.newTitle }).returning();
  return t;
}

export async function listThreads(db: DB, a: Auth): Promise<AssistantThreadView[]> {
  const w = who(a);
  const rows = await db.select().from(assistantThreads).where(and(eq(assistantThreads.userId, w.userId), eq(assistantThreads.accountId, w.accountId))).orderBy(desc(assistantThreads.updatedAt)).limit(100);
  return rows.map((t) => ({ id: t.id, title: t.title || ASSISTANT.newTitle, spent: t.spent, updated: faDateTime(t.updatedAt), updatedTs: t.updatedAt.getTime() }));
}

export const threadRows = (db: DB, threadId: string) => db.select().from(assistantMessages).where(eq(assistantMessages.threadId, threadId)).orderBy(asc(assistantMessages.id));

/** how many stored rows the model sees; older turns are summarised */
export const WINDOW = 30;
/** the latest rows, starting at a user turn (a tool answer never loses the call it answers), and a summary of the rest */
export function windowOf(rows: Row[], size = WINDOW): { rows: Row[]; summary: string } {
  if (rows.length <= size) return { rows, summary: "" };
  let start = rows.length - size;
  while (start < rows.length && rows[start].role !== "user") start++;
  if (start >= rows.length) start = rows.findLastIndex((r) => r.role === "user");
  const older = rows.slice(0, Math.max(0, start));
  const asks = older.filter((r) => r.role === "user").slice(-8).map((r) => "- " + r.content.replace(/\s+/g, " ").slice(0, 120));
  const acts = older.filter((r) => r.role === "tool" && (r.meta as { status?: string }).status === "ok").slice(-8).map((r) => "- " + String((r.meta as { label?: string }).label ?? r.toolName) + " → " + String((r.meta as { summary?: string }).summary ?? ""));
  const summary = (asks.length ? "Earlier requests:\n" + asks.join("\n") : "") + (acts.length ? "\nEarlier tool results:\n" + acts.join("\n") : "");
  return { rows: rows.slice(Math.max(0, start)), summary };
}

type ToolMeta = { label?: string; risk?: AssistantToolActivity["risk"]; status?: AssistantToolActivity["status"]; summary?: string; confirm?: AssistantMessageView["confirm"] };
/** the panel's view: a user turn, then one assistant bubble per answer (its texts, tool chips and any confirmation) */
export function threadView(rows: Row[]): AssistantMessageView[] {
  const out: AssistantMessageView[] = [];
  for (const r of rows) {
    if (r.role === "user") { out.push({ id: r.id, role: "user", content: r.content, cost: 0, at: faDateTime(r.createdAt), tools: [], confirm: null }); continue; }
    let cur = out.at(-1);
    if (!cur || cur.role !== "assistant") { cur = { id: r.id, role: "assistant", content: "", cost: 0, at: faDateTime(r.createdAt), tools: [], confirm: null }; out.push(cur); }
    cur.cost += r.cost;
    if (r.role === "assistant") { if (r.content.trim()) cur.content += (cur.content ? "\n\n" : "") + r.content; cur.id = r.id; continue; }
    const m = r.meta as ToolMeta;
    cur.tools.push({ id: r.toolCallId ?? String(r.id), name: r.toolName ?? "", label: m.label ?? r.toolName ?? "", risk: m.risk ?? "read", status: m.status ?? "ok", summary: m.summary ?? "" });
    if (m.confirm) cur.confirm = m.confirm;
  }
  return out;
}
