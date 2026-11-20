"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GLASS, GLASS_SOFT } from "@/lib/cls";
import { Icon } from "../icon";

export type HubItem = { href: string; title: string; description: string; icon: string; group: string; label: string;
  /** searched but not shown: section headings of a guide, the whole text of a knowledge-base article */
  text: string };
export type HubGroup = { id: string; label: string; icon: string };

const norm = (s: string) => s.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ");

function Card({ a }: { a: HubItem }) {
  return (
    <Link href={a.href as never} className={GLASS + " rounded-2xl p-5 h-full flex flex-col hover:bg-white/[0.08] transition"}>
      <span className="text-xs text-white/55 flex items-center gap-1.5"><Icon name={a.icon} size={13} />{a.label}</span>
      <h3 className="mt-2 font-extrabold leading-7">{a.title}</h3>
      <p className="mt-2 text-sm text-white/60 leading-7 line-clamp-3">{a.description}</p>
    </Link>
  );
}

/** the /docs hub: guides grouped by product area, plus one search over the guides and the knowledge base */
export function DocsHub({ groups, docs, kb }: { groups: HubGroup[]; docs: HubItem[]; kb: HubItem[] }) {
  const [q, setQ] = useState("");
  const words = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q]);
  const hits = useMemo(() => {
    if (!words.length) return [];
    const match = (a: HubItem) => { const t = norm(a.title + " " + a.description + " " + a.text); return words.every((w) => t.includes(w)); };
    // a title hit ranks first, then guides before short articles
    const score = (a: HubItem) => (words.every((w) => norm(a.title).includes(w)) ? 0 : 1);
    return [...docs.filter(match), ...kb.filter(match)].map((a, i) => ({ a, i })).sort((x, y) => score(x.a) - score(y.a) || x.i - y.i).map((x) => x.a);
  }, [words, docs, kb]);
  return (
    <div>
      <div className="relative max-w-2xl mx-auto">
        <Icon name="search" size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-white/45" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو در مستندات" placeholder="مثلا: SSH، رکورد MX، بکاپ، فاکتور رسمی، کلید S3…"
          className="w-full h-14 rounded-2xl bg-white/[0.05] border border-white/[0.14] ps-12 pe-4 outline-none focus:border-white/35 transition placeholder:text-white/35" />
      </div>
      <p className="sr-only" role="status">{words.length ? hits.length.toLocaleString("fa-IR") + " نتیجه" : ""}</p>
      {words.length > 0 ? (
        hits.length === 0 ? (
          <p className="text-center text-white/60 mt-12">نتیجه‌ای پیدا نشد. از <Link href="/panel/assistant" className="acc underline underline-offset-4">دستیار گره</Link> بپرسید یا <Link href="/panel/tickets" className="acc underline underline-offset-4">تیکت</Link> بفرستید.</p>
        ) : (
          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{hits.map((a) => <li key={a.href}><Card a={a} /></li>)}</ul>
        )
      ) : (
        <div className="mt-12 space-y-12">
          {groups.map((g) => {
            const list = g.id === "kb" ? kb : docs.filter((d) => d.group === g.id);
            if (!list.length) return null;
            return (
              <section key={g.id} aria-labelledby={"g-" + g.id}>
                <h2 id={"g-" + g.id} className="text-lg font-extrabold mb-4 flex items-center gap-2"><Icon name={g.icon} size={18} className="acc" />{g.label}</h2>
                {g.id === "kb" ? (
                  <ul className={GLASS_SOFT + " rounded-2xl p-4 grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm"}>
                    {list.map((a) => <li key={a.href}><Link href={a.href as never} className="text-white/70 hover:text-white leading-7 inline-flex items-center gap-2"><Icon name={a.icon} size={14} className="text-white/45 shrink-0" />{a.title}</Link></li>)}
                  </ul>
                ) : (
                  <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{list.map((a) => <li key={a.href}><Card a={a} /></li>)}</ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
