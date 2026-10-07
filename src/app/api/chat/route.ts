import { NextResponse } from "next/server";
import { startChat, visitorClose, visitorSend, visitorView } from "@/server/chat";
import { context } from "@/server/ctx";
import { errorResponse, noStore, sameOrigin } from "@/server/http";
import { fail } from "@/server/util";

/* Site live-chat widget. The visitor's chat token travels in the X-Chat-Token header (not the URL,
   so it never lands in access logs). GET ?after=<last message id> polls for new messages. */
export async function GET(req: Request) {
  try {
    const after = Math.max(0, Number(new URL(req.url).searchParams.get("after")) || 0);
    const ctx = await context();
    return NextResponse.json({ result: await visitorView(ctx, req.headers.get("x-chat-token"), after) }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    const body = (await req.json().catch(() => null)) as { action?: string } & Record<string, unknown> | null;
    const ctx = await context();
    const token = req.headers.get("x-chat-token");
    switch (body?.action) {
      case "start": return NextResponse.json({ result: await startChat(ctx, body as never, new URL(req.url).origin) }, { headers: noStore });
      case "send": await visitorSend(ctx, token, body); break;
      case "close": await visitorClose(ctx, token); break;
      default: fail("درخواست نامعتبر است.");
    }
    return NextResponse.json({ result: true }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
