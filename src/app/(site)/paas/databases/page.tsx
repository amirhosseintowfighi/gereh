import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { DB_FAQ, PaasCta, PaasDatabases, PaasFaq, PaasPricing } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { publicPlans } from "@/server/paas/public";

export const dynamic = "force-dynamic";

const DESC = "PostgreSQL، MySQL، MariaDB، MongoDB و Redis مدیریت‌شده با پشتیبان خودکار روزانه، بازگردانی با یک کلیک، اتصال خودکار به اپ و پرداخت ساعتی در دیتاسنتر تهران.";
export const metadata = pageMeta({ title: "پایگاه داده مدیریت‌شده PostgreSQL، MySQL، MongoDB و Redis", description: DESC, path: "/paas/databases" });

const POINTS: [string, string, string][] = [
  ["archive", "پشتیبان خودکار روزانه", "۷ نسخه آخر نگه داشته می‌شود؛ قبل از هر تغییر بزرگ هم یک پشتیبان دستی بگیرید."],
  ["refresh-cw", "بازگردانی با یک کلیک", "هر پشتیبان را از پنل برگردانید، بدون تیکت و انتظار."],
  ["plug", "اتصال خودکار به اپ", "آدرس اتصال کامل به‌صورت DATABASE_URL، REDIS_URL یا MONGODB_URI به اپ داده می‌شود."],
  ["lock", "شبکه خصوصی", "به‌طور پیش‌فرض فقط اپ‌های خودتان دسترسی دارند؛ دسترسی عمومی اختیاری است."],
  ["gauge", "ارتقای بی‌دردسر", "پلن بزرگ‌تر با چند ثانیه ری‌استارت؛ دیسک NVMe."],
  ["activity", "پایش", "نمودار مصرف پردازنده و حافظه در پنل."],
];

export default async function Page() {
  const plans = await publicPlans();
  const dbs = plans.filter((p) => p.kind === "db" && p.active);
  return (
    <div className="fade-page pb-10 space-y-20">
      <JsonLd data={[breadcrumbLd([["گره اپ", "/paas"], ["پایگاه داده", "/paas/databases"]]), ...(dbs.length ? [offerLd("پایگاه داده مدیریت‌شده گره", DESC, dbs.map((p) => p.price), "/paas/databases")] : []), faqLd(DB_FAQ)]} />
      <PageHeader icon="database" crumb="پایگاه داده مدیریت‌شده" title="پایگاه داده مدیریت‌شده" sub="بسازید، وصل کنید و فراموش کنید؛ پشتیبان، به‌روزرسانی امنیتی و پایش با ما." />
      <PaasDatabases />
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="چرا پایگاه داده مدیریت‌شده؟" />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {POINTS.map(([ic, t, d]) => <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></li>)}
        </ul>
      </section>
      <PaasPricing plans={plans} kind="db" />
      <PaasFaq items={DB_FAQ} />
      <p className="text-center text-sm text-white/60"><Link href="/paas" className="acc underline underline-offset-4">بازگشت به گره اپ</Link></p>
      <PaasCta title="پایگاه داده و اپ را کنار هم بسازید" />
    </div>
  );
}
