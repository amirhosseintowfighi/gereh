import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasFaq } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { GEO_FAQ, GEO_FEATURES, GEO_FOR, GEO_PROBLEMS } from "@/content/geo";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { SYNC_LABEL } from "@/lib/geo";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { publicGeoPlans } from "@/server/geo/public";

export const dynamic = "force-dynamic";
const DESC = "Geo DNS گره: بازدیدکننده ایرانی به سرور ایران، گوگل و کاربران خارج به سرور خارج. در قطعی اینترنت بین‌الملل سایت از گوگل حذف نمی‌شود و رتبه حفظ می‌شود. سوییچ خودکار و همگام‌سازی فایل و پایگاه داده.";
export const metadata = pageMeta({ title: "Geo DNS: حفظ رتبه گوگل در قطعی اینترنت", description: DESC, path: "/geo-dns" });

function Flow() {
  const node = (icon: string, title: string, sub: string, tone = "") => (
    <div className={"rounded-2xl px-4 py-3 border text-center " + (tone || "bg-white/[0.04] border-white/[0.1]")}>
      <Icon name={icon} size={20} className="acc mx-auto" />
      <b className="block text-sm mt-1.5">{title}</b><span className="block text-[11px] text-white/55 mt-0.5">{sub}</span>
    </div>
  );
  const arrow = <Icon name="arrow-down" size={18} className="mx-auto text-white/35 my-1.5" />;
  return (
    <div className={GLASS + " rounded-[1.75rem] p-5 sm:p-6"} role="img" aria-label="کاربر ایران به سرور ایران و گوگل و کاربر خارج به سرور خارج هدایت می‌شوند">
      <div className="grid grid-cols-2 gap-3 sm:gap-5">
        <div>{node("map-pin", "کاربر داخل ایران", "حتی در قطعی بین‌الملل")}{arrow}{node("server", "نام‌سرور گره (ایران)", "پاسخ: سرور ایران")}{arrow}{node("server", "سرور ایران", "سریع و داخلی", "bg-emerald-400/[0.08] border-emerald-300/30")}</div>
        <div>{node("globe", "گوگل و کاربر خارج", "Googlebot، ایرانیان خارج")}{arrow}{node("server", "نام‌سرور گره (خارج)", "پاسخ: سرور خارج")}{arrow}{node("server", "سرور خارج", "همگام با سرور ایران", "bg-sky-400/[0.08] border-sky-300/30")}</div>
      </div>
      <p className="text-[11px] text-white/55 text-center mt-4">یک دامنه، دو سرور، بدون تغییر در کد سایت</p>
    </div>
  );
}

