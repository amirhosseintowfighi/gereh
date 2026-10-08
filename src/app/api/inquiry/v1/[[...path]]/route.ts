import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { rateLimit } from "@/server/auth";
import { db } from "@/server/ctx";
import { inquiryGrants, inquiryServices, users } from "@/server/db/schema";
import { authenticate, ipAllowed, runInquiry } from "@/server/inquiry/service";
import { AppError } from "@/server/util";

/* Inquiry API: POST /api/inquiry/v1/<service>, GET /api/inquiry/v1/services, GET /api/inquiry/v1/balance.
   Auth: X-Api-Key + X-Api-Password headers (or HTTP Basic key:password). X-Sandbox: 1 → free test answers. */
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) => json({ ok: false, error: { code, message } }, status);

function credentials(req: Request) {
  const key = req.headers.get("x-api-key"), pass = req.headers.get("x-api-password");
  if (key && pass) return [key.trim(), pass.trim()];
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(req.headers.get("authorization") || "")?.[1];
  if (!basic) return null;
  const s = Buffer.from(basic, "base64").toString("utf8"), i = s.indexOf(":");
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : null;
}
const clientIp = (req: Request) => (process.env.TRUST_PROXY === "1" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : req.headers.get("x-real-ip")) || "";

async function handle(req: Request, { params }: RouteContext<"/api/inquiry/v1/[[...path]]">) {
  const path = ((await params).path ?? []).join("/");
  try {
    const d = await db();
    const cred = credentials(req);
    if (!cred) return fail(401, "unauthorized", "سربرگ‌های X-Api-Key و X-Api-Password را بفرستید.");
    const acct = await authenticate(d, cred[0], cred[1]);
    if (!acct) return fail(401, "unauthorized", "کلید یا رمز API نادرست است.");
    if (acct.status !== "active" || acct.userStatus === "suspended") return fail(403, "account_suspended", "دسترسی API این حساب معلق است؛ با پشتیبانی تماس بگیرید.");
    const ip = clientIp(req);
    if (!ipAllowed(acct.ipAllow, ip)) return fail(403, "ip_not_allowed", "درخواست از IP مجاز نیامده است (" + (ip || "نامشخص") + ").");
    await rateLimit(d, "inq:" + acct.userId, 600, 60);

    if (req.method === "GET" && path === "balance") {
      const [u] = await d.select({ balance: users.balance }).from(users).where(eq(users.id, acct.userId));
      return json({ ok: true, balance: u?.balance ?? 0, currency: "IRT" });
    }
    if (req.method === "GET" && path === "services") {
      const [list, grants] = await Promise.all([
        d.select().from(inquiryServices).where(eq(inquiryServices.active, true)).orderBy(asc(inquiryServices.position)),
        d.select().from(inquiryGrants).where(and(eq(inquiryGrants.userId, acct.userId))),
      ]);
      return json({ ok: true, services: list.map((s) => ({ id: s.id, name: s.name, price: s.price, access: !s.approval ? "open" : grants.find((g) => g.serviceId === s.id)?.status ?? "none" })) });
    }
    if (req.method === "POST" && /^[a-z0-9_]{2,40}$/.test(path)) {
      const ct = req.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return fail(415, "unsupported_media_type", "بدنه درخواست باید JSON باشد (Content-Type: application/json).");
      if (Number(req.headers.get("content-length") || 0) > 4_000_000) return fail(413, "too_large", "حجم درخواست بیش از حد مجاز است.");
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "invalid_json", "بدنه درخواست JSON معتبر نیست.");
      const sandbox = req.headers.get("x-sandbox") === "1" || new URL(req.url).searchParams.get("sandbox") === "1";
      const r = await runInquiry(d, { userId: acct.userId, serviceId: path, body: body as Record<string, unknown>, sandbox, source: "api", ip });
      return json(r.body, r.http);
    }
    return fail(404, "not_found", "مسیر وجود ندارد. مستندات: /docs/inquiry");
  } catch (e) {
    if (e instanceof AppError) return fail(e.status, e.status === 429 ? "rate_limited" : "error", e.message);
    console.error("[inquiry]", e);
    return fail(500, "internal", "خطای داخلی رخ داد؛ اگر مبلغی کسر شده باشد ظرف چند دقیقه برگشت داده می‌شود. موضوع را با پشتیبانی در میان بگذارید.");
  }
}
export { handle as GET, handle as POST };
