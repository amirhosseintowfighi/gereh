import Link from "next/link";
import { Logo } from "@/components/brand";
import { GirihField } from "@/components/girih";
import { FrontHero, ProductCards } from "@/components/home/front";
import { Builder, Faq, Hardware, Network, Newsletter, Steps } from "@/components/home/interactive";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { BuilderShowcase } from "@/components/site/builder-sections";
import { BizPackages } from "@/components/site/business-sections";
import { IconTile, SectionHead } from "@/components/ui";
import { HOME_FAQ } from "@/lib/catalog";
import { BTN, BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { faqLd, pageMeta } from "@/lib/seo";

const HOME_TITLE = "گره | سایت و فروشگاه آنلاین، سرور ابری و هاست";
const meta = pageMeta({
  title: HOME_TITLE,
  description: "سایت یا فروشگاه آنلاین کسب‌وکارتان را ما می‌سازیم و نگه می‌داریم؛ برای برنامه‌نویس‌ها هم سرور ابری، هاست، دامنه، استقرار اپ از Git (PaaS)، Geo DNS و API استعلام؛ همه با یک حساب.",
  path: "/", en: "/en",
});
// absolute so the "%s | گره" template doesn't repeat the brand
export const metadata = { ...meta, title: { absolute: HOME_TITLE } };

/** for every size of business: the packages, priced in /admin/products */
function BizSection() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" aria-labelledby="home-packages">
      <SectionHead id="home-packages" title="سایت و فروشگاه، برای هر اندازه کسب‌وکار" sub="کارهای فنی با ما: می‌سازیم، راه می‌اندازیم و هر ماه نگه می‌داریم. یک هزینه راه‌اندازی و یک هزینه ماهانه ثابت." />
      <BizPackages />
      <div className="mt-8 text-center"><Link href="/business#request" className={BTN_G + " px-7 h-12"}><Icon name="phone-call" size={18} />مطمئن نیستید کدام؟ با شما تماس می‌گیریم</Link></div>
    </section>
  );
}

