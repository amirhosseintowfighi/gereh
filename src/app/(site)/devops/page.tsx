import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { DevopsFaq, DevopsPricing, DevopsProcess, DevopsRequest, DevopsServicesGrid, devopsServiceLd, DevopsSla, DevopsStack, DevopsTrust } from "@/components/site/devops-sections";
import { SectionHead } from "@/components/ui";
import { DEVOPS_FAQ, DEVOPS_JOURNEYS } from "@/content/devops";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

const TITLE = "خدمات دواپس برای شرکت‌ها و استارتاپ‌ها";
const DESC = "تیم دواپس گره زیرساخت شما را می‌سازد و نگه می‌دارد: CI/CD، کوبرنتیز، Terraform، مانیتورینگ، امنیت، مهاجرت و پشتیبانی شبانه‌روزی با SLA؛ روی هر زیرساختی، با قرارداد ماهانه یا پروژه‌ای.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/devops", en: "/en/devops" });

const PAINS: [string, string][] = [
  ["هر انتشار، یک استرس", "استقرار دستی است و هر بار ممکن است چیزی خراب شود."],
  ["از قطعی، از مشتری باخبر می‌شوید", "مانیتورینگ و هشدار درستی وجود ندارد."],
  ["همه چیز در ذهن یک نفر است", "اگر او نباشد، کسی جرئت دست زدن به سرورها را ندارد."],
  ["پشتیبانی که هیچ‌وقت تست نشده", "معلوم نیست در روز حادثه، داده برمی‌گردد یا نه."],
  ["صورتحساب زیرساخت بی‌حساب بالا می‌رود", "سرورهای بزرگ با بار کم و منابع فراموش‌شده."],
  ["استخدام مهندس دواپس سخت است", "پیدا کردن، نگه داشتن و ۲۴ ساعته در دسترس بودن یک نفر ممکن نیست."],
];

export default function DevopsPage() {
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["خدمات دواپس", "/devops"]]), devopsServiceLd(TITLE, DESC, "/devops", "DevOps consulting and managed infrastructure"), faqLd(DEVOPS_FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 text-center hero-in">
          <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">خدمات دواپس</span>
          </nav>
          <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="sparkles" size={14} className="acc" />برای شرکت‌ها، استارتاپ‌ها و سازمان‌ها</p>
          <h1 className="hero-title mt-6 text-[2.2rem] sm:text-7xl font-black leading-[1.3] tracking-tight">تیم دواپس شما،<br />بدون استخدام</h1>
          <p className="mt-6 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">زیرساختتان را می‌سازیم، خودکار می‌کنیم و شبانه‌روز نگه می‌داریم تا تیم شما روی محصول تمرکز کند. روی گره، هر سرویس‌دهنده دیگر یا سرورهای داخل سازمان خودتان.</p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#request" className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="message-circle" size={18} />جلسه آشنایی رایگان</a>
            <a href="#pricing" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>بسته‌ها و قیمت</a>
          </div>
          <ul className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-white/65">
            {[["file-check", "NDA پیش از هر دسترسی"], ["clock", "پاسخ شبانه‌روزی با SLA"], ["building-2", "مالکیت کامل کد و حساب‌ها با شما"], ["receipt", "فاکتور رسمی"]].map(([ic, t]) => <li key={t} className="flex items-center gap-2"><Icon name={ic} size={16} className="acc" />{t}</li>)}
          </ul>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="این‌ها برایتان آشناست؟" sub="بیشتر تیم‌هایی که با ما تماس می‌گیرند، با یکی از این‌ها شروع می‌کنند." />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PAINS.map(([t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6 flex gap-4"}>
              <Icon name="circle-alert" size={20} className="text-amber-300 shrink-0 mt-1" />
              <div><h3 className="font-extrabold">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section id="services" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="خدمات دواپس گره" sub="هر کدام را جداگانه یا در قالب یک بسته ماهانه دریافت کنید." />
        <DevopsServicesGrid />
      </section>

      <DevopsProcess />
      <DevopsPricing />
      <DevopsSla />
      <DevopsTrust />

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="مسیرهای رایج" sub="نمونه‌هایی از نوع کارهایی که انجام می‌دهیم؛ جزئیات هر پروژه را در جلسه آشنایی بررسی می‌کنیم." />
        <ul className="grid lg:grid-cols-3 gap-4">
          {DEVOPS_JOURNEYS.map((j) => (
            <li key={j.title} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
              <p className="text-xs text-white/55">{j.who}</p>
              <h3 className="font-extrabold mt-1">{j.title}</h3>
              <dl className="mt-4 space-y-3 text-sm leading-7">
                <div><dt className="text-rose-200/80 text-xs">پیش از همکاری</dt><dd className="text-white/70">{j.before}</dd></div>
                <div><dt className="text-emerald-200/80 text-xs">پس از همکاری</dt><dd className="text-white/85">{j.after}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <DevopsStack />
      <DevopsFaq items={DEVOPS_FAQ} />
      <DevopsRequest source="/devops" />
    </div>
  );
}
