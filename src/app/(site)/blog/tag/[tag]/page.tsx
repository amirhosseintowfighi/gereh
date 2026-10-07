import { notFound } from "next/navigation";
import { cache } from "react";
import { JsonLd } from "@/components/json-ld";
import { BlogList, tagHref } from "@/components/site/blog-list";
import { PageHeader } from "@/components/site/page-header";
import { breadcrumbLd, pageMeta } from "@/lib/seo";
import { publishedPosts } from "@/server/blog";
import { db } from "@/server/ctx";

export const dynamic = "force-dynamic";
const load = cache(async () => publishedPosts(await db()));

export async function generateMetadata({ params }: PageProps<"/blog/tag/[tag]">) {
  const tag = decodeURIComponent((await params).tag);
  if (!(await load()).some((p) => p.tags.includes(tag))) return { title: "برچسب پیدا نشد", robots: { index: false } };
  return pageMeta({ title: "نوشته‌های «" + tag + "»", description: "همه آموزش‌ها و نوشته‌های بلاگ گره با برچسب «" + tag + "»؛ سرور ابری، هاست، دامنه و کارایی وب‌سایت.", path: tagHref(tag) });
}

export default async function BlogTagPage({ params }: PageProps<"/blog/tag/[tag]">) {
  const tag = decodeURIComponent((await params).tag);
  const all = await load();
  const posts = all.filter((p) => p.tags.includes(tag));
  if (!posts.length) notFound();
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["بلاگ", "/blog"], [tag, tagHref(tag)]])]} />
      <PageHeader icon="newspaper" crumb={"بلاگ: " + tag} title={"«" + tag + "»"} sub={posts.length.toLocaleString("fa-IR") + " نوشته با این برچسب"} />
      <BlogList posts={posts} tags={[...new Set(all.flatMap((p) => p.tags))]} active={tag} />
    </div>
  );
}
