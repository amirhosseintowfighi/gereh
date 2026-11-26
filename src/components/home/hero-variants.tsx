"use client";
/* Three in-between home heroes (old split layout with a visual + the business-first message). */
import Link from "next/link";
import { useState } from "react";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { BIZ_GOALS, bizFromMonthly } from "@/lib/business";
import { BTN_G, BTN_P, GLASS, GLASS_STRONG } from "@/lib/cls";
import { toman } from "@/lib/format";
import { useDB } from "@/lib/store";
import { Terminal } from "./interactive";

/** a small online shop in a browser window: what a business owner gets, as the hero's picture */
export function ShopPreview() {
  const items: [string, string, string][] = [["قهوه اسپرسو ۲۵۰ گرم", "۲۸۰٬۰۰۰", "from-amber-300/30 to-orange-500/20"], ["ماگ سرامیکی", "۱۹۵٬۰۰۰", "from-sky-300/30 to-indigo-500/20"], ["فرنچ پرس", "۶۴۰٬۰۰۰", "from-emerald-300/25 to-teal-500/20"], ["پک هدیه", "۸۹۰٬۰۰۰", "from-rose-300/25 to-fuchsia-500/20"]];
  return (
    <div className="relative" role="img" aria-label="نمونه فروشگاه آنلاین ساخته‌شده با گره">
      <div className="absolute -inset-10 rounded-[3rem] pointer-events-none" style={{ background: "radial-gradient(closest-side, rgba(125,180,255,.16), transparent)" }} />
      <div className={GLASS_STRONG + " relative rounded-[1.4rem] overflow-hidden shadow-[0_40px_120px_-30px_rgba(0,0,0,.9)]"}>
        <div className="flex items-center gap-3 px-4 h-11 border-b border-white/[0.08] bg-white/[0.03]" dir="ltr">
          <div className="flex gap-2">{["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} className="w-3 h-3 rounded-full" style={{ background: c, opacity: 0.85 }} />)}</div>
          <span className="flex-1 h-6 rounded-md bg-white/[0.06] border border-white/[0.08] text-[11px] text-white/60 grid place-items-center"><span className="flex items-center gap-1.5"><Icon name="lock" size={11} className="text-emerald-300" />cafe-setareh.ir</span></span>
        </div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <span className="font-black">کافه ستاره</span>
            <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-white/[0.07] border border-white/10"><Icon name="shopping-bag" size={13} />سبد خرید · ۲</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {items.map(([n, pr, g]) => (
              <div key={n} className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-2.5">
                <div className={"h-16 rounded-lg bg-gradient-to-br " + g} />
                <div className="text-[12px] font-bold mt-2 truncate">{n}</div>
                <div className="text-[11px] text-white/55 mt-0.5">{pr} تومان</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-white/60">
            <span className="flex items-center gap-1.5"><Icon name="shield-check" size={13} className="text-emerald-300" />درگاه بانکی و نماد اعتماد</span>
            <span className="flex items-center gap-1.5"><Icon name="check" size={13} className="acc" />سفارش جدید ثبت شد</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const chips = (cls = "") => (
  <ul className={"flex flex-wrap gap-2 " + cls}>
    {BIZ_GOALS.filter((g) => g.id !== "dev").map((g) => (
      <li key={g.id}><Link href={("/business?goal=" + g.id + "#request") as never} className="flex items-center gap-2 h-10 px-3.5 rounded-xl text-sm bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.1] hover:border-white/25 transition"><Icon name={g.icon} size={16} className="acc" />{g.title}</Link></li>
    ))}
  </ul>
);

/** A: the old layout, the business message, the shop as the picture; developers get a second button */
export function HeroA() {
  const from = bizFromMonthly(useDB().bizPackages);
  return (
    <section className="relative overflow-hidden">
      <GirihField />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-24 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-14 items-center">
        <div>
          <p className="hero-in text-sm font-bold acc">سرعت ابر، استواری زمین</p>
          <h1 className="hero-in d2 hero-title mt-3 text-[2.35rem] sm:text-[4rem] font-black leading-[1.25] sm:leading-[1.15]">کسب‌وکارتان را آنلاین کنید؛ کارهای فنی با ما</h1>
          <p className="hero-in d3 mt-6 text-white/65 max-w-lg text-base sm:text-lg leading-8">سایت و فروشگاه آنلاین را برایتان می‌سازیم و نگه می‌داریم{from ? "، از ماهی " + toman(from) : ""}. برنامه‌نویس هستید؟ سرور، هاست و ابزارهای فنی هم همین‌جاست.</p>
          {chips("hero-in d3 mt-7")}
          <div className="hero-in d4 mt-7 flex flex-wrap gap-3">
            <Link href="/business" className={BTN_P + " px-6 h-12"}><Icon name="store" size={18} />راه‌اندازی کسب‌وکار</Link>
            <Link href="/vps" className={BTN_G + " px-6 h-12"}><Icon name="code-xml" size={18} />برای برنامه‌نویس‌ها</Link>
          </div>
        </div>
        <div className="hero-in d3"><ShopPreview /></div>
      </div>
    </section>
  );
}

/** B: the old hero with a switch on top; each audience gets its own words and picture */
export function HeroB() {
  const [mode, setMode] = useState<"biz" | "dev">("biz");
  const biz = mode === "biz";
  return (
    <section className="relative overflow-hidden">
      <GirihField />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-20">
        <div className="hero-in mx-auto w-fit p-1 rounded-2xl bg-white/[0.06] border border-white/[0.12] flex gap-1" role="tablist" aria-label="برای چه کسی">
          {([["biz", "store", "کسب‌وکار دارم"], ["dev", "code-xml", "برنامه‌نویسم"]] as const).map(([id, ic, t]) => (
            <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => setMode(id)} className={"h-10 px-4 rounded-xl text-sm flex items-center gap-2 transition " + (mode === id ? "bg-white text-slate-900 font-bold" : "text-white/70 hover:text-white")}><Icon name={ic} size={16} />{t}</button>
          ))}
        </div>
        <div className="mt-10 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-14 items-center">
          <div key={mode} className="fade-in">
            <h1 className="hero-title text-[2.35rem] sm:text-[4rem] font-black leading-[1.25] sm:leading-[1.15]">{biz ? "کسب‌وکارتان را آنلاین کنید؛ کارهای فنی با ما" : "زیرساختی که خودتان مدیریت می‌کنید"}</h1>
            <p className="mt-6 text-white/65 max-w-lg text-base sm:text-lg leading-8">{biz ? "سایت و فروشگاه آنلاین با دامنه، ایمیل و درگاه پرداخت؛ ما می‌سازیم و هر ماه نگه می‌داریم." : "سرور ابری آماده در کمتر از یک دقیقه، هاست، دامنه، استقرار اپ از Git، Geo DNS و API؛ همه با یک حساب."}</p>
            {biz ? chips("mt-7") : null}
            <div className="mt-7 flex flex-wrap gap-3">
              {biz ? <Link href="/business" className={BTN_P + " px-6 h-12"}><Icon name="phone-call" size={18} />با من تماس بگیرید</Link> : <Link href="/vps" className={BTN_P + " px-6 h-12"}><Icon name="rocket" size={18} />ساخت سرور</Link>}
              <Link href={biz ? "/business#packages" : "/vps"} className={BTN_G + " px-6 h-12"}>{biz ? "بسته‌ها و قیمت" : "مشاهده قیمت‌ها"}</Link>
            </div>
          </div>
          <div>{biz ? <ShopPreview /> : <Terminal />}</div>
        </div>
      </div>
    </section>
  );
}

/** C: one headline, then two big doors side by side */
export function HeroC() {
  const from = bizFromMonthly(useDB().bizPackages);
  return (
    <section className="relative overflow-hidden">
      <GirihField />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-20">
        <div className="text-center max-w-3xl mx-auto">
          <p className="hero-in text-sm font-bold acc">سرعت ابر، استواری زمین</p>
          <h1 className="hero-in d2 hero-title mt-3 text-[2.35rem] sm:text-[4rem] font-black leading-[1.25] sm:leading-[1.15]">هر چیزی که برای آنلاین شدن لازم دارید</h1>
        </div>
        <div className="hero-in d3 mt-10 grid lg:grid-cols-2 gap-5">
          <div className={GLASS + " rounded-[1.75rem] p-6 sm:p-7 flex flex-col"}>
            <p className="text-xs text-white/55 flex items-center gap-1.5"><Icon name="store" size={14} className="acc" />کسب‌وکار دارم</p>
            <h2 className="mt-2 text-2xl font-black">سایت و فروشگاه آنلاین؛ ما می‌سازیم</h2>
            <p className="mt-2 text-sm text-white/60 leading-7">دامنه، ایمیل، درگاه پرداخت و نگهداری ماهانه{from ? "؛ از ماهی " + toman(from) : ""}.</p>
            <div className="mt-5 scale-[.92] origin-top"><ShopPreview /></div>
            <Link href="/business" className={BTN_P + " mt-auto h-12"}><Icon name="phone-call" size={18} />راه‌اندازی کسب‌وکار</Link>
          </div>
          <div className={GLASS + " rounded-[1.75rem] p-6 sm:p-7 flex flex-col"}>
            <p className="text-xs text-white/55 flex items-center gap-1.5"><Icon name="code-xml" size={14} className="acc" />برنامه‌نویسم</p>
            <h2 className="mt-2 text-2xl font-black">سرور، هاست و ابزارهای فنی</h2>
            <p className="mt-2 text-sm text-white/60 leading-7">سرور ابری در کمتر از یک دقیقه، استقرار از Git، پایگاه داده و API.</p>
            <div className="mt-5 scale-[.92] origin-top"><Terminal /></div>
            <Link href="/vps" className={BTN_G + " mt-auto h-12"}><Icon name="rocket" size={18} />ساخت سرور</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
