import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { ArticleView } from "@/components/site/article";
import { KB, KB_CATEGORIES, kbArticle } from "@/content/kb";
import { GLASS_SOFT } from "@/lib/cls";
import { faDate } from "@/lib/jalali";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => KB.map((a) => ({ slug: a.slug }));

export async function generateMetadata({ params }: PageProps<"/kb/[slug]">) {
  const a = kbArticle((await params).slug);
  if (!a) return {};
  const m = pageMeta({ title: a.title, description: a.description, path: "/kb/" + a.slug });
  return { ...m, openGraph: { ...m.openGraph, type: "article", modifiedTime: a.updated } };
}

export default async function KbArticlePage({ params }: PageProps<"/kb/[slug]">) {
  const a = kbArticle((await params).slug);
  if (!a) notFound();
  const cat = KB_CATEGORIES[a.category];
  const related = KB.filter((x) => x.category === a.category && x.slug !== a.slug).slice(0, 4);
  return (
    <>
      <JsonLd data={[
        breadcrumbLd([["راهنما", "/kb"], [a.title, "/kb/" + a.slug]]),
        { "@type": "TechArticle", headline: a.title, description: a.description, url: SITE_URL + "/kb/" + a.slug, inLanguage: "fa-IR", dateModified: a.updated, author: { "@id": ORG_ID }, publisher: { "@id": ORG_ID }, articleSection: cat.label },
      ]} />
      <ArticleView crumbs={[["راهنما", "/kb"], [a.title, "/kb/" + a.slug]]} title={a.title} lead={a.description} body={a.body}
        meta={<><span className="flex items-center gap-1.5"><Icon name={cat.icon} size={14} />{cat.label}</span><span className="flex items-center gap-1.5"><Icon name="clock" size={14} />به‌روزرسانی {faDate(new Date(a.updated))}</span></>}
        aside={related.length > 0 && (
          <nav aria-label="مقاله‌های مرتبط" className={GLASS_SOFT + " rounded-2xl p-4"}>
            <h2 className="text-sm font-extrabold mb-3">مقاله‌های مرتبط</h2>
            <ul className="space-y-2.5 text-sm text-white/60">{related.map((r) => <li key={r.slug}><Link href={("/kb/" + r.slug) as never} className="hover:text-white leading-6">{r.title}</Link></li>)}</ul>
          </nav>
        )}>
        <div className={GLASS_SOFT + " rounded-2xl p-5 mt-10 flex flex-wrap items-center justify-between gap-3"}>
          <span className="text-sm text-white/70">مشکلتان حل نشد؟</span>
          <Link href="/panel/tickets" className="text-sm acc inline-flex items-center gap-1.5">ارسال تیکت <Icon name="arrow-left" size={14} /></Link>
        </div>
      </ArticleView>
    </>
  );
}
