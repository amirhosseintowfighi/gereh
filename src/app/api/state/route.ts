import { NextResponse } from "next/server";
import { context } from "@/server/ctx";
import { errorResponse, noStore } from "@/server/http";
import { buildState } from "@/server/state";

/** the session plus everything the current page may render (scope=admin for the staff panel) */
export async function GET(req: Request) {
  try {
    const ctx = await context();
    const scope = new URL(req.url).searchParams.get("scope") === "admin" ? "admin" : "customer";
    return NextResponse.json(await buildState(ctx.db, ctx.auth, scope), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
