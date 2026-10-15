import { NextResponse } from "next/server";
import { z } from "zod";
import type { BuilderEvent } from "@/lib/builder";
import { customAllows } from "@/server/account-extras";
import { rateLimit } from "@/server/auth";
import { ownProject, runAgent } from "@/server/builder/engine";
import { context, needUser, teamAllows } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";

/* one AI run of the app builder (generate or edit), streamed as server-sent events: run, status, plan,
   file (as each file starts), then done or error. Closing the request stops the run. */
export const dynamic = "force-dynamic";
export const maxDuration = 800;

const Body = z.object({ projectId: z.string().max(40), prompt: z.string().trim().min(2, "درخواست را بنویسید.").max(4000) });
const enc = new TextEncoder();

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    const ctx = await context();
    const a = needUser(ctx);
    if (!teamAllows(a.teamRole, "builder.generate") || !(await customAllows(ctx.db, ctx.auth, "builder.generate"))) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const b = Body.parse(await req.json().catch(() => ({})));
    const p = await ownProject(ctx.db, a.uid, b.projectId);
    if (!p) return NextResponse.json({ error: "پروژه پیدا نشد." }, { status: 404 });
    await rateLimit(ctx.db, "builder-run:" + a.uid, 40, 3600);

    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort());
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        let open = true;
        const send = (e: BuilderEvent) => { if (open) try { ctrl.enqueue(enc.encode("data: " + JSON.stringify(e) + "\n\n")); } catch { open = false; } };
        const ping = setInterval(() => { if (open) try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { open = false; } }, 15_000);
        try {
          const r = await runAgent(ctx.db, { userId: a.uid, projectId: p.id, kind: p.version ? "edit" : "generate", prompt: b.prompt, signal: abort.signal, emit: send });
          if (!r.ok && r.status !== 499 && r.status !== 502 && r.status !== 422) send({ type: "error", message: r.error });
        } catch (e) {
          console.error("[builder.run]", e);
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
