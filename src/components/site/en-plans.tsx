import Link from "next/link";
import { enSpec, PLAN_EN, tomanEn } from "@/content/en";
import type { Plan } from "@/lib/catalog";
import { BTN_G, BTN_P, GLASS } from "@/lib/cls";
import { Icon } from "../icon";

/** read-only plan cards for the English site; ordering continues on the Persian page */
export function EnPlans({ plans, rows, order, unit = "/ month" }: { plans: Plan[]; rows: [string, keyof Plan][]; order: string; unit?: string }) {
  return (
    <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {plans.filter((p) => p.active !== false).map((p) => (
        <li key={p.id} className={GLASS + " rounded-2xl p-6 flex flex-col " + (p.popular ? "ring-1 ring-sky-300/40" : "")}>
          <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-black">{PLAN_EN[p.id]?.name ?? p.name}</h3>{p.popular && <span className="text-[11px] px-2 py-0.5 rounded-md bg-sky-400/15 text-sky-200">Popular</span>}</div>
          {(PLAN_EN[p.id]?.tag ?? (/^[\x20-\x7e]+$/.test(p.tag || "") ? p.tag : "")) && <p className="text-xs text-white/55 mt-1">{PLAN_EN[p.id]?.tag ?? p.tag}</p>}
          <p className="mt-4"><span className="text-2xl font-black tabular">{tomanEn(p.price)}</span> <span className="text-xs text-white/55">{unit}</span></p>
          <dl className="mt-4 space-y-2 text-sm flex-1">
            {rows.map(([label, key]) => p[key] ? <div key={label} className="flex justify-between gap-3"><dt className="text-white/55">{label}</dt><dd className="font-medium text-right">{enSpec(String(p[key]))}</dd></div> : null)}
          </dl>
          <Link href={order as never} hrefLang="fa" className={(p.popular ? BTN_P : BTN_G) + " mt-6 h-11 text-sm"}>Order <Icon name="arrow-up-right" size={15} /></Link>
        </li>
      ))}
    </ul>
  );
}

export function EnFaq({ items }: { items: [string, string][] }) {
  return (
    <div className="space-y-3">{items.map(([q, a]) => (
      <details key={q} className="rounded-2xl p-5 bg-white/[0.035] border border-white/[0.08] group">
        <summary className="font-bold cursor-pointer list-none flex justify-between gap-3">{q}<Icon name="chevron-down" size={18} className="group-open:rotate-180 transition shrink-0" /></summary>
        <p className="mt-3 text-white/70 leading-8 text-sm">{a}</p>
      </details>
    ))}</div>
  );
}

export const ORDER_NOTE = "Checkout and the customer panel are in Persian; our support team answers in English 24/7.";
