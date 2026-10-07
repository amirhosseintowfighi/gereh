import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { SLUG_RE } from "../blog";
import { actor, method, needStaff } from "../ctx";
import { posts } from "../db/schema";
import { fail, logAudit, rid } from "../util";

const post = z.object({
  id: z.string().max(40).optional(),
  slug: z.string().trim().toLowerCase().max(80),
  title: z.string().trim().max(160),
  excerpt: z.string().trim().max(300),
  body: z.string().max(60_000),
  tags: z.array(z.string().trim().min(1).max(30)).max(8),
  status: z.enum(["draft", "published"]),
});

export const blogRpc = {
  /** create or update; the first publish stamps published_at */
  "blog.save": method(z.tuple([post]), async (ctx, [p]) => {
    const a = needStaff(ctx, "content");
    if (!SLUG_RE.test(p.slug) || p.slug.length < 3) fail("نشانی (slug) فقط حروف، عدد و خط تیره؛ حداقل ۳ نویسه.");
    if (p.title.length < 5) fail("عنوان را کامل بنویسید.");
    if (p.excerpt.length < 20) fail("خلاصه باید دست‌کم ۲۰ نویسه باشد (برای توضیحات موتور جستجو).");
    if (p.body.trim().length < 50) fail("متن نوشته کوتاه است.");
    const [dup] = await ctx.db.select({ id: posts.id }).from(posts).where(and(eq(posts.slug, p.slug), p.id ? ne(posts.id, p.id) : undefined));
    if (dup) fail("این نشانی برای نوشته دیگری استفاده شده است.");
    const values = { slug: p.slug, title: p.title, excerpt: p.excerpt, body: p.body, tags: [...new Set(p.tags)], status: p.status, updatedAt: new Date() };
    let id = p.id;
    if (id) {
      const [cur] = await ctx.db.select().from(posts).where(eq(posts.id, id));
      if (!cur) fail("نوشته پیدا نشد.", 404);
      await ctx.db.update(posts).set({ ...values, publishedAt: p.status === "published" ? cur!.publishedAt ?? new Date() : cur!.publishedAt }).where(eq(posts.id, id));
    } else {
      id = rid("post");
      await ctx.db.insert(posts).values({ id, ...values, author: a.user.name, publishedAt: p.status === "published" ? new Date() : null });
    }
    await logAudit(ctx.db, actor(ctx), p.status === "published" ? "انتشار نوشته" : "ذخیره پیش‌نویس", p.slug, ctx.ip);
    return id;
  }),
  "blog.delete": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    needStaff(ctx, "content");
    const r = await ctx.db.delete(posts).where(eq(posts.id, id)).returning({ slug: posts.slug });
    if (!r.length) fail("نوشته پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "حذف نوشته", r[0].slug, ctx.ip);
  }),
};
