import { NextResponse } from "next/server";
import { swapDb } from "@/server/db/client";
import { db, resetBoot } from "@/server/ctx";
import { outbox } from "@/server/messaging";

/* e2e support, enabled only with E2E=1 (never in a normal build or production):
   POST resets the in-memory database to the demo seed; GET returns the SMS/email outbox. */
const enabled = () => process.env.E2E === "1" && !process.env.DATABASE_URL;

export async function POST() {
  if (!enabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await swapDb();
  resetBoot();
  await db(); // seed before answering so the next request sees the demo data
  outbox.length = 0;
  return NextResponse.json({ ok: true });
}

export async function GET() {
  if (!enabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ outbox });
}
