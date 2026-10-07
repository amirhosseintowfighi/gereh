import { beforeEach, describe, expect, it } from "vitest";
import { publishedPost, publishedPosts, readingMinutes } from "@/server/blog";
import { asAdmin, asUser, call, db, fails, fresh, login } from "./helpers";

beforeEach(fresh);
const draft = { slug: "test-post", title: "نوشته آزمایشی", excerpt: "خلاصه‌ای به اندازه کافی بلند برای توضیحات متا.", body: "## تیتر\n\n" + "متن نمونه ".repeat(20), tags: ["آزمایش", "آزمایش"], status: "draft" as const };

describe("blog", () => {
  it("demo seed has published posts, newest first", async () => {
    const posts = await publishedPosts(await db());
    expect(posts.length).toBeGreaterThanOrEqual(3);
    expect(posts[0].publishedAt!.getTime()).toBeGreaterThanOrEqual(posts[1].publishedAt!.getTime());
  });

  it("drafts are hidden until published; publishing stamps the date once", async () => {
    await asAdmin();
    const id = await call<string>("blog.save", draft);
    expect(await publishedPost(await db(), "test-post")).toBeNull();
    await call("blog.save", { ...draft, id, status: "published" });
    const p = await publishedPost(await db(), "test-post");
    expect(p).toMatchObject({ title: "نوشته آزمایشی", tags: ["آزمایش"] });
    const first = p!.publishedAt!.getTime();
    await call("blog.save", { ...draft, id, title: "عنوان ویرایش‌شده", status: "published" });
    expect((await publishedPost(await db(), "test-post"))!.publishedAt!.getTime()).toBe(first);
  });

  it("validates slugs and rejects duplicates", async () => {
    await asAdmin();
    await fails("blog.save", { ...draft, slug: "bad slug!" });
    await fails("blog.save", { ...draft, slug: "../etc" });
    await call("blog.save", { ...draft, slug: "نوشته-فارسی" });
    await fails("blog.save", { ...draft, slug: "نوشته-فارسی" });
  });

  it("only content staff (owner, sales) can write", async () => {
    await asUser();
    await fails("blog.save", draft);
    await login("kaveh@gereh.net"); // support
    await fails("blog.save", draft);
    await asAdmin();
    const id = await call<string>("blog.save", draft);
    await call("blog.delete", id);
    await fails("blog.delete", id);
  });

  it("estimates reading time", () => {
    expect(readingMinutes("کلمه ".repeat(600))).toBe(3);
    expect(readingMinutes("")).toBe(1);
  });
});
