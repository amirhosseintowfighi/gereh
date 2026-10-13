import { NextResponse } from "next/server";
import { z } from "zod";
import { chatSend, MAX_ATTACH } from "@/server/ai/chat";
import { isAiError } from "@/server/ai/endpoints";
import { context, needUser, teamAllows } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";

/* panel web chat: one streamed answer per POST (see src/server/ai/chat.ts) */
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const Body = z.object({
  chatId: z.string().max(40),
  content: z.string().trim().min(1).max(20_000),
  attachments: z.array(z.object({ name: z.string().trim().min(1).max(120), type: z.enum(["image", "text"]), data: z.string().max(2_000_000) })).max(MAX_ATTACH).default([]),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    const ctx = await context();
    const a = needUser(ctx);
    if (!teamAllows(a.teamRole, "ai.chatSend")) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const b = Body.parse(await req.json().catch(() => ({})));
    const r = await chatSend(ctx.db, a.uid, b.chatId, b.content, b.attachments);
    if (isAiError(r)) return NextResponse.json({ error: r.message, code: r.code }, { status: r.http });
    return r;
  } catch (e) {
    return errorResponse(e);
  }
}
