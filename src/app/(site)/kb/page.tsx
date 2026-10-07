import { JsonLd } from "@/components/json-ld";
import { KbSearch } from "@/components/site/kb-search";
import { PageHeader } from "@/components/site/page-header";
import { KB, KB_CATEGORIES } from "@/content/kb";
import { plain } from "@/lib/markdown";
import { breadcrumbLd, pageMeta, SITE_URL } from "@/lib/seo";

export const metadata = pageMeta({ title: "راهنما و پایگاه دانش", description: "آموزش گام‌به‌گام سرور ابری، SSH، DNS، هاست، ایمیل، پرداخت و امنیت حساب در گره؛ با جستجوی سریع بین همه مقاله‌ها.", path: "/kb" });

export default function KbPage() {
  const items = KB.map((a) => ({ slug: a.slug, title: a.title, description: a.description, category: a.category, label: KB_CATEGORIES[a.category].label, icon: KB_CATEGORIES[a.category].icon, text: plain(a.body) }));
  const categories = Object.entries(KB_CATEGORIES).map(([id, c]) => ({ id, ...c }));
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["راهنما", "/kb"]]), { "@type": "CollectionPage", name: "پایگاه دانش گره", url: SITE_URL + "/kb", hasPart: KB.map((a) => ({ "@type": "TechArticle", headline: a.title, url: SITE_URL + "/kb/" + a.slug })) }]} />
      <PageHeader icon="book-open" crumb="راهنما" title="چطور کمکتان کنیم؟" sub="راهنمای قدم‌به‌قدم سرویس‌های گره؛ اگر جوابتان را پیدا نکردید، پشتیبانی شبانه‌روزی کنار شماست." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6"><KbSearch items={items} categories={categories} /></div>
    </div>
  );
}
