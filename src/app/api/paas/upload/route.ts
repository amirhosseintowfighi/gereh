import { writeFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { DETECT_READ, detectStack } from "@/lib/paas";
import { rateLimit } from "@/server/auth";
import { context, needUser } from "@/server/ctx";
import { errorResponse, sameOrigin } from "@/server/http";
import { newUploadId, uploadPathFor } from "@/server/paas/service";
import { projectFiles, ZipError } from "@/server/unzip";
import { fail } from "@/server/util";

const MAX_UPLOAD = 200 * 1024 * 1024;

/** POST /api/paas/upload (multipart "file", optional "rootDir") — stores a project ZIP for a later
    deploy and reports the detected stack. Also used by the CLI with a bearer token. */
export async function POST(req: Request) {
  try {
    const bearer = req.headers.get("authorization");
    let uid: string;
    if (bearer) {
      const { tokenAuth } = await import("@/server/publicApi");
      const { db } = await import("@/server/ctx");
      const t = await tokenAuth({ db: await db(), ip: "", device: "" }, bearer);
      if (t.scope !== "read-write") fail("این توکن فقط خواندنی است.", 403);
      uid = t.auth.uid;
    } else {
      if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
      const ctx = await context();
      uid = needUser(ctx).uid;
      await rateLimit(ctx.db, "paas-upload:" + uid, 30, 3600);
    }
    if (Number(req.headers.get("content-length") || 0) > MAX_UPLOAD + 1024 * 1024) fail("حجم فایل باید کمتر از ۲۰۰ مگابایت باشد.", 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) fail("فایل ZIP پروژه را انتخاب کنید.");
    const f = file as File;
    if (f.size > MAX_UPLOAD) fail("حجم فایل باید کمتر از ۲۰۰ مگابایت باشد.", 413);
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.readUInt32LE(0) !== 0x04034b50) fail("فقط فایل ZIP پذیرفته می‌شود.");
    const rootDir = String(form.get("rootDir") || "");
    let detected;
    try { detected = projectFiles(buf, DETECT_READ, rootDir); } catch (e) { if (e instanceof ZipError) fail(e.message); throw e; }
    if (!detected!.count) fail("فایل ZIP خالی است.");
    const id = newUploadId();
    await writeFile((await uploadPathFor(uid, id))!, buf, { mode: 0o600 });
    return NextResponse.json({ result: { uploadId: id, stack: detectStack(detected!.files), files: detected!.count, bytes: detected!.bytes } });
  } catch (e) {
    return errorResponse(e);
  }
}
