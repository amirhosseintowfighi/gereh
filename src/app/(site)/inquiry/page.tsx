import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasFaq } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { INQ_BILLING, INQ_FAQ, INQ_USECASES } from "@/content/inquiry";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { toman } from "@/lib/format";
import { INQUIRY_CATEGORIES, inquiryDef } from "@/lib/inquiry";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { publicInquiry } from "@/server/inquiry/public";

export const dynamic = "force-dynamic";
const DESC = "API استعلام ثبت احوال، شاهکار، کارت و شبا، تبدیل کارت به شبا، کد پستی، اشخاص حقوقی و چک صیادی. بدون هزینه ماهانه؛ فقط به ازای هر استعلام موفق پرداخت کنید. محیط آزمایشی رایگان و مستندات کامل.";
export const metadata = pageMeta({ title: "API استعلام هویتی و بانکی (احراز هویت KYC)", description: DESC, path: "/inquiry" });

export default async function InquiryPage() {
  const list = await publicInquiry();
  const from = list.length ? Math.min(...list.map((s) => s.price)) : 0;
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["API استعلام", "/inquiry"]]), ...(list.length ? [offerLd("API استعلام گره", DESC, list.map((s) => s.price), "/inquiry")] : []), faqLd(INQ_FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center hero-in">
          <div className="text-center lg:text-right">
            <nav aria-label="مسیر صفحه" className="flex items-center justify-center lg:justify-start gap-2 text-xs text-white/55">
              <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
              <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">API استعلام</span>
            </nav>
            <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="fingerprint" size={14} className="acc" />احراز هویت و استعلام با یک API</p>
            <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35] tracking-tight">هویت مشتری را<br />قبل از ریسک بشناسید</h1>
            <p className="mt-6 text-white/70 max-w-xl mx-auto lg:mx-0 leading-8 sm:text-lg">ثبت احوال، شاهکار، کارت و شبا، کد پستی، اشخاص حقوقی و چک صیادی در یک API. بدون قرارداد و هزینه ماهانه؛ فقط استعلام‌های موفق را{from ? " از " + toman(from) : ""} پرداخت می‌کنید.</p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href={"/panel/inquiry" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="key-round" size={18} />دریافت کلید API</Link>
              <Link href={"/docs/inquiry" as never} className={BTN_G + " h-13 px-7 py-3.5 text-base"}><Icon name="book-open" size={18} />مستندات</Link>
            </div>
            <ul className="mt-9 flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 text-sm text-white/65">
              {[["wallet", "بدون هزینه ماهانه"], ["circle-check", "ورودی اشتباه رایگان"], ["terminal", "sandbox رایگان"], ["shield-check", "محدودیت IP"]].map(([ic, t]) => <li key={t} className="flex items-center gap-2"><Icon name={ic} size={16} className="acc" />{t}</li>)}
            </ul>
          </div>
          <div className={GLASS + " rounded-[1.5rem] overflow-hidden text-left"} dir="ltr">
            <div className="flex gap-1.5 px-4 py-3 border-b border-white/[0.08]" aria-hidden="true"><span className="w-3 h-3 rounded-full bg-rose-400/70" /><span className="w-3 h-3 rounded-full bg-amber-300/70" /><span className="w-3 h-3 rounded-full bg-emerald-400/70" /></div>
            <pre tabIndex={0} aria-label="نمونه درخواست و پاسخ" className="p-5 text-[12px] sm:text-[12.5px] leading-7 font-mono text-white/80 overflow-x-auto">
              <span className="text-white/45">POST</span> /api/inquiry/v1/<span className="acc">card_owner</span>{"\n"}
              {"{ "}<span className="text-sky-200">&quot;card&quot;</span>: &quot;6037…7893&quot;, <span className="text-sky-200">&quot;nationalCode&quot;</span>: &quot;0012…5679&quot; {"}"}{"\n\n"}
              <span className="text-emerald-300">200 OK</span>{"\n"}
              {"{ "}<span className="text-sky-200">&quot;status&quot;</span>: &quot;success&quot;,{"\n"}
              {"  "}<span className="text-sky-200">&quot;result&quot;</span>: {"{ "}<span className="text-sky-200">&quot;matched&quot;</span>: <span className="text-emerald-300">true</span> {"}"},{"\n"}
              {"  "}<span className="text-sky-200">&quot;charged&quot;</span>: 1150 {"}"}
            </pre>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="کجا به کارتان می‌آید؟" sub="هر جا که اعتماد به هویت کاربر، کارت یا حساب بانکی مهم است." />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INQ_USECASES.map((u) => (
            <li key={u.title} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
              <Icon name={u.icon} size={22} className="acc" />
              <h3 className="font-extrabold mt-3">{u.title}</h3>
              <p className="text-white/60 text-sm leading-7 mt-1.5">{u.text}</p>
              <p className="text-[11px] text-white/45 mt-3">{u.services.map((id) => inquiryDef(id)?.name).filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="سرویس‌ها و قیمت" sub="قیمت هر درخواست با پاسخ قطعی. شارژ کیف پول با فاکتور رسمی." />
        <div className="space-y-6">
          {INQUIRY_CATEGORIES.map((c) => {
            const items = list.filter((s) => inquiryDef(s.id)?.category === c.id);
            if (!items.length) return null;
            return (
              <div key={c.id}>
                <h3 className="font-extrabold flex items-center gap-2 mb-3"><Icon name={c.icon} size={18} className="acc" />{c.label}</h3>
                <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((s) => (
                    <li key={s.id} className={GLASS_SOFT + " rounded-2xl p-5 flex flex-col"}>
                      <div className="flex items-start justify-between gap-3"><b className="leading-7">{s.name}</b><span className="tabular font-black text-emerald-300 whitespace-nowrap text-sm mt-1">{toman(s.price)}</span></div>
                      <p className="text-xs text-white/60 leading-6 mt-2 flex-1">{inquiryDef(s.id)?.summary}</p>
                      <span className="flex items-center justify-between gap-2 mt-3 text-[11px] text-white/45"><code dir="ltr">{s.id}</code>{s.approval && <span className="flex items-center gap-1"><Icon name="file-check" size={12} />نیاز به تأیید کاربرد</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6">
        <SectionHead title="پرداخت شفاف، فقط برای جواب" sub="هیچ مبلغی بابت اشتباه شما یا قطعی سامانه مرجع کم نمی‌شود." />
        <div className={GLASS + " rounded-[1.75rem] overflow-hidden"}>
          <ul className="divide-y divide-white/[0.06]">
            {INQ_BILLING.map(([t, d, paid]) => (
              <li key={t} className="flex items-center justify-between gap-4 p-5">
                <span><b>{t}</b><span className="block text-sm text-white/60 mt-1 leading-6">{d}</span></span>
                <span className={"shrink-0 text-sm font-bold " + (paid ? "text-white/80" : "text-emerald-300")}>{paid ? "قیمت سرویس" : "رایگان"}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="سه قدم تا اولین استعلام" />
        <ol className="grid md:grid-cols-3 gap-4">
          {[["user-plus", "ثبت‌نام و احراز هویت", "حساب گره بسازید و احراز هویت را کامل کنید؛ سرویس‌ها فقط به حساب‌های احرازشده ارائه می‌شوند."], ["terminal", "کلید API و تست رایگان", "کلید را در پنل بسازید و با sandbox بدون هزینه برنامه‌تان را توسعه دهید."], ["rocket", "شارژ و استفاده واقعی", "کیف پول را شارژ کنید؛ هر استعلام موفق خودکار از موجودی کم می‌شود و در گزارش ثبت می‌شود."]].map(([ic, t, d], i) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
              <span className="text-xs text-white/45">قدم {["اول", "دوم", "سوم"][i]}</span>
              <Icon name={ic} size={22} className="acc mt-3" />
              <h3 className="font-extrabold mt-3">{t}</h3>
              <p className="text-white/60 text-sm leading-7 mt-1">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="امنیت و حریم خصوصی" sub="داده هویتی مسئولیت است؛ با آن همین‌طور رفتار می‌کنیم." />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[["eye-off", "بدون ذخیره پاسخ", "پاسخ استعلام ذخیره نمی‌شود؛ فقط چهار رقم آخر ورودی برای گزارش می‌ماند."], ["shield-check", "محدودیت IP", "رمز لورفته از IP دیگر کار نمی‌کند."], ["file-check", "تأیید کاربرد", "سرویس‌های حساس فقط پس از بررسی کاربرد فعال می‌شوند."], ["scroll-text", "گزارش کامل", "هر درخواست با کد پیگیری، زمان و هزینه در پنل."]].map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></li>
          ))}
        </ul>
      </section>

      <PaasFaq items={INQ_FAQ} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className={GLASS + " rounded-[2rem] p-8 sm:p-12 text-center"}>
          <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">امروز کلید بگیرید، امروز وصل شوید</h2>
          <p className="mt-4 text-white/65 leading-8">sandbox رایگان است؛ تا وقتی آماده نشده‌اید هزینه‌ای نمی‌دهید.</p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={"/panel/inquiry" as never} className={BTN_P + " h-12 px-7"}><Icon name="key-round" size={18} />دریافت کلید API</Link>
            <Link href="/contact" className={BTN_G + " h-12 px-6"}>حجم بالا؟ با فروش صحبت کنید</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
