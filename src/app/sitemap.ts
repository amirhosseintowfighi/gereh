import type { MetadataRoute } from "next";
import { KB } from "@/content/kb";
import { SITE_URL } from "@/lib/seo";

const PAGES: [path: string, priority: number, freq: MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["/", 1, "weekly"], ["/vps", 0.9, "weekly"], ["/hosting", 0.9, "weekly"], ["/domains", 0.9, "weekly"],
  ["/about", 0.6, "monthly"], ["/contact", 0.6, "monthly"], ["/terms", 0.3, "yearly"], ["/privacy", 0.3, "yearly"], ["/sla", 0.3, "yearly"], ["/status", 0.4, "daily"],
  ["/kb", 0.7, "weekly"], ["/docs/api", 0.6, "monthly"],
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(process.env.BUILD_TIME || Date.now());
  return [
    ...PAGES.map(([p, priority, changeFrequency]) => ({ url: SITE_URL + p, lastModified, changeFrequency, priority })),
    ...KB.map((a) => ({ url: SITE_URL + "/kb/" + a.slug, lastModified: new Date(a.updated), changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
