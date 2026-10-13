import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { fileName, MAX_FILE_UPLOAD, nameError } from "@/lib/paas-tools";
import { rateLimit } from "@/server/auth";
import { context, teamAllows } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";
import { appSpec } from "@/server/paas/service";
import { paasTools } from "@/server/paas/tools";
import { ownDisk, rel } from "@/server/rpc/paas-tools";
import { fail, logActivity } from "@/server/util";

export const maxDuration = 3600;

async function open(req: Request, diskId: string, method: string) {
  const ctx = await context();
  if (!teamAllows(ctx.auth?.teamRole, method)) fail("نقش شما در این حساب اجازه این کار را ندارد.", 403);
  const o = await ownDisk(ctx, diskId);
  if (!o.app.liveDeployment || o.app.status !== "running") fail("اپ باید روشن و در حال اجرا باشد.");
  return { ctx, ...o, path: rel(new URL(req.url).searchParams.get("path") || "", false) };
}

/** GET /api/paas/files/<disk>?path=a/b.txt — downloads a file from the disk (streamed) */
export async function GET(req: Request, { params }: RouteContext<"/api/paas/files/[disk]">) {
  try {
    const { disk } = await params;
    const { ctx, app, ref, path } = await open(req, disk, "paas.fsList");
    const spec = await appSpec(ctx.db, app), t = paasTools();
    const out = new Readable({ read() {} });
    // the first bytes (or the error) decide the status code
    const first = new Promise<void>((resolve, reject) => {
      let started = false;
      t.download(spec, ref, path, (b) => { if (!started) { started = true; resolve(); } out.push(b); })
        .then(() => { if (!started) resolve(); out.push(null); }, (e: Error) => { if (!started) reject(e); else out.destroy(e); });
    });
    try { await first; } catch (e) { fail("دانلود ممکن نشد: " + (e as Error).message.slice(0, 200), 404); }
    return new Response(Readable.toWeb(out) as ReadableStream, { headers: { "content-type": "application/octet-stream", "content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(fileName(path)), "cache-control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}

/** PUT /api/paas/files/<disk>?path=folder/name.ext — the raw body becomes the file (up to 200 MB) */
export async function PUT(req: Request, { params }: RouteContext<"/api/paas/files/[disk]">) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
    const { disk } = await params;
    const { ctx, a, app, d, ref, path } = await open(req, disk, "paas.fsWrite");
    await rateLimit(ctx.db, "paas-files:" + a.uid, 300, 3600);
    const n = nameError(fileName(path));
    if (n) fail(n);
    const size = Number(req.headers.get("content-length") || -1);
    if (!(size >= 0)) fail("طول فایل مشخص نیست.", 411);
    if (size > MAX_FILE_UPLOAD) fail("حجم هر فایل باید کمتر از ۲۰۰ مگابایت باشد؛ فایل‌های بزرگ‌تر را با SFTP بفرستید.", 413);
    const body = req.body;
    async function* chunks() { if (body) for await (const c of body as unknown as AsyncIterable<Uint8Array>) yield Buffer.from(c); }
    await paasTools().writeFile(await appSpec(ctx.db, app), ref, path, { stream: chunks(), size });
    await logActivity(ctx.db, a.uid, "upload", "بارگذاری " + d.name + ":/" + path + " در " + app.name, ctx.ip);
    return NextResponse.json({ result: { path, bytes: size } });
  } catch (e) { return errorResponse(e); }
}
