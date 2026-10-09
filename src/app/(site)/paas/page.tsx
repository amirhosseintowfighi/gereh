import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasCompare, PaasCta, PaasDatabases, PaasFaq, PaasFeatures, PaasPricing, PaasStacks, PaasSteps, PaasTemplates, PaasTerminal } from "@/components/site/paas-sections";
import { PAAS_FAQ } from "@/content/paas";
import { BTN_G, BTN_P } from "@/lib/cls";
import { toman } from "@/lib/format";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { publicPlans } from "@/server/paas/public";

// prices come from the database (staff can change them)
export const dynamic = "force-dynamic";

const TITLE = "گره اپ: پلتفرم استقرار اپلیکیشن (PaaS)";
const DESC = "اپ Node.js، Next.js، Python، Django، Laravel، Go، Java و Docker را از Git یا ZIP در چند دقیقه مستقر کنید؛ با SSL خودکار، دامنه اختصاصی، پایگاه داده مدیریت‌شده، مقیاس خودکار و پرداخت ساعتی در دیتاسنتر تهران.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/paas", en: "/en/paas" });

export default async function PaasPage() {
  const plans = await publicPlans();
  const apps = plans.filter((p) => p.kind === "app" && p.active);
  const from = apps.length ? Math.min(...apps.map((p) => p.price)) : 0;
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["گره اپ", "/paas"]]), ...(apps.length ? [offerLd("گره اپ", DESC, apps.map((p) => p.price), "/paas")] : []), faqLd(PAAS_FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center hero-in">
          <div className="text-center lg:text-right">
            <nav aria-label="مسیر صفحه" className="flex items-center justify-center lg:justify-start gap-2 text-xs text-white/55">
              <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
              <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">گره اپ</span>
            </nav>
            <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="sparkles" size={14} className="acc" />پلتفرم به‌عنوان سرویس (PaaS)</p>
            <h1 className="hero-title mt-6 text-[2.2rem] sm:text-6xl font-black leading-[1.35] tracking-tight">کد را بفرستید،<br />بقیه با ما</h1>
            <p className="mt-6 text-white/70 max-w-xl mx-auto lg:mx-0 leading-8 sm:text-lg">از Git، فایل ZIP یا ایمیج Docker؛ بیلد، اجرا، SSL، دامنه، پایگاه داده و مقیاس را خودکار انجام می‌دهیم. بدون مدیریت سرور، با پرداخت ساعتی{from ? " از " + toman(from) + " در ماه" : ""}.</p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href={"/panel/apps/new" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="rocket" size={18} />ساخت اپ</Link>
              <a href="#pricing" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>قیمت‌ها</a>
            </div>
            <ul className="mt-9 flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 text-sm text-white/65">
              {[["shield-check", "SSL خودکار"], ["git-branch", "استقرار با git push"], ["database", "پایگاه داده با پشتیبان"], ["map-pin", "دیتاسنتر تهران"]].map(([ic, t]) => <li key={t} className="flex items-center gap-2"><Icon name={ic} size={16} className="acc" />{t}</li>)}
            </ul>
          </div>
          <PaasTerminal />
        </div>
      </section>
      <PaasSteps />
      <PaasFeatures />
      <PaasStacks />
      <PaasTemplates />
      <PaasPricing plans={plans} />
      <PaasDatabases />
      <PaasCompare />
      <section className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <p className="text-white/65 leading-8">زیرساخت پیچیده‌تری دارید یا می‌خواهید کسی کل مسیر CI/CD و کوبرنتیز را برایتان بسازد و نگه دارد؟ <Link href="/devops" className="acc underline underline-offset-4">خدمات دواپس گره</Link> را ببینید.</p>
      </section>
      <PaasFaq items={PAAS_FAQ} />
      <PaasCta />
    </div>
  );
}
