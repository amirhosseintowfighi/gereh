import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { filesAt } from "@/server/builder/engine";
import { context, needUser, teamAllows } from "@/server/ctx";
import { builderProjects } from "@/server/db/schema";
import { errorResponse } from "@/server/http";
import { fail, logActivity } from "@/server/util";
import { zip } from "@/server/xlsx";

/** GET /api/build/download/<project>?v=<version> — the project's files at that version (default: current) as a ZIP */
export async function GET(req: Request, { params }: RouteContext<"/api/build/download/[id]">) {
  try {
    const { id } = await params;
    const ctx = await context();
    const a = needUser(ctx);
    if (!teamAllows(ctx.auth?.teamRole, "builder.get")) return NextResponse.json({ error: "نقش شما در این حساب اجازه این کار را ندارد." }, { status: 403 });
    const [p] = await ctx.db.select().from(builderProjects).where(and(eq(builderProjects.id, id), eq(builderProjects.userId, a.uid)));
    if (!p) fail("پروژه پیدا نشد.", 404);
    const raw = new URL(req.url).searchParams.get("v");
    const version = raw === null ? p!.version : Number(raw);
    if (!Number.isInteger(version) || version < 1 || version > p!.version) fail("این نسخه وجود ندارد.", 404);
    const files = await filesAt(ctx.db, p!.id, version);
    if (!Object.keys(files).length) fail("این نسخه فایلی ندارد.", 404);
    const body = zip(Object.entries(files).sort(([x], [y]) => x.localeCompare(y)).map(([n, c]) => [n, Buffer.from(c, "utf8")]));
    await logActivity(ctx.db, a.uid, "download", "دانلود نسخه " + version.toLocaleString("fa-IR") + " پروژه «" + p!.name + "»", ctx.ip);
    const ascii = "project-" + p!.id + "-v" + version + ".zip";
    const utf = encodeURIComponent(p!.name.replace(/[\\/:*?"<>|]+/g, "-") + "-v" + version + ".zip");
    return new Response(new Uint8Array(body), { headers: { "content-type": "application/zip", "content-length": String(body.length), "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf}`, "cache-control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
