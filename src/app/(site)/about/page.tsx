import Link from "next/link";
import { Logo, VIRGULE_URL, VirguleLink, VirguleMark } from "@/components/brand";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { IconTile, SectionHead } from "@/components/ui";
import { Counter } from "@/components/ui-client";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT, GLASS_STRONG } from "@/lib/cls";
import { breadcrumbLd, ORG_ID, pageMeta, SITE_URL } from "@/lib/seo";

export const metadata = pageMeta({
  title: "درباره گره؛ زیرساخت ابری از خانواده ویرگول",
  description: "گره از دل استودیوی طراحی و توسعه ویرگول بیرون آمد تا محصولات دیجیتال روی زیرساختی سریع، شفاف و قابل اعتماد اجرا شوند. داستان، ارزش‌ها و تیم گره را بشناسید.",
  path: "/about", en: "/en/about",
});

const VALUES = [
  ["gauge", "سرعت، پیش‌فرض است", "هیچ پلنی روی دیسک کند یا شبکه شلوغ نمی‌نشیند؛ حتی ارزان‌ترینش."],
  ["shield-check", "شفافیت در قیمت و قطعی", "هزینه پنهان نداریم و هر اختلال را در صفحه وضعیت با جزئیات اعلام می‌کنیم."],
  ["headphones", "پشتیبانی از جنس مهندسی", "کسی که جواب تیکت شما را می‌دهد، خودش سرور را می‌شناسد."],
  ["code-xml", "ساخته‌شده برای توسعه‌دهنده", "API کامل، CLI و ماژول Terraform از روز اول، نه به‌عنوان افزونه."],
];
const TIMELINE = [
  ["۱۳۹۹", "شروع در یک رک", "اولین سرورها در دیتاسنتر تهران برای پروژه‌های داخلی ویرگول راه‌اندازی شد."],
  ["۱۴۰۱", "عرضه عمومی", "سرور ابری گره برای عموم باز شد؛ با دیسک NVMe روی همه پلن‌ها."],
  ["۱۴۰۲", "شبکه چندمسیره", "اتصال هم‌زمان به چهار اپراتور و دیتاسنتر پشتیبان اصفهان."],
  ["۱۴۰۳", "حضور در اروپا", "افتتاح لوکیشن‌های فرانکفورت و آمستردام برای کسب‌وکارهای بین‌المللی."],
];
const TEAM = [["ک", "کاوه نوری", "مدیر زیرساخت"], ["ش", "شیما کاظمی", "مدیر مالی و عملیات"], ["پ", "پویا تهرانی", "سرپرست شبکه"], ["ن", "نازنین صادقی", "سرپرست پشتیبانی"]];
const STATS: [number, string, string, number?][] = [[12000, "+", "کسب‌وکار فعال"], [4, "", "دیتاسنتر"], [99.99, "٪", "آپتایم سال گذشته", 2], [9, " دقیقه", "میانگین پاسخ"]];

