import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { rateLimit } from "@/server/auth";
import { db } from "@/server/ctx";
import { mailDomains } from "@/server/db/schema";
import { queueMessage, sendSchema } from "@/server/mail/service";
import { AppError, sha256 } from "@/server/util";

/* POST /api/mail/v1/send — transactional email with a per-domain API key.
   Auth: Authorization: Bearer gm_… (or X-Api-Key). Body (JSON):
   { from, to, cc?, bcc?, replyTo?, subject, html?, text?, tag?, listUnsubscribe?, headers?, attachments?: [{ filename, content (base64), contentType? }] }
   The tag may also come in the X-Gereh-Tag header. Attachments up to 10 MB in total. */
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => json({ ok: false, error: { code, message } }, status);

export async function POST(req: Request) {
  try {
    const key = (/^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1] ?? req.headers.get("x-api-key") ?? "").trim();
    if (!/^gm_[\w-]{20,60}$/.test(key)) return fail(401, "unauthorized", "کلید API را در سربرگ Authorization: Bearer بفرستید.");
    const d = await db();
    const [dom] = await d.select().from(mailDomains).where(eq(mailDomains.apiKeyHash, sha256(key)));
    if (!dom) return fail(401, "unauthorized", "کلید API نادرست است.");
    await rateLimit(d, "mail:" + dom.id, 600, 60);
    if (!(req.headers.get("content-type") || "").includes("application/json")) return fail(415, "unsupported_media_type", "بدنه درخواست باید JSON باشد (Content-Type: application/json).");
    if (Number(req.headers.get("content-length") || 0) > 15_000_000) return fail(413, "too_large", "حجم درخواست بیش از حد مجاز است (پیوست‌ها حداکثر ۱۰ مگابایت).");
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "invalid_json", "بدنه درخواست JSON معتبر نیست.");
    const tag = req.headers.get("x-gereh-tag");
    const input = sendSchema.parse({ ...(body as object), ...(tag && !(body as { tag?: string }).tag ? { tag } : {}) });
    const r = await queueMessage(d, dom, input, "api");
    return json({ ok: true, id: r.id, status: r.status, mode: dom.mode }, 202);
  } catch (e) {
    if (e instanceof AppError) return fail(e.status, e.status === 429 ? "limit_exceeded" : e.status === 402 ? "no_credit" : e.status === 413 ? "too_large" : e.status === 403 ? "suspended" : "invalid_request", e.message);
    if (e instanceof ZodError) return fail(400, "invalid_request", "ورودی نامعتبر است: " + e.issues.slice(0, 3).map((i) => i.path.join(".") || "body").join("، "));
    console.error("[mail.send]", e);
    return fail(500, "internal", "خطای داخلی رخ داد؛ چند لحظه دیگر دوباره تلاش کنید.");
  }
}