export default async function GeoPage() {
  const plans = await publicGeoPlans();
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["Geo DNS", "/geo-dns"]]), ...(plans.length ? [offerLd("Geo DNS گره", DESC, plans.map((p) => p.price), "/geo-dns")] : []), faqLd(GEO_FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center hero-in">
          <div className="text-center lg:text-right">
            <nav aria-label="مسیر صفحه" className="flex items-center justify-center lg:justify-start gap-2 text-xs text-white/55">
              <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
              <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">Geo DNS</span>
            </nav>
            <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="radar" size={14} className="acc" />Geo DNS · دسترسی کاربران داخل + حفظ جایگاه در گوگل</p>
            <h1 className="hero-title mt-6 text-[2rem] sm:text-6xl font-black leading-[1.35] tracking-tight">قطعی اینترنت،<br />رتبه گوگل شما را نبرد</h1>
            <p className="mt-6 text-white/70 max-w-xl mx-auto lg:mx-0 leading-8 sm:text-lg">بازدیدکننده ایرانی به سرور ایران، گوگل و کاربران خارج به سرور خارج. وقتی اینترنت بین‌الملل قطع می‌شود، سایت شما برای هر دو طرف باز می‌ماند؛ همگام‌سازی فایل‌ها و پایگاه داده هم با ما.</p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href={"/panel/geo?new=1" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="radar" size={18} />فعال‌سازی برای دامنه من</Link>
              <a href="#plans" className={BTN_G + " h-13 px-7 py-3.5 text-base"}>پلن‌ها و قیمت</a>
            </div>
          </div>
          <Flow />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="در قطعی اینترنت بین‌الملل چه اتفاقی می‌افتد؟" sub="سایت روی هاست ایرانی برای کاربران داخل باز است، ولی دنیای بیرون آن را نمی‌بیند." />
        <ul className="grid md:grid-cols-3 gap-4">
          {GEO_PROBLEMS.map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6 flex gap-4"}>
              <Icon name={ic} size={22} className="text-amber-300 shrink-0 mt-1" />
              <div><h3 className="font-extrabold">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="راه‌حل گره: هر بازدیدکننده، نزدیک‌ترین سرور در دسترس" sub="بدون تغییر در کد سایت؛ فقط NS دامنه را عوض می‌کنید." />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {GEO_FEATURES.map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p></li>
          ))}
        </ul>
      </section>

      <section id="plans" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="پلن‌ها" sub="ماهانه از کیف پول؛ بدون قرارداد بلندمدت. هر پلن برای یک دامنه." />
        <ul className="grid lg:grid-cols-3 gap-4">
          {plans.map((p, i) => (
            <li key={p.id} className={GLASS + " rounded-[1.75rem] p-7 flex flex-col relative " + (i === 1 ? "ring-1 ring-sky-300/40" : "")}>
              {i === 1 && <span className="absolute -top-3 right-7 text-xs font-bold px-3 py-1 rounded-full acc-bg">پیشنهاد ما</span>}
              {i === 2 && <span className="absolute -top-3 right-7 text-xs font-bold px-3 py-1 rounded-full bg-emerald-400 text-black">بی‌دردسر</span>}
              <h3 className="text-xl font-black">{p.name}</h3>
              <p className="mt-4"><span className="text-3xl font-black tabular">{fa(p.price / 1000)}</span> <span className="text-sm text-white/60">هزار تومان / ماه</span></p>
              <ul className="mt-6 space-y-3 text-sm flex-1">
                {[`تفکیک ایران و خارج برای تا ${fa(p.records)} رکورد`, p.healthChecks ? "سوییچ خودکار هنگام قطعی یک سرور" : "بدون سوییچ خودکار", p.sync === "none" ? "سرور خارج و به‌روزرسانی آن با شما" : "راه‌اندازی سرور خارج توسط گره", p.sync !== "none" ? SYNC_LABEL[p.sync] + " به‌صورت خودکار" : "", "نام‌سرور داخل و خارج ایران", p.sync !== "none" ? "پشتیبانی اولویت‌دار" : "پشتیبانی تیکت"].filter(Boolean).map((f) => (
                  <li key={f} className="flex gap-2.5"><Icon name={f.startsWith("بدون") || f.endsWith("با شما") ? "minus" : "check"} size={16} className={(f.startsWith("بدون") || f.endsWith("با شما") ? "text-white/40" : "acc") + " shrink-0 mt-1"} /><span className="leading-7">{f}</span></li>
                ))}
              </ul>
              <Link href={"/panel/geo?new=1" as never} className={(i === 1 ? BTN_P : BTN_G) + " mt-7 h-12"}>{p.sync !== "none" ? "شروع با پلن مدیریت‌شده" : "انتخاب " + p.name}</Link>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-white/60 flex items-start gap-2"><Icon name="info" size={17} className="acc shrink-0 mt-0.5" />سرور خارج ندارید؟ <Link href="/vps" className="acc underline underline-offset-4">سرور ابری گره در فرانکفورت و آمستردام</Link> یا پلن مدیریت‌شده را انتخاب کنید.</p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="برای چه کسانی؟" />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {GEO_FOR.map(([t, d]) => <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><h3 className="font-extrabold">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p></li>)}
        </ul>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="راه‌اندازی در سه قدم" />
        <ol className="grid md:grid-cols-3 gap-4">
          {[["globe", "ثبت دامنه", "دامنه، IP سرور ایران و خارج را وارد کنید. رکوردهای فعلی را هم اضافه کنید."], ["network", "تغییر NS", "نام‌سرورهای دامنه را به گره بدهید؛ فعال شدن خودکار است."], ["refresh-cw", "همگام‌سازی", "در پلن مدیریت‌شده، سرور خارج و همگام‌سازی را ما راه می‌اندازیم."]].map(([ic, t, d], i) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><span className="text-xs text-white/45">قدم {["اول", "دوم", "سوم"][i]}</span><Icon name={ic} size={22} className="acc mt-3" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></li>
          ))}
        </ol>
        <p className="text-center mt-6"><Link href={"/docs/geo-dns" as never} className="acc underline underline-offset-4 text-sm">راهنمای کامل راه‌اندازی</Link></p>
      </section>

      <PaasFaq items={GEO_FAQ} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className={GLASS + " rounded-[2rem] p-8 sm:p-12 text-center"}>
          <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">پیش از قطعی بعدی آماده باشید</h2>
          <p className="mt-4 text-white/65 leading-8">راه‌اندازی کمتر از یک ساعت طول می‌کشد؛ بازگرداندن رتبه از دست رفته ماه‌ها.</p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={"/panel/geo?new=1" as never} className={BTN_P + " h-12 px-7"}><Icon name="radar" size={18} />فعال‌سازی Geo DNS</Link>
            <Link href="/contact" className={BTN_G + " h-12 px-6"}>مشاوره رایگان</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
