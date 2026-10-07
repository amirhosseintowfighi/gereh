import { NextResponse } from "next/server";
import { db } from "@/server/ctx";
import { completePayment } from "@/server/rpc/billing";

/** the bank redirects the customer here (GET or POST); we verify server-to-server, then send them to billing */
async function handle(req: Request, gateway: string) {
  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);
  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    form?.forEach((v, k) => typeof v === "string" && params.set(k, v));
  }
  const authority = params.get("Authority") || params.get("id") || params.get("authority") || "";
  let ok = false, message = "تراکنش پیدا نشد.";
  if (authority) {
    try { ({ ok, message } = await completePayment(await db(), gateway, authority, params)); }
    catch (e) { console.error("[pay] callback", e); message = "تأیید پرداخت با خطا روبه‌رو شد؛ اگر مبلغ کسر شده، تا ۷۲ ساعت بازمی‌گردد یا با پشتیبانی تماس بگیرید."; }
  }
  const dest = new URL("/panel/billing", url.origin);
  dest.searchParams.set(ok ? "paid" : "failed", "1");
  dest.searchParams.set("msg", message);
  return NextResponse.redirect(dest, 303);
}

export async function GET(req: Request, { params }: RouteContext<"/api/pay/callback/[gateway]">) { return handle(req, (await params).gateway); }
export async function POST(req: Request, { params }: RouteContext<"/api/pay/callback/[gateway]">) { return handle(req, (await params).gateway); }
