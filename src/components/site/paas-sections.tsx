import Link from "next/link";
import { DB_FAQ, PAAS_COMPARE, PAAS_FEATURES, PAAS_STEPS, STACK_GUIDES } from "@/content/paas";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { DB_ENGINES, DISK_PRICE_GB, hourlyOf, stackOf, type PaasPlan } from "@/lib/paas";
import { Icon } from "../icon";
import { SectionHead } from "../ui";

const ram = (mb: number) => (mb >= 1024 ? fa(mb / 1024) + " گیگ" : fa(mb) + " مگ");
const cpu = (c: number) => c.toLocaleString("fa-IR", { maximumFractionDigits: 2 }) + " هسته";

export function PaasFeatures() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="هر چیزی که اپ شما در production لازم دارد" sub="بدون نصب سرور، بدون Nginx، بدون certbot؛ با همان کدی که الان دارید." />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PAAS_FEATURES.map((f) => (
          <li key={f.title} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
            <Icon name={f.icon} size={22} className="acc" />
            <h3 className="font-extrabold mt-3">{f.title}</h3>
            <p className="text-white/60 text-sm leading-7 mt-1.5">{f.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PaasSteps() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6">
      <SectionHead title="از کد تا آدرس HTTPS در چند دقیقه" />
      <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PAAS_STEPS.map(([ic, t, d], i) => (
          <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6 relative"}>
            <span className="absolute top-5 left-5 text-4xl font-black text-white/[0.07] tabular">{fa(i + 1)}</span>
            <Icon name={ic} size={22} className="acc" />
            <h3 className="font-extrabold mt-3">{t}</h3>
            <p className="text-white/60 text-sm leading-7 mt-1">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PaasTerminal() {
  return (
    <div className={GLASS + " rounded-[1.5rem] overflow-hidden text-left"} dir="ltr">
      <div className="flex gap-1.5 px-4 py-3 border-b border-white/[0.08]" aria-hidden="true"><span className="w-3 h-3 rounded-full bg-rose-400/70" /><span className="w-3 h-3 rounded-full bg-amber-300/70" /><span className="w-3 h-3 rounded-full bg-emerald-400/70" /></div>
      <pre tabIndex={0} className="p-5 text-[12.5px] leading-7 font-mono text-white/80 overflow-x-auto" aria-label="نمونه استقرار با CLI">
        <span className="text-white/45">$</span> npx @gereh/cli deploy{"\n"}
        <span className="text-white/45">==&gt;</span> Packing project (214 files, 1.8 MB){"\n"}
        <span className="text-white/45">==&gt;</span> Detected Next.js (node 22){"\n"}
        <span className="text-white/45">==&gt;</span> Building… <span className="text-emerald-300">done in 41s</span>{"\n"}
        <span className="text-white/45">==&gt;</span> Rolling out 2 instances… <span className="text-emerald-300">healthy</span>{"\n"}
        <span className="text-emerald-300">✓</span> Live at <span className="acc">https://my-shop.gereh.app</span>
      </pre>
    </div>
  );
}

export function PaasPricing({ plans, kind = "app" }: { plans: PaasPlan[]; kind?: "app" | "db" }) {
  const list = plans.filter((p) => p.kind === kind && p.active);
  if (!list.length) return null;
  const popular = kind === "app" ? "app-small" : "db-small";
  return (
    <section id={kind === "app" ? "pricing" : "db-pricing"} className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title={kind === "app" ? "قیمت اپ‌ها" : "قیمت پایگاه داده"} sub={kind === "app" ? "قیمت هر نمونه؛ پرداخت ساعتی از کیف پول و فقط برای زمانی که روشن است." : "شامل دیسک NVMe، پشتیبان روزانه با ۷ روز نگهداری و پایش."} />
      <div className={GLASS + " rounded-[1.75rem] overflow-hidden"}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={kind === "app" ? "جدول قیمت اپ" : "جدول قیمت پایگاه داده"}>
          <table className="w-full text-sm">
            <thead><tr className="text-white/55 text-xs text-right"><th className="p-4">پلن</th><th className="p-4">پردازنده</th><th className="p-4">حافظه</th>{kind === "db" && <th className="p-4">دیسک</th>}<th className="p-4">ساعتی</th><th className="p-4">ماهانه</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id} className={"border-t border-white/[0.06] " + (p.id === popular ? "bg-sky-400/[0.06]" : "")}>
                <td className="p-4 font-bold">{p.name}{p.id === popular && <span className="mr-2 text-[10px] px-2 py-0.5 rounded-full acc-bg">محبوب</span>}</td>
                <td className="p-4">{cpu(p.cpu)}</td><td className="p-4">{ram(p.ramMb)}</td>{kind === "db" && <td className="p-4">{fa(p.diskGb)} گیگ</td>}
                <td className="p-4 tabular">{fa(hourlyOf(p.price))} تومان</td>
                <td className="p-4 tabular font-bold">{toman(p.price)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
        {(kind === "app" ? ["SSL، دامنه و ترافیک بدون هزینه اضافه", "دیسک دائمی: ماهانه " + toman(DISK_PRICE_GB) + " هر گیگ", "اپ خاموش = بدون هزینه پردازش"] : ["پشتیبان دستی تا ۱۰ نسخه بدون هزینه", "ارتقای پلن با چند ثانیه ری‌استارت", "بدون هزینه ترافیک داخلی"]).map((t) => <li key={t} className="flex items-center gap-2"><Icon name="check" size={15} className="acc" />{t}</li>)}
      </ul>
    </section>
  );
}

export function PaasStacks({ title = "زبان‌ها و فریم‌ورک‌ها" }: { title?: string }) {
  return (
    <section id="stacks" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title={title} sub="بیلد خودکار، بدون نوشتن Dockerfile. اگر Dockerfile دارید، همان استفاده می‌شود." />
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {STACK_GUIDES.map((g) => (
          <li key={g.slug}><Link href={("/paas/" + g.slug) as never} className={GLASS_SOFT + " rounded-2xl p-4 block text-center hover:border-white/25 transition h-full"}>
            <b className="block text-sm" dir="ltr">{stackOf(g.id)?.label}</b>
            <span className="block text-[11px] text-white/50 mt-1">{stackOf(g.id)?.hint}</span>
          </Link></li>
        ))}
      </ul>
    </section>
  );
}

export function PaasDatabases() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6">
      <SectionHead title="پایگاه داده مدیریت‌شده" sub="با یک کلیک بسازید، با یک کلیک به اپ وصل کنید؛ پشتیبان و به‌روزرسانی امنیتی با ما." />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {DB_ENGINES.map((e) => (
          <li key={e.id} className={GLASS_SOFT + " rounded-2xl p-5"}>
            <Icon name={e.icon} size={20} className="acc" />
            <b className="block mt-3">{e.label}</b>
            <span className="block text-[11px] text-white/50 mt-1" dir="ltr">{e.versions.join(" · ")}</span>
            <p className="text-xs text-white/60 mt-2 leading-6">{e.hint}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 text-center"><Link href="/paas/databases" className={BTN_G + " h-11 px-5 text-sm"}>جزئیات و قیمت پایگاه داده<Icon name="arrow-left" size={15} /></Link></div>
    </section>
  );
}

export function PaasCompare() {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6">
      <SectionHead title="گره اپ، سرور ابری یا هاست؟" sub="هر سه را داریم؛ این جدول کمک می‌کند درست انتخاب کنید." />
      <div className={GLASS + " rounded-[1.75rem] overflow-hidden"}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="مقایسه">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-right"><th className="p-4 text-white/55" /><th className="p-4 acc">گره اپ</th><th className="p-4"><Link href="/vps" className="hover:underline">سرور ابری</Link></th><th className="p-4"><Link href="/hosting" className="hover:underline">هاست</Link></th></tr></thead>
            <tbody>{PAAS_COMPARE.map((r) => (
              <tr key={r.row} className="border-t border-white/[0.06]"><th scope="row" className="p-4 text-right font-normal text-white/60">{r.row}</th><td className="p-4 font-bold">{r.paas}</td><td className="p-4 text-white/75">{r.vps}</td><td className="p-4 text-white/75">{r.host}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function PaasFaq({ items }: { items: [string, string][] }) {
  return (
    <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 scroll-mt-24">
      <SectionHead title="پرسش‌های رایج" />
      <div className="space-y-3">{items.map(([q, a]) => (
        <details key={q} className={GLASS_SOFT + " rounded-2xl p-5 group"}>
          <summary className="font-bold cursor-pointer list-none flex justify-between gap-3">{q}<Icon name="chevron-down" size={18} className="group-open:rotate-180 transition shrink-0" /></summary>
          <p className="mt-3 text-white/70 leading-8 text-sm">{a}</p>
        </details>
      ))}</div>
    </section>
  );
}

export function PaasCta({ title = "اولین اپ را همین الان بسازید" }: { title?: string }) {
  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6">
      <div className={GLASS + " rounded-[2rem] p-8 sm:p-12 text-center"}>
        <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">{title}</h2>
        <p className="mt-4 text-white/65 leading-8">ثبت‌نام، شارژ کیف پول و استقرار؛ پرداخت ساعتی و بدون قرارداد.</p>
        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={"/panel/apps/new" as never} className={BTN_P + " h-12 px-7"}><Icon name="rocket" size={18} />ساخت اپ</Link>
          <Link href={"/docs/paas" as never} className={BTN_G + " h-12 px-6"}><Icon name="book-open" size={17} />راهنمای استقرار</Link>
        </div>
      </div>
    </section>
  );
}

export { DB_FAQ };
