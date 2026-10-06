"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TLDS, TLD_CATS, isAvailable, parseDomain, type Tld } from "@/lib/catalog";
import { BTN_G, BTN_P, GLASS, GLASS_STRONG } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { useApp } from "../app-context";
import { DomainInput } from "../home/interactive";
import { Icon } from "../icon";
import { PriceTag, Tabs } from "../ui-client";

type Res = Tld & { domain: string; available: boolean };
type BulkRes = Res | { domain: string; invalid: true };

export function DomainSearch() {
  const { addToCart, cart } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlQ = params.get("q") || "";
  const [mode, setMode] = useState("single");
  const [q, setQ] = useState(urlQ);
  const [bulk, setBulk] = useState("");
  const [bulkTld, setBulkTld] = useState(".ir");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ primary: Res; others: Res[] } | null>(null);
  const [bulkRes, setBulkRes] = useState<BulkRes[] | null>(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("all");
  const [filter, setFilter] = useState("");
  const [nonce, setNonce] = useState(0);
  const inCart = (d: string) => cart.some((c) => c.title === d);

  // the URL (?q=) is the single source of truth for single searches, so results are shareable
  useEffect(() => {
    if (!urlQ) return;
    const parsed = parseDomain(urlQ);
    let alive = true;
    const t0 = setTimeout(() => {
      setMode("single"); setQ(urlQ);
      if ("error" in parsed && parsed.error) { setError(parsed.error); setResult(null); setLoading(false); return; }
      setError(""); setLoading(true); setResult(null);
    }, 0);
    // ponytail: simulated latency; real availability comes from GET /domains/check?name=
    const t = setTimeout(() => {
      if (!alive || !("name" in parsed)) return;
      const ptld = parsed.tld || ".ir";
      const list = TLDS.map((x) => ({ ...x, domain: parsed.name + x.tld, available: isAvailable(parsed.name, x.tld) }));
      setResult({ primary: list.find((x) => x.tld === ptld)!, others: list.filter((x) => x.tld !== ptld).sort((a, b) => Number(b.available) - Number(a.available) || Number(!!b.hot) - Number(!!a.hot)) });
      setLoading(false);
    }, 700);
    return () => { alive = false; clearTimeout(t0); clearTimeout(t); };
  }, [urlQ, nonce]);

  const search = (v: string) => {
    const val = v.trim();
    const parsed = parseDomain(val);
    if ("error" in parsed && parsed.error) { setError(parsed.error); setResult(null); return; }
    if (val === urlQ) setNonce((n) => n + 1);
    else router.replace((pathname + "?q=" + encodeURIComponent(val)) as never, { scroll: false });
  };
  const runBulk = () => {
    const names = bulk.split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
    if (!names.length) { setError("هر نام را در یک خط بنویسید."); return; }
    setError(""); setLoading(true);
    setTimeout(() => {
      const t = TLDS.find((x) => x.tld === bulkTld)!;
      setBulkRes(names.map((n) => { const p = parseDomain(n); return "name" in p ? { ...t, domain: p.name + bulkTld, available: isAvailable(p.name, bulkTld) } : { domain: n, invalid: true as const }; }));
      setLoading(false);
    }, 700);
  };
  const order = (d: Res) => addToCart({ title: d.domain, meta: "ثبت یک‌ساله", base: d.reg, icon: "globe", ltr: true });
  const tldList = useMemo(() => TLDS.filter((t) => (cat === "all" || t.cat === cat) && t.tld.includes(filter.trim().toLowerCase())), [cat, filter]);
  const parsedQ = parseDomain(q);
  const baseName = "name" in parsedQ && parsedQ.name ? parsedQ.name : "mybrand";

  const addBtn = (d: Res, small?: boolean) => inCart(d.domain)
    ? <span className={"inline-flex items-center gap-1.5 text-emerald-300 font-bold " + (small ? "text-xs" : "text-sm")}><Icon name="circle-check" size={small ? 15 : 18} /> در سبد</span>
    : <button type="button" onClick={() => order(d)} aria-label={"ثبت " + d.domain} className={small ? BTN_G + " px-3 py-1.5 text-xs" : BTN_P + " px-5 py-3 text-sm"}><Icon name="plus" size={small ? 14 : 16} /> ثبت</button>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-center mb-4"><Tabs size="sm" value={mode} onChange={(m) => { setMode(m); setError(""); }} label="نوع جست‌وجو" options={[{ id: "single", label: "جست‌وجوی تکی", icon: "search" }, { id: "bulk", label: "جست‌وجوی گروهی", icon: "layers" }]} /></div>
        <div className={GLASS_STRONG + " rounded-[1.5rem] p-2.5 shadow-2xl shadow-black/30"}>
          {mode === "single" ? <DomainInput value={q} onChange={setQ} onSearch={() => search(q)} loading={loading} /> : (
            <form className="fade-in" onSubmit={(e) => { e.preventDefault(); runBulk(); }}>
              <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} dir="ltr" placeholder={"mybrand\ncafe-online\nstudio"} aria-label="فهرست نام‌ها (هر نام در یک خط)"
                className="w-full rounded-2xl bg-black/20 border border-white/15 focus:border-white/40 outline-none p-4 text-left placeholder:text-white/30 resize-none" />
              <div className="mt-2 flex items-center gap-2">
                <select value={bulkTld} onChange={(e) => setBulkTld(e.target.value)} aria-label="پسوند" className="h-11 rounded-xl bg-white/10 border border-white/20 px-3 outline-none ltr">
                  {TLDS.map((t) => <option key={t.tld} value={t.tld} className="bg-[#0d1018]">{t.tld}</option>)}
                </select>
                <button type="submit" disabled={loading} className={BTN_P + " flex-1 h-11"}><Icon name={loading ? "loader-circle" : "search"} size={18} className={loading ? "animate-spin" : ""} /> بررسی همه</button>
              </div>
            </form>
          )}
        </div>
        {error && <div role="alert" className="pop-in mt-3 flex items-start gap-2 text-sm text-rose-200 bg-rose-500/15 border border-rose-300/30 rounded-xl p-3"><Icon name="circle-alert" size={18} className="mt-0.5" />{error}</div>}
      </div>

      <div aria-live="polite" aria-busy={loading}>
        {loading && mode === "single" && (
          <div className="max-w-4xl mx-auto mt-10 space-y-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-white/[0.06] border border-white/10 animate-pulse" style={{ animationDelay: i * 0.1 + "s" }} />)}
          </div>
        )}
        {mode === "single" && result && !loading && (
          <div className="max-w-4xl mx-auto mt-10 fade-in">
            <div className={"rounded-[1.75rem] p-6 sm:p-7 backdrop-blur-md border flex flex-col sm:flex-row sm:items-center justify-between gap-5 " + (result.primary.available ? "bg-emerald-400/[0.13] border-emerald-300/40" : "bg-rose-400/10 border-rose-300/30")}>
              <div className="flex items-center gap-4">
                <div className={"w-14 h-14 rounded-2xl grid place-items-center " + (result.primary.available ? "bg-emerald-400/25 text-emerald-200" : "bg-rose-400/20 text-rose-200")}>
                  <Icon name={result.primary.available ? "circle-check" : "circle-x"} size={28} />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-black ltr text-right">{result.primary.domain}</h2>
                  <div className="text-sm text-white/70 mt-1">{result.primary.available ? "آزاد است و همین حالا قابل ثبت است." : "قبلا ثبت شده است. پسوندهای آزاد را پایین‌تر ببینید."}</div>
                </div>
              </div>
              {result.primary.available && <div className="flex items-center gap-4"><div className="text-left"><PriceTag base={result.primary.reg} suffix="تومان / سال" big={false} /></div>{addBtn(result.primary)}</div>}
            </div>
            <ul className={GLASS + " rounded-[1.75rem] mt-4 divide-y divide-white/10 overflow-hidden"}>
              {result.others.map((d) => (
                <li key={d.tld} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-white/[0.05] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={"w-2 h-2 rounded-full shrink-0 " + (d.available ? "bg-emerald-400" : "bg-white/25")} />
                    <span className={"font-bold ltr truncate " + (d.available ? "" : "text-white/40 line-through")}>{d.domain}</span>
                    {d.promo && d.available && <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-300/20 text-amber-200 shrink-0 flex items-center gap-1"><Icon name="badge-percent" size={11} />تخفیف</span>}
                  </div>
                  {d.available
                    ? <div className="flex items-center gap-3 shrink-0"><span className="text-sm text-white/75 hidden sm:inline">{toman(d.reg)}</span>{addBtn(d, true)}</div>
                    : <span className="text-xs text-white/40 shrink-0">ثبت شده</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {mode === "bulk" && bulkRes && !loading && (
          <ul className={GLASS + " max-w-4xl mx-auto mt-10 rounded-[1.75rem] divide-y divide-white/10 overflow-hidden fade-in"}>
            {bulkRes.map((d, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <span className={"font-bold ltr truncate " + ("available" in d && d.available ? "" : "text-white/40")}>{d.domain}</span>
                {"invalid" in d ? <span className="text-xs text-rose-200">نام نامعتبر</span>
                  : d.available ? <div className="flex items-center gap-3"><span className="text-sm text-white/75 hidden sm:inline">{toman(d.reg)}</span>{addBtn(d, true)}</div>
                  : <span className="text-xs text-white/40">ثبت شده</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="mt-24" aria-labelledby="tld-h">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-5">
          <div>
            <h2 id="tld-h" className="text-2xl font-black">تعرفه پسوندها</h2>
            <p className="text-white/55 text-sm mt-2">قیمت برای یک سال و به تومان. انتقال دامنه‌های ملی رایگان است.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="rounded-xl flex items-center px-3 h-10 bg-white/10 border border-white/20 focus-within:border-white/40">
              <Icon name="search" size={16} className="text-white/50" />
              <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="فیلتر پسوند" aria-label="فیلتر پسوند" className="bg-transparent outline-none text-sm px-2 w-32 placeholder:text-white/40" />
            </div>
            <div className="overflow-x-auto no-scrollbar"><Tabs size="sm" value={cat} onChange={setCat} label="دسته پسوند" options={TLD_CATS} /></div>
          </div>
        </div>
        <div className={GLASS + " rounded-[1.75rem] overflow-x-auto"}>
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b border-white/15 text-white/50">
              <th scope="col" className="text-right font-medium p-4">پسوند</th><th scope="col" className="font-medium p-4">ثبت</th><th scope="col" className="font-medium p-4">تمدید</th><th scope="col" className="font-medium p-4">انتقال</th><th className="p-4"><span className="sr-only-focusable">بررسی</span></th>
            </tr></thead>
            <tbody>
              {tldList.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-white/55">پسوندی با این عبارت پیدا نشد. فیلتر را پاک کنید.</td></tr>}
              {tldList.map((t, i) => (
                <tr key={t.tld} className={"hover:bg-white/[0.06] transition-colors " + (i % 2 ? "bg-white/[0.03]" : "")}>
                  <th scope="row" className="p-4 text-right font-normal">
                    <span className="font-black text-base ltr">{t.tld}</span>
                    {t.hot && <span className="mr-2 text-[10px] px-2 py-0.5 rounded-md bg-white/10 border border-white/15 acc">محبوب</span>}
                    {t.promo && <span className="mr-2 text-[10px] px-2 py-0.5 rounded-md bg-amber-300/20 text-amber-200">تخفیف</span>}
                  </th>
                  <td className="p-4 text-center font-bold">{fa(t.reg)}</td>
                  <td className="p-4 text-center text-white/70">{fa(t.renew)}</td>
                  <td className="p-4 text-center text-white/70">{t.transfer === 0 ? "رایگان" : fa(t.transfer)}</td>
                  <td className="p-4 text-left">
                    <button type="button" onClick={() => { setMode("single"); search(baseName + t.tld); window.scrollTo({ top: 0 }); }} className={BTN_G + " px-3 py-1.5 text-xs"} aria-label={"بررسی " + baseName + t.tld}>
                      <Icon name="search" size={14} /> بررسی
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
