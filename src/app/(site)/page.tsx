import Link from "next/link";
import { Logo } from "@/components/brand";
import { GirihField } from "@/components/girih";
import { Builder, DomainSearchBox, Faq, Hardware, LiveSpark, Network, Newsletter, Performance, QuickStart, Steps, Terminal, Testimonials } from "@/components/home/interactive";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { IconTile, SectionHead } from "@/components/ui";
import { Counter } from "@/components/ui-client";
import { HOME_FAQ, HOSTING, VPS } from "@/lib/catalog";
import { BTN, BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa, toman } from "@/lib/format";
import { faqLd, pageMeta } from "@/lib/seo";

const meta = pageMeta({
  title: "گره | سرور ابری، هاست، PaaS و Geo DNS",
  description: "سرور ابری NVMe با آماده‌سازی زیر یک دقیقه، سرور اختصاصی، هاست وب، دامنه، استقرار اپ از Git (PaaS)، Geo DNS برای حفظ رتبه گوگل در قطعی اینترنت و API استعلام هویتی و بانکی؛ همه با یک حساب.",
  path: "/", en: "/en",
});
// absolute so the "%s | گره" template doesn't repeat the brand
export const metadata = { ...meta, title: { absolute: "گره | سرور ابری، هاست، PaaS و Geo DNS" } };

