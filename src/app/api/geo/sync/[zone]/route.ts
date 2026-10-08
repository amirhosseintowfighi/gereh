import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/ctx";
import { geoZones } from "@/server/db/schema";
import { notify } from "@/server/util";

/** POST /api/geo/sync/<zone> — heartbeat from the mirror-sync agent (Bearer <sync token>).
    Body: { "ok": true, "lagSeconds": 42 } — lag = how far the mirror is behind the Iranian server. */
export async function POST(req: Request, { params }: RouteContext<"/api/geo/sync/[zone]">) {
  const { zone: id } = await params;
  const token = /^Bearer\s+(\S{20,100})$/.exec(req.headers.get("authorization") || "")?.[1] ?? "";
  const d = await db();
  const [z] = await d.select().from(geoZones).where(eq(geoZones.id, id));
  const ok = !!z && token.length === z.syncToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(z.syncToken));
  if (!ok) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { ok?: boolean; lagSeconds?: number };
  const lag = Number.isFinite(b.lagSeconds) ? Math.max(0, Math.round(b.lagSeconds!)) : null;
  const status = b.ok === false ? "failed" : lag !== null && lag > 900 ? "lagging" : "ok";
  await d.update(geoZones).set({ syncStatus: status, syncLagSec: lag, lastSyncAt: new Date() }).where(eq(geoZones.id, id));
  if (status !== z!.syncStatus && (status === "failed" || z!.syncStatus === "failed")) await notify(d, z!.userId, status === "failed" ? "circle-alert" : "circle-check", status === "failed" ? "همگام‌سازی سرور خارج " + z!.domain + " متوقف شد؛ تیم گره در حال بررسی است" : "همگام‌سازی سرور خارج " + z!.domain + " دوباره برقرار شد");
  return NextResponse.json({ ok: true, status });
}
