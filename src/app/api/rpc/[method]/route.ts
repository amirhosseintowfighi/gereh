import { NextResponse } from "next/server";
import { context, teamAllows } from "@/server/ctx";
import { errorResponse, noStore, sameOrigin } from "@/server/http";
import { registry } from "@/server/rpc";

export async function POST(req: Request, { params }: RouteContext<"/api/rpc/[method]">) {
  const { method } = await params;
  if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
  const m = Object.hasOwn(registry, method) ? registry[method] : undefined;
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = (await req.json().catch(() => ({}))) as { args?: unknown };
    const args = m.args.parse(body.args ?? []);
    const ctx = await context();
    if (!teamAllows(ctx.auth?.teamRole, method)) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const result = await m.run(ctx, args);
    return NextResponse.json({ result: result ?? null }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