const FEATURES = [
  ["gauge", "NVMe روی همه سرویس‌ها", "تا هفت برابر سریع‌تر از SSD معمولی؛ حتی در ارزان‌ترین پلن."],
  ["shield-check", "محافظت DDoS بدون هزینه", "ترافیک مخرب در لبه شبکه فیلتر می‌شود، پیش از رسیدن به سرور شما."],
  ["network", "شبکه چندمسیره", "اتصال هم‌زمان به چند اپراتور؛ اگر مسیری قطع شود، مسیر دیگر جایگزین است."],
  ["database-backup", "بکاپ جغرافیایی", "نسخه پشتیبان در شهری دیگر نگه داشته می‌شود و با یک کلیک برمی‌گردد."],
  ["layout-dashboard", "پنل یکپارچه", "سرور، هاست، دامنه و صورت‌حساب‌ها را از یک جا مدیریت کنید."],
  ["code-xml", "API و ترافورم", "زیرساخت را با کد بسازید؛ API کامل و ماژول رسمی Terraform."],
];
function Features() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
      <SectionHead title="جزئیاتی که فرق را می‌سازند" sub="چیزهایی که معمولا هزینه جداگانه دارند، در گره بخشی از سرویس‌اند." />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map(([ic, t, d]) => (
          <li key={t} className={"spot group rounded-[1.5rem] p-6 " + GLASS_SOFT + " hover:border-white/25 transition-colors"}>
            <div className="w-11 h-11 rounded-xl grid place-items-center bg-white/[0.08] border border-white/15 acc group-hover:scale-110 transition-transform duration-300"><Icon name={ic} size={21} /></div>
            <h3 className="font-extrabold mt-5">{t}</h3>
            <p className="text-white/60 text-sm leading-7 mt-2">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const NEW_PRODUCTS = [
  { href: "/paas", icon: "rocket", kicker: "گره اپ · PaaS", title: "کد را بفرستید، بقیه با ما", text: "از Git، ZIP یا Docker در چند دقیقه آنلاین شوید؛ SSL، دامنه، پایگاه داده و مقیاس خودکار، با پرداخت ساعتی.", points: ["git push = استقرار", "PostgreSQL، MySQL، Redis", "مقیاس خودکار"], cta: "آشنایی با گره اپ" },
  { href: "/geo-dns", icon: "radar", kicker: "Geo DNS", title: "قطعی اینترنت، رتبه گوگل را نبرد", text: "کاربر ایرانی به سرور ایران، گوگل و کاربران خارج به سرور خارج. همگام‌سازی فایل و پایگاه داده هم با ما.", points: ["حفظ رتبه در گوگل", "سوییچ خودکار", "همگام‌سازی دیتابیس"], cta: "حفظ سایت در قطعی" },
  { href: "/inquiry", icon: "fingerprint", kicker: "API استعلام", title: "هویت مشتری را قبل از ریسک بشناسید", text: "ثبت احوال، شاهکار، کارت و شبا، کد پستی و چک صیادی با یک API. بدون هزینه ماهانه؛ فقط استعلام موفق.", points: ["پرداخت به ازای مصرف", "sandbox رایگان", "ورودی اشتباه رایگان"], cta: "دریافت کلید API" },
];
function NewProducts() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" aria-labelledby="new-products">
      <SectionHead id="new-products" title="فراتر از سرور" sub="سه سرویس تازه برای وقتی که سرعت توسعه، دسترس‌پذیری در بحران یا اعتماد به کاربر مهم است." />
      <ul className="grid lg:grid-cols-3 gap-4">
        {NEW_PRODUCTS.map((p) => (
          <li key={p.href} className={"spot rounded-[1.75rem] p-6 sm:p-7 flex flex-col " + GLASS + " hover:border-white/30 transition-colors"}>
            <span className="flex items-center justify-between gap-3"><IconTile name={p.icon} /><span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-300/25">جدید</span></span>
            <p className="mt-5 text-xs text-white/55">{p.kicker}</p>
            <h3 className="mt-1.5 text-xl font-black leading-8">{p.title}</h3>
            <p className="mt-2 text-white/65 text-sm leading-7 flex-1">{p.text}</p>
            <ul className="mt-5 flex flex-wrap gap-2">{p.points.map((t) => <li key={t} className="text-[11px] rounded-lg px-2.5 py-1.5 bg-white/[0.06] border border-white/[0.1]">{t}</li>)}</ul>
            <Link href={p.href as never} className={BTN_G + " mt-6 h-11 text-sm"}>{p.cta} <Icon name="arrow-left" size={16} /></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DEVOPS_TEASER: [string, string][] = [["rocket", "CI/CD و استقرار خودکار"], ["box", "کوبرنتیز"], ["activity", "مانیتورینگ و هشدار"], ["shield-check", "امنیت زیرساخت"], ["headset", "پشتیبانی ۲۴/۷ با SLA"], ["code-xml", "Terraform و Ansible"]];
function DevopsTeaser() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24" aria-labelledby="devops-teaser">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.12] p-8 sm:p-12 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center"
        style={{ background: "radial-gradient(ellipse 70% 100% at 100% 0%, rgba(125,180,255,.16), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.015))" }}>
        <div>
          <p className="text-xs text-white/60 flex items-center gap-1.5"><Icon name="sparkles" size={14} className="acc" />خدمات دواپس برای شرکت‌ها و استارتاپ‌ها</p>
          <h2 id="devops-teaser" className="mt-4 text-[1.8rem] sm:text-5xl font-black leading-[1.35]">تیم دواپس شما، بدون استخدام</h2>
          <p className="mt-4 text-white/70 leading-8">زیرساختتان را می‌سازیم، خودکار می‌کنیم و شبانه‌روز نگه می‌داریم؛ روی گره یا هر زیرساخت دیگری. قرارداد ماهانه بدون حداقل مدت، یا پروژه با قیمت ثابت.</p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Link href="/devops" className={BTN_P + " px-6 py-3"}><Icon name="rocket" size={18} />آشنایی با خدمات دواپس</Link>
            <Link href="/devops#request" className={BTN_G + " px-6 py-3"}>جلسه آشنایی رایگان</Link>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3">
          {DEVOPS_TEASER.map(([ic, t]) => <li key={t} className={GLASS_SOFT + " rounded-2xl p-4 flex items-center gap-3 text-sm font-bold"}><Icon name={ic} size={19} className="acc shrink-0" />{t}</li>)}
        </ul>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.12] backdrop-blur-xl p-8 sm:p-16 text-center"
        style={{ background: "radial-gradient(ellipse 60% 90% at 50% 0%, rgba(125,180,255,.2), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015))" }}>
        <GirihField fade={false} />
        <div className="relative">
          <div className="mx-auto w-fit"><Logo size={56} /></div>
          <h2 className="mt-6 text-[1.9rem] sm:text-6xl font-black leading-[1.3] hero-title">کسب‌وکارتان را امروز آنلاین کنید</h2>
          <p className="mt-4 text-white/75 leading-8">تماس اول رایگان است. بدون قرارداد بلندمدت، بدون هزینه پنهان.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/business#request" className={BTN + " bg-white text-slate-900 px-7 py-3.5 hover:bg-white/90 shadow-xl"}><Icon name="phone-call" size={18} /> با من تماس بگیرید</Link>
            <a href="#builder" className={BTN_G + " px-7 py-3.5"}><Icon name="rocket" size={18} /> ساخت سرور</a>
          </div>
          <Newsletter />
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="fade-page">
      <JsonLd data={faqLd(HOME_FAQ)} />
      <FrontHero />
      <ProductCards />
      <BizSection />
      <BuilderShowcase />
      <Hardware />
      <Builder />
      <Network />
      <Steps />
      <Features />
      <NewProducts />
      <DevopsTeaser />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
        <SectionHead title="پرسش‌های رایج" />
        <Faq id="faq" items={HOME_FAQ} />
      </section>
      <Cta />
    </div>
  );
}
