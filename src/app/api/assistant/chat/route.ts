import { NextResponse } from "next/server";
import { z } from "zod";
import type { AssistantEvent } from "@/lib/assistant";
import { customAllows } from "@/server/account-extras";
import { runTurn } from "@/server/assistant/engine";
import { rateLimit } from "@/server/auth";
import { context, needUser, teamAllows } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";

/* one turn of «دستیار گره», streamed as server-sent events: thread, text (deltas), tool, tool_result, confirm,
   decided, then done or error. The body carries a new message, or the person's decision on a proposed action
   (confirm with its one-time token and the exact arguments, or cancel). Closing the request stops the turn. */
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const Body = z.object({
  threadId: z.string().max(40).nullish(),
  message: z.string().trim().max(8000).optional(),
  context: z.object({ kind: z.enum(["server", "app", "db"]), id: z.string().regex(/^[\w.-]{1,40}$/) }).nullish(),
  confirm: z.object({ token: z.string().min(16).max(64), args: z.record(z.string(), z.unknown()) }).optional(),
  cancel: z.object({ token: z.string().min(16).max(64) }).optional(),
}).refine((b) => !!b.message || !!b.confirm || !!b.cancel, "پیام را بنویسید.");
const enc = new TextEncoder();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    const ctx = await context();
    const a = needUser(ctx);
    if (!teamAllows(a.teamRole, "assistant.chat") || !(await customAllows(ctx.db, ctx.auth, "assistant.chat"))) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const b = Body.parse(await req.json().catch(() => ({})));
    // per person (a team member or staff member has their own limit)
    await rateLimit(ctx.db, "assistant:" + a.user.id, 20, 60);
    await rateLimit(ctx.db, "assistant-h:" + a.user.id, 200, 3600);

    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort());
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        let open = true;
        const send = (e: AssistantEvent) => { if (open) try { ctrl.enqueue(enc.encode("data: " + JSON.stringify(e) + "\n\n")); } catch { open = false; } };
        const ping = setInterval(() => { if (open) try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { open = false; } }, 15_000);
        try {
          await runTurn({ ctx, threadId: b.threadId ?? null, message: b.message, context: b.context ?? null, confirm: b.confirm as { token: string; args: Record<string, unknown> } | undefined, cancel: b.cancel, signal: abort.signal, emit: send });
        } catch (e) {
          console.error("[assistant.chat]", e);
          send({ type: "error", message: "خطای غیرمنتظره؛ دوباره تلاش کنید." });
        } finally {
          clearInterval(ping);
          open = false;
          try { ctrl.close(); } catch { /* closed by the client */ }
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (e) {
    return errorResponse(e);
  }
}
