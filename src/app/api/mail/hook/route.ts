import { NextResponse } from "next/server";
import { db } from "@/server/ctx";
import { hookAuthorized, mtaHook } from "@/server/mail/hooks";

/** POST /api/mail/hook — the mail server's MTA hook (stage DATA): inbound mail and SMTP submissions.
    Answers { action: accept | discard | quarantine | reject }. See deploy/mail/README.md. */
export async function POST(req: Request) {
  const body = await req.text();
  if (!hookAuthorized(req, body)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let b: unknown;
  try { b = JSON.parse(body); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  try {
    return NextResponse.json(await mtaHook(await db(), b as never));
  } catch (e) {
    console.error("[mail.hook]", e);
    // a temporary failure: the sender retries
    return NextResponse.json({ action: "reject", response: { status: 451, enhancedStatus: "4.3.0", message: "Temporary failure" } });
  }
}
