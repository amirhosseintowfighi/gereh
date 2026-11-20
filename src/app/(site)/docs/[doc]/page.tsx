import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { DOC_GROUPS, DOCS, docHref, docOf, GUIDES, type GuideEnv } from "@/content/docs";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

/* Product guides that have no page of their own. Rendered per request so the storage endpoint and the mirror
   address follow this server's environment, like /mirror does. */
export const dynamic = "force-dynamic";

const env = (): GuideEnv => ({
  site: SITE_URL,
  storageEndpoint: (process.env.STORAGE_PUBLIC_ENDPOINT || "https://storage.gereh.net").replace(/\/$/, ""),
  storageRegion: process.env.STORAGE_REGION || "us-east-1",
  mirror: (process.env.MIRROR_URL || "https://mirror.gereh.net").replace(/\/$/, ""),
});

const guideOf = (slug: string) => { const d = docOf(slug); const g = GUIDES[slug]; return d && g ? { ...d, ...g } : null; };

export async function generateMetadata({ params }: PageProps<"/docs/[doc]">) {
  const g = guideOf((await params).doc);
  return g ? pageMeta({ title: "راهنمای " + g.title, description: g.description, path: docHref(g.slug) }) : {};
}

export default async function DocPage({ params }: PageProps<"/docs/[doc]">) {
  const g = guideOf((await params).doc);
  if (!g) notFound();
  const path = docHref(g.slug);
  const related = DOCS.filter((d) => d.group === g.group && d.slug !== g.slug);
  const crumbs: [string, string][] = [["مستندات", "/docs"], [g.title, path]];
  return (
    <>
      <JsonLd data={[breadcrumbLd(crumbs), { "@type": "TechArticle", headline: g.title, description: g.description, url: SITE_URL + path, inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={crumbs} title={g.title} lead={g.lead} body={g.body(env())}
        meta={<span className="flex items-center gap-1.5"><Icon name={DOC_GROUPS[g.group].icon} size={14} />{DOC_GROUPS[g.group].label}</span>}
        aside={(
          <>
            {(g.panel || g.product) && (
              <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
                {g.panel && <Link href={g.panel[1] as never} className={BTN_P + " w-full h-10 text-sm"}><Icon name="layout-dashboard" size={15} />{g.panel[0]}</Link>}
                {g.product && <Link href={g.product[1] as never} className={BTN_G + " w-full h-10 text-sm"}><Icon name="tag" size={15} />پلن‌ها و قیمت</Link>}
              </div>
            )}
            {related.length > 0 && (
              <nav aria-label="راهنماهای مرتبط" className={GLASS_SOFT + " rounded-2xl p-4"}>
                <h2 className="text-sm font-extrabold mb-3">راهنماهای مرتبط</h2>
                <ul className="space-y-2.5 text-sm text-white/60">{related.map((r) => <li key={r.slug}><Link href={docHref(r.slug) as never} className="hover:text-white leading-6">{r.title}</Link></li>)}</ul>
              </nav>
            )}
          </>
        )}>
        <div className={GLASS_SOFT + " rounded-2xl p-5 mt-10 flex flex-wrap items-center justify-between gap-3"}>
          <span className="text-sm text-white/70">جوابتان را پیدا نکردید؟</span>
          <span className="flex flex-wrap gap-4 text-sm">
            <Link href="/docs" className="acc inline-flex items-center gap-1.5"><Icon name="book-open" size={14} />همه مستندات</Link>
            <Link href="/panel/tickets" className="acc inline-flex items-center gap-1.5">ارسال تیکت <Icon name="arrow-left" size={14} /></Link>
          </span>
        </div>
      </ArticleView>
    </>
  );
}
