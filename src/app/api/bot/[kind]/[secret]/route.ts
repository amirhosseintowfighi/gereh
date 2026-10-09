import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { botSecret, botSend, botUpdate, type BotKind } from "@/server/channels";
import { db } from "@/server/ctx";

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** POST /api/bot/<telegram|bale>/<secret> — updates from the Telegram or Bale bot (setWebhook) */
export async function POST(req: Request, { params }: RouteContext<"/api/bot/[kind]/[secret]">) {
  const { kind, secret } = await params;
  if ((kind !== "telegram" && kind !== "bale") || !same(secret, botSecret(kind))) return new NextResponse(null, { status: 404 });
  const update = await req.json().catch(() => ({}));
  try {
    const reply = await botUpdate(await db(), kind as BotKind, update);
    const chat = (update as { message?: { chat?: { id?: number | string } } }).message?.chat?.id;
    if (reply && chat !== undefined) await botSend(kind as BotKind, String(chat), reply);
  } catch (e) { console.error("[bot]", e); }
  return NextResponse.json({ ok: true }); // always 200: the platform would otherwise retry the same update
}
