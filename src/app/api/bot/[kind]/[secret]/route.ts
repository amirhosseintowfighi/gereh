import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { botSecret, hookSecret, type BotKind } from "@/server/bots/api";
import { firstDelivery, handleUpdate, type TgUpdate } from "@/server/bots/chat";
import { db } from "@/server/ctx";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** POST /api/bot/<telegram|bale>/<secret> — updates from the Telegram or Bale bot in webhook mode. Both the path
    secret and the X-Telegram-Bot-Api-Secret-Token header given to setWebhook must match. The answer is immediate;
    the assistant's turn runs after it (a slow answer would make the messenger deliver the update again). */
export async function POST(req: Request, { params }: RouteContext<"/api/bot/[kind]/[secret]">) {
  const { kind, secret } = await params;
  if ((kind !== "telegram" && kind !== "bale") || !same(secret, botSecret(kind))) return new NextResponse(null, { status: 404 });
  if (!same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", hookSecret(kind))) return new NextResponse(null, { status: 401 });
  const update = (await req.json().catch(() => ({}))) as TgUpdate;
  const d = await db();
  const work = async () => {
    try { if (await firstDelivery(d, kind as BotKind, update.update_id)) await handleUpdate(d, kind as BotKind, update); }
    catch (e) { console.error("[bot] " + kind + " update failed:", (e as Error).message); }
  };
  // outside a request scope (tests) after() is unavailable: the update is handled before answering
  try { after(work); } catch { await work(); }
  return NextResponse.json({ ok: true }); // always 200: the platform would otherwise retry the same update
}
