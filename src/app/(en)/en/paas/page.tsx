import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { EnFaq, ORDER_NOTE } from "@/components/site/en-plans";
import { tomanEn } from "@/content/en";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { DB_ENGINES, DISK_PRICE_GB, hourlyOf, STACKS } from "@/lib/paas";
import { ORG_ID, pageMetaEn, SITE_URL } from "@/lib/seo";
import { publicPlans } from "@/server/paas/public";

export const dynamic = "force-dynamic";
export const metadata = pageMetaEn({ title: "Gereh Apps: deploy apps without managing servers (PaaS)", description: "Deploy Node.js, Next.js, Python, Django, Laravel, Go, Java and Docker apps from Git or a ZIP in minutes, with automatic SSL, custom domains, managed PostgreSQL, MySQL, MongoDB and Redis, autoscaling and hourly billing in Tehran.", path: "/en/paas", fa: "/paas" });

const FEATURES: [string, string, string][] = [
  ["code-xml", "Deploy on git push", "Connect GitHub, GitLab or Gitea; every push to your branch builds and rolls out with zero downtime."],
  ["upload", "ZIP, Docker or Compose", "No repository? Upload a ZIP, point to an image or send a docker-compose.yml."],
  ["sparkles", "Automatic builds", "Node, Python, PHP, Go, Java, .NET and Ruby are detected and built without a Dockerfile."],
  ["shield-check", "SSL and custom domains", "Every app gets HTTPS on day one; add your domain with one CNAME record."],
  ["database", "Managed databases", "PostgreSQL, MySQL, MariaDB, MongoDB and Redis with daily backups, linked to apps in one click."],
  ["gauge", "Horizontal and autoscaling", "Add instances in one click or scale automatically on CPU load."],
  ["refresh-cw", "Health-checked rollouts", "A new version only takes traffic once its health check passes; roll back to any release instantly."],
  ["terminal", "Live logs and metrics", "Stream build and runtime logs; chart CPU, memory and requests."],
  ["key-round", "CLI and API", "Deploy from your terminal or CI with npx @gereh/cli deploy, or use the REST API."],
];
const FAQ: [string, string][] = [
  ["How is billing calculated?", "Each plan has a monthly price; every hour 1/720 of it is charged to your wallet while the app runs. A stopped app only pays for its persistent disk."],
  ["What happens when my wallet runs out?", "Services are suspended, not deleted. Topping up resumes them automatically."],
  ["Do I need a Dockerfile?", "No. Common stacks build automatically; a Dockerfile in the project root is used when present."],
  ["Where does my app run?", "In our Tehran datacenter; backups are stored separately inside Iran."],
];

export default async function EnPaas() {
  const plans = await publicPlans();
  const apps = plans.filter((p) => p.kind === "app" && p.active);
  const dbs = plans.filter((p) => p.kind === "db" && p.active);
  return (
    <>
      <JsonLd data={[{ "@type": "Product", name: "Gereh Apps", description: metadata.description, url: SITE_URL + "/en/paas", brand: { "@id": ORG_ID }, ...(apps.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "IRR", lowPrice: Math.min(...apps.map((p) => p.price)) * 10, highPrice: Math.max(...apps.map((p) => p.price)) * 10, offerCount: apps.length } } : {}) },
        { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }]} />
      <EnHeader active="/en/paas" />
      <EnHero kicker="Gereh Apps · Platform as a Service" title="Ship code, we run it" sub="Git, ZIP or Docker image in; a running HTTPS app out. Builds, SSL, domains, databases and scaling are handled for you, billed by the hour." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-16">
        <div className="flex flex-wrap justify-center gap-3 -mt-2">
          <Link href={"/panel/apps/new" as never} hrefLang="fa" className={BTN_P + " h-12 px-6"}>Create an app</Link>
          <a href="#pricing" className={BTN_G + " h-12 px-6"}>Pricing</a>
        </div>
        <section aria-labelledby="features">
          <h2 id="features" className="text-2xl font-black mb-6">Everything production needs</h2>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(([ic, t, d]) => <li key={t} className={GLASS_SOFT + " rounded-2xl p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-4">{t}</h3><p className="text-sm text-white/60 mt-2 leading-7">{d}</p></li>)}
          </ul>
        </section>
        <section aria-labelledby="stacks">
          <h2 id="stacks" className="text-2xl font-black mb-6">Supported stacks</h2>
          <ul className="flex flex-wrap gap-2">{STACKS.map((s) => <li key={s.id} className={GLASS_SOFT + " rounded-xl px-4 py-2 text-sm"}>{s.label === "سایت استاتیک" ? "Static site" : s.label}</li>)}</ul>
        </section>
        <section id="pricing" aria-labelledby="pr" className="scroll-mt-24">
          <h2 id="pr" className="text-2xl font-black mb-2">Pricing</h2>
          <p className="text-sm text-white/60 mb-6">Per instance, billed hourly from your wallet. Persistent disk: {tomanEn(DISK_PRICE_GB)} per GB per month. SSL, domains and traffic included.</p>
          <div className="grid lg:grid-cols-2 gap-4">
            {([["Apps", apps], ["Databases", dbs]] as const).map(([title, list]) => (
              <div key={title} className={GLASS + " rounded-2xl overflow-hidden"}>
                <h3 className="font-black px-5 pt-5">{title}</h3>
                <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={title + " pricing"}>
                  <table className="w-full text-sm mt-3"><thead><tr className="text-white/55 text-xs text-left"><th className="p-3 pl-5">Plan</th><th className="p-3">vCPU</th><th className="p-3">RAM</th>{title === "Databases" && <th className="p-3">Disk</th>}<th className="p-3">Hourly</th><th className="p-3">Monthly</th></tr></thead>
                    <tbody>{list.map((p) => <tr key={p.id} className="border-t border-white/[0.06]"><td className="p-3 pl-5 font-bold">{p.id.split("-")[1].replace(/^./, (c) => c.toUpperCase())}</td><td className="p-3">{p.cpu}</td><td className="p-3">{p.ramMb >= 1024 ? p.ramMb / 1024 + " GB" : p.ramMb + " MB"}</td>{title === "Databases" && <td className="p-3">{p.diskGb} GB</td>}<td className="p-3 tabular">{tomanEn(hourlyOf(p.price))}</td><td className="p-3 tabular font-bold">{tomanEn(p.price)}</td></tr>)}</tbody></table>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/50 mt-3">Database engines: {DB_ENGINES.map((e) => e.label + " " + e.versions.join("/")).join(", ")}.</p>
        </section>
        <section aria-labelledby="faq"><h2 id="faq" className="text-2xl font-black mb-6">FAQ</h2><EnFaq items={FAQ} /></section>
        <p className="text-sm text-white/60">{ORDER_NOTE}</p>
      </div>
    </>
  );
}
