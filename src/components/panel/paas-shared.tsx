"use client";
import { useState } from "react";
import { BTN_G, INPUT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { APP_STATUS, DEPLOY_STATUS, ENV_KEY_RE, ENV_RESERVED, hourlyOf } from "@/lib/paas";
import type { PaasPlanRow } from "@/lib/types";
import { Icon } from "../icon";
import { Badge } from "../ui";

export const StatusPill = ({ s, map = APP_STATUS }: { s: string; map?: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> }) => {
  const [label, tone] = map[s] ?? [s, "gray"];
  return <Badge tone={tone} dot>{label}</Badge>;
};
export const DeployPill = ({ s }: { s: string }) => <StatusPill s={s} map={DEPLOY_STATUS} />;

export const ramLabel = (mb: number) => (mb >= 1024 ? fa(mb / 1024, 1) + " گیگ" : fa(mb) + " مگ");
export const cpuLabel = (c: number) => c.toLocaleString("fa-IR", { maximumFractionDigits: 2 }) + " هسته";

/** monthly price with its hourly equivalent */
export function Cost({ monthly, className = "" }: { monthly: number; className?: string }) {
  return (
    <span className={className}>
      <b className="tabular">{toman(monthly)}</b> <span className="text-white/55 text-xs">در ماه</span>
      <span className="block text-[11px] text-white/50 tabular">ساعتی {fa(hourlyOf(monthly))} تومان از کیف پول</span>
    </span>
  );
}

export function PlanPicker({ plans, value, onChange, label }: { plans: PaasPlanRow[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 lg:grid-cols-3 gap-2">
      {plans.filter((p) => p.active).map((p) => {
        const on = p.id === value;
        return (
          <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(p.id)}
            className={"text-right rounded-2xl p-4 border transition " + (on ? "bg-sky-400/10 border-sky-300/50" : "bg-white/[0.03] border-white/[0.1] hover:border-white/25")}>
            <span className="flex items-center justify-between gap-2"><b>{p.name}</b>{on && <Icon name="circle-check" size={16} className="acc" />}</span>
            <span className="block text-xs text-white/60 mt-1.5">{cpuLabel(p.cpu)} · {ramLabel(p.ramMb)}{p.diskGb ? " · " + fa(p.diskGb) + " گیگ دیسک" : ""}</span>
            <span className="block text-sm mt-2 tabular">{toman(p.price)}<span className="text-[11px] text-white/50"> / ماه</span></span>
          </button>
        );
      })}
    </div>
  );
}

export type EnvRow = { key: string; value: string; secret: boolean; existing?: boolean };
/** parses KEY=value lines (.env format: comments, export, quotes) */
export function parseDotenv(text: string): EnvRow[] {
  const out: EnvRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out.push({ key: m[1], value: v.replace(/\\n/g, "\n"), secret: /SECRET|PASSWORD|TOKEN|KEY|PRIVATE/i.test(m[1]) });
  }
  return out;
}
export const envProblems = (rows: EnvRow[]) => {
  const keys = rows.map((r) => r.key.trim()).filter(Boolean);
  const bad = keys.find((k) => !ENV_KEY_RE.test(k) || ENV_RESERVED.has(k));
  if (bad) return "نام «" + bad + "» مجاز نیست.";
  if (new Set(keys).size !== keys.length) return "نام متغیرها تکراری است.";
  return "";
};

export function EnvEditor({ rows, onChange, locked = [] }: { rows: EnvRow[]; onChange: (r: EnvRow[]) => void; locked?: { key: string; note: string }[] }) {
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const set = (i: number, patch: Partial<EnvRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {locked.map((l) => (
        <div key={l.key} className="flex items-center gap-2 text-sm rounded-xl bg-white/[0.03] px-3 h-11">
          <Icon name="lock" size={14} className="text-white/50" /><span dir="ltr" className="font-mono">{l.key}</span><span className="text-[11px] text-white/50 mr-auto">{l.note}</span>
        </div>
      ))}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto_auto] gap-2 items-center">
          <label className="sr-only" htmlFor={"env-k-" + i}>نام متغیر</label>
          <input id={"env-k-" + i} value={r.key} disabled={r.existing} onChange={(e) => set(i, { key: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") })} dir="ltr" placeholder="KEY" className={INPUT + " font-mono text-left disabled:opacity-70"} />
          <label className="sr-only" htmlFor={"env-v-" + i}>مقدار {r.key}</label>
          <input id={"env-v-" + i} value={r.value} type={r.secret ? "password" : "text"} autoComplete="off" onChange={(e) => set(i, { value: e.target.value })} dir="ltr"
            placeholder={r.secret && r.existing ? "•••••• (بدون تغییر)" : "value"} className={INPUT + " font-mono text-left"} />
          <button type="button" aria-pressed={r.secret} aria-label={"محرمانه: " + (r.key || "متغیر")} title="محرمانه (مقدار دیگر نمایش داده نمی‌شود)" onClick={() => set(i, { secret: !r.secret })}
            className={"w-11 h-11 rounded-xl grid place-items-center border " + (r.secret ? "bg-amber-400/10 border-amber-300/40 text-amber-200" : "border-white/[0.12] text-white/50 hover:text-white")}><Icon name={r.secret ? "lock" : "eye"} size={15} /></button>
          <button type="button" aria-label={"حذف " + (r.key || "متغیر")} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="w-11 h-11 rounded-xl grid place-items-center border border-white/[0.12] text-white/50 hover:text-rose-300"><Icon name="trash-2" size={15} /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => onChange([...rows, { key: "", value: "", secret: false }])} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="plus" size={14} />متغیر</button>
        <button type="button" onClick={() => setPaste((p) => !p)} aria-expanded={paste} className={BTN_G + " h-9 px-3 text-xs"}><Icon name="file-text" size={14} />چسباندن فایل ‎.env</button>
      </div>
      {paste && (
        <div className="space-y-2">
          <label className="sr-only" htmlFor="dotenv">محتوای ‎.env</label>
          <textarea id="dotenv" rows={5} value={text} onChange={(e) => setText(e.target.value)} dir="ltr" placeholder={"DATABASE_HOST=...\nAPI_SECRET=..."} className={INPUT + " h-auto py-2.5 font-mono text-left text-xs leading-6"} />
          <button type="button" onClick={() => { const add = parseDotenv(text); const keep = rows.filter((r) => !add.some((a) => a.key === r.key)); onChange([...keep, ...add]); setText(""); setPaste(false); }} className={BTN_G + " h-9 px-3 text-xs"}>افزودن {fa(parseDotenv(text).length)} متغیر</button>
        </div>
      )}
    </div>
  );
}