function Hero() {
  const metrics = [
    { v: 55, s: " ثانیه", l: "تا آنلاین شدن سرور" },
    { v: 7000, s: "", l: "مگابایت بر ثانیه، دیسک NVMe" },
    { v: 99.99, d: 2, s: "٪", l: "آپتایم تضمینی" },
  ];
  return (
    <section className="relative overflow-hidden">
      <GirihField />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-24 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-14 items-center">
        <div>
          <a href="#network" className="hero-in inline-flex items-center gap-2.5 text-xs text-white/60 hover:text-white transition group">
            <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" /><span className="relative w-2 h-2 rounded-full bg-emerald-400" /></span>
            همه سیستم‌ها عملیاتی هستند
            <Icon name="chevron-left" size={14} className="transition group-hover:-translate-x-0.5" />
          </a>
          <p className="hero-in d2 mt-6 text-sm font-bold acc">سرعت ابر، استواری زمین</p>
          <h1 className="hero-in d2 hero-title mt-3 text-[2.35rem] sm:text-[4.4rem] font-black leading-[1.25] sm:leading-[1.15] tracking-[-0.03em]">
            زیرساختی که کسب‌وکارتان را آنلاین نگه می‌دارد
          </h1>
          <p className="hero-in d3 mt-6 text-white/65 max-w-lg text-base sm:text-lg leading-8">
            سرور ابری آماده در کمتر از یک دقیقه، هاست و دامنه، استقرار اپ از Git، Geo DNS برای عبور از قطعی اینترنت و API استعلام؛ همه با یک حساب، یک کیف پول و پشتیبانی شبانه‌روزی.
          </p>
          <div className="hero-in d3 mt-9 flex flex-wrap gap-3">
            <a href="#builder" className={BTN_P + " px-6 h-12"}><Icon name="rocket" size={18} /> ساخت سرور</a>
            <Link href="/vps" className={BTN_G + " px-6 h-12"}>مشاهده قیمت‌ها</Link>
          </div>
          <dl className="hero-in d4 mt-12 grid grid-cols-3 max-w-lg">
            {metrics.map((m, i) => (
              <div key={m.l} className={"pl-4 flex flex-col-reverse " + (i ? "border-r border-white/10 pr-4" : "")}>
                <dt className="text-[11px] sm:text-xs text-white/55 mt-1.5 leading-5">{m.l}</dt>
                <dd className="text-2xl sm:text-3xl font-black tracking-tight silver tabular"><Counter to={m.v} d={m.d || 0} suffix={m.s} /></dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="hero-in d3"><Terminal /></div>
      </div>
    </section>
  );
}

function Bento() {
  const card = "spot min-w-0 rounded-[1.75rem] p-6 sm:p-7 " + GLASS + " hover:border-white/30 transition-colors duration-300";
  const more = "mt-5 text-sm font-bold inline-flex items-center gap-1.5 acc hover:gap-2.5 transition-all";
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
      <SectionHead title="هر چیزی که برای آنلاین ماندن لازم دارید" sub="از اولین وب‌سایت تا کلاستر سرورهای اختصاصی، همه در یک حساب و یک صورت‌حساب." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        <article className={card + " md:col-span-2 md:row-span-2 flex flex-col"}>
          <div className="flex items-start justify-between gap-4">
            <IconTile name="cloud" />
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-300/25">پرفروش‌ترین سرویس</span>
          </div>
          <h3 className="mt-6 text-2xl sm:text-3xl font-black">سرور ابری</h3>
          <p className="mt-3 text-white/65 leading-8 max-w-lg">منابع تضمین‌شده روی دیسک NVMe، دسترسی کامل root و ارتقای منابع بدون خاموشی. ساعتی بپردازید، هر وقت خواستید حذف کنید.</p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {[["cpu", "تا ۳۲ هسته"], ["memory-stick", "تا ۱۲۸ گیگ رم"], ["hard-drive", "NVMe نسل ۴"], ["shield-half", "ضد DDoS"]].map(([ic, t]) => (
              <li key={t} className="flex items-center gap-1.5 text-xs rounded-xl px-3 py-2 bg-white/[0.07] border border-white/[0.12]"><Icon name={ic} size={15} className="acc" />{t}</li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl bg-black/20 border border-white/10 p-4"><LiveSpark /></div>
          <div className="mt-auto pt-7 flex items-end justify-between gap-4">
            <div><div className="text-[11px] text-white/50">شروع قیمت از</div><div className="font-black text-xl">{fa(VPS.cloud[0].price)} <span className="text-xs font-normal text-white/50">تومان / ماه</span></div></div>
            <Link href="/vps" className={BTN_P + " px-5 py-3 text-sm"}>مشاهده پلن‌ها <Icon name="arrow-left" size={16} /></Link>
          </div>
        </article>
        <article className={card + " flex flex-col"}>
          <IconTile name="server-cog" />
          <h3 className="mt-5 text-xl font-black">سرور اختصاصی</h3>
          <p className="mt-2 text-white/60 text-sm leading-7 flex-1">سخت‌افزار کامل برای شما؛ Xeon و EPYC با پورت تا ۱۰ گیگابیت.</p>
          <Link href="/vps#dedicated" className={more}>از {toman(VPS.metal[0].price)} <Icon name="chevron-left" size={16} /></Link>
        </article>
        <article className={card + " flex flex-col"}>
          <IconTile name="layers" />
          <h3 className="mt-5 text-xl font-black">هاست وب</h3>
          <p className="mt-2 text-white/60 text-sm leading-7 flex-1">LiteSpeed، SSL رایگان و بکاپ روزانه؛ برای وردپرس و فروشگاه.</p>
          <Link href="/hosting" className={more}>از {toman(HOSTING.linux[0].price)} <Icon name="chevron-left" size={16} /></Link>
        </article>
        <article className={card + " md:col-span-2"}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="flex items-center gap-4 sm:w-56 shrink-0">
              <IconTile name="globe" />
              <div><h3 className="text-xl font-black">ثبت دامنه</h3><p className="text-white/55 text-xs mt-1">بیش از ۱۶ پسوند، ثبت آنی</p></div>
            </div>
            <div className="flex-1"><DomainSearchBox /></div>
          </div>
        </article>
        <article className={card + " flex flex-col"}>
          <IconTile name="heart-handshake" />
          <h3 className="mt-5 text-xl font-black">انتقال رایگان</h3>
          <p className="mt-2 text-white/60 text-sm leading-7 flex-1">سایت و سرورتان را بدون قطعی به گره می‌آوریم.</p>
          <a href="#faq" className={more}>چطور کار می‌کند <Icon name="chevron-left" size={16} /></a>
        </article>
      </div>
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
          <h2 id="devops-teaser" className="mt-4 text-[1.8rem] sm:text-5xl font-black leading-[1.35] tracking-tight">تیم دواپس شما، بدون استخدام</h2>
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
          <h2 className="mt-6 text-[1.9rem] sm:text-6xl font-black leading-[1.3] tracking-tight hero-title">اولین سرورتان را امروز بسازید</h2>
          <p className="mt-4 text-white/75 leading-8">۷ روز ضمانت بازگشت وجه. بدون قرارداد، بدون هزینه پنهان.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#builder" className={BTN + " bg-white text-slate-900 px-7 py-3.5 hover:bg-white/90 shadow-xl"}><Icon name="rocket" size={18} /> ساخت سرور</a>
            <Link href="/hosting" className={BTN_G + " px-7 py-3.5"}><Icon name="layers" size={18} /> پلن‌های هاست</Link>
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
      <Hero />
      <QuickStart />
      <Bento />
      <Hardware />
      <Builder />
      <Network />
      <Performance />
      <Steps />
      <Features />
      <NewProducts />
      <DevopsTeaser />
      <Testimonials />
      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
        <SectionHead title="پرسش‌های رایج" />
        <Faq id="faq" items={HOME_FAQ} />
      </section>
      <Cta />
    </div>
  );
}
