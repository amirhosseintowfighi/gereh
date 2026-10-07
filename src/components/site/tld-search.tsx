"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BTN_P } from "@/lib/cls";
import { Icon } from "../icon";

/** name box with the TLD fixed; hands off to the main domain search */
export function TldSearch({ tld }: { tld: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  return (
    <form role="search" className="max-w-xl mx-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = name.trim().toLowerCase().replace(/\..*$/, ""); if (n) router.push(("/domains?q=" + encodeURIComponent(n + tld)) as never); }}>
      <div className="flex-1 flex items-center h-14 rounded-2xl bg-white/[0.05] border border-white/[0.14] focus-within:border-white/35 overflow-hidden" dir="ltr">
        <label htmlFor="tld-name" className="sr-only">نام دامنه بدون پسوند</label>
        <input id="tld-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="mybrand" autoComplete="off" spellCheck={false} className="flex-1 min-w-0 h-full bg-transparent px-4 outline-none text-left" />
        <span className="px-4 text-white/60 font-bold">{tld}</span>
      </div>
      <button type="submit" className={BTN_P + " h-14 px-5"}><Icon name="search" size={18} />بررسی</button>
    </form>
  );
}
