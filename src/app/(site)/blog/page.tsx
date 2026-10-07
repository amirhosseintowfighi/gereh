import { JsonLd } from "@/components/json-ld";
import { BlogList } from "@/components/site/blog-list";
import { PageHeader } from "@/components/site/page-header";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";
import { publishedPosts } from "@/server/blog";
import { db } from "@/server/ctx";

// posts come from the database, so render per request (cheap, and builds never need DB access)
export const dynamic = "force-dynamic";
const base = pageMeta({ title: "بلاگ گره", description: "آموزش‌ها، تجربه‌های فنی و خبرهای گره درباره سرور ابری، هاست، دامنه، امنیت و کارایی وب‌سایت.", path: "/blog" });
export const metadata = { ...base, alternates: { ...base.alternates, types: { "application/rss+xml": "/blog/rss.xml" } } };

export default async function BlogPage() {
  const all = await publishedPosts(await db());
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["بلاگ", "/blog"]]), { "@type": "Blog", name: "بلاگ گره", url: SITE_URL + "/blog", publisher: { "@id": ORG_ID }, blogPost: all.slice(0, 20).map((p) => ({ "@type": "BlogPosting", headline: p.title, url: SITE_URL + "/blog/" + encodeURIComponent(p.slug), datePublished: p.publishedAt?.toISOString() })) }]} />
      <PageHeader icon="newspaper" crumb="بلاگ" title="بلاگ گره" sub="آموزش‌های کاربردی و تجربه‌های تیم زیرساخت؛ بدون حرف اضافه." />
      <BlogList posts={all} tags={[...new Set(all.flatMap((p) => p.tags))]} />
    </div>
  );
}
