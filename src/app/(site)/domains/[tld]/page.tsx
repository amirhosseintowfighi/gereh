import { asc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { TldSearch } from "@/components/site/tld-search";
import { TLD_INFO, tldSlug } from "@/content/tlds";
import { TLDS, type Tld } from "@/lib/catalog";
import { GLASS, GLASS_SOFT } from "@/lib/cls";
import { toman } from "@/lib/format";
import { breadcrumbLd, faqLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";
import { db } from "@/server/ctx";
import { tlds } from "@/server/db/schema";

// live prices from the admin catalogue
export const dynamic = "force-dynamic";

const prices = cache(async (): Promise<Tld[]> => {
  try {
    const rows = await (await db()).select().from(tlds).orderBy(asc(tlds.position));
    return rows.length ? rows.map((r) => ({ tld: r.tld, reg: r.reg, renew: r.renew, transfer: r.transfer, cat: r.cat, hot: r.hot, promo: r.promo })) : TLDS;
  } catch { return TLDS; }
});
const find = async (slug: string) => {
  const tld = "." + decodeURIComponent(slug).toLowerCase();
  const p = (await prices()).find((t) => t.tld === tld);
  return p && TLD_INFO[tld] ? { p, info: TLD_INFO[tld] } : null;
};

export async function generateMetadata({ params }: PageProps<"/domains/[tld]">) {
  const f = await find((await params).tld);
  if (!f) return { title: "پسوند پیدا نشد", robots: { index: false } };
  return pageMeta({ title: `ثبت دامنه ${f.p.tld} از ${toman(f.p.reg)}`, description: `ثبت آنی دامنه ${f.p.tld} در گره؛ ${f.info.who}. ثبت ${toman(f.p.reg)}، تمدید ${toman(f.p.renew)}، مدیریت DNS رایگان و پشتیبانی شبانه‌روزی.`, path: "/domains/" + tldSlug(f.p.tld) });
}

export default async function TldPage({ params }: PageProps<"/domains/[tld]">) {
  const f = await find((await params).tld);
  if (!f) notFound();
  const { p, info } = f;
  const path = "/domains/" + tldSlug(p.tld);
  const faq: [string, string][] = [
    [`هزینه ثبت و تمدید دامنه ${p.tld} چقدر است؟`, `ثبت سال اول ${toman(p.reg)} و تمدید سالانه ${toman(p.renew)} است؛ مالیات بر ارزش افزوده جداگانه محاسبه می‌شود.`],
    ...info.faq,
    [`چطور دامنه ${p.tld} را به گره منتقل کنم؟`, p.transfer ? `کد انتقال (EPP) را از ثبت‌کننده فعلی بگیرید و در صفحه دامنه وارد کنید؛ هزینه انتقال ${toman(p.transfer)} است و یک سال به اعتبار دامنه اضافه می‌شود.` : "انتقال دامنه‌های ملی بین نمایندگان ایرنیک رایگان است؛ کافی است در پنل ایرنیک گره را به‌عنوان نماینده انتخاب کنید."],
  ];
  const others = (await prices()).filter((t) => t.tld !== p.tld && TLD_INFO[t.tld]).slice(0, 8);
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[
        breadcrumbLd([["دامنه", "/domains"], [p.tld, path]]),
        { "@type": "Product", name: "ثبت دامنه " + p.tld, description: info.about, brand: { "@id": ORG_ID }, url: SITE_URL + path, offers: { "@type": "Offer", price: p.reg * 10, priceCurrency: "IRR", availability: "https://schema.org/InStock", url: SITE_URL + path } },
        faqLd(faq),
      ]} />
      <PageHeader icon="globe" crumb={"دامنه " + p.tld} title={"ثبت دامنه " + p.tld} sub={"مناسب " + info.who + "؛ ثبت در چند ثانیه با DNS رایگان."} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-12">
        <TldSearch tld={p.tld} />
        <section aria-label="قیمت" className="grid sm:grid-cols-3 gap-4">
          {([["ثبت", p.reg, p.promo ? "قیمت ویژه سال اول" : "سال اول"], ["تمدید", p.renew, "سالانه"], ["انتقال", p.transfer, p.transfer ? "با یک سال تمدید" : "رایگان"]] as const).map(([l, v, s]) => (
            <div key={l} className={GLASS + " rounded-2xl p-6 text-center"}>
              <div className="text-sm text-white/60">{l}</div>
              <div className="mt-2 text-2xl font-black tabular">{v ? toman(v) : "رایگان"}</div>
              <div className="text-xs text-white/55 mt-1">{s}</div>
            </div>
          ))}
        </section>
        <section className="grid md:grid-cols-[1.4fr_1fr] gap-6">
          <div><h2 className="text-xl font-black">درباره پسوند {p.tld}</h2><p className="mt-3 text-white/70 leading-8">{info.about}</p></div>
          <ul className={GLASS_SOFT + " rounded-2xl p-5 space-y-3 text-sm"}>
            {info.rules.map((r) => <li key={r} className="flex gap-2"><Icon name="check" size={16} className="acc shrink-0 mt-1" /><span className="leading-7">{r}</span></li>)}
          </ul>
        </section>
        <section>
          <h2 className="text-xl font-black mb-4">پرسش‌های رایج</h2>
          <div className="space-y-3">{faq.map(([q, a]) => <details key={q} className={GLASS_SOFT + " rounded-2xl p-5 group"}><summary className="font-bold cursor-pointer list-none flex justify-between gap-3">{q}<Icon name="chevron-down" size={18} className="group-open:rotate-180 transition shrink-0" /></summary><p className="mt-3 text-white/70 leading-8 text-sm">{a}</p></details>)}</div>
        </section>
        <nav aria-label="پسوندهای دیگر">
          <h2 className="text-xl font-black mb-4">پسوندهای دیگر</h2>
          <ul className="flex flex-wrap gap-2">{others.map((t) => <li key={t.tld}><Link href={("/domains/" + tldSlug(t.tld)) as never} className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-white/[0.04] border border-white/[0.1] hover:bg-white/[0.08] text-sm"><b dir="ltr">{t.tld}</b><span className="text-white/55 text-xs">{toman(t.reg)}</span></Link></li>)}</ul>
        </nav>
      </div>
    </div>
  );
}
