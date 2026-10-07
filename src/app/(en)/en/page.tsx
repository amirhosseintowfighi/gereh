import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { LOC_EN, tomanEn } from "@/content/en";
import { HOSTING, LOCS, TLDS, VPS } from "@/lib/catalog";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { ORG_ID, pageMetaEn, SITE_URL } from "@/lib/seo";

export const metadata = pageMetaEn({ title: "Cloud servers, web hosting and domains in Iran", description: "Gereh Cloud runs NVMe cloud servers, dedicated servers, web hosting and domain registration from Tehran, Isfahan, Frankfurt and Amsterdam, with Rial payments and 24/7 support.", path: "/en", fa: "/" });

const min = (xs: { price: number }[]) => Math.min(...xs.map((x) => x.price));
const PRODUCTS = [
  ["server", "Cloud servers", "NVMe disks, ready in under a minute, hourly or monthly billing.", "/en/vps", min(VPS.cloud)],
  ["layers", "Web hosting", "cPanel and LiteSpeed hosting for WordPress and PHP sites.", "/en/hosting", min([...HOSTING.linux, ...HOSTING.wordpress])],
  ["globe", "Domains", ".ir and 15 international extensions with free DNS management.", "/en/domains", min(TLDS.map((t) => ({ price: t.reg })))],
] as const;
const WHY = [
  ["gauge", "NVMe everywhere", "Even the smallest plan runs on NVMe storage with a 1 Gbps port."],
  ["code-xml", "API and Terraform", "A REST API, OpenAPI spec and an official Terraform provider."],
  ["users-round", "Team access", "Invite colleagues with admin, technical or billing roles."],
  ["activity", "Public status page", "Live component health, 90-day uptime and incident history."],
];

export default function EnHome() {
  return (
    <>
      <JsonLd data={{ "@type": "WebPage", name: "Gereh Cloud", url: SITE_URL + "/en", inLanguage: "en", about: { "@id": ORG_ID } }} />
      <EnHeader />
      <EnHero kicker="Gereh Cloud" title="Fast cloud infrastructure for teams in Iran and beyond" sub="Cloud and dedicated servers, web hosting and domains, all in one panel with Rial payments, an API and round-the-clock engineers." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-20">
        <div className="flex flex-wrap justify-center gap-3 -mt-2">
          <Link href="/en/vps" className={BTN_P + " h-12 px-6"}>See cloud servers</Link>
          <Link href="/en/about" className={BTN_G + " h-12 px-6"}>About Gereh</Link>
        </div>
        <section aria-labelledby="products" className="grid md:grid-cols-3 gap-4">
          <h2 id="products" className="sr-only">Products</h2>
          {PRODUCTS.map(([icon, title, text, href, from]) => (
            <Link key={href} href={href as never} className={GLASS + " rounded-2xl p-6 hover:bg-white/[0.08] transition"}>
              <Icon name={icon} size={24} className="acc" />
              <h3 className="mt-4 text-lg font-extrabold">{title}</h3>
              <p className="mt-2 text-sm text-white/60 leading-7">{text}</p>
              <p className="mt-4 text-sm">from <b className="tabular">{tomanEn(from)}</b></p>
            </Link>
          ))}
        </section>
        <section aria-labelledby="locations">
          <h2 id="locations" className="text-2xl sm:text-3xl font-black text-center">Four locations, one panel</h2>
          <ul className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {LOCS.map((l) => (
              <li key={l.id} className={GLASS_SOFT + " rounded-2xl p-5"}>
                <div className="font-extrabold">{LOC_EN[l.id][0]}</div><div className="text-xs text-white/55">{LOC_EN[l.id][1]}</div>
                <div className="mt-4 text-sm text-white/70 tabular">{l.up}% uptime · {l.ping} ms from Tehran</div>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="why">
          <h2 id="why" className="text-2xl sm:text-3xl font-black text-center">Built for developers</h2>
          <ul className="mt-8 grid sm:grid-cols-2 gap-4">
            {WHY.map(([icon, t, d]) => <li key={t} className={GLASS_SOFT + " rounded-2xl p-6 flex gap-4"}><Icon name={icon} size={22} className="acc shrink-0 mt-1" /><div><h3 className="font-extrabold">{t}</h3><p className="text-sm text-white/60 mt-1 leading-7">{d}</p></div></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}
