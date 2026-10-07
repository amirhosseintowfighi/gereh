import type { MetadataRoute } from "next";
import { DEVOPS_SERVICES } from "@/content/devops";
import { KB } from "@/content/kb";
import { tldSlug } from "@/content/tlds";
import { TLDS } from "@/lib/catalog";
import { EN_PAGES, SITE_URL } from "@/lib/seo";
import { publishedPosts } from "@/server/blog";
import { db } from "@/server/ctx";

// blog posts live in the database, so the sitemap is built per request
export const dynamic = "force-dynamic";

const PAGES: [path: string, priority: number, freq: MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["/", 1, "weekly"], ["/vps", 0.9, "weekly"], ["/hosting", 0.9, "weekly"], ["/domains", 0.9, "weekly"],
  ["/about", 0.6, "monthly"], ["/contact", 0.6, "monthly"], ["/terms", 0.3, "yearly"], ["/privacy", 0.3, "yearly"], ["/sla", 0.3, "yearly"], ["/status", 0.4, "daily"],
  ["/kb", 0.7, "weekly"], ["/blog", 0.7, "daily"], ["/docs/api", 0.6, "monthly"], ["/compare", 0.6, "monthly"], ["/devops", 0.9, "weekly"],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date(process.env.BUILD_TIME || Date.now());
  const posts = await publishedPosts(await db(), 1000).catch((e) => { console.error("[sitemap] posts", e); return []; });
  return [
    ...PAGES.map(([p, priority, changeFrequency]) => {
      const en = EN_PAGES.find(([, fa]) => fa === p)?.[0];
      return { url: SITE_URL + p, lastModified, changeFrequency, priority, ...(en ? { alternates: { languages: { "fa-IR": SITE_URL + p, en: SITE_URL + en } } } : {}) };
    }),
    ...EN_PAGES.map(([en, fa]) => ({ url: SITE_URL + en, lastModified, changeFrequency: "monthly" as const, priority: 0.5, alternates: { languages: { "fa-IR": SITE_URL + fa, en: SITE_URL + en } } })),
    ...KB.map((a) => ({ url: SITE_URL + "/kb/" + a.slug, lastModified: new Date(a.updated), changeFrequency: "monthly" as const, priority: 0.5 })),
    ...DEVOPS_SERVICES.map((s) => ({ url: SITE_URL + "/devops/" + s.slug, lastModified, changeFrequency: "monthly" as const, priority: 0.7 })),
    ...TLDS.map((t) => ({ url: SITE_URL + "/domains/" + tldSlug(t.tld), lastModified, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...posts.map((p) => ({ url: SITE_URL + "/blog/" + encodeURIComponent(p.slug), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
