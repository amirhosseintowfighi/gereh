import { NextResponse } from "next/server";
import { LOG_LEVELS, MAX_LOG_EXPORT, type LogLevel } from "@/lib/paas-tools";
import { context, teamAllows } from "@/server/ctx";
import { errorResponse } from "@/server/http";
import { searchLogs } from "@/server/paas/observe";
import { appSpec } from "@/server/paas/service";
import { paasTools } from "@/server/paas/tools";
import { ownApp } from "@/server/rpc/paas";

export const maxDuration = 3600;

const date = (s: string | null) => { const d = s ? new Date(s) : null; return d && !Number.isNaN(d.getTime()) ? d : undefined; };

/** GET /api/paas/logs/<app>?tail=1 — live tail as server-sent events (new lines from every instance,
    read from the platform every 2 seconds). Without tail: the stored lines matching q, level, from
    and to as a .txt download (oldest first, up to MAX_LOG_EXPORT lines). */
export async function GET(req: Request, { params }: RouteContext<"/api/paas/logs/[app]">) {
  try {
    const { app: appId } = await params;
    const ctx = await context();
    if (!teamAllows(ctx.auth?.teamRole, "paas.logSearch")) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const { app } = await ownApp(ctx, appId);
    const q = new URL(req.url).searchParams;
    if (q.get("tail")) {
      const enc = new TextEncoder(), t = paasTools();
      let stop = false;
      const stream = new ReadableStream<Uint8Array>({
        async start(ctrl) {
          req.signal.addEventListener("abort", () => { stop = true; });
          let since = new Date(Date.now() - 60_000);
          const started = Date.now();
          while (!stop && Date.now() - started < 3600_000) {
            try {
              const spec = await appSpec(ctx.db, app);
              const lines = app.liveDeployment ? await t.logsSince(spec, since, 1000) : [];
              if (lines.length) { since = lines[lines.length - 1].at; ctrl.enqueue(enc.encode("data: " + JSON.stringify(lines.map((l) => ({ at: l.at.toISOString(), instance: l.instance, line: l.line }))) + "\n\n")); }
              else ctrl.enqueue(enc.encode(": ping\n\n"));
            } catch { if (stop) break; }
            await new Promise((r) => setTimeout(r, 2000));
          }
          try { ctrl.close(); } catch { /* closed */ }
        },
        cancel() { stop = true; },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
    }
    const levels = (q.get("level") || "").split(",").filter((l): l is LogLevel => LOG_LEVELS.some((x) => x.id === l));
    const rows = await searchLogs(ctx.db, app.id, { q: (q.get("q") || "").slice(0, 200) || undefined, levels, from: date(q.get("from")), to: date(q.get("to")), limit: MAX_LOG_EXPORT });
    const body = rows.reverse().map((l) => l.at.toISOString() + " " + l.level.toUpperCase().padEnd(5) + " [" + l.instance + "] " + l.line).join("\n") + "\n";
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${app.name}-logs.txt"`, "cache-control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
