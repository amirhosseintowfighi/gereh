import Link from "next/link";
import { Suspense } from "react";
import { GirihField } from "@/components/girih";
import { Faq } from "@/components/home/interactive";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { BusinessRequestForm } from "@/components/site/business";
import { BizGoals, BizPackages, BizSteps } from "@/components/site/business-sections";
import { SectionHead } from "@/components/ui";
import { BIZ_FAQ } from "@/lib/business";
import { BTN_G, BTN_P, GLASS } from "@/lib/cls";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

const TITLE = "راه‌اندازی سایت و فروشگاه آنلاین برای کسب‌وکارهای کوچک";
const DESC = "سایت یا فروشگاه آنلاین کسب‌وکارتان را ما می‌سازیم و نگه می‌داریم: دامنه، ایمیل، درگاه پرداخت و کمک برای اینماد، با یک هزینه ماهانه ثابت. بدون نیاز به دانش فنی.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/business" });

export default function BusinessPage() {
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["راه‌اندازی کسب‌وکار", "/business"]]), faqLd(BIZ_FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 text-center hero-in">
          <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">راه‌اندازی کسب‌وکار</span>
          </nav>
          <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="store" size={14} className="acc" />برای مغازه‌ها، فروشگاه‌ها و کسب‌وکارهای کوچک</p>
          <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35]">کسب‌وکارتان را آنلاین کنید؛<br />کارهای فنی با ما</h1>
          <p className="mt-6 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">سایت یا فروشگاه آنلاین را برایتان می‌سازیم، دامنه و ایمیل و درگاه پرداخت را راه می‌اندازیم و هر ماه نگهش می‌داریم. شما فقط عکس و متن را بفرستید.</p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#request" className={BTN_P + " px-7 py-3.5 text-base"}><Icon name="phone-call" size={18} />با من تماس بگیرید</a>
            <a href="#packages" className={BTN_G + " px-7 py-3.5 text-base"}>بسته‌ها و قیمت</a>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6" aria-labelledby="biz-goals">
        <SectionHead id="biz-goals" title="می‌خواهید چه چیزی راه بیندازید؟" sub="یکی را انتخاب کنید؛ بسته مناسبش را پیشنهاد می‌کنیم." />
        <BizGoals />
      </section>

      <section id="packages" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24" aria-labelledby="biz-packages">
        <SectionHead id="biz-packages" title="بسته‌ها و قیمت" sub="یک هزینه راه‌اندازی و یک هزینه ماهانه ثابت؛ قیمت‌ها بدون مالیات بر ارزش افزوده است." />
        <BizPackages />
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6" aria-labelledby="biz-steps">
        <SectionHead id="biz-steps" title="چطور کار می‌کند؟" />
        <BizSteps />
      </section>

      <section id="request" className="max-w-3xl mx-auto px-4 sm:px-6 scroll-mt-24" aria-labelledby="biz-request">
        <SectionHead id="biz-request" title="شماره‌تان را بگذارید، ما تماس می‌گیریم" sub="تماس اول رایگان است. نیازتان را می‌پرسیم و بسته مناسب را با هم انتخاب می‌کنیم." />
        <div className={GLASS + " rounded-[1.75rem] p-5 sm:p-8"}>
          <Suspense fallback={<p className="text-sm text-white/55 py-10 text-center">در حال آماده‌سازی فرم…</p>}>
            <BusinessRequestForm source="/business" />
          </Suspense>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6">
        <SectionHead title="پرسش‌های رایج" />
        <Faq id="faq" items={BIZ_FAQ} />
      </section>
    </div>
  );
}
