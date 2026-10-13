"use client";
import { useState } from "react";
import { BTN_G, GLASS, INPUT } from "@/lib/cls";
import { fa, toEnDigits, toman } from "@/lib/format";
import { calcTotal, type CalcCatalog, type CalcLine } from "@/lib/vps-billing";
import { Icon } from "../icon";
import { Select } from "../ui-client";

export function CostCalculator({ cat }: { cat: CalcCatalog }) {
  const [lines, setLines] = useState<CalcLine[]>(cat[0] ? [{ group: cat[0].group, id: cat[0].items[0].id, qty: 1 }] : []);
  const [months, setMonths] = useState(1);
  const r = calcTotal(cat, lines, months);
  const set = (i: number, p: Partial<CalcLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  if (!cat.length) return <p className="text-center text-white/60 mt-10">فهرست قیمت‌ها در دسترس نیست.</p>;
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-10">
      <div className={GLASS + " rounded-3xl p-5 space-y-3"}>
        {lines.map((l, i) => {
          const g = cat.find((x) => x.group === l.group) ?? cat[0];
          const item = g.items.find((x) => x.id === l.id);
          return (
            <div key={i} className="grid sm:grid-cols-[170px_1fr_110px_auto] gap-2 items-center">
              <Select label="محصول" value={g.group} onChange={(v) => set(i, { group: v, id: cat.find((x) => x.group === v)!.items[0].id })} options={cat.map((x) => ({ value: x.group, label: x.label }))} />
              <div>
                <Select label="پلن" value={l.id} onChange={(v) => set(i, { id: v })} options={g.items.map((x) => ({ value: x.id, label: x.name + " — " + toman(x.monthly) }))} />
                {item && <div className="text-[11px] text-white/50 mt-1 px-1">{item.meta}</div>}
              </div>
              <input value={fa(l.qty)} onChange={(e) => set(i, { qty: Math.min(1000, +toEnDigits(e.target.value).replace(/\D/g, "") || 0) })} inputMode="numeric" aria-label={"تعداد (" + g.unit + ")"} title={g.unit} className={INPUT + " text-center tabular"} />
              <button type="button" aria-label="حذف ردیف" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="w-9 h-9 rounded-xl grid place-items-center text-white/60 hover:bg-white/[0.08]"><Icon name="x" size={16} /></button>
            </div>
          );
        })}
        <button type="button" onClick={() => setLines([...lines, { group: cat[0].group, id: cat[0].items[0].id, qty: 1 }])} className={BTN_G + " px-4 h-10 text-sm"}><Icon name="plus" size={16} /> افزودن سرویس</button>
      </div>
      <aside className={GLASS + " rounded-3xl p-5 h-fit lg:sticky lg:top-28"} aria-live="polite">
        <div className="flex items-center gap-2 font-bold"><Icon name="calculator" size={18} className="acc" /> برآورد هزینه</div>
        <label className="block text-xs text-white/55 mt-5 mb-2" htmlFor="calc-months">مدت: {fa(months)} ماه</label>
        <input id="calc-months" type="range" min={1} max={12} value={months} onChange={(e) => setMonths(+e.target.value)} className="w-full" />
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between"><dt className="text-white/55">ماهانه</dt><dd className="tabular">{toman(r.monthly)}</dd></div>
          <div className="flex justify-between text-lg font-black"><dt>جمع {fa(r.months)} ماه</dt><dd className="tabular">{toman(r.total)}</dd></div>
        </dl>
        <p className="text-[11px] text-white/50 mt-4 leading-6">بدون مالیات بر ارزش افزوده. سرور ابری ماهانه یا ساعتی، و بقیه سرویس‌ها ساعتی از کیف پول پرداخت می‌شوند.</p>
      </aside>
    </div>
  );
}
