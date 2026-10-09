import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { WP_MAX_IMPORT } from "@/lib/wordpress";
import { rateLimit } from "@/server/auth";
import { context, needUser } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";
import { backupPathFor, newUploadId } from "@/server/paas/service";
import { fail } from "@/server/util";

export const maxDuration = 3600;

/** PUT /api/wp/upload — the raw body is a site backup (cPanel full backup .tar.gz, or .zip with the
    site files and an .sql dump), streamed to disk; up to 4 GB. */
export async function PUT(req: Request) {
  let path: string | null = null;
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
    const ctx = await context();
    const uid = needUser(ctx).uid;
    await rateLimit(ctx.db, "wp-upload:" + uid, 10, 3600);
    if (Number(req.headers.get("content-length") || 0) > WP_MAX_IMPORT) fail("حجم فایل پشتیبان باید کمتر از ۴ گیگابایت باشد.", 413);
    if (!req.body) fail("فایل پشتیبان را انتخاب کنید.");
    const id = newUploadId();
    path = (await backupPathFor(uid, id))!;
    let size = 0, head: Buffer | null = null;
    const guard = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (!head) head = chunk.subarray(0, 4);
        size += chunk.length;
        cb(size > WP_MAX_IMPORT ? new Error("too large") : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(req.body as never), guard, createWriteStream(path, { mode: 0o600 }));
    const magic = head ? (head as Buffer).subarray(0, 2).toString("hex") : "";
    if (magic !== "504b" && magic !== "1f8b") fail("فقط پشتیبان کامل cPanel ‏(‎.tar.gz) یا فایل ‎.zip پذیرفته می‌شود.");
    return NextResponse.json({ result: { uploadId: id, bytes: size } });
  } catch (e) {
    if (path) await rm(path, { force: true });
    if ((e as Error).message === "too large") return NextResponse.json({ error: "حجم فایل پشتیبان باید کمتر از ۴ گیگابایت باشد." }, { status: 413 });
    return errorResponse(e);
  }
}
