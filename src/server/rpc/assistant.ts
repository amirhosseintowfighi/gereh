import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { AssistantMessageView, AssistantThreadView } from "@/lib/assistant";
import { isAiError } from "../ai/endpoints";
import { resolveModel } from "../ai/service";
import { actor, method, needStaff, needUser } from "../ctx";
import { aiModels, assistantThreads } from "../db/schema";
import { fail, logAudit } from "../util";

const id = z.string().max(40);
const token = z.string().min(16).max(64);
// the assistant modules reach the whole registry, so they load on first use
const threads = () => import("../assistant/threads");
const confirm = () => import("../assistant/confirm");
const prompt = () => import("../assistant/prompt");

export const assistantRpc = {
  /** the panel's threads, or with "staff" the staff console's (staff in their own session only) */
  "assistant.threads": method(z.tuple([z.enum(["customer", "staff"]).optional()]), async (ctx, [mode]): Promise<AssistantThreadView[]> => {
    const a = needUser(ctx);
    if (mode === "staff" && !(a.user.role === "admin" && a.uid === a.user.id)) fail("اجازه این کار را ندارید.", 403);
    return (await threads()).listThreads(ctx.db, a, mode ?? "customer");
  }),

  "assistant.thread": method(z.tuple([id]), async (ctx, [tid]): Promise<{ id: string; title: string; spent: number; messages: AssistantMessageView[] }> => {
    const t = await threads();
    const th = await t.ownThread(ctx.db, needUser(ctx), tid);
    if (!th) fail("گفتگو پیدا نشد.", 404);
    return { id: th!.id, title: th!.title, spent: th!.spent, messages: t.threadView(await t.threadRows(ctx.db, th!.id)) };
  }),

  "assistant.deleteThread": method(z.tuple([id]), async (ctx, [tid]) => {
    const th = await (await threads()).ownThread(ctx.db, needUser(ctx), tid);
    if (!th) fail("گفتگو پیدا نشد.", 404);
    await ctx.db.delete(assistantThreads).where(eq(assistantThreads.id, th!.id));
  }),

  /** runs a proposed action once: the token from the confirm card and the exact arguments it showed */
  "assistant.confirm": method(z.tuple([token, z.record(z.string(), z.unknown())]), async (ctx, [tok, args]) => {
    needUser(ctx);
    return (await confirm()).decide(ctx, tok, args, "confirm");
  }),
  "assistant.cancel": method(z.tuple([token]), async (ctx, [tok]) => {
    needUser(ctx);
    return (await confirm()).decide(ctx, tok, null, "cancel");
  }),

  /** staff: the assistant's model (kv "assistant"; "" = the default) and the chat models that can call tools */
  "assistant.adminSettings": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "ai");
    const p = await prompt();
    const [s, eff, models] = await Promise.all([p.assistantSettings(ctx.db), p.assistantModel(ctx.db),
      ctx.db.select({ id: aiModels.id, name: aiModels.name }).from(aiModels).where(and(eq(aiModels.active, true), eq(aiModels.kind, "chat"), eq(aiModels.tools, true), gt(aiModels.outPrice, 0))).orderBy(asc(aiModels.position))]);
    return { model: s.model, effective: eff?.id ?? "", env: !!process.env.ASSISTANT_MODEL, models };
  }),
  "assistant.adminSetModel": method(z.tuple([z.string().trim().max(80)]), async (ctx, [model]) => {
    const a = needStaff(ctx, "ai");
    if (model) {
      const m = await resolveModel(ctx.db, model, [], "chat");
      if (isAiError(m) || !m.tools || m.outPrice <= 0) fail("این مدل فعال، قیمت‌گذاری‌شده و با پشتیبانی فراخوانی ابزار نیست.");
    }
    await (await prompt()).saveAssistantSettings(ctx.db, { model });
    await logAudit(ctx.db, actor(ctx), "مدل دستیار گره: " + (model || "پیش‌فرض"), a.user.id, ctx.ip);
  }),
};
