import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { tagHref } from "@/components/site/blog-list";
import { GLASS_SOFT } from "@/lib/cls";
import { faDate } from "@/lib/jalali";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";
import { publishedPost, readingMinutes } from "@/server/blog";
import { db } from "@/server/ctx";

export const dynamic = "force-dynamic";
const load = cache(async (raw: string) => publishedPost(await db(), decodeURIComponent(raw)));

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">) {
  const p = await load((await params).slug);
  if (!p) return { title: "نوشته پیدا نشد", robots: { index: false } };
  const m = pageMeta({ title: p.title, description: p.excerpt, path: "/blog/" + encodeURIComponent(p.slug) });
  return { ...m, openGraph: { ...m.openGraph, type: "article", publishedTime: p.publishedAt?.toISOString(), modifiedTime: p.updatedAt.toISOString(), authors: [p.author], tags: p.tags } };
}

export default async function BlogPostPage({ params }: PageProps<"/blog/[slug]">) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const url = SITE_URL + "/blog/" + encodeURIComponent(p.slug);
  return (
    <>
      <JsonLd data={[
        breadcrumbLd([["بلاگ", "/blog"], [p.title, "/blog/" + encodeURIComponent(p.slug)]]),
        { "@type": "BlogPosting", headline: p.title, description: p.excerpt, url, mainEntityOfPage: url, inLanguage: "fa-IR", datePublished: p.publishedAt?.toISOString(), dateModified: p.updatedAt.toISOString(), author: { "@type": "Person", name: p.author }, publisher: { "@id": ORG_ID }, keywords: p.tags.join(", "), image: SITE_URL + "/og.png" },
      ]} />
      <ArticleView crumbs={[["بلاگ", "/blog"], [p.title, "/blog/" + encodeURIComponent(p.slug)]]} title={p.title} lead={p.excerpt} body={p.body}
        meta={<><span className="flex items-center gap-1.5"><Icon name="user-round" size={14} />{p.author}</span><span className="flex items-center gap-1.5"><Icon name="clock" size={14} />{faDate(p.publishedAt)}</span><span>{readingMinutes(p.body).toLocaleString("fa-IR")} دقیقه مطالعه</span></>}
        aside={p.tags.length > 0 && (
          <nav aria-label="برچسب‌ها" className={GLASS_SOFT + " rounded-2xl p-4"}>
            <h2 className="text-sm font-extrabold mb-3">برچسب‌ها</h2>
            <ul className="flex flex-wrap gap-1.5">{p.tags.map((t) => <li key={t}><Link href={tagHref(t) as never} className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.06] text-white/70 hover:text-white inline-block">{t}</Link></li>)}</ul>
          </nav>
        )}>
        <div className={GLASS_SOFT + " rounded-2xl p-5 mt-10 flex flex-wrap items-center justify-between gap-3"}>
          <Link href="/blog" className="text-sm acc inline-flex items-center gap-1.5"><Icon name="chevron-right" size={14} />همه نوشته‌ها</Link>
          <Link href="/vps" className="text-sm text-white/70 hover:text-white">سرور ابری NVMe گره</Link>
        </div>
      </ArticleView>
    </>
  );
}
