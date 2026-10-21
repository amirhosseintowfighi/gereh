/* Confirmation of sensitive assistant actions. The model can only propose a danger tool: the proposal is stored
   with a one-time token (only its hash is kept) bound to the person, the account, the exact arguments and a short
   expiry, and the panel shows a card. Only the person's explicit confirm, with that token and the same arguments,
   runs it; the model never sees the token, so it cannot confirm by itself. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { ConfirmCard } from "@/lib/assistant";
import { actor, type Ctx } from "../ctx";
import { assistantActions, assistantMessages } from "../db/schema";
import { AppError, fail, logActivity, logAudit, rid, sha256 } from "../util";
import { errorText, wrapResult } from "./prompt";
import { who, type Thread } from "./threads";
import { execTool, readOnlyView, toolAllowed, toolByName, type AssistantTool, type Quote } from "./tools";

type Json = Record<string, unknown>;
export const confirmTtl = () => Number(process.env.ASSISTANT_CONFIRM_TTL_MS || 5 * 60_000);

/** JSON with sorted keys, so the same arguments always hash the same */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => (v as Json)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical((v as Json)[k])).join(",") + "}";
  return JSON.stringify(v ?? null);
}
export const argsHash = (userId: string, accountId: string, tool: string, args: Json) => sha256(["assistant-confirm", userId, accountId, tool, canonical(args)].join("\n"));

export async function propose(ctx: Ctx, thread: Thread, t: AssistantTool, args: Json, toolCallId: string, q: Quote): Promise<ConfirmCard> {
  const w = who(ctx.auth!);
  const token = randomBytes(24).toString("base64url");
  const id = rid("aact");
  const expiresAt = new Date(Date.now() + confirmTtl());
  await ctx.db.insert(assistantActions).values({
    id, tokenHash: sha256(token), threadId: thread.id, ...w, toolCallId, tool: t.name, args, argsHash: argsHash(w.userId, w.accountId, t.name, args),
    summary: q.summary.slice(0, 1000), cost: q.cost, expiresAt,
  });
  return { id, token, tool: t.name, args, title: q.title, summary: q.summary, resource: q.resource, cost: q.cost, costNote: q.costNote, expiresAt: expiresAt.getTime() };
}

export type Decision = { id: string; threadId: string; status: "done" | "failed" | "cancelled"; summary: string; tool: string };

async function settleMessage(ctx: Ctx, a: typeof assistantActions.$inferSelect, status: Decision["status"], content: string, summary: string) {
  const [m] = await ctx.db.select().from(assistantMessages).where(and(eq(assistantMessages.threadId, a.threadId), eq(assistantMessages.toolCallId, a.toolCallId), eq(assistantMessages.role, "tool")));
  if (!m) return;
  const meta = m.meta as Json;
  const confirm = meta.confirm ? { ...(meta.confirm as Json), status } : meta.confirm;
  await ctx.db.update(assistantMessages).set({ content, meta: { ...meta, status: status === "done" ? "ok" : status === "failed" ? "error" : "cancelled", summary, confirm } }).where(eq(assistantMessages.id, m.id));
}

/** confirm (runs the action once) or cancel a proposal; throws a user-facing error for a wrong, used, expired or
    tampered token */
