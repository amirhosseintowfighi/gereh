import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasFaq } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { publicStoragePlans } from "@/server/storage/public";

export const dynamic = "force-dynamic";
const DESC = "فضای ذخیره‌سازی ابری گره: سازگار با S3 برای فایل‌ها، تصاویر، بکاپ و استاتیک سایت. دیتاسنتر داخل ایران، پرداخت ساعتی، ترافیک رایگان، کلید دسترسی محدود به هر باکت و دامنه اختصاصی.";
export const metadata = pageMeta({ title: "فضای ذخیره‌سازی ابری سازگار با S3", description: DESC, path: "/storage" });

const FEATURES: [string, string, string][] = [
  ["plug", "سازگار با S3", "هر ابزاری که با آمازون S3 کار می‌کند: aws-cli، rclone، SDK نود، پایتون، PHP و Go، و درایور s3 لاراول."],
  ["key-round", "کلید دسترسی محدود", "برای هر برنامه کلید جدا بسازید و فقط به باکت‌های لازم، فقط‌خواندنی یا خواندن و نوشتن، دسترسی بدهید."],
  ["folder-open", "مدیریت فایل در پنل", "بارگذاری، دانلود، پوشه‌بندی، تغییر نام و لینک اشتراک موقت بدون نصب هیچ ابزاری."],
  ["globe", "دامنه اختصاصی و عمومی", "باکت را عمومی کنید و فایل‌ها را روی cdn.example.ir با SSL رایگان تحویل دهید."],
  ["timer", "حذف خودکار و نسخه‌بندی", "لاگ‌ها و بکاپ‌های قدیمی خودکار پاک می‌شوند؛ با نسخه‌بندی، فایل بازنویسی‌شده برمی‌گردد."],
  ["wallet", "پرداخت ساعتی", "هزینه هر ساعت از کیف پول؛ ترافیک ورودی و خروجی و درخواست‌ها رایگان است."],
];
const FAQ: [string, string][] = [
  ["فضای ذخیره‌سازی ابری چه فرقی با هاست دارد؟", "فضای ذخیره‌سازی فقط فایل نگه می‌دارد و از طریق API سازگار با S3 در دسترس است؛ برای تصاویر و فایل‌های کاربران، بکاپ و فایل‌های استاتیک مناسب است و با رشد حجم، نیازی به جابه‌جایی سرور ندارید."],
  ["هزینه ترافیک جداست؟", "خیر. هزینه فقط بر اساس حجم پلن و ساعتی از کیف پول کسر می‌شود؛ ترافیک و تعداد درخواست‌ها رایگان است."],
  ["می‌توانم حجم را بعداً تغییر دهم؟", "ارتقا به پلن بزرگ‌تر در هر زمان و بدون قطعی ممکن است. کاهش حجم پشتیبانی نمی‌شود؛ در این صورت باکت کوچک‌تری بسازید و فایل‌ها را با rclone منتقل کنید."],
  ["اگر موجودی کیف پول تمام شود؟", "دسترسی به باکت‌ها موقتاً متوقف می‌شود ولی فایل‌ها حذف نمی‌شوند؛ با شارژ کیف پول، باکت‌ها خودکار فعال می‌شوند."],
  ["فایل‌ها کجا نگه داشته می‌شوند؟", "در دیتاسنتر گره در ایران؛ بنابراین در قطعی اینترنت بین‌الملل هم در دسترس‌اند و سرعت دسترسی کاربران داخل بالاست."],
];

export default async function StoragePage() {
  const plans = await publicStoragePlans();
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["فضای ذخیره‌سازی ابری", "/storage"]]), ...(plans.length ? [offerLd("فضای ذخیره‌سازی ابری گره", DESC, plans.map((p) => p.price), "/storage")] : []), faqLd(FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 text-center hero-in">
          <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">فضای ذخیره‌سازی ابری</span>
          </nav>
          <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="hard-drive" size={14} className="acc" />Object Storage · سازگار با S3</p>
          <h1 className="hero-title mt-6 text-[2rem] sm:text-6xl font-black leading-[1.35] tracking-tight">فضای ذخیره‌سازی ابری<br />برای فایل‌های اپلیکیشن شما</h1>
          <p className="mt-6 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">تصاویر، فایل‌های کاربران، بکاپ و استاتیک سایت را در باکت‌های سازگار با S3 داخل ایران نگه دارید؛ ساعتی پرداخت کنید و ترافیک رایگان بگیرید.</p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={"/panel/storage?new=1" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="hard-drive" size={18} />ساخت باکت</Link>
            <a href="#plans" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>پلن‌ها و قیمت</a>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="هر آنچه از یک S3 انتظار دارید" />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p></li>
          ))}
        </ul>
      </section>

      <section id="plans" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="پلن‌ها" sub="قیمت ماهانه، کسر ساعتی از کیف پول؛ ترافیک و درخواست رایگان. هر پلن برای یک باکت." />
        <ul className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {plans.map((p) => (
            <li key={p.id} className={GLASS + " rounded-[1.4rem] p-5 text-center"}>
              <h3 className="font-black">{p.name}</h3>
              <p className="mt-3"><span className="text-2xl font-black tabular">{fa(p.price / 1000)}</span><span className="block text-[11px] text-white/55 mt-1">هزار تومان / ماه</span></p>
              <p className="text-[11px] text-white/45 mt-2">{fa(Math.round(p.price / p.sizeGb))} تومان هر گیگ</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-white/60 flex items-start gap-2"><Icon name="info" size={17} className="acc shrink-0 mt-0.5" />ارتقا به پلن بزرگ‌تر در هر زمان و بدون قطعی؛ کلید دسترسی، دامنه اختصاصی و SSL رایگان در همه پلن‌ها.</p>
      </section>

      <PaasFaq items={FAQ} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className={GLASS + " rounded-[2rem] p-8 sm:p-12 text-center"}>
          <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">اولین باکت در کمتر از یک دقیقه</h2>
          <p className="mt-4 text-white/65 leading-8">باکت بسازید، کلید دسترسی بگیرید و با همان کدی که برای S3 نوشته‌اید ادامه دهید.</p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={"/panel/storage?new=1" as never} className={BTN_P + " h-12 px-7"}><Icon name="hard-drive" size={18} />شروع</Link>
            <Link href="/contact" className={BTN_G + " h-12 px-6"}>مشاوره رایگان</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
