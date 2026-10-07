import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./util";

/** same-origin check for state-changing requests (SameSite=Lax cookies already block most CSRF) */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") || req.headers.get("host")); } catch { return false; }
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: "ورودی نامعتبر است." }, { status: 400 });
  console.error("[api] unhandled", e);
  return NextResponse.json({ error: "خطای سرور؛ چند لحظه دیگر دوباره تلاش کنید." }, { status: 500 });
}

export const noStore = { "cache-control": "no-store" };
