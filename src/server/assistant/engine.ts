/* «دستیار گره»: one turn of the agent loop. The customer's message (or their decision on a proposed action) is
   stored, then up to MAX_STEPS model calls run, each streamed and metered through the AI gateway's meter (wallet
   reserve → real cost). Tool calls run through the RPC methods as the customer (./tools.ts); danger tools stop the
   turn with a confirmation card (./confirm.ts). Without an upstream key the simulator plans the turn (./sim.ts). */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { costOf, estimateTokens } from "@/lib/ai";
import { ASSISTANT, type AssistantContext, type AssistantEvent } from "@/lib/assistant";
import { faDate } from "@/lib/jalali";
import { isAiError } from "../ai/endpoints";
import { openMeter, panelCaller, upstreamError, type ResolvedModel } from "../ai/service";
import { readSSE, type ChatMessage, type ChatUsage, type ToolCall } from "../ai/translate";
import { aiUpstream } from "../ai/upstream";
import type { Ctx } from "../ctx";
import { assistantMessages, assistantThreads, paasApps, paasDbs, servers } from "../db/schema";
import { logActivity, rid } from "../util";
import { decide, lapsePending, propose } from "./confirm";
import { assistantModel, errorText, systemPrompt, wrapResult } from "./prompt";
import { simPlan, type SimDone } from "./sim";
import { newThread, ownThread, threadRows, windowOf, type Row, type Thread } from "./threads";
import { execTool, readOnlyView, toolAllowed, toolByName, toolCtx, toolSpecs, type Quote } from "./tools";

type Json = Record<string, unknown>;
export const MAX_STEPS = 8;
/** the longest answer of one step (the assistant is concise; tool arguments fit easily) */
export const MAX_OUT = 3000;
const STEP_TIMEOUT_MS = Number(process.env.ASSISTANT_STEP_TIMEOUT_MS || 120_000);
const NET_RETRIES = 2;
const isNetError = (e: unknown) => /terminated|fetch failed|other side closed|socket|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(((e as Error)?.message ?? "") + " " + String((e as { cause?: { code?: string } })?.cause?.code ?? ""));
const simDelay = () => Number(process.env.ASSISTANT_SIM_DELAY_MS ?? (process.env.NODE_ENV === "test" ? 0 : 18));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Stopped extends Error {}

export type TurnInput = {
  ctx: Ctx; threadId?: string | null; message?: string; context?: AssistantContext | null;
  confirm?: { token: string; args: Json }; cancel?: { token: string };
  signal?: AbortSignal; emit: (e: AssistantEvent) => void;
};

/** the page the assistant was opened from, if it is the customer's own resource */
async function contextLine(ctx: Ctx, c: AssistantContext | null | undefined) {
  if (!c) return "";
  const uid = ctx.auth!.uid;
  if (c.kind === "server") {
    const [s] = await ctx.db.select().from(servers).where(and(eq(servers.id, c.id), eq(servers.userId, uid)));
    return s ? "cloud server «" + s.name + "» (server_id " + s.id + ", IP " + s.ip + ", plan " + s.plan + ", status " + s.status + ")" : "";
  }
  if (c.kind === "app") {
    const [a] = await ctx.db.select().from(paasApps).where(and(eq(paasApps.id, c.id), eq(paasApps.userId, uid)));
    return a ? "Gereh app «" + a.name + "» (app " + a.name + ", id " + a.id + ", status " + a.status + ")" : "";
  }
  const [d] = await ctx.db.select().from(paasDbs).where(and(eq(paasDbs.id, c.id), eq(paasDbs.userId, uid)));
  return d ? "managed database «" + d.name + "» (id " + d.id + ", engine " + d.engine + ", status " + d.status + ")" : "";
}

