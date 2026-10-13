import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { MAX_IMPORT } from "@/lib/dbaas";
import { rateLimit } from "@/server/auth";
import { context, needUser } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";
import { dumpPathFor } from "@/server/paas/dbaas-service";
import { newUploadId } from "@/server/paas/service";
import { fail } from "@/server/util";

export const maxDuration = 3600;

/** PUT /api/dbaas/upload — the raw body is a database dump (.sql, .sql.gz, pg_dump, SQL Server .bak,
    mongodump archive), streamed to disk; up to 2 GB. Loaded with dbaas.importDump. */
export async function PUT(req: Request) {
  let path: string | null = null;
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
    const ctx = await context();
    const uid = needUser(ctx).uid;
    await rateLimit(ctx.db, "dbaas-upload:" + uid, 10, 3600);
    if (Number(req.headers.get("content-length") || 0) > MAX_IMPORT) fail("حجم فایل باید کمتر از ۲ گیگابایت باشد.", 413);
    if (!req.body) fail("فایل را انتخاب کنید.");
    const id = newUploadId();
    path = (await dumpPathFor(uid, id))!;
    let size = 0;
    const guard = new Transform({ transform(chunk: Buffer, _enc, cb) { size += chunk.length; cb(size > MAX_IMPORT ? new Error("too large") : null, chunk); } });
    await pipeline(Readable.fromWeb(req.body as never), guard, createWriteStream(path, { mode: 0o600 }));
    if (!size) fail("فایل خالی است.");
    return NextResponse.json({ result: { uploadId: id, bytes: size } });
  } catch (e) {
    if (path) await rm(path, { force: true });
    if ((e as Error).message === "too large") return NextResponse.json({ error: "حجم فایل باید کمتر از ۲ گیگابایت باشد." }, { status: 413 });
    return errorResponse(e);
  }
}
