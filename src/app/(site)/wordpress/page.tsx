import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasFaq } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { WP_PLANS, wpMonthly } from "@/lib/wordpress";
import { publicPlans } from "@/server/paas/public";

export const dynamic = "force-dynamic";
const DESC = "هاست وردپرس مدیریت‌شده روی زیرساخت ابری: منابع اختصاصی، پایگاه داده جدا با پشتیبان روزانه، SSL رایگان، کش لبه و انتقال رایگان از cPanel. بسته‌های اکو و توربو با پرداخت ساعتی.";
export const metadata = pageMeta({ title: "وردپرس مدیریت‌شده (اکو و توربو) با انتقال رایگان از cPanel", description: DESC, path: "/wordpress" });

const FAQ: [string, string][] = [
  ["فرق آن با هاست اشتراکی وردپرس چیست؟", "در هاست اشتراکی صدها سایت روی یک سرور منابع را تقسیم می‌کنند. در وردپرس مدیریت‌شده گره، سایت شما CPU و رم اختصاصی دارد، پایگاه داده‌اش روی سرویس جداگانه با پشتیبان روزانه است و ترافیک سایت‌های دیگر روی آن اثری ندارد."],
  ["انتقال از cPanel چطور انجام می‌شود؟", "در cPanel از بخش Backup یک «Full Account Backup» بگیرید و فایل را در پنل گره بارگذاری کنید. فایل‌ها و پایگاه داده خودکار منتقل و تنظیمات اتصال پایگاه داده اصلاح می‌شود. اگر دامنه فعلی را وصل می‌کنید، آدرس سایت دست نمی‌خورد."],
  ["دامنه خودم را چطور وصل کنم؟", "از صفحه سایت › دامنه‌ها، دامنه را اضافه و رکورد CNAME یا A را طبق راهنما تنظیم کنید؛ SSL خودکار صادر می‌شود."],
  ["پلاگین کش لازم دارم؟", "در بسته توربو کش لبه گره صفحات عمومی و فایل‌ها را کش می‌کند. برای کش شیء می‌توانید یک Redis مدیریت‌شده بسازید و با پلاگین Redis Object Cache وصل کنید."],
  ["هزینه چطور حساب می‌شود؟", "ساعتی از کیف پول؛ قیمت ماهانه بسته مجموع هزینه اپ، پایگاه داده و دیسک است. هر وقت بخواهید بین اکو و توربو جابه‌جا شوید."],
];

export default async function WordpressPage() {
  const plans = await publicPlans();
  const prices = WP_PLANS.map((p) => wpMonthly(p, plans));
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["وردپرس مدیریت‌شده", "/wordpress"]]), offerLd("وردپرس مدیریت‌شده گره", DESC, prices, "/wordpress"), faqLd(FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 text-center hero-in">
          <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">وردپرس مدیریت‌شده</span>
          </nav>
          <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="upload" size={14} className="acc" />انتقال رایگان از cPanel</p>
          <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35] tracking-tight">وردپرس سریع<br />بدون دردسر سرور</h1>
          <p className="mt-6 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">منابع اختصاصی، پایگاه داده جدا با پشتیبان روزانه، SSL رایگان و کش لبه؛ روی همان زیرساخت ابری که اپ‌های گره اجرا می‌شوند. سایت فعلی‌تان را با یک فایل پشتیبان cPanel منتقل کنید.</p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={"/panel/wordpress" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="rocket" size={18} />ساخت سایت وردپرس</Link>
            <Link href="#plans" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>بسته‌ها و قیمت</Link>
          </div>
        </div>
      </section>

      <section id="plans" className="max-w-4xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="اکو یا توربو؟" sub="پرداخت ساعتی از کیف پول؛ هر وقت بخواهید بسته را عوض کنید." />
        <div className="grid md:grid-cols-2 gap-4">
          {WP_PLANS.map((p, i) => (
            <div key={p.id} className={(p.cdn ? GLASS : GLASS_SOFT) + " rounded-[1.75rem] p-7 flex flex-col"}>
              <div className="flex items-center justify-between"><h3 className="text-2xl font-black">{p.name}</h3>{p.cdn && <span className="text-xs px-2.5 py-1 rounded-full bg-sky-400/15 text-sky-200">پیشنهاد فروشگاه‌ها</span>}</div>
              <p className="text-sm text-white/60 mt-1">{p.for}</p>
              <p className="text-3xl font-black tabular mt-5">{fa(prices[i])} <span className="text-sm font-normal text-white/60">تومان در ماه</span></p>
              <ul className="space-y-2.5 mt-5 text-sm text-white/75 flex-1">{p.features.map((f) => <li key={f} className="flex gap-2"><Icon name="check" size={16} className="acc shrink-0 mt-0.5" />{f}</li>)}</ul>
              <Link href={"/panel/wordpress" as never} className={(p.cdn ? BTN_P : BTN_G) + " h-12 mt-6"}>شروع با {p.name}</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="انتقال از cPanel در سه قدم" />
        <ol className="grid md:grid-cols-3 gap-4">
          {[["download", "پشتیبان کامل بگیرید", "در cPanel › Backup روی «Download a Full Account Backup» بزنید و فایل tar.gz را دانلود کنید."], ["upload", "در پنل گره بارگذاری کنید", "هنگام ساخت سایت گزینه «انتقال از cPanel» را بزنید و فایل را انتخاب کنید (تا ۴ گیگ)."], ["globe", "دامنه را وصل کنید", "فایل‌ها، پایگاه داده و پیشوند جداول خودکار منتقل می‌شوند؛ دامنه را اضافه و DNS را تغییر دهید."]].map(([ic, t, d], i) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><span className="text-xs text-white/45">قدم {["اول", "دوم", "سوم"][i]}</span><Icon name={ic} size={22} className="acc mt-3" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></li>
          ))}
        </ol>
      </section>

      <PaasFaq items={FAQ} />
    </div>
  );
}
