import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasFaq } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { CopyText } from "@/components/ui-client";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { MIRROR_ECOSYSTEMS } from "@/lib/mirror";
import { breadcrumbLd, faqLd, pageMeta, SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";
const DESC = "میرور رایگان npm، PyPI، Docker Hub، Go، Maven، Ubuntu، Debian و Alpine در ایران: نصب بسته‌ها و بیلد پروژه‌ها حتی در اختلال اینترنت بین‌الملل، با سرعت شبکه داخلی.";
export const metadata = pageMeta({ title: "میرور مخازن npm، PyPI و Docker در ایران", description: DESC, path: "/mirror" });

const FAQ: [string, string][] = [
  ["استفاده از میرور هزینه دارد؟", "خیر. میرور برای همه آزاد است و نیازی به حساب کاربری ندارد. سرورها و اپ‌های گره به‌طور خودکار از آن استفاده می‌کنند."],
  ["اگر بسته‌ای در میرور نباشد چه می‌شود؟", "میرور بسته را همان لحظه از مخزن اصلی دریافت، ذخیره و تحویل می‌دهد؛ دفعه بعد از کش داخلی سرو می‌شود. در قطعی کامل اینترنت بین‌الملل فقط بسته‌هایی در دسترس‌اند که قبلاً یک بار دریافت شده باشند."],
  ["امن است؟ بسته‌ها تغییر داده نمی‌شوند؟", "میرور فقط کش است و بسته‌ها را دست‌نخورده تحویل می‌دهد؛ امضا و checksum بسته‌ها (lockfile، apt، go.sum) مثل قبل بررسی می‌شوند."],
  ["گیت‌هاب و Composer هم پشتیبانی می‌شود؟", "فعلاً خیر. برای Composer از mirror رسمی Packagist و برای گیت‌هاب از Gereh Apps با منبع ZIP استفاده کنید."],
];

export default function MirrorPage() {
  const base = (process.env.MIRROR_URL || "https://mirror.gereh.net").replace(/\/$/, "");
  const oneLiner = `curl -fsSL ${SITE_URL}/mirror/setup.sh | sudo sh`;
  return (
    <div className="fade-page pb-10 space-y-20">
      <JsonLd data={[breadcrumbLd([["میرور مخازن", "/mirror"]]), faqLd(FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 text-center hero-in">
          <nav aria-label="مسیر صفحه" className="flex items-center justify-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">میرور مخازن</span>
          </nav>
          <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="download" size={14} className="acc" />رایگان، بدون ثبت‌نام</p>
          <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35] tracking-tight">npm install<br />حتی وقتی اینترنت قطع است</h1>
          <p className="mt-6 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">میرور گره بسته‌های npm، PyPI، Docker Hub، Go، Maven و مخازن لینوکس را داخل ایران کش می‌کند تا نصب و بیلد پروژه‌ها سریع و بدون وابستگی به اینترنت بین‌الملل انجام شود.</p>
          <div className={GLASS + " rounded-2xl mt-9 p-4 text-left flex items-center gap-3 max-w-2xl mx-auto"} dir="ltr">
            <code className="text-[12px] sm:text-sm font-mono text-white/85 overflow-x-auto whitespace-nowrap flex-1">{oneLiner}</code>
            <CopyText text={oneLiner} className="text-[11px] shrink-0" />
          </div>
          <p className="text-xs text-white/50 mt-3">روی سرور لینوکسی شما apt، Docker، npm، pip و Go را یکجا به میرور وصل می‌کند.</p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="تنظیم برای هر ابزار" sub={"نشانی میرور: " + base} />
        <ul className="grid md:grid-cols-2 gap-4">
          {MIRROR_ECOSYSTEMS.map((e) => {
            const s = e.snippet(base);
            return (
              <li key={e.id} id={e.id} className={GLASS_SOFT + " rounded-[1.5rem] p-5 scroll-mt-24 min-w-0"}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-extrabold flex items-center gap-2"><Icon name={e.icon} size={18} className="acc" />{e.label}</h3>
                  <span className="text-[11px] text-white/45" dir="ltr">{e.upstream}</span>
                </div>
                {s.file && <p className="text-[11px] text-white/50 mt-2" dir="ltr" style={{ textAlign: "right" }}>{s.file}</p>}
                <div className="relative mt-3">
                  <pre dir="ltr" tabIndex={0} aria-label={"تنظیم " + e.label} className="text-left text-[12px] leading-6 font-mono bg-black/40 rounded-xl p-4 overflow-x-auto">{s.code}</pre>
                  <div className="absolute top-2 left-2"><CopyText text={s.code} className="text-[11px]" /></div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <ul className="grid sm:grid-cols-3 gap-4">
          {[["rocket", "گره اپ خودکار", "بیلد اپ‌ها در گره اپ ایمیج‌های پایه و بسته‌ها را از میرور می‌گیرد؛ تنظیمی لازم نیست."], ["server", "سرورهای ابری", "با یک دستور، سرور شما به میرور وصل می‌شود و apt update و docker pull سریع می‌شوند."], ["shield-check", "بدون تغییر بسته‌ها", "میرور فقط کش است؛ امضا و checksum بسته‌ها مثل همیشه بررسی می‌شوند."]].map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1">{d}</p></li>
          ))}
        </ul>
      </section>

      <PaasFaq items={FAQ} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className={GLASS + " rounded-[2rem] p-8 sm:p-12 text-center"}>
          <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">بیلد بدون دردسر، روی زیرساخت ایرانی</h2>
          <p className="mt-4 text-white/65 leading-8">اپ خود را در گره اپ مستقر کنید؛ بیلد از میرور داخلی انجام می‌شود.</p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/paas" className={BTN_P + " h-12 px-7"}><Icon name="rocket" size={18} />گره اپ</Link>
            <Link href="/vps" className={BTN_G + " h-12 px-6"}>سرور ابری</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
