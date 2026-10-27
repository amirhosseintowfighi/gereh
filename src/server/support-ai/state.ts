/* «پشتیبانی AI» per ticket for /api/state (kept apart from the engine, which reaches the RPC registry). */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { TicketAiState } from "@/lib/support-ai";
import type { DB } from "../db/client";
import { supportAiRuns, supportAiThreads } from "../db/schema";

/** escalation, resolution and turns; pendingDraft (a draft waiting for staff) only in the admin view */
export async function ticketAiStates(db: DB, ids: string[], admin: boolean): Promise<Map<string, TicketAiState>> {
  const out = new Map<string, TicketAiState>();
  if (!ids.length) return out;
  const [threads, drafts] = await Promise.all([
    db.select().from(supportAiThreads).where(inArray(supportAiThreads.ticketId, ids)),
    admin ? db.select({ ticketId: supportAiRuns.ticketId }).from(supportAiRuns).where(and(inArray(supportAiRuns.ticketId, ids), eq(supportAiRuns.status, "draft"))) : [],
  ]);
  const pending = new Set(drafts.map((d) => d.ticketId));
  for (const r of threads) if (r.ticketId) out.set(r.ticketId, { escalated: r.escalated, resolved: !!r.resolvedAt, turns: r.turns, pendingDraft: pending.has(r.ticketId), handled: r.turns > 0 });
  return out;
}
