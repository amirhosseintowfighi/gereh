/* «راه‌اندازی کسب‌وکار» sections shared by /business and the home page: plain words, no resource specs. */
import Link from "next/link";
import { BIZ_GOALS, BIZ_PACKAGES, BIZ_STEPS } from "@/lib/business";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { Icon } from "../icon";

/** «می‌خواهید چه چیزی راه بیندازید؟» — each goal leads to the package that fits it; «من برنامه‌نویسم» to the developer side */
export function BizGoals({ devHref = "/#developers" }: { devHref?: string }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {BIZ_GOALS.map((g) => {
        const dev = g.id === "dev";
        return (
          <li key={g.id}>
            <Link href={(dev ? devHref : "/business?goal=" + g.id + "#request") as never}
              className={"spot group h-full rounded-2xl p-5 flex flex-col gap-3 transition-colors " + (dev ? "border border-dashed border-white/20 hover:border-white/40 bg-white/[0.02]" : GLASS + " hover:border-white/35")}>
              <span className={"w-11 h-11 rounded-xl grid place-items-center border " + (dev ? "border-white/15 text-white/60" : "bg-white/[0.08] border-white/15 acc")}><Icon name={g.icon} size={21} /></span>
              <span className="font-extrabold">{g.title}</span>
              <span className="text-sm text-white/60 leading-7 flex-1">{g.text}</span>
              <span className="text-xs font-bold acc inline-flex items-center gap-1 group-hover:gap-2 transition-all">{dev ? "ابزارهای فنی" : "شروع کنید"}<Icon name="chevron-left" size={14} /></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** the four packages with what each one includes; prices excluding VAT */
export function BizPackages() {
  return (
    <ul className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
      {BIZ_PACKAGES.map((p) => (
        <li key={p.id} id={p.id} className={"relative rounded-[1.75rem] p-6 flex flex-col " + (p.popular ? "border-2 border-sky-300/50 bg-sky-400/[0.06]" : GLASS)}>
          {p.popular && <span className="absolute -top-3 start-6 text-[11px] font-bold px-2.5 py-1 rounded-full acc-bg">بیشترین انتخاب</span>}
          <h3 className="text-xl font-black">بسته {p.name}</h3>
          <p className="text-sm text-white/60 leading-7 mt-2 min-h-14">{p.for}</p>
          <div className="mt-5">
            {p.quote ? <div className="text-lg font-black">قیمت بعد از جلسه آشنایی</div> : <>
              <div className="font-black text-2xl tabular">{fa(p.monthly)} <span className="text-xs font-normal text-white/55">تومان در ماه</span></div>
              <div className="text-xs text-white/55 mt-1">به‌اضافه راه‌اندازی یک‌باره {toman(p.setup)}</div>
            </>}
            <div className="text-xs text-white/55 mt-1 flex items-center gap-1.5"><Icon name="clock" size={13} />{p.quote ? "زمان‌بندی " + p.days : "آماده در " + p.days}</div>
          </div>
          <ul className="mt-5 space-y-2.5 text-sm flex-1">
            {p.includes.map((t) => <li key={t} className="flex gap-2 items-start"><Icon name="check" size={16} className="acc shrink-0 mt-1" /><span className="text-white/80 leading-7">{t}</span></li>)}
          </ul>
          <Link href={(p.quote ? "/devops#request" : "/business?pkg=" + p.id + "#request") as never} className={(p.popular ? BTN_P : BTN_G) + " mt-6 h-11 text-sm"}>
            {p.quote ? "جلسه آشنایی رایگان" : "همین بسته را می‌خواهم"}<Icon name="arrow-left" size={16} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** how it works, in three steps */
export function BizSteps() {
  return (
    <ol className="grid md:grid-cols-3 gap-4">
      {BIZ_STEPS.map(([ic, t, d], i) => (
        <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-xl grid place-items-center bg-white/[0.08] border border-white/15 acc"><Icon name={ic} size={21} /></span>
            <span className="text-xs text-white/50">قدم {fa(i + 1)}</span>
          </div>
          <h3 className="font-extrabold mt-4">{t}</h3>
          <p className="text-white/60 text-sm leading-7 mt-2">{d}</p>
        </li>
      ))}
    </ol>
  );
}
