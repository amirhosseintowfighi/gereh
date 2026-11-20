import { JsonLd } from "@/components/json-ld";
import { DocsHub, type HubItem } from "@/components/site/docs-hub";
import { PageHeader } from "@/components/site/page-header";
import { aiDocs } from "@/content/ai";
import { API_DOCS } from "@/content/api-docs";
import { DOC_GROUPS, DOCS, docHref, GUIDES, type GuideEnv } from "@/content/docs";
import { GEO_DOCS } from "@/content/geo";
import { inquiryDocs } from "@/content/inquiry";
import { KB, KB_CATEGORIES } from "@/content/kb";
import { mcpDocs } from "@/content/mcp";
import { PAAS_DOCS } from "@/content/paas-docs";
import { PAAS_GUIDES } from "@/content/paas-guides";
import { headings, plain } from "@/lib/markdown";
import { breadcrumbLd, pageMeta, SITE_URL } from "@/lib/seo";
import { MCP_TOOLS } from "@/server/mcp";

export const metadata = pageMeta({
  title: "مستندات گره",
  description: "راهنمای کامل همه سرویس‌های گره: سرور ابری، هاست، دامنه و DNS، گره اپ، پایگاه داده، وردپرس، فضای ذخیره‌سازی S3، ایمیل، API هوش مصنوعی، API استعلام، Geo DNS، صورتحساب و امنیت حساب؛ با جستجوی سریع.",
  path: "/docs",
});

/* Only the headings of each guide are searched here (the full text would make the page heavy); the knowledge
   base articles are short, so their whole text is. Env-dependent values do not change any heading. */
const ENV: GuideEnv = { site: SITE_URL, storageEndpoint: "", storageRegion: "", mirror: "" };
const STANDALONE: Record<string, () => string> = {
  api: () => API_DOCS, paas: () => PAAS_DOCS, "geo-dns": () => GEO_DOCS,
  mcp: () => mcpDocs(SITE_URL, MCP_TOOLS), "ai-api": () => aiDocs(SITE_URL, []), inquiry: () => inquiryDocs(SITE_URL, {}),
};
const sections = (body: string) => headings(body).map((h) => h.text).join(" ");

export default function DocsIndexPage() {
  const docs: HubItem[] = DOCS.flatMap((d) => {
    const body = GUIDES[d.slug]?.body(ENV) ?? STANDALONE[d.slug]?.() ?? "";
    const item: HubItem = { href: docHref(d.slug), title: d.title, description: d.description, icon: d.icon, group: d.group, label: DOC_GROUPS[d.group].label, text: sections(body) };
    // the PaaS sub-guides sit right after the PaaS guide
    return d.slug !== "paas" ? [item] : [item, ...PAAS_GUIDES.map((g) => ({ href: "/docs/paas/" + g.slug, title: g.title, description: g.description, icon: g.icon, group: d.group, label: "گره اپ", text: sections(g.body) }))];
  });
  const kb: HubItem[] = KB.map((a) => ({ href: "/kb/" + a.slug, title: a.title, description: a.description, icon: KB_CATEGORIES[a.category].icon, group: "kb", label: "پایگاه دانش · " + KB_CATEGORIES[a.category].label, text: plain(a.body) }));
  const groups = [...Object.entries(DOC_GROUPS).map(([id, g]) => ({ id, ...g })), { id: "kb", label: "پرسش‌های رایج و راهنماهای کوتاه", icon: "book-open" }];
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["مستندات", "/docs"]]), { "@type": "CollectionPage", name: "مستندات گره", url: SITE_URL + "/docs", inLanguage: "fa-IR", hasPart: docs.map((d) => ({ "@type": "TechArticle", headline: d.title, url: SITE_URL + d.href })) }]} />
      <PageHeader icon="book-open" crumb="مستندات" title="مستندات گره" sub="راهنمای کامل هر سرویس، از اولین قدم تا API؛ هر چیزی را که می‌خواهید پیدا کنید." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6"><DocsHub groups={groups} docs={docs} kb={kb} /></div>
    </div>
  );
}
