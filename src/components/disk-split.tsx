"use client";
/* Disk layout editor: a disk allowance split into several disks (sda 30 + sdb 50 …) with a live sum.
   Used on the server page (vps-panel.tsx) and in the order builder. Sizes move in 10 GB steps (min 10); a disk left
   as it was and, on an older server, the primary's remainder follow layoutSizeError (@/lib/catalog). */
import { DISK_MIN_GB, DISK_STEP_GB, layoutSizeError } from "@/lib/catalog";
import { BTN_G, BTN_SM, INPUT_BASE } from "@/lib/cls";
import { fa, toEnDigits } from "@/lib/format";
import { Icon } from "./icon";
import { IconBtn } from "./ui-client";

const num = (v: string) => +toEnDigits(v).replace(/\D/g, "") || 0;

/** sizes in GB, primary first; the live sum must equal the allowance. current: the server's disks now (kept as is) */
export function DiskLayoutEditor({ allowance, sizes, onChange, max = 4, current = [] }: { allowance: number; sizes: number[]; onChange: (v: number[]) => void; max?: number; current?: number[] }) {
  const sum = sizes.reduce((a, b) => a + b, 0), left = allowance - sum;
  const rem = allowance % DISK_STEP_GB;
  const set = (i: number, v: number) => onChange(sizes.map((x, j) => (j === i ? v : x)));
  /** the nearest allowed size for disk i (an unchanged disk stays as it is) */
  const snap = (i: number, v: number) => {
    if (current[i] === v) return v;
    const off = i === 0 ? rem : 0;
    return Math.max(DISK_MIN_GB + off, Math.round((v - off) / DISK_STEP_GB) * DISK_STEP_GB + off);
  };
  const error = layoutSizeError(current, sizes, allowance);
  return (
    <div>
      <div className="space-y-2">
        {sizes.map((gb, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="mono text-xs w-10 text-white/60 ltr">{"sd" + String.fromCharCode(97 + i)}</span>
            <IconBtn icon="minus" label={"کم کردن دیسک " + fa(i + 1)} onClick={() => set(i, snap(i, gb - DISK_STEP_GB))} />
            <input value={String(gb)} onChange={(e) => set(i, num(e.target.value))} onBlur={() => set(i, snap(i, gb))} inputMode="numeric" dir="ltr" role="spinbutton"
              aria-valuemin={DISK_MIN_GB} aria-valuemax={allowance} aria-valuenow={gb} aria-label={"اندازه دیسک " + fa(i + 1) + " (گیگابایت، گام " + fa(DISK_STEP_GB) + ")"}
              onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); set(i, snap(i, gb + (e.key === "ArrowUp" ? DISK_STEP_GB : -DISK_STEP_GB))); } }}
              className={INPUT_BASE + " h-9 w-20 text-left tabular text-sm"} />
            <IconBtn icon="plus" label={"افزایش دیسک " + fa(i + 1)} onClick={() => set(i, snap(i, gb + DISK_STEP_GB))} />
            <span className="text-xs text-white/50 min-w-0">گیگابایت{i === 0 && " · دیسک اصلی"}</span>
            {i > 0 && <IconBtn icon="x" label={"حذف دیسک " + fa(i + 1)} className="hover:text-rose-300 mr-auto" onClick={() => onChange(sizes.filter((_, j) => j !== i))} />}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <button type="button" disabled={sizes.length >= max || left < DISK_MIN_GB} onClick={() => onChange([...sizes, Math.floor(left / DISK_STEP_GB) * DISK_STEP_GB])} className={BTN_G + BTN_SM}><Icon name="plus" size={14} /> دیسک دیگر</button>
        <span role="status" className={"text-xs tabular " + (left === 0 ? "text-emerald-300" : "text-amber-200")}>جمع {fa(sum)} از {fa(allowance)} گیگابایت{left > 0 ? "، " + fa(left) + " گیگ تقسیم‌نشده" : left < 0 ? "، " + fa(-left) + " گیگ بیش از سهم" : ""}</span>
      </div>
      <p className={"text-[11px] mt-2 " + (error ? "text-amber-200" : "text-white/50")}>{error || "هر دیسک دست‌کم " + fa(DISK_MIN_GB) + " گیگابایت، در گام‌های " + fa(DISK_STEP_GB) + " گیگابایتی."}</p>
    </div>
  );
}
