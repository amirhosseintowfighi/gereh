import { NextResponse } from "next/server";
import { db } from "@/server/ctx";
import { deliveryEvents, hookAuthorized } from "@/server/mail/hooks";

/** POST /api/mail/events — delivery webhooks from the mail server (delivered, bounced, failed) */
export async function POST(req: Request) {
  const body = await req.text();
  if (!hookAuthorized(req, body)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let b: unknown;
  try { b = JSON.parse(body); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  return NextResponse.json({ ok: true, recorded: await deliveryEvents(await db(), b as never) });
}
