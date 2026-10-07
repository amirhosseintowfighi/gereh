import Link from "next/link";
import { JsonLd } from "@/components/json-ld";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { BTN_G, GLASS_SOFT } from "@/lib/cls";
import { ORG_ID, pageMetaEn, SITE_URL } from "@/lib/seo";

export const metadata = pageMetaEn({ title: "About Gereh", description: "Gereh grew out of the Virgule design and engineering studio to give digital products fast, transparent and dependable infrastructure in Iran and Europe.", path: "/en/about", fa: "/about" });

const TIMELINE = [["2020", "One rack", "The first servers went live in Tehran for Virgule's own projects."], ["2022", "Public launch", "Gereh cloud servers opened to everyone, with NVMe on every plan."], ["2023", "Multi-path network", "Four upstream carriers and a backup datacenter in Isfahan."], ["2024", "Europe", "Frankfurt and Amsterdam locations for international businesses."]];

export default function EnAbout() {
  return (
    <>
      <JsonLd data={{ "@type": "AboutPage", name: "About Gereh", url: SITE_URL + "/en/about", inLanguage: "en", about: { "@id": ORG_ID } }} />
      <EnHeader active="/en/about" />
      <EnHero kicker="About us" title="We build infrastructure, not promises" sub="Gereh started inside a design and engineering studio, when we saw that the products we built deserved a better place to run." />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12">
        <section className="space-y-4 text-white/70 leading-8">
          <h2 className="text-2xl font-black text-white">Why Gereh</h2>
          <p>Gereh means knot in Persian: the point where threads hold together. We run our own hardware in Tehran and Isfahan, rent capacity in Frankfurt and Amsterdam, and put all of it behind one panel, one API and one invoice in Rials.</p>
          <p>Every plan uses NVMe storage, every incident is published on our status page, and the people answering your tickets are the engineers who run the servers.</p>
        </section>
        <section aria-labelledby="timeline">
          <h2 id="timeline" className="text-2xl font-black mb-6">Timeline</h2>
          <ol className="grid sm:grid-cols-2 gap-4">{TIMELINE.map(([y, t, d]) => <li key={y} className={GLASS_SOFT + " rounded-2xl p-5"}><div className="text-sm text-white/55 tabular">{y}</div><h3 className="font-extrabold mt-1">{t}</h3><p className="text-sm text-white/60 mt-1 leading-7">{d}</p></li>)}</ol>
        </section>
        <Link href="/contact" hrefLang="fa" className={BTN_G + " h-11 px-5"}>Contact us</Link>
      </div>
    </>
  );
}
