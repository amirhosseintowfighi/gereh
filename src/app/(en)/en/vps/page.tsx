import { JsonLd } from "@/components/json-ld";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { EnFaq, EnPlans, ORDER_NOTE } from "@/components/site/en-plans";
import { VPS } from "@/lib/catalog";
import { ORG_ID, pageMetaEn, SITE_URL } from "@/lib/seo";

export const metadata = pageMetaEn({ title: "NVMe cloud servers (VPS)", description: "Linux and Windows cloud servers on NVMe storage in Tehran, Isfahan, Frankfurt and Amsterdam. Ready in under a minute, hourly or monthly billing, snapshots, backups and an API.", path: "/en/vps", fa: "/vps" });

const ROWS: [string, "cpu" | "ram" | "disk" | "traffic" | "port" | "ipv4" | "snap" | "backup"][] = [["CPU", "cpu"], ["Memory", "ram"], ["Storage", "disk"], ["Traffic", "traffic"], ["Port", "port"], ["IPv4", "ipv4"], ["Snapshots", "snap"], ["Backups", "backup"]];
const FAQ: [string, string][] = [
  ["How fast is a server ready?", "Usually in under a minute after payment. Login details are emailed to you and shown in the panel."],
  ["Can I pay by the hour?", "Yes. Hourly servers are charged from your wallet every hour and can be deleted at any time."],
  ["Which operating systems are available?", "Ubuntu, Debian, AlmaLinux, Rocky Linux and Windows Server, plus one-click apps such as Docker and WordPress."],
  ["Can I upgrade later?", "Yes. Resize from the panel; you only pay the difference for the remaining days."],
];

export default function EnVps() {
  return (
    <>
      <JsonLd data={[{ "@type": "Product", name: "Gereh cloud server", description: metadata.description, brand: { "@id": ORG_ID }, url: SITE_URL + "/en/vps", offers: { "@type": "AggregateOffer", priceCurrency: "IRR", lowPrice: Math.min(...VPS.cloud.map((p) => p.price)) * 10, highPrice: Math.max(...VPS.metal.map((p) => p.price)) * 10, offerCount: VPS.cloud.length + VPS.metal.length } },
        { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }]} />
      <EnHeader active="/en/vps" />
      <EnHero kicker="Cloud servers" title="NVMe cloud servers, ready in a minute" sub="Pick a plan, a location and an operating system. Pay monthly, or by the hour for short-lived workloads." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-16">
        <section aria-labelledby="cloud"><h2 id="cloud" className="text-2xl font-black mb-6">Cloud plans</h2><EnPlans plans={VPS.cloud} rows={ROWS} order="/vps" /><p className="text-xs text-white/55 mt-4">{ORDER_NOTE}</p></section>
        <section aria-labelledby="metal"><h2 id="metal" className="text-2xl font-black mb-6">Dedicated servers</h2><EnPlans plans={VPS.metal} rows={ROWS.slice(0, 6)} order="/vps#dedicated" /></section>
        <section aria-labelledby="faq"><h2 id="faq" className="text-2xl font-black mb-6">FAQ</h2><EnFaq items={FAQ} /></section>
      </div>
    </>
  );
}
