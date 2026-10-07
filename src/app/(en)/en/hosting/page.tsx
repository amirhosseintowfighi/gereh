import { JsonLd } from "@/components/json-ld";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { EnFaq, EnPlans, ORDER_NOTE } from "@/components/site/en-plans";
import { HOSTING } from "@/lib/catalog";
import { ORG_ID, pageMetaEn, SITE_URL } from "@/lib/seo";

export const metadata = pageMetaEn({ title: "Web hosting and WordPress hosting", description: "cPanel and LiteSpeed web hosting on NVMe in Tehran with free SSL, daily backups, business email and optimised WordPress and WooCommerce plans.", path: "/en/hosting", fa: "/hosting" });

const ROWS: [string, "disk" | "sites" | "traffic" | "email" | "db"][] = [["Storage", "disk"], ["Websites", "sites"], ["Traffic", "traffic"], ["Email", "email"], ["Databases", "db"]];
const FAQ: [string, string][] = [
  ["What is the difference between WordPress and Linux hosting?", "Same infrastructure; WordPress plans add tuned PHP, Redis object cache and automatic core and plugin updates."],
  ["Is SSL included?", "Yes. A free Let's Encrypt certificate is issued automatically once your domain points to the hosting."],
  ["Where is the hosting located?", "All hosting runs in our Tehran datacenter, with backups kept in Isfahan."],
];

export default function EnHosting() {
  const all = [...HOSTING.linux, ...HOSTING.wordpress];
  return (
    <>
      <JsonLd data={[{ "@type": "Product", name: "Gereh web hosting", description: metadata.description, brand: { "@id": ORG_ID }, url: SITE_URL + "/en/hosting", offers: { "@type": "AggregateOffer", priceCurrency: "IRR", lowPrice: Math.min(...all.map((p) => p.price)) * 10, highPrice: Math.max(...all.map((p) => p.price)) * 10, offerCount: all.length } },
        { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }]} />
      <EnHeader active="/en/hosting" />
      <EnHero kicker="Web hosting" title="Hosting that keeps your site fast" sub="LiteSpeed web server, NVMe storage and cPanel, with free SSL and daily backups on every plan." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-16">
        <section aria-labelledby="linux"><h2 id="linux" className="text-2xl font-black mb-6">Linux hosting</h2><EnPlans plans={HOSTING.linux} rows={ROWS} order="/hosting" /><p className="text-xs text-white/55 mt-4">{ORDER_NOTE}</p></section>
        <section aria-labelledby="wp"><h2 id="wp" className="text-2xl font-black mb-6">WordPress hosting</h2><EnPlans plans={HOSTING.wordpress} rows={ROWS} order="/hosting" /></section>
        <section aria-labelledby="faq"><h2 id="faq" className="text-2xl font-black mb-6">FAQ</h2><EnFaq items={FAQ} /></section>
      </div>
    </>
  );
}
