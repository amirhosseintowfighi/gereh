/* Blog: staff-written posts (Markdown subset). Public readers only ever see published posts. */
import "server-only";
import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { plain } from "@/lib/markdown";
import type { DB } from "./db/client";
import { posts } from "./db/schema";

export const SLUG_RE = /^[a-z0-9؀-ۿ]+(?:-[a-z0-9؀-ۿ]+)*$/;
const visible = () => and(eq(posts.status, "published"), isNotNull(posts.publishedAt), lte(posts.publishedAt, new Date()));

export const publishedPosts = (db: DB, limit = 100) =>
  db.select({ slug: posts.slug, title: posts.title, excerpt: posts.excerpt, tags: posts.tags, author: posts.author, publishedAt: posts.publishedAt, updatedAt: posts.updatedAt, body: posts.body })
    .from(posts).where(visible()).orderBy(desc(posts.publishedAt)).limit(limit);

export async function publishedPost(db: DB, slug: string) {
  const [p] = await db.select().from(posts).where(and(visible(), eq(posts.slug, slug)));
  return p ?? null;
}

/** rough reading time for Persian text (~200 words a minute) */
export const readingMinutes = (body: string) => Math.max(1, Math.round(plain(body).split(/\s+/).filter(Boolean).length / 200));
