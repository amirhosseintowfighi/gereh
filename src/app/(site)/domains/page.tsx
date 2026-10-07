import Link from "next/link";
import { Suspense } from "react";
import { JsonLd } from "@/components/json-ld";
import { DomainSearch, DomainSearchView } from "@/components/site/domains";
import { PageHeader } from "@/components/site/page-header";
import { IconTile } from "@/components/ui";
import { tldSlug } from "@/content/tlds";
import { TLDS } from "@/lib/catalog";
import { toman } from "@/lib/format";
import { GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, offerLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "ثبت دامنه ir و دامنه بین‌المللی",
  description: "جست‌وجو و ثبت آنی دامنه .ir، .com، .io، .cloud و ۱۶ پسوند دیگر؛ ثبت دامنه ملی از ۹۵ هزار تومان، انتقال رایگان دامنه‌های ملی، مدیریت DNS و محافظت از اطلاعات مالک.",
  path: "/domains",
});

export default function DomainsPage() {
  return (
    <div className="fade-page pb-8">
      <JsonLd data={[breadcrumbLd([["دامنه", "/domains"]]), offerLd("ثبت دامنه گره", "ثبت و تمدید دامنه ملی و بین‌المللی", TLDS.map((t) => t.reg), "/domains")]} />
      <PageHeader icon="globe" crumb="دامنه" title="نامی که می‌ماند" sub="وضعیت نام دلخواه را روی همه پسوندها یک‌جا ببینید و در چند ثانیه ثبت کنید." />
      <Suspense fallback={<DomainSearchView urlQ="" />}>
        <DomainSearch />
      </Suspense>
      <ul className="max-w-6xl mx-auto px-4 sm:px-6 mt-16 grid md:grid-cols-3 gap-4">
        {[["eye-off", "محافظت از اطلاعات مالک", "اطلاعات تماس شما در WHOIS عمومی نمایش داده نمی‌شود."],
          ["settings-2", "مدیریت DNS پیشرفته", "رکوردهای A، CNAME، MX و TXT را از پنل تنظیم کنید."],
          ["arrow-left-right", "انتقال آسان", "کد انتقال را وارد کنید؛ باقی کار با ماست."]].map(([ic, t, d]) => (
          <li key={t} className={"spot rounded-[1.5rem] p-6 " + GLASS_SOFT}>
            <IconTile name={ic} size={20} />
            <h2 className="font-extrabold mt-5 text-base">{t}</h2><p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p>
          </li>
        ))}
      </ul>
      <nav aria-label="راهنمای پسوندها" className="max-w-6xl mx-auto px-4 sm:px-6 mt-16">
        <h2 className="text-xl font-black mb-5 text-center">قیمت و شرایط هر پسوند</h2>
        <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {TLDS.map((t) => (
            <li key={t.tld}><Link href={("/domains/" + tldSlug(t.tld)) as never} className={"block rounded-xl p-3 text-center hover:bg-white/[0.08] transition " + GLASS_SOFT}>
              <b dir="ltr" className="block">{t.tld}</b><span className="text-[11px] text-white/55">{toman(t.reg)}</span>
            </Link></li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
