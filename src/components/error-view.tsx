"use client";
import Link from "next/link";
import { useEffect } from "react";
import { BTN_G, BTN_MD, BTN_P } from "@/lib/cls";
import { Icon } from "./icon";

export type ErrorProps = { error: Error & { digest?: string }; retry: () => void };

/** the fallback of every error.tsx: what happened, a retry, a way out, and the digest support can look up */
export function ErrorView({ error, retry, home = ["/", "صفحه اصلی"], compact = false }: ErrorProps & { home?: [string, string]; compact?: boolean }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className={"fade-page max-w-xl mx-auto px-4 text-center " + (compact ? "py-16" : "py-28")}>
      <div className="w-14 h-14 mx-auto rounded-2xl tile grid place-items-center" aria-hidden="true"><Icon name="triangle-alert" size={24} /></div>
      <h1 className="text-2xl font-black mt-6">این صفحه بارگذاری نشد</h1>
      <p className="text-white/55 text-sm leading-7 mt-3">خطایی پیش‌بینی‌نشده رخ داد. دوباره تلاش کنید؛ اگر ادامه داشت، کد زیر را برای پشتیبانی بفرستید.</p>
      {error.digest && <p className="mt-4 text-xs text-white/50">کد خطا: <span dir="ltr" className="mono text-white/75">{error.digest}</span></p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className={BTN_P + BTN_MD}><Icon name="refresh-cw" size={16} /> تلاش دوباره</button>
        <Link href={home[0] as never} className={BTN_G + BTN_MD}>{home[1]}</Link>
      </div>
    </div>
  );
}
