import Link from "next/link";
import { GLASS } from "@/lib/cls";
import { faDate } from "@/lib/jalali";
import { readingMinutes } from "@/server/blog";
import { Icon } from "../icon";

type P = { slug: string; title: string; excerpt: string; tags: string[]; publishedAt: Date | null; body: string };
export const tagHref = (t: string) => "/blog/tag/" + encodeURIComponent(t);

/** tag chips + post cards, shared by /blog and /blog/tag/[tag] */
export function BlogList({ posts, tags, active = "" }: { posts: P[]; tags: string[]; active?: string }) {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      {tags.length > 0 && (
        <nav aria-label="برچسب‌ها" className="flex flex-wrap justify-center gap-2 mb-10">
          {["", ...tags].map((t) => (
            <Link key={t || "all"} href={(t ? tagHref(t) : "/blog") as never} aria-current={t === active ? "page" : undefined}
              className={"h-9 px-3.5 rounded-xl text-sm inline-flex items-center border transition " + (t === active ? "bg-white text-black border-white font-bold" : "bg-white/[0.04] border-white/[0.1] text-white/70 hover:text-white")}>{t || "همه"}</Link>
          ))}
        </nav>
      )}
      {posts.length === 0 ? <p className="text-center text-white/60 py-16">هنوز نوشته‌ای منتشر نشده است.</p> : (
        <ul className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link href={("/blog/" + encodeURIComponent(p.slug)) as never} className={GLASS + " rounded-2xl p-6 h-full flex flex-col hover:bg-white/[0.08] transition"}>
                <span className="flex flex-wrap gap-1.5">{p.tags.map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-md bg-white/[0.06] text-white/65">{t}</span>)}</span>
                <h2 className="mt-3 text-lg font-extrabold leading-8">{p.title}</h2>
                <p className="mt-2 text-sm text-white/60 leading-7 flex-1">{p.excerpt}</p>
                <span className="mt-4 text-xs text-white/55 flex items-center gap-3"><span className="flex items-center gap-1"><Icon name="clock" size={13} />{faDate(p.publishedAt)}</span><span>{readingMinutes(p.body).toLocaleString("fa-IR")} دقیقه مطالعه</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
