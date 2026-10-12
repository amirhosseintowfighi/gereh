import { NextResponse } from "next/server";
import { db } from "@/server/ctx";
import { errorResponse } from "@/server/http";
import { getLocations, publicLocations } from "@/server/locations";

/** datacenter locations for the public order pages (no Virtualizor group names) */
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json({ locations: publicLocations(await getLocations(await db())) }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    return errorResponse(e);
  }
}
