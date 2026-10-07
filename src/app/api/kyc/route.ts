import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { context, needUser } from "@/server/ctx";
import { users } from "@/server/db/schema";
import { errorResponse, sameOrigin } from "@/server/http";
import { fail, logActivity } from "@/server/util";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
/** magic numbers, so a renamed executable is rejected even with a forged Content-Type */
const MAGIC: Record<string, number[]> = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46], pdf: [0x25, 0x50, 0x44, 0x46] };

/** POST /api/kyc (multipart "file") — stored outside the web root (KYC_DIR) for staff review */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "درخواست نامعتبر است." }, { status: 403 });
  try {
    const ctx = await context();
    const a = needUser(ctx);
    await rateLimit(ctx.db, "kyc:" + a.uid, 10, 3600);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) fail("فایلی انتخاب نشده است.");
    const f = file as File;
    const ext = TYPES[f.type];
    if (!ext) fail("فقط تصویر JPG، PNG، WebP یا PDF.");
    if (f.size > 5 * 1024 * 1024) fail("حجم فایل باید کمتر از ۵ مگابایت باشد.");
    const buf = Buffer.from(await f.arrayBuffer());
    if (!MAGIC[ext].every((b, i) => buf[i] === b)) fail("محتوای فایل با نوع آن هم‌خوانی ندارد.");
    const dir = path.join(process.env.KYC_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "kyc"), a.uid);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, Date.now() + "-" + randomBytes(6).toString("hex") + "." + ext), buf, { mode: 0o600 });
    await ctx.db.update(users).set({ kyc: "pending" }).where(eq(users.id, a.uid));
    await logActivity(ctx.db, a.uid, "upload", "بارگذاری مدرک احراز هویت", ctx.ip);
    return NextResponse.json({ result: true });
  } catch (e) {
    return errorResponse(e);
  }
}
