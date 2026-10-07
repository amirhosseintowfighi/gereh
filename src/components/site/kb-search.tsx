"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GLASS } from "@/lib/cls";
import { Icon } from "../icon";

type Item = { slug: string; title: string; description: string; category: string; label: string; icon: string; text: string };

const norm = (s: string) => s.toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ");

/** instant client-side search over the (small) knowledge base; every word must match */
export function KbSearch({ items, categories }: { items: Item[]; categories: { id: string; label: string; icon: string }[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const hits = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return items.filter((a) => (!cat || a.category === cat) && words.every((w) => norm(a.title + " " + a.description + " " + a.text).includes(w)));
  }, [items, q, cat]);
  return (
    <div>
      <div className="relative max-w-2xl mx-auto">
        <Icon name="search" size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجو در راهنما" placeholder="مثلا: SSH، رکورد MX، فاکتور رسمی…"
          className="w-full h-14 rounded-2xl bg-white/[0.05] border border-white/[0.14] pr-12 pl-4 outline-none focus:border-white/35 transition placeholder:text-white/35" />
      </div>
      <div role="group" aria-label="دسته‌ها" className="mt-5 flex flex-wrap justify-center gap-2">
        {[{ id: "", label: "همه", icon: "layers" }, ...categories].map((c) => (
          <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}
            className={"h-9 px-3.5 rounded-xl text-sm inline-flex items-center gap-1.5 border transition " + (cat === c.id ? "bg-white text-black border-white font-bold" : "bg-white/[0.04] border-white/[0.1] text-white/70 hover:text-white")}>
            <Icon name={c.icon} size={14} />{c.label}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">{hits.length.toLocaleString("fa-IR")} مقاله</p>
      {hits.length === 0 ? (
        <p className="text-center text-white/60 mt-12">مقاله‌ای پیدا نشد. از <Link href="/contact" className="acc underline underline-offset-4">پشتیبانی</Link> بپرسید.</p>
      ) : (
        <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {hits.map((a) => (
            <li key={a.slug}>
              <Link href={("/kb/" + a.slug) as never} className={GLASS + " rounded-2xl p-5 h-full flex flex-col hover:bg-white/[0.08] transition"}>
                <span className="text-xs text-white/55 flex items-center gap-1.5"><Icon name={a.icon} size={13} />{a.label}</span>
                <h2 className="mt-2 font-extrabold leading-7">{a.title}</h2>
                <p className="mt-2 text-sm text-white/60 leading-7 line-clamp-3">{a.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
