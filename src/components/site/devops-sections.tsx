import Link from "next/link";
import { DEVOPS_ONEOFF, DEVOPS_PACKAGES, DEVOPS_PROCESS, DEVOPS_SERVICES, DEVOPS_SLA, DEVOPS_STACK, DEVOPS_TRUST } from "@/content/devops";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { ORG_ID, SITE_URL } from "@/lib/seo";
import { Icon } from "../icon";
import { SectionHead } from "../ui";
import { DevopsRequestForm } from "./devops-form";

export function DevopsServicesGrid({ exclude }: { exclude?: string }) {
  return (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {DEVOPS_SERVICES.filter((s) => s.slug !== exclude).map((s) => (
        <li key={s.slug}>
          <Link href={("/devops/" + s.slug) as never} className={"spot group h-full rounded-[1.5rem] p-6 flex flex-col hover:border-white/25 transition-colors " + GLASS_SOFT}>
            <span className="w-11 h-11 rounded-xl grid place-items-center bg-white/[0.08] border border-white/15 acc group-hover:scale-110 transition-transform duration-300"><Icon name={s.icon} size={21} /></span>
            <h3 className="font-extrabold mt-5">{s.title}</h3>
            <p className="text-white/60 text-sm leading-7 mt-2 flex-1">{s.short}</p>
            <span className="mt-4 text-sm acc inline-flex items-center gap-1">جزئیات <Icon name="chevron-left" size={14} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DevopsProcess() {
  return (
    <section id="process" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="همکاری چطور پیش می‌رود" sub="از اولین گفتگو تا تحویل؛ شفاف، مکتوب و قدم‌به‌قدم." />
      <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {DEVOPS_PROCESS.map(([icon, t, d], i) => (
          <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6 relative"}>
            <span className="absolute top-5 left-5 text-4xl font-black text-white/[0.07] tabular" aria-hidden="true">{fa(i + 1)}</span>
            <Icon name={icon} size={22} className="acc" />
            <h3 className="font-extrabold mt-4"><span className="sr-only">گام {fa(i + 1)}: </span>{t}</h3>
            <p className="text-white/60 text-sm leading-7 mt-2">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DevopsPricing() {
  return (
    <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="بسته‌های همکاری" sub="قرارداد ماهانه بدون حداقل مدت؛ با یک ماه اطلاع قبلی قابل لغو. مبالغ بدون مالیات بر ارزش افزوده است." />
      <ul className="grid lg:grid-cols-3 gap-4">
        {DEVOPS_PACKAGES.map((p) => (
          <li key={p.id} className={GLASS + " rounded-[1.75rem] p-7 flex flex-col relative " + (p.highlight ? "ring-1 ring-sky-300/40" : "")}>
            {p.highlight && <span className="absolute -top-3 right-7 text-xs font-bold px-3 py-1 rounded-full acc-bg">پیشنهاد ما</span>}
            <h3 className="text-xl font-black">{p.name}</h3>
            <p className="text-sm text-white/55 mt-1">{p.for}</p>
            <p className="mt-6">{p.price ? <><span className="text-3xl font-black tabular">{fa(p.price / 1e6)}</span> <span className="text-sm text-white/60">میلیون {p.unit}</span></> : <span className="text-2xl font-black">{p.unit}</span>}</p>
            <ul className="mt-6 space-y-3 text-sm flex-1">
              {p.features.map((f) => <li key={f} className="flex gap-2.5"><Icon name="check" size={16} className="acc shrink-0 mt-1" /><span className="leading-7">{f}</span></li>)}
            </ul>
            <a href={"#request"} className={(p.highlight ? BTN_P : BTN_G) + " mt-7 h-12"}>{p.cta}</a>
          </li>
        ))}
      </ul>
      <ul className="mt-4 grid md:grid-cols-3 gap-4">
        {DEVOPS_ONEOFF.map((o) => (
          <li key={o.id} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
            <div className="flex items-center justify-between gap-3"><h3 className="font-extrabold flex items-center gap-2"><Icon name={o.icon} size={18} className="acc" />{o.name}</h3><span className="text-sm font-bold tabular shrink-0">{o.price ? toman(o.price) : "قیمت ثابت پس از ارزیابی"}</span></div>
            <p className="text-sm text-white/60 leading-7 mt-3">{o.desc}</p>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-sm text-white/60 flex items-start gap-2"><Icon name="badge-percent" size={17} className="acc shrink-0 mt-0.5" />اگر زیرساختتان روی سرورهای گره باشد، ۱۰ درصد تخفیف خدمات دواپس می‌گیرید. روی هر زیرساخت دیگری هم کار می‌کنیم.</p>
    </section>
  );
}

export function DevopsSla() {
  return (
    <section id="sla" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="توافق سطح خدمات" sub="زمان اولین پاسخ مهندس، بر اساس شدت مشکل. نقض SLA در حادثه بحرانی، اعتبار در صورتحساب بعدی دارد." />
      <div className={GLASS + " rounded-2xl overflow-x-auto"} tabIndex={0} role="region" aria-label="جدول توافق سطح خدمات">
        <table className="w-full text-sm min-w-[680px]">
          <caption className="sr-only">زمان اولین پاسخ بر اساس شدت مشکل و بسته</caption>
          <thead><tr className="bg-white/[0.04]"><th scope="col" className="text-right p-4">شدت</th>{DEVOPS_PACKAGES.map((p) => <th key={p.id} scope="col" className="text-right p-4">{p.name}</th>)}</tr></thead>
          <tbody>{DEVOPS_SLA.map((r) => (
            <tr key={r.sev} className="border-t border-white/[0.06]">
              <th scope="row" className="text-right p-4 align-top"><span className="font-bold block">{r.sev}</span><span className="text-xs text-white/55 font-normal">{r.desc}</span></th>
              <td className="p-4 align-top">{r.startup}</td><td className="p-4 align-top">{r.growth}</td><td className="p-4 align-top">{r.enterprise}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export function DevopsTrust() {
  return (
    <section id="trust" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="امنیت و اعتماد، قبل از هر چیز" sub="به زیرساخت شما دسترسی پیدا می‌کنیم؛ این تعهدهای ما در هر قرارداد است." />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {DEVOPS_TRUST.map(([icon, t, d]) => (
          <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
            <Icon name={icon} size={22} className="acc" />
            <h3 className="font-extrabold mt-4 leading-7">{t}</h3>
            <p className="text-white/60 text-sm leading-7 mt-2">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DevopsStack() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6">
      <SectionHead title="ابزارهایی که با آن‌ها کار می‌کنیم" sub="ابزار را بر اساس نیاز شما انتخاب می‌کنیم، نه سلیقه خودمان؛ ترجیحاً متن‌باز و بدون قفل." />
      <dl className={GLASS_SOFT + " rounded-[1.5rem] p-6 sm:p-8 grid sm:grid-cols-2 gap-x-10 gap-y-6"}>
        {DEVOPS_STACK.map(([group, items]) => (
          <div key={group}>
            <dt className="text-sm text-white/55 mb-2">{group}</dt>
            <dd className="flex flex-wrap gap-1.5" dir="ltr">{items.map((i) => <span key={i} className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08]">{i}</span>)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DevopsFaq({ items }: { items: [string, string][] }) {
  return (
    <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="پرسش‌های رایج" />
      <div className="space-y-3">{items.map(([q, a]) => (
        <details key={q} className={GLASS_SOFT + " rounded-2xl p-5 group"}>
          <summary className="font-bold cursor-pointer list-none flex justify-between gap-3">{q}<Icon name="chevron-down" size={18} className="group-open:rotate-180 transition shrink-0" /></summary>
          <p className="mt-3 text-white/70 leading-8 text-sm">{a}</p>
        </details>
      ))}</div>
    </section>
  );
}

export function DevopsRequest({ preset, source, title = "جلسه آشنایی رایگان رزرو کنید" }: { preset?: string; source: string; title?: string }) {
  return (
    <section id="request" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <div className="grid lg:grid-cols-[1fr_2fr] gap-6 items-start">
        <div className="lg:sticky lg:top-28">
          <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">{title}</h2>
          <p className="mt-4 text-white/65 leading-8">چند سؤال کوتاه تا قبل از جلسه، وضعیت شما را بشناسیم و وقت هیچ‌کس هدر نرود.</p>
          <ul className="mt-6 space-y-3 text-sm text-white/70">
            {[["clock", "پاسخ ظرف یک روز کاری؛ موارد فوری همان روز"], ["file-check", "امضای NDA پیش از جلسه، در صورت نیاز"], ["shield-check", "بدون نیاز به ارسال رمز یا دسترسی"], ["phone", "یا مستقیم تماس بگیرید: ۰۲۱-۹۱۰۰۰۰۰۰"]].map(([ic, t]) => <li key={t} className="flex gap-2.5"><Icon name={ic} size={17} className="acc shrink-0 mt-0.5" />{t}</li>)}
          </ul>
        </div>
        <div className={GLASS + " rounded-[1.75rem] p-6 sm:p-8 relative"}><DevopsRequestForm preset={preset} source={source} /></div>
      </div>
    </section>
  );
}

/** schema.org Service with the packages as an offer catalogue */
export const devopsServiceLd = (name: string, description: string, path: string, serviceType: string) => ({
  "@type": "Service",
  name, description, serviceType,
  url: SITE_URL + path,
  provider: { "@id": ORG_ID },
  areaServed: [{ "@type": "Country", name: "Iran" }],
  availableLanguage: ["fa", "en"],
  hasOfferCatalog: {
    "@type": "OfferCatalog", name: "بسته‌های دواپس گره",
    itemListElement: [
      ...DEVOPS_PACKAGES.filter((p) => p.price).map((p) => ({ "@type": "Offer", name: "بسته " + p.name, price: p.price! * 10, priceCurrency: "IRR", priceSpecification: { "@type": "UnitPriceSpecification", price: p.price! * 10, priceCurrency: "IRR", unitText: "MONTH" } })),
      ...DEVOPS_ONEOFF.filter((o) => o.price).map((o) => ({ "@type": "Offer", name: o.name, price: o.price! * 10, priceCurrency: "IRR" })),
    ],
  },
});
