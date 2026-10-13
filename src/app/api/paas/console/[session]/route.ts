import { NextResponse } from "next/server";
import { context, needUser, teamAllows } from "@/server/ctx";
import { errorResponse } from "@/server/http";
import { sessionOf } from "@/server/paas/console";

export const maxDuration = 7200;

/** GET /api/paas/console/<session>?after=<seq> — server-sent events with the console's output
    (`data: {"seq":n,"data":"…"}`, then `event: exit`). Keystrokes go to paas.consoleInput. */
export async function GET(req: Request, { params }: RouteContext<"/api/paas/console/[session]">) {
  try {
    const { session } = await params;
    const ctx = await context();
    const uid = needUser(ctx).uid;
    if (!teamAllows(ctx.auth?.teamRole, "paas.consoleOpen")) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const s = sessionOf(session, uid);
    if (!s) return NextResponse.json({ error: "کنسول پیدا نشد." }, { status: 404 });
    const after = Number(req.headers.get("last-event-id") || new URL(req.url).searchParams.get("after") || 0);
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const send = (t: string) => { try { ctrl.enqueue(enc.encode(t)); } catch { cleanup(); } };
        const end = () => { send("event: exit\ndata: " + JSON.stringify({ code: s.exitCode }) + "\n\n"); cleanup(); try { ctrl.close(); } catch { /* closed */ } };
        for (const c of s.chunks) if (c.seq > after) send("id: " + c.seq + "\ndata: " + JSON.stringify(c) + "\n\n");
        if (s.closed) return end();
        const listener = (c: { seq: number; data: string } | null) => (c ? send("id: " + c.seq + "\ndata: " + JSON.stringify(c) + "\n\n") : end());
        const ping = setInterval(() => send(": ping\n\n"), 20_000);
        s.listeners.add(listener);
        cleanup = () => { clearInterval(ping); s.listeners.delete(listener); };
        req.signal.addEventListener("abort", () => cleanup());
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
  } catch (e) { return errorResponse(e); }
}
