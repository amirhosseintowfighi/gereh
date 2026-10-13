import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { guideOf, PAAS_GUIDES } from "@/content/paas-guides";
import { BTN_G, BTN_P, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => PAAS_GUIDES.map((g) => ({ guide: g.slug }));

export async function generateMetadata({ params }: PageProps<"/docs/paas/[guide]">) {
  const g = guideOf((await params).guide);
  return g ? pageMeta({ title: g.title, description: g.description, path: "/docs/paas/" + g.slug }) : {};
}

export default async function PaasGuidePage({ params }: PageProps<"/docs/paas/[guide]">) {
  const g = guideOf((await params).guide);
  if (!g) notFound();
  const path = "/docs/paas/" + g.slug;
  return (
    <>
      <JsonLd data={[breadcrumbLd([["گره اپ", "/paas"], ["مستندات", "/docs/paas"], [g.title, path]]), { "@type": "TechArticle", headline: g.title, description: g.description, url: SITE_URL + path, inLanguage: "fa-IR", author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID } }]} />
      <ArticleView crumbs={[["گره اپ", "/paas"], ["مستندات", "/docs/paas"], [g.title, path]]} title={g.title} lead={g.lead} body={g.body}
        meta={<span className="flex items-center gap-1.5"><Icon name={g.icon} size={14} />راهنمای گره اپ</span>}
        aside={(
          <div className={GLASS_SOFT + " rounded-2xl p-4 space-y-2"}>
            <Link href="/panel/apps/new" className={BTN_P + " w-full h-10 text-sm"}><Icon name="rocket" size={15} />ساخت اپ</Link>
            {PAAS_GUIDES.filter((x) => x.slug !== g.slug).map((x) => <Link key={x.slug} href={("/docs/paas/" + x.slug) as never} className={BTN_G + " w-full h-10 text-sm"}><Icon name={x.icon} size={15} />{x.title}</Link>)}
            <Link href={"/docs/paas" as never} className={BTN_G + " w-full h-10 text-sm"}><Icon name="book-open" size={15} />مستندات کامل</Link>
          </div>
        )} />
    </>
  );
}
