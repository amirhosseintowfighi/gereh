import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/server/ctx";
import { openapi } from "@/server/openapi";
import { ROUTES, tokenAuth } from "@/server/publicApi";
import { AppError } from "@/server/util";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

async function handle(req: Request, { params }: RouteContext<"/api/v1/[[...path]]">) {
  const path = ((await params).path ?? []).join("/");
  if (req.method === "GET" && path === "openapi.json") return NextResponse.json(openapi(new URL(req.url).origin), { headers: { "cache-control": "public, max-age=3600" } });
  const route = ROUTES.find((r) => r.method === req.method && r.pattern.test(path));
  if (!route) return json({ error: { message: "Not found" } }, 404);
  try {
    const d = await db();
    const base = { db: d, ip: req.headers.get("x-real-ip") || "", device: "API" };
    const { auth, scope } = await tokenAuth(base, req.headers.get("authorization"));
    if (route.write && scope !== "read-write") return json({ error: { message: "This token is read-only" } }, 403);
    const body = route.write && req.method !== "DELETE" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
    return json(await route.run({ ...base, auth }, route.pattern.exec(path)!, body));
  } catch (e) {
    if (e instanceof AppError) return json({ error: { message: e.message } }, e.status === 400 ? 422 : e.status);
    if (e instanceof ZodError) return json({ error: { message: "Invalid request body", issues: e.issues.map((i) => i.path.join(".") + ": " + i.message) } }, 422);
    console.error("[api/v1]", e);
    return json({ error: { message: "Internal error" } }, 500);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
