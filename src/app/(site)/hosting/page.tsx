import { Faq } from "@/components/home/interactive";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { HostingPlans } from "@/components/site/plans";
import { SectionHead } from "@/components/ui";
import { HOSTING, HOSTING_FAQ } from "@/lib/catalog";
import { GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "خرید هاست وردپرس و هاست لینوکس پرسرعت",
  description: "هاست لینوکس و وردپرس روی NVMe با وب‌سرور LiteSpeed، SSL رایگان، بکاپ روزانه و کنترل‌پنل cPanel از ۸۹ هزار تومان در ماه؛ میزبانی در دیتاسنتر تهران و انتقال رایگان.",
  path: "/hosting", en: "/en/hosting",
});

const FEATURES = [
  ["zap", "وب‌سرور LiteSpeed", "کش داخلی LSCache؛ صفحات وردپرس تا سه برابر سریع‌تر."],
  ["lock", "SSL رایگان و خودکار", "گواهی برای همه دامنه‌ها و ساب‌دامنه‌ها، تمدید خودکار."],
  ["database-backup", "بکاپ روزانه", "۱۴ نسخه آخر، بازیابی با یک کلیک از داخل پنل."],
  ["layout-dashboard", "کنترل‌پنل cPanel", "فایل، ایمیل و دیتابیس را بدون دانش فنی مدیریت کنید."],
  ["bug", "ضدبدافزار Imunify360", "اسکن و پاک‌سازی خودکار فایل‌های آلوده."],
  ["cloud-upload", "انتقال رایگان", "سایت فعلی‌تان را بدون قطعی به گره منتقل می‌کنیم."],
];

export default function HostingPage() {
  const all = HOSTING.linux.concat(HOSTING.wordpress);
  return (
    <div className="fade-page pb-8">
      <JsonLd data={[breadcrumbLd([["هاست وب", "/hosting"]]), offerLd("هاست وب گره", "هاست لینوکس و وردپرس با LiteSpeed و دیسک NVMe", all.map((p) => p.price), "/hosting"), faqLd(HOSTING_FAQ)]} />
      <PageHeader icon="layers" crumb="هاست وب" title="هاست وب پرسرعت" sub="برای سایت شرکتی، فروشگاه و وبلاگ؛ روی سرورهای NVMe با LiteSpeed در دیتاسنتر تهران." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <HostingPlans />
        <div className="mt-24">
          <SectionHead title="در همه پلن‌ها" />
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(([ic, t, d]) => (
              <li key={t} className={"spot group rounded-[1.5rem] p-6 flex gap-4 " + GLASS_SOFT}>
                <div className="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-white/[0.08] border border-white/15 acc group-hover:scale-110 transition-transform"><Icon name={ic} size={20} /></div>
                <div><h3 className="font-extrabold">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-24 max-w-3xl mx-auto">
          <SectionHead title="پرسش‌های رایج هاست" />
          <Faq items={HOSTING_FAQ} id="hosting-faq" />
        </div>
      </div>
    </div>
  );
}
