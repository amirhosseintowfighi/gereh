import type { Metadata } from "next";
import { Suspense } from "react";
import { VirguleLink, Wordmark } from "@/components/brand";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { AuthForm } from "@/components/site/auth-form";

export const metadata: Metadata = {
  title: "ورود و ثبت‌نام",
  description: "ورود به پنل کاربری گره با رمز عبور یا کد یک‌بارمصرف، یا ساخت حساب رایگان.",
  alternates: { canonical: "/auth" },
  robots: { index: false, follow: true },
};

export default function AuthPage() {
  return (
    <div className="fade-page min-h-[calc(100vh-88px)] grid lg:grid-cols-2">
      <div className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 border-l border-white/[0.08]">
        <GirihField />
        <div className="relative"><Wordmark size={40} /></div>
        <div className="relative">
          <p className="text-5xl font-black hero-title leading-[1.25] tracking-tight">یک پنل،<br />همه زیرساخت شما</p>
          <p className="text-white/55 leading-8 mt-5 max-w-sm">سرورها، هاست‌ها، دامنه‌ها و صورتحساب‌ها را از یک جا مدیریت کنید.</p>
          <ul className="mt-10 space-y-3">
            {[["zap", "ساخت سرور در کمتر از یک دقیقه"], ["shield-check", "ورود دومرحله‌ای و کلیدهای SSH"], ["code-xml", "API کامل برای اتوماسیون"]].map(([ic, t]) => (
              <li key={t} className="flex items-center gap-3 text-sm text-white/70"><Icon name={ic} size={17} className="acc" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-white/50">قدرت‌گرفته از <VirguleLink className="text-white/60" /></div>
      </div>
      <div className="flex items-center justify-center px-4 sm:px-6 py-12">
        <div className="w-full max-w-md">
          <Suspense><AuthForm /></Suspense>
        </div>
      </div>
    </div>
  );
}