export async function decide(ctx: Ctx, token: string, args: Json | null, how: "confirm" | "cancel"): Promise<Decision> {
  const auth = ctx.auth;
  if (!auth) throw new AppError("برای ادامه وارد حساب شوید.", 401);
  const w = who(auth);
  const [a] = token.length >= 16 && token.length <= 64 ? await ctx.db.select().from(assistantActions).where(eq(assistantActions.tokenHash, sha256(token))) : [];
  if (!a || a.userId !== w.userId || a.accountId !== w.accountId) fail("این درخواست تأیید معتبر نیست.", 404);
  const row = a!;
  const tool = toolByName(row.tool);
  if (how === "confirm") {
    // the arguments the person saw must be exactly the ones proposed; anything else burns the token
    const tampered = !args || argsHash(w.userId, w.accountId, row.tool, args) !== row.argsHash || row.argsHash !== argsHash(row.userId, row.accountId, row.tool, row.args);
    if (tampered || !tool || readOnlyView(ctx) || !(await toolAllowed(ctx, tool, "danger"))) {
      await ctx.db.update(assistantActions).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(assistantActions.id, row.id), eq(assistantActions.status, "pending")));
      if (tampered) fail("مشخصات این اقدام تغییر کرده است؛ برای امنیت لغو شد. دوباره از دستیار بخواهید.", 409);
      fail(readOnlyView(ctx) ? "در حالت مشاهده حساب مشتری، دستیار فقط می‌خواند و اقدامی انجام نمی‌دهد." : "نقش شما در این حساب اجازه این کار را ندارد.", 403);
    }
  }
  // single use: only one request can move it out of pending, and only before it expires
  const [claimed] = await ctx.db.update(assistantActions).set({ status: how === "confirm" ? "done" : "cancelled", decidedAt: new Date() })
    .where(and(eq(assistantActions.id, row.id), eq(assistantActions.status, "pending"), ...(how === "confirm" ? [gt(assistantActions.expiresAt, new Date())] : []))).returning();
  if (!claimed) {
    if (row.status === "pending" && row.expiresAt <= new Date()) {
      await ctx.db.update(assistantActions).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(assistantActions.id, row.id), eq(assistantActions.status, "pending")));
      await settleMessage(ctx, row, "cancelled", wrapResult(row.tool, { status: "expired", note: "The confirmation expired; nothing was done." }), "مهلت تأیید تمام شد؛ کاری انجام نشد.");
      fail("مهلت تأیید این اقدام تمام شده است؛ دوباره از دستیار بخواهید.", 410);
    }
    fail("این اقدام قبلاً تأیید یا لغو شده است.", 409);
  }
  if (how === "cancel") {
    const summary = "لغو شد؛ کاری انجام نشد.";
    await settleMessage(ctx, row, "cancelled", wrapResult(row.tool, { status: "cancelled_by_user", note: "The person declined. Nothing was done." }), summary);
    return { id: row.id, threadId: row.threadId, status: "cancelled", summary, tool: row.tool };
  }
  try {
    const out = await execTool(ctx, tool!, row.args);
    const summary = tool!.brief(out, row.args);
    await ctx.db.update(assistantActions).set({ result: summary }).where(eq(assistantActions.id, row.id));
    await settleMessage(ctx, row, "done", wrapResult(row.tool, out), summary);
    await logActivity(ctx.db, auth.uid, "sparkles", "دستیار گره (با تأیید): " + row.summary.slice(0, 160), ctx.ip);
    if (auth.uid !== auth.user.id) await logAudit(ctx.db, actor(ctx), "دستیار گره: " + row.tool, row.id, ctx.ip);
    return { id: row.id, threadId: row.threadId, status: "done", summary, tool: row.tool };
  } catch (e) {
    const msg = errorText(e);
    await ctx.db.update(assistantActions).set({ status: "failed", result: msg }).where(eq(assistantActions.id, row.id));
    await settleMessage(ctx, row, "failed", wrapResult(row.tool, { error: msg }), msg);
    return { id: row.id, threadId: row.threadId, status: "failed", summary: msg, tool: row.tool };
  }
}

/** a new message without deciding: open proposals of the thread lapse */
export async function lapsePending(ctx: Ctx, threadId: string) {
  const open = await ctx.db.update(assistantActions).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(assistantActions.threadId, threadId), eq(assistantActions.status, "pending"))).returning();
  for (const a of open) await settleMessage(ctx, a, "cancelled", wrapResult(a.tool, { status: "not_confirmed", note: "The person did not confirm this; nothing was done." }), "تأیید نشد؛ کاری انجام نشد.");
}
