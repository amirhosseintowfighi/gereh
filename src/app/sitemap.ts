import type { MetadataRoute } from "next";
import { KB } from "@/content/kb";
import { tldSlug } from "@/content/tlds";
import { TLDS } from "@/lib/catalog";
import { SITE_URL } from "@/lib/seo";
import { publishedPosts } from "@/server/blog";
import { db } from "@/server/ctx";

// blog posts live in the database, so the sitemap is built per request
export const dynamic = "force-dynamic";

const PAGES: [path: string, priority: number, freq: MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["/", 1, "weekly"], ["/vps", 0.9, "weekly"], ["/hosting", 0.9, "weekly"], ["/domains", 0.9, "weekly"],
  ["/about", 0.6, "monthly"], ["/contact", 0.6, "monthly"], ["/terms", 0.3, "yearly"], ["/privacy", 0.3, "yearly"], ["/sla", 0.3, "yearly"], ["/status", 0.4, "daily"],
  ["/kb", 0.7, "weekly"], ["/blog", 0.7, "daily"], ["/docs/api", 0.6, "monthly"], ["/compare", 0.6, "monthly"],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date(process.env.BUILD_TIME || Date.now());
  const posts = await publishedPosts(await db(), 1000).catch((e) => { console.error("[sitemap] posts", e); return []; });
  return [
    ...PAGES.map(([p, priority, changeFrequency]) => ({ url: SITE_URL + p, lastModified, changeFrequency, priority })),
    ...KB.map((a) => ({ url: SITE_URL + "/kb/" + a.slug, lastModified: new Date(a.updated), changeFrequency: "monthly" as const, priority: 0.5 })),
    ...TLDS.map((t) => ({ url: SITE_URL + "/domains/" + tldSlug(t.tld), lastModified, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...posts.map((p) => ({ url: SITE_URL + "/blog/" + encodeURIComponent(p.slug), lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
