import Link from "next/link";
import { GLASS } from "@/lib/cls";
import { EMAIL } from "@/lib/seo";
import { VIRGULE_URL, VirguleLink, VirguleMark, Wordmark } from "../brand";
import { Icon } from "../icon";

const COLS: [string, [string, string, string][]][] = [
  ["سرویس‌ها", [["server", "سرور ابری", "/vps"], ["server-cog", "سرور اختصاصی", "/vps#dedicated"], ["layers", "هاست وب", "/hosting"], ["globe", "ثبت دامنه", "/domains"], ["rocket", "خدمات دواپس", "/devops"]]],
  ["گره", [["building-2", "درباره ما", "/about"], ["scale", "مقایسه با دیگران", "/compare"], ["message-circle", "تماس با ما", "/contact"], ["file-text", "قوانین استفاده", "/terms"], ["shield-check", "حریم خصوصی", "/privacy"], ["gauge", "توافق سطح خدمات", "/sla"]]],
  ["منابع", [["book-open", "راهنما و آموزش", "/kb"], ["newspaper", "بلاگ", "/blog"], ["code-xml", "مستندات API", "/docs/api"], ["activity", "وضعیت سرویس‌ها", "/status"], ["languages", "English", "/en"]]],
];

export function Footer() {
  return (
    <footer className="px-3 sm:px-6 pb-6">
      <div className={GLASS + " max-w-6xl mx-auto rounded-[1.75rem] p-6 sm:p-10"}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr] gap-10">
          <div>
            <Wordmark size={36} />
            <p className="text-white/55 text-sm leading-7 mt-4 max-w-xs">زیرساخت ابری برای محصولاتی که نباید کند شوند؛ از اولین وب‌سایت تا کلاستر سرورهای اختصاصی.</p>
            <a href={VIRGULE_URL} target="_blank" rel="noopener" className="mt-5 inline-flex items-center gap-3 rounded-2xl px-3.5 py-2.5 bg-white/[0.04] border border-white/[0.1] hover:bg-white/[0.08] hover:border-white/20 transition group">
              <VirguleMark size={26} />
              <span className="text-right leading-5"><span className="block text-[11px] text-white/55">گره، عضوی از خانواده</span><span className="block text-sm font-bold">ویرگول</span></span>
              <Icon name="arrow-up-right" size={15} className="text-white/50 group-hover:text-white transition mr-1" />
            </a>
          </div>
          {COLS.map(([h, items]) => (
            <nav key={h} aria-label={h}>
              <h2 className="font-extrabold mb-4 text-base">{h}</h2>
              <ul className="space-y-2.5 text-sm text-white/55">
                {items.map(([ic, l, href]) => <li key={l}><Link href={href as never} className="hover:text-white inline-flex items-center gap-2 transition"><Icon name={ic} size={15} />{l}</Link></li>)}
              </ul>
            </nav>
          ))}
          <div>
            <h2 className="font-extrabold mb-4 text-base">تماس</h2>
            <address className="not-italic">
              <ul className="space-y-3 text-sm text-white/55">
                <li><a href="tel:+982191000000" className="inline-flex items-center gap-2 hover:text-white"><Icon name="phone" size={15} /><span className="ltr">۰۲۱-۹۱۰۰۰۰۰۰</span></a></li>
                <li><a href={"mailto:" + EMAIL} className="inline-flex items-center gap-2 hover:text-white"><Icon name="mail" size={15} /><span className="ltr">{EMAIL}</span></a></li>
                <li className="flex items-center gap-2"><Icon name="map-pin" size={15} />تهران، خیابان ولیعصر</li>
                <li className="flex items-center gap-2"><Icon name="clock" size={15} />پشتیبانی ۲۴ ساعته</li>
              </ul>
            </address>
          </div>
        </div>
        <div className="hairline mt-10" />
        <div className="pt-6 text-xs text-white/55 flex flex-col sm:flex-row justify-between items-center gap-3">
          <span>© ۱۴۰۵ گره. تمام حقوق محفوظ است. قدرت‌گرفته از ویرگول.</span>
          <span className="flex items-center gap-1.5">طراحی و توسعه با <span aria-label="عشق" role="img">❤️</span> توسط <VirguleLink /></span>
        </div>
      </div>
    </footer>
  );
}
