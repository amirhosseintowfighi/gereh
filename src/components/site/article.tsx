import Link from "next/link";
import type { ReactNode } from "react";
import { GLASS_SOFT } from "@/lib/cls";
import { headings, Markdown } from "@/lib/markdown";
import { GirihField } from "../girih";
import { Icon } from "../icon";

/** shared layout for knowledge-base articles, API docs and blog posts: breadcrumb, title, TOC and body */
export function ArticleView({ crumbs, title, lead, meta, body, aside, children }: {
  crumbs: [string, string][]; title: string; lead?: string; meta?: ReactNode; body: string; aside?: ReactNode; children?: ReactNode;
}) {
  const toc = headings(body);
  return (
    <article className="fade-page pb-10">
      <header className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-8">
          <nav aria-label="مسیر صفحه" className="flex flex-wrap items-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            {crumbs.map(([label, href], i) => (
              <span key={href} className="flex items-center gap-2"><Icon name="chevron-left" size={13} />
                {i === crumbs.length - 1 ? <span className="text-white/75" aria-current="page">{label}</span> : <Link href={href as never} className="hover:text-white">{label}</Link>}
              </span>
            ))}
          </nav>
          <h1 className="mt-6 text-[1.9rem] sm:text-5xl font-black leading-[1.4] tracking-tight max-w-3xl">{title}</h1>
          {lead && <p className="mt-4 text-white/65 max-w-2xl leading-8">{lead}</p>}
          {meta && <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/55">{meta}</div>}
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_16rem] gap-10 items-start">
        <div className="min-w-0 max-w-3xl">
          <Markdown src={body} />
          {children}
        </div>
        <aside className="lg:sticky lg:top-28 space-y-4 order-first lg:order-none">
          {toc.length > 1 && (
            <nav aria-label="فهرست مطالب" className={GLASS_SOFT + " rounded-2xl p-4"}>
              <h2 className="text-sm font-extrabold mb-3">در این صفحه</h2>
              <ol className="space-y-2 text-sm text-white/60">
                {toc.map((h) => <li key={h.id} className={h.level === 3 ? "pr-3" : ""}><a href={"#" + h.id} className="hover:text-white">{h.text}</a></li>)}
              </ol>
            </nav>
          )}
          {aside}
        </aside>
      </div>
    </article>
  );
}
