import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { SectionHead } from "@/components/ui";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { hourlyOf } from "@/lib/paas";
import { breadcrumbLd, offerLd, pageMeta } from "@/lib/seo";
import { publicMailPlans } from "@/server/mail/public";

export const dynamic = "force-dynamic";
const DESC = "سرویس ایمیل گره: ارسال ایمیل تراکنشی با API و SMTP، صندوق ایمیل روی دامنه خودتان، DKIM و SPF و DMARC خودکار، گزارش تحویل و آمار ۹۰ روزه. پرداخت ساعتی از کیف پول.";
export const metadata = pageMeta({ title: "سرویس ایمیل: ایمیل تراکنشی و صندوق ایمیل سازمانی", description: DESC, path: "/mail" });

const FEATURES: [string, string, string][] = [
  ["send", "API و SMTP", "ارسال با یک درخواست HTTP یا هر کتابخانه SMTP؛ پیوست تا ۱۰ مگابایت، cc و bcc، برچسب و List-Unsubscribe."],
  ["shield-check", "DKIM، SPF و DMARC", "کلید DKIM اختصاصی و همه رکوردها آماده؛ اگر DNS دامنه در گره است، با یک کلیک ثبت می‌شوند."],
  ["zap", "حالت DEV و LIVE", "در حالت DEV پیام‌ها ثبت می‌شوند ولی ارسال نمی‌شوند؛ یکپارچه‌سازی را بی‌خطر آزمایش کنید."],
  ["scroll-text", "گزارش و رویداد", "وضعیت هر پیام (در صف، ارسال، تحویل، برگشت، خطا)، نمایش HTML و منبع پیام، آمار ۹۰ روزه و برچسب‌ها."],
  ["mail", "صندوق ایمیل", "info@ و support@ روی دامنه خودتان با IMAP، POP3 و SMTP؛ نشانی مستعار، هدایت و catch-all."],
  ["ban", "کنترل ورودی", "قوانین هدایت یا دور ریختن، فهرست مسدود و تنظیم حساسیت هرزنامه برای هر دامنه."],
];

export default async function MailPage() {
  const plans = await publicMailPlans();
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["سرویس ایمیل", "/mail"]]), ...(plans.length ? [offerLd("سرویس ایمیل گره", DESC, plans.map((p) => p.price), "/mail")] : [])]} />
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 text-center hero-in">
        <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/55">
          <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
          <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">سرویس ایمیل</span>
        </nav>
        <h1 className="hero-title mt-8 text-[2rem] sm:text-6xl font-black leading-[1.35] tracking-tight">ایمیل‌هایتان به صندوق<br />برسند، نه به هرزنامه</h1>
        <p className="mt-6 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">ایمیل تراکنشی (کد ورود، فاکتور، خوش‌آمد) با API و SMTP، و صندوق ایمیل سازمانی روی دامنه خودتان؛ با DKIM، SPF و DMARC آماده و گزارش تحویل هر پیام.</p>
        <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={"/panel/mail?new=1" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="mail" size={18} />افزودن دامنه ایمیل</Link>
          <a href="#plans" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>پلن‌ها و قیمت</a>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="هر آنچه برای ایمیل قابل اعتماد لازم است" />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p></li>
          ))}
        </ul>
      </section>

      <section id="plans" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="پلن‌ها" sub="قیمت ماهانه، کسر ساعتی از کیف پول؛ هر زمان حذف کنید، فقط ساعت‌های استفاده‌شده حساب می‌شود." />
        <ul className="grid md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <li key={p.id} className={GLASS + " rounded-[1.75rem] p-6"}>
              <h3 className="font-extrabold text-lg">{p.name}</h3>
              <p className="mt-3"><b className="text-2xl tabular">{fa(p.price)}</b> <span className="text-xs text-white/55">تومان / ماه</span></p>
              <p className="text-[11px] text-white/50 mt-1">ساعتی {fa(hourlyOf(p.price))} تومان</p>
              <ul className="mt-5 space-y-2 text-sm text-white/75">
                <li className="flex gap-2"><Icon name="check" size={15} className="acc mt-1 shrink-0" />{fa(p.dailyLimit)} ارسال در روز</li>
                <li className="flex gap-2"><Icon name="check" size={15} className="acc mt-1 shrink-0" />{fa(p.monthlyLimit)} ارسال در ماه</li>
                <li className="flex gap-2"><Icon name="check" size={15} className="acc mt-1 shrink-0" />{fa(p.mailboxes)} صندوق ایمیل تا {fa(Math.round(p.quotaMb / 1024))} گیگابایت</li>
                <li className="flex gap-2"><Icon name="check" size={15} className="acc mt-1 shrink-0" />API، SMTP و گزارش ۹۰ روزه</li>
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section id="api" className="max-w-4xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="ارسال با یک درخواست" sub="کلید API برای هر دامنه جداست؛ برچسب را در سربرگ X-Gereh-Tag یا فیلد tag بفرستید." />
        <pre dir="ltr" className={GLASS + " rounded-[1.5rem] p-5 text-xs leading-6 overflow-x-auto text-left"}>{`POST https://gereh.net/api/mail/v1/send
Authorization: Bearer gm_…
Content-Type: application/json
X-Gereh-Tag: welcome

{
  "from": "Shop <no-reply@mail.example.ir>",
  "to": ["user@example.com"], "cc": [], "bcc": [],
  "subject": "Welcome", "html": "<b>Hi</b>", "text": "Hi",
  "listUnsubscribe": "https://example.ir/unsubscribe?u=42",
  "attachments": [{ "filename": "invoice.pdf", "content": "<base64>" }]
}

→ 202 { "ok": true, "id": "msg-…", "status": "queued" }`}</pre>
      </section>
    </div>
  );
}
