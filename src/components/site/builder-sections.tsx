import Link from "next/link";
import { BUILDER, BUILDER_IDEAS } from "@/lib/builder";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { Icon } from "../icon";
import { SectionHead } from "../ui";

/* The AI app builder on the public site: the home-page section and the parts of /build. */

export const BUILDER_STEPS: [string, string, string][] = [
  ["sparkles", "بساز", "ایده را به فارسی بنویسید؛ AI طراحی و کد کامل سایت یا اپ را می‌نویسد و پیش‌نمایش زنده را همان لحظه می‌بینید. هر تغییری را در گفتگو بخواهید."],
  ["rocket", "منتشر کن", "با یک کلیک روی گره اپ در دیتاسنتر تهران اجرا می‌شود؛ با SSL، دامنه و در صورت نیاز پایگاه داده. اگر بیلد خطا بدهد، AI لاگ را می‌خواند و خودش رفع می‌کند."],
  ["heart-pulse", "نگه‌دار", "عامل نگهداری اپ را شبانه‌روز می‌پاید؛ کرش، کمبود حافظه یا خطای سلامت را به فارسی توضیح می‌دهد و وصله را با یک کلیک (یا خودکار) منتشر می‌کند."],
];

export const BUILDER_FEATURES: [string, string, string][] = [
  ["languages", "فارسی و راست‌به‌چپ از پایه", "خروجی با فونت وزیرمتن، اعداد فارسی و قیمت به تومان؛ برای مخاطب ایرانی طراحی می‌شود."],
  ["code-xml", "کد واقعی، مال شما", "HTML و Tailwind یا Node.js و Express؛ کد کامل را می‌بینید، ویرایش می‌کنید و هر نسخه را برمی‌گردانید."],
  ["database", "پایگاه داده خودکار", "اگر اپ باید اطلاعات (نوبت، سفارش، ثبت‌نام) ذخیره کند، PostgreSQL ساخته و وصل می‌شود."],
  ["hammer", "رفع خودکار خطای بیلد", "خطای انتشار تا سه بار توسط AI بررسی و رفع می‌شود؛ هر تلاش با توضیح فارسی."],
  ["shield-check", "اجرای امن پیش‌نمایش", "کد ساخته‌شده در محیط ایزوله اجرا می‌شود و به حساب و پنل شما دسترسی ندارد."],
  ["wallet", "پرداخت به اندازه مصرف", "هزینه AI و میزبانی از همان کیف پول تومانی؛ بدون اشتراک ماهانه و بدون کارت ارزی."],
];

function MockStudio() {
  return (
    <div className={GLASS + " rounded-[1.75rem] p-3 sm:p-4"} aria-hidden="true">
      <div className="grid sm:grid-cols-[0.9fr_1.1fr] gap-3">
        <div className="rounded-2xl bg-black/25 border border-white/[0.08] p-3 space-y-2.5 text-[12px] leading-6">
          <div className="mr-auto w-[88%] rounded-2xl rounded-bl-md px-3 py-2 bg-violet-500/25 border border-violet-300/20">یک سایت نوبت‌دهی برای سالن زیبایی با فرم رزرو</div>
          <div className="rounded-2xl rounded-br-md px-3 py-2 bg-white/[0.06] border border-white/[0.1]">
            <span className="inline-flex items-center gap-1 text-[10px] text-sky-200"><Icon name="sparkles" size={11} />ساخت · نسخه ۱</span>
            <p className="mt-1 text-white/80">«سالن زیبایی رز» آماده است: خدمات و قیمت‌ها، رزرو آنلاین و نظرات مشتریان.</p>
            <div className="mt-2 flex flex-wrap gap-1 font-mono text-[10px] text-white/60" dir="ltr"><span className="px-1.5 rounded bg-black/30">+ server.js</span><span className="px-1.5 rounded bg-black/30">+ public/index.html</span></div>
          </div>
          <div className="mr-auto w-[70%] rounded-2xl rounded-bl-md px-3 py-2 bg-violet-500/25 border border-violet-300/20">رنگ را صورتی کن</div>
          <div className="rounded-2xl px-3 py-2 bg-emerald-400/[0.08] border border-emerald-300/20 text-emerald-200 flex items-center gap-1.5"><Icon name="rocket" size={13} />منتشر شد: <span dir="ltr">salon-rose.gereh.dev</span></div>
        </div>
        <div className="rounded-2xl overflow-hidden bg-white text-slate-800">
          <div className="h-7 bg-slate-100 flex items-center gap-1.5 px-3"><span className="w-2 h-2 rounded-full bg-rose-300" /><span className="w-2 h-2 rounded-full bg-amber-300" /><span className="w-2 h-2 rounded-full bg-emerald-300" /></div>
          <div className="p-4 bg-gradient-to-b from-pink-50 to-white">
            <div className="flex items-center justify-between text-[11px] font-black"><span>💇‍♀️ سالن زیبایی رز</span><span className="rounded-lg bg-pink-600 text-white px-2 py-1 text-[10px]">رزرو نوبت</span></div>
            <p className="mt-5 text-[15px] font-black leading-7">زیبایی شما، در زمانی که خودتان انتخاب می‌کنید</p>
            <p className="mt-1.5 text-[10px] text-slate-500 leading-5">نوبت سالن را در کمتر از یک دقیقه آنلاین رزرو کنید.</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[["✂️", "کوتاهی"], ["🎨", "رنگ مو"], ["💅", "ناخن"]].map(([e, t]) => <div key={t} className="rounded-xl bg-white shadow-sm ring-1 ring-slate-100 p-2 text-center"><div>{e}</div><div className="text-[10px] font-bold mt-0.5">{t}</div></div>)}
            </div>
            <div className="mt-3 rounded-xl bg-pink-600 text-white text-[10px] font-bold text-center py-2">ثبت نوبت</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** home page: the AI builder up front */
export function BuilderShowcase() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" aria-labelledby="builder-showcase">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.12] p-6 sm:p-12 grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center"
        style={{ background: "radial-gradient(ellipse 70% 100% at 0% 0%, rgba(167,139,250,.18), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015))" }}>
        <div>
          <p className="text-xs text-white/65 flex items-center gap-1.5"><Icon name="sparkles" size={14} className="text-violet-300" />{BUILDER.name} · {BUILDER.short}</p>
          <h2 id="builder-showcase" className="mt-4 text-[1.8rem] sm:text-5xl font-black leading-[1.35] tracking-tight">{BUILDER.tagline}</h2>
          <p className="mt-4 text-white/70 leading-8">بدون برنامه‌نویسی، ایده‌تان را به فارسی بنویسید. AI سایت یا اپ را می‌سازد، روی گره منتشر می‌کند و بعد از انتشار هم مراقبش است.</p>
          <ol className="mt-6 grid sm:grid-cols-3 gap-2.5">
            {BUILDER_STEPS.map(([ic, t], i) => <li key={t} className={GLASS_SOFT + " rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-sm font-bold"}><Icon name={ic} size={17} className="text-violet-300 shrink-0" />{fa(i + 1)}. {t}</li>)}
          </ol>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Link href={"/panel/build" as never} className={BTN_P + " px-6 py-3"}><Icon name="sparkles" size={18} />همین حالا بسازید</Link>
            <Link href={"/build" as never} className={BTN_G + " px-6 py-3"}>چطور کار می‌کند</Link>
          </div>
        </div>
        <MockStudio />
      </div>
    </section>
  );
}

