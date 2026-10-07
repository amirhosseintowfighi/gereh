import { SITE_URL } from "@/lib/seo";
import { publishedPosts } from "@/server/blog";
import { db } from "@/server/ctx";

export const dynamic = "force-dynamic";
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** RSS 2.0 feed of the latest 30 published posts */
export async function GET() {
  const posts = await publishedPosts(await db(), 30);
  const items = posts.map((p) => {
    const url = SITE_URL + "/blog/" + encodeURIComponent(p.slug);
    return `<item><title>${esc(p.title)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${esc(p.excerpt)}</description>${p.publishedAt ? `<pubDate>${p.publishedAt.toUTCString()}</pubDate>` : ""}${p.tags.map((t) => `<category>${esc(t)}</category>`).join("")}</item>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>بلاگ گره</title><link>${SITE_URL}/blog</link><description>آموزش‌ها و خبرهای گره</description><language>fa-IR</language><atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
