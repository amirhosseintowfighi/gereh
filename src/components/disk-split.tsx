"use client";
/* Disk layout editor: a disk allowance split into several disks (sda 30 + sdb 50 …) with a live sum.
   Used on the server page (vps-panel.tsx) and in the order builder. */
import { BTN_G, BTN_SM, INPUT_BASE } from "@/lib/cls";
import { fa, toEnDigits } from "@/lib/format";
import { Icon } from "./icon";
import { IconBtn } from "./ui-client";

const num = (v: string) => +toEnDigits(v).replace(/\D/g, "") || 0;

/** sizes in GB, primary first; the live sum must equal the allowance */
export function DiskLayoutEditor({ allowance, sizes, onChange, max = 4 }: { allowance: number; sizes: number[]; onChange: (v: number[]) => void; max?: number }) {
  const sum = sizes.reduce((a, b) => a + b, 0), left = allowance - sum;
  const set = (i: number, v: number) => onChange(sizes.map((x, j) => (j === i ? v : x)));
  return (
    <div>
      <div className="space-y-2">
        {sizes.map((gb, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="mono text-xs w-10 text-white/60 ltr">{"sd" + String.fromCharCode(97 + i)}</span>
            <input value={String(gb)} onChange={(e) => set(i, num(e.target.value))} inputMode="numeric" dir="ltr" aria-label={"اندازه دیسک " + fa(i + 1) + " (گیگابایت)"} className={INPUT_BASE + " h-9 w-24 text-left tabular text-sm"} />
            <span className="text-xs text-white/50 min-w-0">گیگابایت{i === 0 && " · دیسک اصلی"}</span>
            {i > 0 && <IconBtn icon="x" label={"حذف دیسک " + fa(i + 1)} className="hover:text-rose-300 mr-auto" onClick={() => onChange(sizes.filter((_, j) => j !== i))} />}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <button type="button" disabled={sizes.length >= max || left < 5} onClick={() => onChange([...sizes, left])} className={BTN_G + BTN_SM}><Icon name="plus" size={14} /> دیسک دیگر</button>
        <span role="status" className={"text-xs tabular " + (left === 0 ? "text-emerald-300" : "text-amber-200")}>جمع {fa(sum)} از {fa(allowance)} گیگابایت{left > 0 ? "، " + fa(left) + " گیگ تقسیم‌نشده" : left < 0 ? "، " + fa(-left) + " گیگ بیش از سهم" : ""}</span>
      </div>
    </div>
  );
}
