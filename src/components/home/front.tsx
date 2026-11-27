"use client";
/* The top of the home page: one promise, one search box (a domain, or a site described to the AI builder) and the
   main products with their starting prices. Prices come from the catalog in the store, as staff set them. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GirihField } from "@/components/girih";
import { BUILDER } from "@/lib/builder";
import { bizFromMonthly } from "@/lib/business";
import { parseDomain } from "@/lib/catalog";
import { BTN_P, GLASS, GLASS_STRONG } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { useDB } from "@/lib/store";
import { useApp } from "../app-context";
import { Icon } from "../icon";
import { Tabs } from "../ui-client";
import { DomainInput } from "./interactive";

/** where /panel/build picks the idea up after sign-in (the redirect to /auth drops the query string); same key in panel/builder.tsx */
const IDEA_KEY = "gereh-build-idea";

function SearchBox() {
  const { searchDomain } = useApp();
  const router = useRouter();
  const tlds = useDB().tlds;
  const [tab, setTab] = useState("domain");
  const [q, setQ] = useState("");
  const [idea, setIdea] = useState("");
  const parsed = parseDomain(q);
  const base = "name" in parsed && parsed.name ? parsed.name : "mybrand";
  const build = () => {
    const t = idea.trim();
    try { if (t) sessionStorage.setItem(IDEA_KEY, t); } catch { /* storage blocked: the query string still carries it */ }
    router.push(("/panel/build" + (t ? "?idea=" + encodeURIComponent(t) : "")) as never);
  };
  return (
    <div className={GLASS_STRONG + " rounded-[1.6rem] p-2.5 sm:p-3 text-start"}>
      <Tabs full value={tab} onChange={setTab} label="از کجا شروع کنید" options={[
        { id: "domain", label: "جستجوی دامنه", icon: "globe" },
        { id: "build", label: "ساخت سایت با AI", icon: "sparkles" },
      ]} />
      <div className="p-2 sm:p-3 pt-4" role="tabpanel">
        {tab === "domain" ? (
          <div key="d" className="fade-in">
            <DomainInput value={q} onChange={setQ} onSearch={() => searchDomain(q)} />
            <div className="mt-3 flex flex-wrap gap-2 justify-center">
              {[".ir", ".com", ".shop", ".net"].map((t) => {
                const d = tlds.find((x) => x.tld === t);
                if (!d) return null;
                return (
                  <button type="button" key={t} onClick={() => searchDomain(base + t)}
                    className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-2 bg-white/[0.04] border border-white/10 hover:bg-white/[0.09] hover:border-white/20 transition">
                    <span className="font-black ltr">{t}</span><span className="text-white/55 tabular">{toman(d.reg)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <form key="b" className="fade-in" onSubmit={(e) => { e.preventDefault(); build(); }}>
            <label htmlFor="home-idea" className="sr-only">سایتی که می‌خواهید را توضیح دهید</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input id="home-idea" value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={400}
                placeholder="مثلا: سایت کافه با منو، آدرس و دکمه سفارش در واتس‌اپ"
                className="flex-1 min-w-0 h-14 rounded-2xl px-5 bg-black/30 border border-white/15 outline-none focus:border-white/40 text-base" />
              <button type="submit" className={BTN_P + " h-14 px-6"}><Icon name="sparkles" size={18} />بساز</button>
            </div>
            <p className="mt-3 text-xs text-white/55 text-center">{BUILDER.name} از روی توضیح شما سایت را می‌سازد؛ بعد با گفتگو تغییرش می‌دهید.</p>
          </form>
        )}
      </div>
    </div>
  );
}

const TRUST: [string, string][] = [["headset", "پشتیبانی فارسی شبانه‌روزی"], ["badge-check", "۷ روز ضمانت بازگشت وجه"], ["shield-check", "تعهد آپتایم ۹۹٫۹٪"]];

export function FrontHero() {
  return (
    <section className="relative overflow-hidden">
      <GirihField />
      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pt-14 sm:pt-24 pb-14 text-center">
        <Link href={"/status" as never} className="hero-in inline-flex items-center gap-2 text-xs text-white/60 hover:text-white transition">
          <Icon name="activity" size={14} className="acc" />وضعیت لحظه‌ای سرویس‌ها<Icon name="chevron-left" size={14} />
        </Link>
        <h1 className="hero-in d2 hero-title mt-6 text-[2.3rem] sm:text-[4rem] font-black leading-[1.3] sm:leading-[1.2]">هر چیزی که برای آنلاین شدن لازم دارید</h1>
        <p className="hero-in d3 mt-5 text-white/65 text-base sm:text-lg leading-8 max-w-2xl mx-auto">دامنه، سایت و فروشگاه آماده، هاست و سرور ابری؛ با یک حساب و یک کیف پول.</p>
        <div className="hero-in d3 mt-9"><SearchBox /></div>
        <ul className="hero-in d4 mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/65">
          {TRUST.map(([ic, t]) => <li key={t} className="flex items-center gap-2"><Icon name={ic} size={16} className="acc" />{t}</li>)}
        </ul>
      </div>
    </section>
  );
}

const MORE: [string, string][] = [["/paas", "گره اپ (PaaS)"], ["/paas/databases", "پایگاه داده"], ["/wordpress", "وردپرس مدیریت‌شده"], ["/mail", "ایمیل سازمانی"], ["/storage", "فضای ذخیره‌سازی"], ["/geo-dns", "Geo DNS"], ["/ai-api", "API هوش مصنوعی"], ["/inquiry", "API استعلام"], ["/devops", "خدمات دواپس"], ["/vps#dedicated", "سرور اختصاصی"]];

/** the four main products with «شروع قیمت از», then every other service as a chip */
export function ProductCards() {
  const db = useDB();
  const min = (xs: number[]) => (xs.length ? Math.min(...xs) : 0);
  const visible = <T extends { price: number; active?: boolean }>(ps: T[]) => ps.filter((p) => p.active !== false && p.price > 0).map((p) => p.price);
  const ir = db.tlds.find((t) => t.tld === ".ir");
  const cards = [
    { icon: "store", title: "سایت و فروشگاه آماده", text: "ما می‌سازیم، راه می‌اندازیم و هر ماه نگه می‌داریم؛ دامنه، ایمیل و درگاه پرداخت هم با ما.", from: bizFromMonthly(db.bizPackages), unit: "در ماه", href: "/business", cta: "بسته‌ها و قیمت", star: true },
    { icon: "layers", title: "هاست وب", text: "برای وردپرس و سایت‌های معمولی؛ قفل امنیتی (SSL) رایگان و پشتیبان‌گیری روزانه.", from: min(visible(db.plans.hosting)), unit: "در ماه", href: "/hosting", cta: "مشاهده و خرید" },
    { icon: "server", title: "سرور ابری", text: "آماده در کمتر از یک دقیقه با دسترسی کامل؛ ساعتی بپردازید، هر وقت خواستید حذف کنید.", from: min(visible(db.plans.cloud)), unit: "در ماه", href: "/vps", cta: "مشاهده و خرید" },
    { icon: "globe", title: "دامنه", text: "دامنه .ir و بیش از ۱۵ پسوند بین‌المللی؛ ثبت فوری و انتقال رایگان.", from: ir?.reg ?? 0, unit: "در سال", href: "/domains", cta: "جستجوی دامنه" },
  ];
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" aria-label="محصولات اصلی">
      <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c) => (
          <li key={c.title} className={"spot rounded-[1.6rem] p-4 sm:p-6 flex flex-col transition-colors " + (c.star ? "border-2 border-sky-300/40 bg-sky-400/[0.06]" : GLASS + " hover:border-white/30")}>
            <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl grid place-items-center bg-white/[0.08] border border-white/15 acc"><Icon name={c.icon} size={22} /></span>
            <h2 className="mt-4 sm:mt-5 text-base sm:text-xl font-black leading-7">{c.title}</h2>
            {c.from > 0 && <p className="mt-2 text-xs sm:text-sm text-white/60 leading-6 max-sm:flex-1">شروع قیمت از <b className="text-white text-sm sm:text-base tabular">{fa(c.from)}</b> تومان {c.unit}</p>}
            <p className="mt-3 text-sm text-white/60 leading-7 flex-1 max-sm:hidden">{c.text}</p>
            <Link href={c.href as never} className={(c.star ? BTN_P : "inline-flex items-center justify-center gap-2 rounded-xl font-bold bg-white/[0.07] border border-white/15 hover:bg-white/[0.12] transition") + " mt-4 sm:mt-5 h-10 sm:h-11 text-xs sm:text-sm"}>{c.cta}<Icon name="arrow-left" size={16} className="max-sm:hidden" /></Link>
          </li>
        ))}
      </ul>
      <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="سرویس‌های دیگر">
        {MORE.map(([h, t]) => <li key={h}><Link href={h as never} className="inline-flex items-center h-9 px-3.5 rounded-xl text-xs text-white/70 bg-white/[0.04] border border-white/[0.1] hover:text-white hover:border-white/25 transition">{t}</Link></li>)}
      </ul>
    </section>
  );
}
