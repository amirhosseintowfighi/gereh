import Link from "next/link";
import { Icon } from "@/components/icon";
import { EnHeader, EnHero } from "@/components/site/en-chrome";
import { ORDER_NOTE } from "@/components/site/en-plans";
import { tomanEn } from "@/content/en";
import { tldSlug } from "@/content/tlds";
import { TLDS } from "@/lib/catalog";
import { BTN_P, GLASS } from "@/lib/cls";
import { pageMetaEn } from "@/lib/seo";

export const metadata = pageMetaEn({ title: "Domain registration: .ir, .com, .io and more", description: "Register .ir and 15 international domain extensions with free DNS management, WHOIS privacy and free transfers between .ir registrars. Prices in Toman.", path: "/en/domains", fa: "/domains" });

export default function EnDomains() {
  return (
    <>
      <EnHeader active="/en/domains" />
      <EnHero kicker="Domains" title="A name that stays" sub="Check a name across every extension at once and register it in seconds." />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12">
        <form action="/domains" method="get" role="search" className="flex gap-2">
          <label htmlFor="en-q" className="sr-only">Domain name</label>
          <input id="en-q" name="q" required placeholder="mybrand.ir" autoComplete="off" spellCheck={false} className="flex-1 min-w-0 h-14 rounded-2xl bg-white/[0.05] border border-white/[0.14] px-4 outline-none focus:border-white/35" />
          <button type="submit" className={BTN_P + " h-14 px-5"}><Icon name="search" size={18} />Search</button>
        </form>
        <p className="text-xs text-white/55 -mt-8">{ORDER_NOTE}</p>
        <div className={GLASS + " rounded-2xl overflow-x-auto"} tabIndex={0} role="region" aria-label="Domain prices">
          <table className="w-full text-sm">
            <caption className="sr-only">Yearly domain prices in Toman</caption>
            <thead><tr className="bg-white/[0.04]">{["Extension", "Register", "Renew", "Transfer"].map((h) => <th key={h} scope="col" className="text-left p-4 font-bold">{h}</th>)}</tr></thead>
            <tbody className="tabular">{TLDS.map((t) => (
              <tr key={t.tld} className="border-t border-white/[0.06]">
                <th scope="row" className="text-left p-4"><Link href={("/domains/" + tldSlug(t.tld)) as never} hrefLang="fa" className="font-bold hover:underline">{t.tld}</Link>{t.promo && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-200">Offer</span>}</th>
                <td className="p-4">{tomanEn(t.reg)}</td><td className="p-4">{tomanEn(t.renew)}</td><td className="p-4">{t.transfer ? tomanEn(t.transfer) : "Free"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
