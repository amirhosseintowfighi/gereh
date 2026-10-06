import { JsonLd } from "@/components/json-ld";
import { ContactForm } from "@/components/site/contact-form";
import { PageHeader } from "@/components/site/page-header";
import { Icon } from "@/components/icon";
import { Card, IconTile } from "@/components/ui";
import { GLASS } from "@/lib/cls";
import { breadcrumbLd, EMAIL, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

export const metadata = pageMeta({
  title: "تماس با گره",
  description: "تماس با فروش و پشتیبانی فنی گره: تلفن شبانه‌روزی ۰۲۱-۹۱۰۰۰۰۰۰، ایمیل support@gereh.cloud، تیکت از پنل کاربری و دفتر مرکزی در خیابان ولیعصر تهران.",
  path: "/contact",
});

const CARDS: [string, string, string, string, string?][] = [
  ["phone", "تلفن پشتیبانی", "۰۲۱-۹۱۰۰۰۰۰۰", "شبانه‌روزی", "tel:+982191000000"],
  ["mail", "ایمیل", "support@gereh.cloud", "پاسخ زیر یک ساعت", "mailto:support@gereh.cloud"],
  ["message-circle", "تیکت", "از پنل کاربری", "سریع‌ترین مسیر فنی", "/panel/tickets"],
  ["map-pin", "دفتر مرکزی", "تهران، خیابان ولیعصر", "شنبه تا چهارشنبه، ۹ تا ۱۸"],
];

export default function ContactPage() {
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["تماس با ما", "/contact"]]), { "@type": "ContactPage", name: "تماس با گره", url: SITE_URL + "/contact", about: { "@id": ORG_ID }, email: EMAIL }]} />
      <PageHeader icon="message-circle" crumb="تماس با ما" title="با ما در تماس باشید" sub="سؤال فروش، مشاوره فنی یا همکاری؛ یک نفر از تیم ما که موضوع را می‌شناسد جواب می‌دهد." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {CARDS.map(([ic, t, v, s, href]) => {
            const body = (
              <>
                <IconTile name={ic} size={18} cls="w-10 h-10 rounded-xl" />
                <div className="text-xs text-white/55 mt-4">{t}</div>
                <div className={"font-bold mt-1 " + (/[a-z0-9]/i.test(v) ? "ltr text-right" : "")}>{v}</div>
                <div className="text-[11px] text-white/55 mt-1">{s}</div>
              </>
            );
            const cls = "spot block h-full rounded-[1.4rem] p-5 " + GLASS;
            return <li key={t}>{href ? <a href={href} className={cls + " hover:border-white/25 transition-colors"}>{body}</a> : <div className={cls}>{body}</div>}</li>;
          })}
        </ul>
        <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5">
          <Card title="ارسال پیام" icon="send"><ContactForm /></Card>
          <Card title="دفتر مرکزی" icon="map-pin" pad="p-5">
            <svg viewBox="0 0 400 260" className="w-full rounded-2xl bg-black/30 border border-white/[0.08]" role="img" aria-label="نقشه موقعیت دفتر در خیابان ولیعصر">
              {Array.from({ length: 14 }, (_, i) => <line key={"h" + i} x1="0" x2="400" y1={i * 20} y2={i * 20 + (i % 3) * 6} stroke="rgba(255,255,255,.05)" />)}
              {Array.from({ length: 20 }, (_, i) => <line key={"v" + i} y1="0" y2="260" x1={i * 21} x2={i * 21 + (i % 4) * 5} stroke="rgba(255,255,255,.05)" />)}
              <path d="M200 0 L205 260" stroke="rgba(156,201,255,.35)" strokeWidth="5" />
              <path d="M0 140 Q 200 120 400 150" stroke="rgba(255,255,255,.14)" strokeWidth="3" fill="none" />
              <circle cx="203" cy="128" r="22" fill="rgba(156,201,255,.12)" /><circle cx="203" cy="128" r="7" fill="#cfe0ff" />
              <text x="215" y="110" fill="rgba(255,255,255,.7)" fontSize="12">خیابان ولیعصر</text>
            </svg>
            <address className="not-italic mt-5 space-y-3 text-sm">
              <div className="flex items-center gap-2.5 text-white/70"><Icon name="map-pin" size={16} className="acc" />تهران، خیابان ولیعصر، بالاتر از پارک ساعی</div>
              <div className="flex items-center gap-2.5 text-white/70"><Icon name="clock" size={16} className="acc" />شنبه تا چهارشنبه، ۹ تا ۱۸</div>
            </address>
          </Card>
        </div>
      </div>
    </div>
  );
}
