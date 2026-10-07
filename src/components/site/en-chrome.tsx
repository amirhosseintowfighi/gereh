import Link from "next/link";
import { GLASS } from "@/lib/cls";
import { EMAIL } from "@/lib/seo";
import { Logo, VirguleLink } from "../brand";
import { Icon } from "../icon";

export const EN_NAV: [string, string][] = [["/en/vps", "Cloud servers"], ["/en/hosting", "Web hosting"], ["/en/domains", "Domains"], ["/en/paas", "Apps (PaaS)"], ["/en/devops", "DevOps"], ["/en/about", "About"]];

/** header for the English site (server component; links wrap on small screens) */
export function EnHeader({ active }: { active?: string }) {
  return (
    <header className="px-3 sm:px-6 pt-3">
      <nav aria-label="Main" className="mx-auto max-w-6xl rounded-2xl px-3 sm:px-4 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2 bg-white/[0.04] border border-white/[0.1] backdrop-blur-xl">
        <Link href="/en" className="flex items-center gap-2.5 font-black text-lg" aria-label="Gereh Cloud home"><Logo size={32} decorative />Gereh<span className="text-white/50 font-medium text-sm">cloud</span></Link>
        <ul className="flex flex-wrap items-center gap-1 text-sm order-3 sm:order-none w-full sm:w-auto">
          {EN_NAV.map(([href, label]) => (
            <li key={href}><Link href={href as never} aria-current={active === href ? "page" : undefined} className={"px-3 h-9 inline-flex items-center rounded-xl transition " + (active === href ? "bg-white/10 text-white font-bold" : "text-white/65 hover:text-white")}>{label}</Link></li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link href="/" hrefLang="fa" lang="fa" className="h-9 px-3 rounded-xl inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white bg-white/[0.05] border border-white/[0.1]"><Icon name="languages" size={15} />فارسی</Link>
          <Link href="/auth" className="h-9 px-4 rounded-xl inline-flex items-center text-sm font-bold btn-p">Sign in</Link>
        </div>
      </nav>
    </header>
  );
}

export function EnFooter() {
  return (
    <footer className="px-3 sm:px-6 pb-6 mt-16">
      <div className={GLASS + " max-w-6xl mx-auto rounded-[1.75rem] p-6 sm:p-10 grid gap-8 sm:grid-cols-3 text-sm"}>
        <div>
          <div className="flex items-center gap-2 font-black text-lg"><Logo size={28} decorative />Gereh Cloud</div>
          <p className="text-white/55 mt-3 leading-7">NVMe cloud servers, web hosting and domains, built in Iran with datacenters in Tehran, Isfahan, Frankfurt and Amsterdam.</p>
        </div>
        <nav aria-label="Products">
          <h2 className="font-extrabold mb-3">Products</h2>
          <ul className="space-y-2 text-white/60">{EN_NAV.map(([h, l]) => <li key={h}><Link href={h as never} className="hover:text-white">{l}</Link></li>)}<li><Link href="/docs/api" hrefLang="fa" className="hover:text-white">API reference (Persian)</Link></li></ul>
        </nav>
        <div>
          <h2 className="font-extrabold mb-3">Contact</h2>
          <ul className="space-y-2 text-white/60">
            <li><a href={"mailto:" + EMAIL} className="hover:text-white">{EMAIL}</a></li>
            <li><a href="tel:+982191000000" className="hover:text-white">+98 21 9100 0000</a></li>
            <li>Valiasr St, Tehran, Iran</li>
            <li>24/7 support in Persian and English</li>
          </ul>
        </div>
        <div className="sm:col-span-3 border-t border-white/[0.08] pt-5 flex flex-col sm:flex-row justify-between gap-2 text-xs text-white/55">
          <span>© 2026 Gereh. Part of the Virgule family.</span>
          <span>Designed and built by <VirguleLink /></span>
        </div>
      </div>
    </footer>
  );
}

/** title block used at the top of every English page */
export function EnHero({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-10 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-white/55">{kicker}</p>
      <h1 className="mt-4 text-[2.1rem] sm:text-6xl font-black leading-[1.15] tracking-tight">{title}</h1>
      <p className="mt-5 text-white/65 max-w-2xl mx-auto leading-8">{sub}</p>
    </div>
  );
}