/** stored rows → the model's messages; a call whose answer is missing gets one, as the protocol requires */
function toMessages(rows: Row[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const answered = new Set(rows.filter((r) => r.role === "tool").map((r) => r.toolCallId));
  for (const r of rows) {
    if (r.role === "user") out.push({ role: "user", content: r.content });
    else if (r.role === "tool") out.push({ role: "tool", tool_call_id: r.toolCallId ?? "", content: r.content });
    else {
      out.push({ role: "assistant", content: r.content || null, ...(r.toolCalls?.length ? { tool_calls: r.toolCalls } : {}) });
      for (const c of r.toolCalls ?? []) if (!answered.has(c.id)) out.push({ role: "tool", tool_call_id: c.id, content: wrapResult(c.function.name, { status: "not_run" }) });
    }
  }
  // tool answers must follow their call directly
  return out.filter((m, i) => m.role !== "tool" || out.slice(0, i).some((p) => p.role === "assistant" && p.tool_calls?.some((c) => c.id === m.tool_call_id)));
}

function unwrap(content: string): unknown {
  const body = content.replace(/^<tool_result[^>]*>\n?/, "").replace(/\n?<\/tool_result>$/, "");
  try { return JSON.parse(body); } catch { return body; }
}

/** the simulator's view of the turn so far: the customer's words and what the tools returned */
function simInput(rows: Row[], context: AssistantContext | null, tools: Set<string>) {
  const last = rows.findLastIndex((r) => r.role === "user");
  const after = rows.slice(last + 1);
  const calls = new Map(after.flatMap((r) => (r.toolCalls ?? []).map((c) => [c.id, c] as const)));
  const done: SimDone[] = after.filter((r) => r.role === "tool").map((r) => {
    const m = r.meta as { status?: string; summary?: string };
    let args: Json = {};
    try { args = JSON.parse(calls.get(r.toolCallId ?? "")?.function.arguments || "{}"); } catch { /* keep {} */ }
    return { name: r.toolName ?? "", args, out: unwrap(r.content), ok: m.status === "ok", summary: m.summary ?? "" };
  });
  return { ask: rows[last]?.content ?? "", earlier: rows.slice(0, Math.max(0, last)).filter((r) => r.role === "user").map((r) => r.content), context, done, tools };
}

type StepOut = { text: string; calls: ToolCall[]; usage: ChatUsage | null };

/** one model answer, streamed: the upstream with tools (a dropped connection before any text retries), or the simulator */
async function step(o: { model: ResolvedModel; messages: ChatMessage[]; tools: Json[]; signal: AbortSignal; sim: () => ReturnType<typeof simPlan>; onDelta: (d: string) => void; partial: { text: string } }): Promise<StepOut> {
  const up = aiUpstream();
  if (up.name === "sim") {
    const r = o.sim(), wait = simDelay();
    for (let i = 0; i < r.text.length; i += 24) {
      if (o.signal.aborted) throw new Stopped();
      if (wait) await sleep(wait);
      const d = r.text.slice(i, i + 24);
      o.partial.text += d;
      o.onDelta(d);
    }
    return { text: r.text, calls: r.calls.map((c) => ({ id: "call_" + rid("s"), type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })), usage: null };
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await up.chat({ model: o.model.upstream || o.model.id, messages: o.messages, tools: o.tools, tool_choice: "auto", stream: true, max_tokens: MAX_OUT, temperature: 0.2, stream_options: { include_usage: true } }, o.signal);
      if (!res.ok) { const err = new Error(upstreamError(res.status, (await res.text().catch(() => "")).slice(0, 300)).message); (err as { upstream?: boolean }).upstream = true; throw err; }
      let usage: ChatUsage | null = null;
      const calls: { id: string; name: string; args: string }[] = [];
      for await (const c of readSSE(res.body!)) {
        if (o.signal.aborted) throw new Stopped();
        if (c.usage) usage = c.usage as ChatUsage;
        const delta = (c.choices as { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] | undefined)?.[0]?.delta;
        if (delta?.content) { o.partial.text += delta.content; o.onDelta(delta.content); }
        for (const t of delta?.tool_calls ?? []) {
          const k = t.index ?? calls.length;
          calls[k] ??= { id: "", name: "", args: "" };
          if (t.id) calls[k].id = t.id;
          if (t.function?.name) calls[k].name += t.function.name;
          if (t.function?.arguments) calls[k].args += t.function.arguments;
        }
      }
      return { text: o.partial.text, usage, calls: calls.filter(Boolean).map((c) => ({ id: c.id || "call_" + rid("u"), type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })) };
    } catch (e) {
      if (e instanceof Stopped || o.signal.aborted || o.partial.text || attempt >= NET_RETRIES || !isNetError(e)) throw e;
      console.warn("[assistant] upstream dropped (" + (e as Error).message + "); retry " + (attempt + 1));
    }
  }
}

