import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { SupportAiMetrics, SupportAiRunView, SupportAiSettings } from "@/lib/support-ai";
import { actor, method, needStaff } from "../ctx";
import { aiModels } from "../db/schema";
import { logAudit } from "../util";

const id = z.string().max(40);
// the engine reaches the RPC registry through the assistant's tools, so it loads on first use
const engine = () => import("../support-ai/engine");

export const supportAiRpc = {
  /** customer: «مشکلم حل شد» under an AI reply closes the ticket and records the resolution */
  "tickets.aiResolved": method(z.tuple([id]), async (ctx, [tid]) => (await engine()).customerResolved(ctx, tid)),
  /** customer: «با پشتیبان انسانی صحبت کنم» flags the ticket for humans, raises its priority and stops AI replies */
  "tickets.aiHuman": method(z.tuple([id]), async (ctx, [tid]) => (await engine()).customerEscalate(ctx, tid)),

  /** staff: the AI runs of a ticket or a live chat, newest first (drafts, sent, rejected, auto) */
  "supportAi.runs": method(z.tuple([z.object({ ticketId: id.optional(), chatId: id.optional() })]), async (ctx, [o]): Promise<SupportAiRunView[]> => (await engine()).runsOf(ctx, o)),
  "supportAi.send": method(z.tuple([id, z.string().max(5000).optional()]), async (ctx, [rid, text]) => (await engine()).sendDraft(ctx, rid, text)),
  "supportAi.reject": method(z.tuple([id]), async (ctx, [rid]) => (await engine()).rejectDraft(ctx, rid)),
  "supportAi.metrics": method(z.tuple([z.number().int().min(1).max(365).optional()]), async (ctx, [days]): Promise<SupportAiMetrics> => {
    needStaff(ctx, "tickets");
    return (await engine()).supportAiMetrics(ctx.db, days ?? 30);
  }),
  "supportAi.settings": method(z.tuple([]), async (ctx): Promise<{ settings: SupportAiSettings; models: { id: string; name: string }[] }> => {
    needStaff(ctx, "tickets");
    const models = await ctx.db.select({ id: aiModels.id, name: aiModels.name }).from(aiModels).where(and(eq(aiModels.active, true), eq(aiModels.kind, "chat"), gt(aiModels.outPrice, 0))).orderBy(asc(aiModels.position));
    return { settings: await (await engine()).supportAiSettings(ctx.db), models };
  }),
  /** the owner (settings) decides the mode, thresholds, filters and the platform's daily budget */
  "supportAi.saveSettings": method(z.tuple([z.record(z.string(), z.unknown())]), async (ctx, [raw]) => {
    needStaff(ctx, "settings");
    const e = await engine();
    const next = await e.saveSupportAiSettings(ctx.db, e.SETTINGS_PATCH.parse(raw));
    await logAudit(ctx.db, actor(ctx), "تنظیمات پشتیبانی هوش مصنوعی: حالت " + next.mode, "support.ai", ctx.ip);
    return next;
  }),
};
