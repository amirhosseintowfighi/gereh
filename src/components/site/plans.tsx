"use client";
import { useEffect, useState } from "react";
import { BILLING, HOSTING, LOCS, VPS, type Plan } from "@/lib/catalog";
import { BTN_G, BTN_P, GLASS } from "@/lib/cls";
import { roundK, toman } from "@/lib/format";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { PriceTag, Switch, Tabs } from "../ui-client";

type Row = [icon: string, label: string, key: keyof Plan];

function PlanCard({ p, rows, onAdd, badge = "پرفروش‌ترین", priceBase, extra }: { p: Plan; rows: Row[]; onAdd: () => void; badge?: string; priceBase: number; extra?: React.ReactNode }) {
  return (
    <article className={"spot relative rounded-[1.75rem] p-6 flex flex-col backdrop-blur-md border transition-all duration-300 " +
      (p.popular ? "bg-white/[0.09] border-white/25 lg:-translate-y-3" : "bg-white/[0.045] border-white/[0.1] hover:border-white/20 hover:-translate-y-1")}
      style={p.popular ? { boxShadow: "0 40px 90px -40px rgba(125,180,255,.45), inset 0 1px 0 rgba(255,255,255,.12)" } : { boxShadow: "inset 0 1px 0 rgba(255,255,255,.06)" }}>
      {p.popular && <span className="absolute -top-3 right-6 text-[11px] font-black px-3 py-1 rounded-full bg-white text-slate-900 shadow-lg flex items-center gap-1"><Icon name="sparkles" size={12} />{badge}</span>}
      <h3 className="text-xl font-black ltr text-right">{p.name}</h3>
      {p.tag && <p className="text-xs text-white/55 mt-1.5">{p.tag}</p>}
      <div className="mt-5"><PriceTag base={priceBase} /></div>
      {extra}
      <ul className="mt-5 space-y-3 text-sm flex-1">
        {rows.map(([ic, label, key]) => (
          <li key={key} className="flex items-center gap-2.5">
            <Icon name={ic} size={16} className="acc" />
            <span className="text-white/50 text-xs w-[4.5rem] shrink-0">{label}</span>
            <span className="font-medium">{String(p[key] ?? "")}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onAdd} className={(p.popular ? BTN_P : BTN_G) + " mt-6 py-3 text-sm"} aria-label={"افزودن " + p.name + " به سبد"}><Icon name="plus" size={16} /> افزودن به سبد</button>
    </article>
  );
}

const VPS_ROWS: Row[] = [["cpu", "پردازنده", "cpu"], ["memory-stick", "رم", "ram"], ["hard-drive", "فضا", "disk"], ["arrow-down-up", "ترافیک", "traffic"], ["cable", "پورت", "port"], ["hash", "آی‌پی", "ipv4"]];
const VPS_ALL: Row[] = [...VPS_ROWS, ["camera", "اسنپ‌شات", "snap"], ["database-backup", "بکاپ", "backup"]];

export function VpsPlans() {
  const { addToCart } = useApp();
  const [kind, setKindRaw] = useState<"cloud" | "metal">("cloud");
  const [billing, setBilling] = useState("m");
  const [loc, setLoc] = useState("thr");
  const setKind = (k: string) => {
    setKindRaw(k as "cloud" | "metal");
    if (k === "metal" && !LOCS.find((l) => l.id === loc)?.metal) setLoc("thr");
  };
  useEffect(() => {
    const sync = () => { if (location.hash === "#dedicated") setKind("metal"); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const b = BILLING.find((x) => x.id === billing)!;
  const locs = kind === "metal" ? LOCS.filter((l) => l.metal) : LOCS;
  const locObj = LOCS.find((l) => l.id === loc) || LOCS[0];
  const monthly = (p: Plan, k: string) => roundK(p.price * (locObj.foreign && k === "cloud" ? 1.12 : 1) * (1 - b.disc));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div id="dedicated" className={GLASS + " scroll-mt-28 rounded-[1.75rem] p-3 sm:p-4 mb-10 flex flex-col lg:flex-row gap-3 lg:items-center justify-between"}>
        <div className="overflow-x-auto no-scrollbar"><Tabs value={kind} onChange={setKind} label="نوع سرور" options={[{ id: "cloud", label: "سرور ابری", icon: "cloud" }, { id: "metal", label: "سرور اختصاصی", icon: "server-cog" }]} /></div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="group" aria-label="موقعیت دیتاسنتر">
          {locs.map((l) => (
            <button type="button" key={l.id} onClick={() => setLoc(l.id)} aria-pressed={loc === l.id}
              className={"px-3 h-10 rounded-xl text-sm whitespace-nowrap border transition flex items-center gap-1.5 " + (loc === l.id ? "bg-white/[0.18] border-white/40" : "bg-white/[0.05] border-white/10 text-white/70 hover:bg-white/10")}>
              <Icon name="map-pin" size={14} />{l.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto no-scrollbar"><Tabs value={billing} onChange={setBilling} label="دوره پرداخت" options={BILLING} /></div>
      </div>

      {(["cloud", "metal"] as const).map((k) => {
        const plans = VPS[k];
        return (
          <div key={k} hidden={kind !== k}>
            <h2 className="sr-only-focusable">{k === "cloud" ? "پلن‌های سرور ابری" : "پلن‌های سرور اختصاصی"}</h2>
            <div className={"grid gap-5 " + (plans.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3")}>
              {plans.map((p) => (
                <PlanCard key={p.id} p={p} rows={VPS_ROWS} priceBase={monthly(p, k)}
                  extra={b.months > 1 ? <div className="text-[11px] text-emerald-300 mt-1">پرداخت {b.label}: {toman(monthly(p, k) * b.months)}</div> : null}
                  onAdd={() => addToCart({ title: (k === "cloud" ? "سرور ابری " : "سرور اختصاصی ") + p.name, meta: locObj.label + "، پرداخت " + b.label, base: monthly(p, k) * b.months, icon: "server" })} />
              ))}
            </div>

            <h2 className="text-xl font-black mt-16 mb-4 flex items-center gap-2"><Icon name="layout-dashboard" size={20} className="acc" />مقایسه کامل پلن‌های {k === "cloud" ? "سرور ابری" : "سرور اختصاصی"}</h2>
            <div className={GLASS + " rounded-[1.75rem] overflow-x-auto"} tabIndex={0} role="region" aria-label={"جدول مقایسه پلن‌های " + (k === "cloud" ? "سرور ابری" : "سرور اختصاصی")}>
              <table className="w-full min-w-[680px] text-sm">
                <thead><tr className="border-b border-white/15">
                  <th scope="col" className="text-right font-medium text-white/50 p-4">ویژگی</th>
                  {plans.map((p) => <th scope="col" key={p.id} className="p-4 text-center font-black ltr">{p.name}{p.popular && <Icon name="sparkles" size={13} className="inline acc mx-1" />}</th>)}
                </tr></thead>
                <tbody>
                  {VPS_ALL.map(([ic, label, key], i) => (
                    <tr key={key} className={"hover:bg-white/[0.06] transition-colors " + (i % 2 ? "bg-white/[0.03]" : "")}>
                      <th scope="row" className="p-4 text-white/70 font-normal text-right"><span className="flex items-center gap-2"><Icon name={ic} size={15} className="text-white/55" />{label}</span></th>
                      {plans.map((p) => <td key={p.id} className="p-4 text-center">{String(p[key] ?? "")}</td>)}
                    </tr>
                  ))}
                  {["محافظت DDoS", "دسترسی root و کنسول", "آی‌پی نسخه ۶"].map((f) => (
                    <tr key={f} className="hover:bg-white/[0.06] transition-colors">
                      <th scope="row" className="p-4 text-white/70 font-normal text-right"><span className="flex items-center gap-2"><Icon name="shield-check" size={15} className="text-white/55" />{f}</span></th>
                      {plans.map((p) => <td key={p.id} className="p-4 text-center"><Icon name="circle-check" size={18} className="inline text-emerald-300" /><span className="sr-only-focusable">دارد</span></td>)}
                    </tr>
                  ))}
                  <tr className="border-t border-white/15">
                    <th scope="row" className="p-4 font-bold text-right">قیمت ماهانه</th>
                    {plans.map((p) => <td key={p.id} className="p-4 text-center font-black">{toman(monthly(p, k))}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const HOST_ROWS: Row[] = [["hard-drive", "فضا", "disk"], ["globe", "سایت", "sites"], ["arrow-down-up", "ترافیک", "traffic"], ["mail", "ایمیل", "email"], ["database", "دیتابیس", "db"]];
export function HostingPlans() {
  const { addToCart } = useApp();
  const [kind, setKind] = useState<"linux" | "wordpress">("linux");
  const [yearly, setYearly] = useState(false);
  const mPrice = (p: Plan) => (yearly ? roundK(p.price * 0.85) : p.price);
  return (
    <>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
        <Tabs value={kind} onChange={(k) => setKind(k as "linux" | "wordpress")} label="نوع هاست" options={[{ id: "linux", label: "هاست لینوکس", icon: "server" }, { id: "wordpress", label: "هاست وردپرس", icon: "pen-tool" }]} />
        <div className={GLASS + " flex items-center gap-3 rounded-2xl px-4 h-12 text-sm"}>
          <span className={yearly ? "text-white/50" : "font-bold"}>ماهانه</span>
          <Switch on={yearly} onChange={setYearly} label="پرداخت سالانه" />
          <span className={yearly ? "font-bold" : "text-white/50"}>سالانه</span>
          <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-400/20 text-emerald-300">۱۵٪ کمتر</span>
        </div>
      </div>
      {(["linux", "wordpress"] as const).map((k) => {
        const plans = HOSTING[k];
        return (
          <div key={k} hidden={kind !== k}>
            <h2 className="sr-only-focusable">{k === "linux" ? "پلن‌های هاست لینوکس" : "پلن‌های هاست وردپرس"}</h2>
            <div className={"grid gap-5 " + (plans.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3 max-w-5xl mx-auto")}>
              {plans.map((p) => (
                <PlanCard key={p.id} p={p} rows={HOST_ROWS} badge="پیشنهاد ما" priceBase={mPrice(p)}
                  extra={yearly ? <div className="text-[11px] text-emerald-300 mt-1">صورت‌حساب سالانه: {toman(mPrice(p) * 12)}</div> : null}
                  onAdd={() => addToCart({ title: "هاست " + p.name, meta: (k === "linux" ? "لینوکس" : "وردپرس") + "، پرداخت " + (yearly ? "سالانه" : "ماهانه"), base: yearly ? mPrice(p) * 12 : p.price, icon: "layers" })} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