export async function runTurn(i: TurnInput): Promise<void> {
  const { ctx, emit } = i;
  const db = ctx.db, auth = ctx.auth!;
  let thread: Thread | null = i.threadId ? await ownThread(db, auth, i.threadId) : null;
  if (i.threadId && !thread) return emit({ type: "error", message: "گفتگو پیدا نشد.", code: "not_found" });

  // the person's decision on a proposed action
  if (i.confirm || i.cancel) {
    let r;
    try { r = await decide(ctx, (i.confirm ?? i.cancel)!.token, i.confirm?.args ?? null, i.confirm ? "confirm" : "cancel"); } catch (e) { return emit({ type: "error", message: errorText(e), code: "confirm_rejected" }); }
    if (thread && r.threadId !== thread.id) return emit({ type: "error", message: "این تأیید مربوط به گفتگوی دیگری است.", code: "confirm_rejected" });
    thread = (await ownThread(db, auth, r.threadId))!;
    emit({ type: "decided", id: r.id, status: r.status, summary: r.summary });
    if (r.status === "cancelled") {
      const [m] = await db.insert(assistantMessages).values({ threadId: thread.id, role: "assistant", content: "باشد، این کار انجام نشد." }).returning({ id: assistantMessages.id });
      emit({ type: "text", delta: "باشد، این کار انجام نشد." });
      return emit({ type: "done", charged: 0, messageId: m.id, pending: false });
    }
  } else {
    const text = (i.message ?? "").trim();
    if (!text) return emit({ type: "error", message: "پیام خالی است.", code: "invalid_request" });
    if (!thread) { thread = await newThread(db, auth); emit({ type: "thread", id: thread.id, title: thread.title }); }
    await lapsePending(ctx, thread.id);
    await db.insert(assistantMessages).values({ threadId: thread.id, role: "user", content: text.slice(0, 8000), meta: i.context ? { context: i.context } : {} });
    if (thread.title === ASSISTANT.newTitle || !thread.title) {
      const title = text.replace(/\s+/g, " ").slice(0, 60);
      await db.update(assistantThreads).set({ title }).where(eq(assistantThreads.id, thread.id));
      emit({ type: "thread", id: thread.id, title });
    }
  }

  const model = await assistantModel(db);
  if (!model) return emit({ type: "error", message: "در حال حاضر مدلی برای دستیار در دسترس نیست؛ کمی بعد دوباره تلاش کنید.", code: "no_model" });
  const readOnly = readOnlyView(ctx);
  // staff viewing a customer pay for their own questions; a team member's use is the account's, like other AI use
  const caller = await panelCaller(db, readOnly ? auth.user.id : auth.uid);
  const specs = await toolSpecs(ctx);
  const names = new Set(specs.map((s) => s.function.name));
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  i.signal?.addEventListener("abort", onAbort);
  let charged = 0, lastId: number | null = null, pending = false;
  try {
    for (let n = 0; n < MAX_STEPS; n++) {
      const all = await threadRows(db, thread.id);
      const { rows, summary } = windowOf(all);
      if (summary && summary !== thread.summary) { await db.update(assistantThreads).set({ summary }).where(eq(assistantThreads.id, thread.id)); thread.summary = summary; }
      const lastUser = all.findLast((r) => r.role === "user");
      const context = ((lastUser?.meta as { context?: AssistantContext })?.context) ?? null;
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt({ name: auth.user.name, context: await contextLine(toolCtx(ctx), context), summary, readOnly, today: faDate(new Date()) }) },
        ...toMessages(rows),
      ];
      const inEst = estimateTokens(JSON.stringify(messages).length + JSON.stringify(specs).length);
      const meter = await openMeter(db, { caller, model, format: "panel", stream: true, reserve: costOf(inEst, MAX_OUT, model) });
      if (isAiError(meter)) { emit({ type: "error", message: meter.message, code: meter.code }); break; }

      const partial = { text: "" };
      const stall = setTimeout(() => abort.abort(), STEP_TIMEOUT_MS);
      let r: StepOut;
      try {
        r = await step({ model, messages, tools: specs, signal: abort.signal, sim: () => simPlan(simInput(all, context, names)), onDelta: (d) => emit({ type: "text", delta: d }), partial });
      } catch (e) {
        clearTimeout(stall);
        const stopped = e instanceof Stopped || abort.signal.aborted || (e as Error).name === "AbortError";
        if (stopped && partial.text) {
          const outT = estimateTokens(partial.text.length);
          const cost = await meter.close("cancelled", { inTokens: inEst, outTokens: outT, charged: costOf(inEst, outT, model), estimated: true, error: "stopped" });
          await db.insert(assistantMessages).values({ threadId: thread.id, role: "assistant", content: partial.text, meta: { stopped: true }, inTokens: inEst, outTokens: outT, cost });
          await db.update(assistantThreads).set({ spent: sql`${assistantThreads.spent} + ${cost}`, updatedAt: new Date() }).where(eq(assistantThreads.id, thread.id));
          charged += cost;
        } else await meter.close("error", { error: (e as Error).message });
        if (!stopped) emit({ type: "error", message: isNetError(e) ? "اتصال به سرویس مدل قطع شد؛ چند لحظه دیگر دوباره تلاش کنید. مبلغی کسر نشد." : (e as Error).message || "سرویس مدل در دسترس نبود؛ مبلغی کسر نشد.", code: "upstream" });
        else if (!i.signal?.aborted) emit({ type: "error", message: "پاسخ بیش از حد طول کشید و متوقف شد.", code: "timeout" });
        return;
      }
      clearTimeout(stall);
      const argChars = r.calls.reduce((s, c) => s + c.function.arguments.length + c.function.name.length, 0);
      const inT = r.usage?.prompt_tokens ?? inEst, outT = r.usage?.completion_tokens ?? estimateTokens(r.text.length + argChars);
      const cost = await meter.close("success", { inTokens: inT, outTokens: outT, charged: costOf(inT, outT, model), estimated: !r.usage, finish: r.calls.length ? "tool_calls" : "stop", request: messages.slice(-1), response: r.text });
      charged += cost;
      const [saved] = await db.insert(assistantMessages).values({ threadId: thread.id, role: "assistant", content: r.text, toolCalls: r.calls.length ? r.calls : null, inTokens: inT, outTokens: outT, cost }).returning({ id: assistantMessages.id });
      lastId = saved.id;
      await db.update(assistantThreads).set({ spent: sql`${assistantThreads.spent} + ${cost}`, updatedAt: new Date() }).where(eq(assistantThreads.id, thread.id));
      if (!r.calls.length) break;

      for (const c of r.calls) {
        const save = (content: string, meta: Json) => db.insert(assistantMessages).values({ threadId: thread!.id, role: "tool", toolCallId: c.id, toolName: c.function.name.slice(0, 80), content, meta });
        const t = toolByName(c.function.name);
        let args: Json;
        try { const p = JSON.parse(c.function.arguments || "{}"); args = p && typeof p === "object" && !Array.isArray(p) ? p : {}; } catch { args = { __invalid: true }; }
        const risk = t ? t.risk(args) : "read";
        if (!t || !names.has(t.name) || args.__invalid || !(await toolAllowed(ctx, t, risk))) {
          const msg = !t || !names.has(t.name) ? "این ابزار در دسترس نیست." : args.__invalid ? "آرگومان‌های ابزار JSON معتبر نیست." : readOnly ? "در حالت مشاهده حساب مشتری فقط خواندن مجاز است." : "نقش شما در این حساب اجازه این کار را ندارد.";
          await save(wrapResult(c.function.name, { error: msg }), { label: c.function.name, risk, status: "error", summary: msg });
          emit({ type: "tool_result", id: c.id, name: c.function.name, ok: false, summary: msg });
          continue;
        }
        const label = await t.label(toolCtx(ctx), args).catch(() => t.name);
        emit({ type: "tool", id: c.id, name: t.name, label, risk });
        if (risk === "danger") {
          if (pending) {
            const msg = "فقط یک اقدام حساس در هر نوبت؛ پس از تصمیم کاربر دوباره پیشنهاد دهید.";
            await save(wrapResult(t.name, { status: "skipped", note: "Only one action needing confirmation at a time. Propose it again after the person decides." }), { label, risk, status: "cancelled", summary: msg });
            emit({ type: "tool_result", id: c.id, name: t.name, ok: false, summary: msg });
            continue;
          }
          let q: Quote;
          try { q = t.quote ? await t.quote(toolCtx(ctx), args) : { title: label, summary: label, resource: "", cost: null, costNote: "" }; } catch (e) {
            const msg = errorText(e);
            await save(wrapResult(t.name, { error: msg }), { label, risk, status: "error", summary: msg });
            emit({ type: "tool_result", id: c.id, name: t.name, ok: false, summary: msg });
            continue;
          }
          const card = await propose(ctx, thread, t, args, c.id, q);
          const { token: _token, ...stored } = card;
          void _token;
          await save(wrapResult(t.name, { status: "awaiting_confirmation", note: "The person sees a confirmation card with the cost. Nothing has been done yet; it runs only if they confirm." }), { label, risk, status: "pending", summary: "در انتظار تأیید شما", confirm: { ...stored, status: "pending" } });
          emit({ type: "confirm", card });
          pending = true;
          continue;
        }
        let out: unknown, ok = true, msg = "";
        try { out = await execTool(ctx, t, args); } catch (e) { ok = false; msg = errorText(e); }
        const brief = ok ? t.brief(out, args) : msg;
        await save(wrapResult(t.name, ok ? out : { error: msg }), { label, risk, status: ok ? "ok" : "error", summary: brief });
        emit({ type: "tool_result", id: c.id, name: t.name, ok, summary: brief });
        if (ok && risk === "safe") await logActivity(db, auth.uid, "sparkles", "دستیار گره: " + label.replace(/…$/, ""), ctx.ip);
      }
      if (pending) break;
      if (n === MAX_STEPS - 1) {
        const note = "\n\nبه سقف مراحل این پاسخ رسیدم؛ برای ادامه پیام بدهید.";
        await db.insert(assistantMessages).values({ threadId: thread.id, role: "assistant", content: note.trim() });
        emit({ type: "text", delta: note });
      }
    }
  } finally {
    i.signal?.removeEventListener("abort", onAbort);
  }
  emit({ type: "done", charged, messageId: lastId, pending });
}
