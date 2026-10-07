import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { EnFaq } from "@/components/site/en-plans";
import { tomanEn } from "@/content/en";
import { DEVOPS_PACKAGES, DEVOPS_SERVICES } from "@/content/devops";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { ORG_ID, pageMetaEn, SITE_URL } from "@/lib/seo";

export const metadata = pageMetaEn({ title: "DevOps services for companies and startups", description: "Gereh's DevOps team builds, automates and runs your infrastructure: CI/CD, Kubernetes, Terraform, monitoring, security, migrations and 24/7 on-call with an SLA, on any provider or on-premise.", path: "/en/devops", fa: "/devops" });

const SERVICES_EN: Record<string, [string, string]> = {
  "ci-cd": ["CI/CD and automated deployment", "From every commit to production: built, tested and reversible."],
  kubernetes: ["Kubernetes and containers", "Self-healing, autoscaling clusters without needless complexity."],
  "infrastructure-as-code": ["Infrastructure as code", "Terraform and Ansible: reviewable, repeatable, documented."],
  monitoring: ["Monitoring and observability", "Prometheus, Grafana and Loki, with alerts that matter."],
  devsecops: ["Security and DevSecOps", "Hardening, secret management and scanning in the pipeline."],
  "cloud-migration": ["Cloud migration", "Move services and data with minimal or zero downtime."],
  "managed-devops": ["Managed DevOps and SRE", "A full DevOps team with 24/7 incident response."],
  "cost-optimization": ["Cost optimisation", "The same performance for a smaller bill."],
  "database-ops": ["Database operations", "Replication, point-in-time recovery and tuning."],
  "backup-dr": ["Backup and disaster recovery", "Tested recovery with defined RPO and RTO."],
};
const PKG_EN: Record<string, [string, string[]]> = {
  startup: ["Startup", ["Up to 10 servers or nodes", "20 engineering hours a month", "CI/CD, monitoring and backups", "Business-hours response", "Monthly report"]],
  growth: ["Growth", ["Up to 30 servers or nodes", "50 engineering hours a month", "Kubernetes and database management", "24/7 response to critical incidents", "Quarterly recovery drill"]],
  enterprise: ["Enterprise", ["No server limit", "Dedicated engineer", "15-minute critical response", "On-premise and compliance work", "Custom contract and SLA"]],
};
const TRUST = ["An NDA is signed before any access", "Named, least-privilege, time-limited accounts with MFA", "Secrets only move through a secrets manager", "Every change goes through code review and is logged", "You own all code, docs and accounts; no lock-in", "Your data stays in your infrastructure", "Clean offboarding: access removed and secrets rotated"];
const FAQ: [string, string][] = [
  ["Do you only work on Gereh infrastructure?", "No. We work with any cloud provider, dedicated servers or your own datacenter. Infrastructure hosted on Gereh gets a 10% discount on DevOps services."],
  ["Is there a minimum contract term?", "No. Monthly contracts can be cancelled with one month's notice."],
  ["What happens if you miss the SLA?", "Each missed critical-incident response earns a 10% credit on that month's fee, up to 30%."],
  ["Can we work in English?", "Yes. Meetings, documentation and support are available in English; invoices are issued in Rials."],
];

export default function EnDevops() {
  return (
    <>
      <JsonLd data={[{ "@type": "Service", name: "Gereh DevOps services", serviceType: "DevOps consulting and managed infrastructure", description: metadata.description, url: SITE_URL + "/en/devops", provider: { "@id": ORG_ID }, areaServed: { "@type": "Country", name: "Iran" }, availableLanguage: ["en", "fa"] },
        { "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }]} />
      <EnHeader active="/en/devops" />
      <EnHero kicker="DevOps services" title="Your DevOps team, without the hiring" sub="We build, automate and run your infrastructure around the clock, so your team can focus on the product. On Gereh, any other provider or your own servers." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-16">
        <div className="flex flex-wrap justify-center gap-3 -mt-2">
          <Link href="/devops#request" hrefLang="fa" className={BTN_P + " h-12 px-6"}>Book a free intro call</Link>
          <a href="#packages" className={BTN_G + " h-12 px-6"}>Packages</a>
        </div>
        <section aria-labelledby="services">
          <h2 id="services" className="text-2xl font-black mb-6">What we do</h2>
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {DEVOPS_SERVICES.map((s) => (
              <li key={s.slug} className={GLASS_SOFT + " rounded-2xl p-6"}>
                <Icon name={s.icon} size={22} className="acc" />
                <h3 className="font-extrabold mt-4">{SERVICES_EN[s.slug][0]}</h3>
                <p className="text-sm text-white/60 mt-2 leading-7">{SERVICES_EN[s.slug][1]}</p>
              </li>
            ))}
          </ul>
        </section>
        <section id="packages" aria-labelledby="pk" className="scroll-mt-24">
          <h2 id="pk" className="text-2xl font-black mb-2">Packages</h2>
          <p className="text-sm text-white/60 mb-6">Monthly, no minimum term. Prices exclude VAT. One-off infrastructure audit: {tomanEn(18_000_000)}.</p>
          <ul className="grid lg:grid-cols-3 gap-4">
            {DEVOPS_PACKAGES.map((p) => (
              <li key={p.id} className={GLASS + " rounded-2xl p-6 " + (p.highlight ? "ring-1 ring-sky-300/40" : "")}>
                <h3 className="text-lg font-black">{PKG_EN[p.id][0]}</h3>
                <p className="mt-3 text-2xl font-black tabular">{p.price ? tomanEn(p.price) : "Custom"}{p.price && <span className="text-xs text-white/55 font-normal"> / month</span>}</p>
                <ul className="mt-4 space-y-2 text-sm">{PKG_EN[p.id][1].map((f) => <li key={f} className="flex gap-2"><Icon name="check" size={15} className="acc shrink-0 mt-1" />{f}</li>)}</ul>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="trust">
          <h2 id="trust" className="text-2xl font-black mb-6">Security and trust</h2>
          <ul className="grid sm:grid-cols-2 gap-3">{TRUST.map((t) => <li key={t} className={GLASS_SOFT + " rounded-xl p-4 text-sm flex gap-3"}><Icon name="shield-check" size={17} className="acc shrink-0 mt-0.5" />{t}</li>)}</ul>
        </section>
        <section aria-labelledby="faq"><h2 id="faq" className="text-2xl font-black mb-6">FAQ</h2><EnFaq items={FAQ} /></section>
        <p className="text-sm text-white/60">The request form is in Persian; you can also email <a className="acc underline" href="mailto:hello@gereh.net">hello@gereh.net</a> in English.</p>
      </div>
    </>
  );
}
