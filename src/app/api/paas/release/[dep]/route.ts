import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { context, needUser, teamAllows } from "@/server/ctx";
import { paasApps, paasDeployments } from "@/server/db/schema";
import { errorResponse } from "@/server/http";
import { fail, logActivity } from "@/server/util";

/** GET /api/paas/release/<deployment> — the uploaded source (ZIP) a release was built from */
export async function GET(_req: Request, { params }: RouteContext<"/api/paas/release/[dep]">) {
  try {
    const { dep } = await params;
    const ctx = await context();
    const a = needUser(ctx);
    if (!teamAllows(ctx.auth?.teamRole, "paas.releases")) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const [row] = await ctx.db.select({ d: paasDeployments, name: paasApps.name }).from(paasDeployments).innerJoin(paasApps, eq(paasApps.id, paasDeployments.appId)).where(and(eq(paasDeployments.id, dep), eq(paasApps.userId, a.uid)));
    if (!row?.d.uploadPath) fail("سورس این نسخه نگه داشته نشده است.", 404);
    const st = await stat(row!.d.uploadPath!).catch(() => null);
    if (!st) fail("سورس این نسخه دیگر در دسترس نیست.", 410);
    await logActivity(ctx.db, a.uid, "download", "دانلود سورس نسخه " + dep + " اپ " + row!.name, ctx.ip);
    return new Response(Readable.toWeb(createReadStream(row!.d.uploadPath!)) as ReadableStream, { headers: { "content-type": "application/zip", "content-length": String(st!.size), "content-disposition": `attachment; filename="${row!.name}-${dep}.zip"`, "cache-control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