export function BuilderHero() {
  return (
    <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center hero-in">
      <div className="text-center lg:text-right">
        <nav aria-label="مسیر صفحه" className="flex items-center justify-center lg:justify-start gap-2 text-xs text-white/55">
          <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
          <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">{BUILDER.name}</span>
        </nav>
        <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="sparkles" size={14} className="text-violet-300" />{BUILDER.name} · {BUILDER.short}</p>
        <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35] tracking-tight">{BUILDER.tagline}</h1>
        <p className="mt-6 text-white/70 max-w-xl mx-auto lg:mx-0 leading-8 sm:text-lg">ایده را به فارسی بنویسید؛ هوش مصنوعی کد را می‌نویسد، پیش‌نمایش را نشان می‌دهد، با یک کلیک روی زیرساخت گره منتشر می‌کند و بعد از انتشار هم اپ را نگه می‌دارد.</p>
        <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
          <Link href={"/panel/build" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="sparkles" size={18} />شروع ساخت</Link>
          <a href="#how" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>چطور کار می‌کند</a>
        </div>
        <ul className="mt-8 flex flex-wrap justify-center lg:justify-start gap-2">
          {BUILDER_IDEAS.map((i) => <li key={i.label} className="text-xs rounded-full px-3 py-1.5 bg-white/[0.05] border border-white/[0.1] text-white/70 flex items-center gap-1.5"><Icon name={i.icon} size={13} />{i.label}</li>)}
        </ul>
      </div>
      <MockStudio />
    </div>
  );
}

export function BuilderSteps() {
  return (
    <section id="how" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="سه قدم: بساز، منتشر کن، نگه‌دار" sub="یک گفتگو، از ایده تا محصول در حال اجرا." />
      <ol className="grid md:grid-cols-3 gap-4">
        {BUILDER_STEPS.map(([ic, t, d], i) => (
          <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6 relative"}>
            <span className="absolute top-5 left-5 text-4xl font-black text-white/[0.07] tabular">{fa(i + 1)}</span>
            <Icon name={ic} size={22} className="text-violet-300" />
            <h3 className="font-extrabold mt-3 text-lg">{t}</h3>
            <p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BuilderFeatures() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6">
      <SectionHead title="ساخته‌شده برای کسب‌وکارهای ایرانی" />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {BUILDER_FEATURES.map(([ic, t, d]) => (
          <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
            <Icon name={ic} size={22} className="acc" />
            <h3 className="font-extrabold mt-3">{t}</h3>
            <p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BuilderCta() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.12] p-8 sm:p-14 text-center"
        style={{ background: "radial-gradient(ellipse 60% 90% at 50% 0%, rgba(167,139,250,.2), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015))" }}>
        <h2 className="text-[1.8rem] sm:text-5xl font-black leading-[1.35] tracking-tight">اولین اپ‌تان را همین امروز بسازید</h2>
        <p className="mt-4 text-white/70 leading-8">ثبت‌نام رایگان است؛ فقط هزینه مصرف از کیف پول کم می‌شود.</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={"/panel/build" as never} className={BTN_P + " px-7 py-3.5"}><Icon name="sparkles" size={18} />شروع ساخت</Link>
          <Link href="/paas" className={BTN_G + " px-7 py-3.5"}>درباره گره اپ</Link>
        </div>
      </div>
    </section>
  );
}