export default function AboutPage() {
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["درباره ما", "/about"]]), { "@type": "AboutPage", name: "درباره گره", url: SITE_URL + "/about", about: { "@id": ORG_ID } }]} />
      <PageHeader icon="building-2" crumb="درباره ما" title="ما زیرساخت می‌سازیم، نه وعده" sub="گره از دل یک استودیوی طراحی و توسعه بیرون آمد؛ وقتی دیدیم محصولاتی که می‌سازیم جای بهتری برای اجرا لازم دارند." />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-24">
        <section className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl sm:text-4xl font-black leading-[1.45] tracking-tight">چرا گره را ساختیم</h2>
            <div className="mt-5 space-y-4 text-white/65 leading-8">
              <p>سال‌ها برای مشتریان‌مان وب‌سایت و اپلیکیشن ساختیم و هر بار به یک دیوار مشترک خوردیم: سرورهایی که در ساعت اوج کند می‌شدند، پشتیبانی‌ای که مسئله را نمی‌فهمید و قیمت‌هایی که هیچ‌وقت شفاف نبودند.</p>
              <p>گره پاسخ ما به همان دیوار است. همان دقتی که در طراحی یک رابط کاربری خرج می‌کنیم، این‌جا خرج انتخاب سخت‌افزار، طراحی شبکه و نوشتن هر خط از پنل شده است.</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {STATS.map(([v, s, l, d]) => (
              <div key={l} className={"spot rounded-[1.4rem] p-6 flex flex-col-reverse " + GLASS}>
                <dt className="text-sm text-white/50 mt-2">{l}</dt>
                <dd className="text-3xl sm:text-4xl font-black silver tabular"><Counter to={v} d={d || 0} suffix={s} /></dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <SectionHead title="چیزهایی که رویشان کوتاه نمی‌آییم" />
          <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {VALUES.map(([ic, t, d]) => (
              <li key={t} className={"spot rounded-[1.4rem] p-6 " + GLASS_SOFT}>
                <IconTile name={ic} size={20} cls="w-11 h-11 rounded-xl" />
                <h3 className="font-extrabold mt-5">{t}</h3><p className="text-sm text-white/55 leading-7 mt-2">{d}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="max-w-3xl mx-auto">
          <SectionHead title="مسیری که آمده‌ایم" />
          <ol className="relative border-r border-white/10 pr-8 space-y-10">
            {TIMELINE.map(([y, t, d]) => (
              <li key={y} className="relative">
                <span className="absolute -right-[41px] top-1 w-4 h-4 rounded-full bg-[#04050b] border-2 border-[#9cc9ff]" aria-hidden="true" />
                <div className="mono text-xs text-white/55"><time>{y}</time></div>
                <h3 className="font-extrabold text-lg mt-1">{t}</h3>
                <p className="text-white/55 text-sm leading-7 mt-1">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <SectionHead title="تیمی که پشت سرورهاست" />
          <ul className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TEAM.map(([i, n, r]) => (
              <li key={n} className={"rounded-[1.4rem] p-6 text-center " + GLASS_SOFT}>
                <div className="w-16 h-16 mx-auto rounded-2xl tile grid place-items-center text-xl font-black" aria-hidden="true">{i}</div>
                <h3 className="font-bold mt-4">{n}</h3><div className="text-xs text-white/55 mt-1">{r}</div>
              </li>
            ))}
          </ul>
        </section>

        <section id="virgule">
          <div className={GLASS_STRONG + " rounded-[2rem] p-8 sm:p-12 grid md:grid-cols-[auto_1fr] gap-8 items-center relative overflow-hidden"}>
            <div className="absolute -top-20 -left-20 w-72 h-72 rounded-full pointer-events-none" style={{ background: "radial-gradient(closest-side, rgba(156,201,255,.18), transparent)" }} />
            <div className="flex items-center gap-4">
              <Logo size={64} />
              <span className="text-3xl text-white/50 font-light" aria-hidden="true">×</span>
              <VirguleMark size={60} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-black">گره، عضوی از خانواده ویرگول</h2>
              <p className="text-white/65 leading-8 mt-3 max-w-2xl">گره زیرمجموعه <VirguleLink />، استودیوی طراحی و توسعه محصول، است و قدرتش را از همان‌جا می‌گیرد: از تیمی که هر روز محصول دیجیتال طراحی و منتشر می‌کند و می‌داند یک زیرساخت خوب باید چه حسی داشته باشد.</p>
              <a href={VIRGULE_URL} target="_blank" rel="noopener" className={BTN_G + " mt-6 px-5 h-11 text-sm"}>آشنایی با ویرگول <Icon name="external-link" size={15} /></a>
            </div>
          </div>
        </section>

        <section className="text-center">
          <h2 className="text-2xl sm:text-4xl font-black hero-title leading-[1.4]">بیایید چیزی سریع بسازیم</h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/vps" className={BTN_P + " px-6 h-12"}><Icon name="rocket" size={18} /> شروع با سرور ابری</Link>
            <Link href="/contact" className={BTN_G + " px-6 h-12"}>گفت‌وگو با فروش</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
