import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BTN_G, BTN_P } from "@/lib/cls";
import { toman } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "درگاه آزمایشی", robots: { index: false, follow: false } };

/** stands in for the bank page when no real gateway is configured (dev, CI, demos) */
export default async function SimGateway({ searchParams }: PageProps<"/pay/sim">) {
  if (process.env.NODE_ENV === "production" && process.env.PAY_SIMULATOR !== "1") notFound();
  const q = await searchParams;
  const authority = String(q.authority || ""), cb = String(q.cb || ""), amount = Number(q.amount || 0);
  // only our own callback path is allowed as the return target
  let back = "";
  try { const u = new URL(cb); if (u.pathname.startsWith("/api/pay/callback/")) back = u.pathname; } catch { back = cb.startsWith("/api/pay/callback/") ? cb : ""; }
  if (!authority || !back) notFound();
  const link = (ok: boolean) => back + "?" + new URLSearchParams({ authority, ok: ok ? "1" : "0" });
  return (
    <main id="main" className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white text-slate-900 p-8 shadow-2xl text-center">
        <div className="text-xs font-bold text-amber-700 bg-amber-100 rounded-full inline-block px-3 py-1">محیط آزمایشی — پولی جابه‌جا نمی‌شود</div>
        <h1 className="text-2xl font-black mt-5">درگاه پرداخت آزمایشی</h1>
        <div className="mt-6 text-sm text-slate-500">مبلغ قابل پرداخت</div>
        <div className="text-3xl font-black mt-1 tabular">{toman(amount)}</div>
        <div className="mono text-xs text-slate-400 mt-3 ltr">{authority}</div>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <a href={link(false)} className={BTN_G + " h-12 !text-slate-700 !bg-slate-100 !border-slate-200"}>انصراف</a>
          <a href={link(true)} className={BTN_P + " h-12 !bg-slate-900 !text-white"}>پرداخت موفق</a>
        </div>
      </div>
    </main>
  );
}
