import Link from "next/link";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PaasFaq } from "@/components/site/paas-sections";
import { SectionHead } from "@/components/ui";
import { AI_FAQ, AI_FEATURES } from "@/content/ai";
import { AI_VENDORS } from "@/lib/ai";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { breadcrumbLd, faqLd, offerLd, pageMeta } from "@/lib/seo";
import { publicAi } from "@/server/ai/public";

export const dynamic = "force-dynamic";
const DESC = "API هوش مصنوعی با پرداخت تومانی: Claude، GPT، Gemini، DeepSeek و Qwen با یک کلید و بدون VPN یا کارت ارزی. سازگار با OpenAI، Anthropic و Gemini؛ مناسب Claude Code، Codex، Cursor و n8n.";
export const metadata = pageMeta({ title: "API هوش مصنوعی (Claude، GPT، Gemini) با پرداخت تومانی", description: DESC, path: "/ai-api" });

const TOOLS = ["Claude Code", "Codex", "Cursor", "n8n", "LangChain", "Continue", "LibreChat", "Dify"];

export default async function AiApiPage() {
  const { models, endpoint } = await publicAi();
  const vendors = [...new Set(models.map((m) => m.vendor))];
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([["API هوش مصنوعی", "/ai-api"]]), ...(models.length ? [offerLd("API هوش مصنوعی گره", DESC, models.map((m) => m.inPrice), "/ai-api")] : []), faqLd(AI_FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center hero-in">
          <div className="text-center lg:text-right">
            <nav aria-label="مسیر صفحه" className="flex items-center justify-center lg:justify-start gap-2 text-xs text-white/55">
              <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
              <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">API هوش مصنوعی</span>
            </nav>
            <p className="mt-8 inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/75"><Icon name="bot" size={14} className="acc" />{fa(models.length)} مدل با یک کلید</p>
            <h1 className="hero-title mt-6 text-[2.1rem] sm:text-6xl font-black leading-[1.35] tracking-tight">Claude و GPT و Gemini<br />با پرداخت تومانی</h1>
            <p className="mt-6 text-white/70 max-w-xl mx-auto lg:mx-0 leading-8 sm:text-lg">بدون VPN، کارت ارزی و حساب خارجی. همان API رسمی OpenAI، Anthropic و Gemini را روی آدرس گره صدا بزنید و فقط به اندازه توکن مصرفی پرداخت کنید.</p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href={"/panel/ai" as never} className={BTN_P + " h-13 px-7 py-3.5 text-base"}><Icon name="key-round" size={18} />دریافت کلید API</Link>
              <Link href={"/docs/ai-api" as never} className={BTN_G + " h-13 px-7 py-3.5 text-base"}><Icon name="book-open" size={18} />مستندات</Link>
            </div>
            <ul className="mt-9 flex flex-wrap justify-center lg:justify-start gap-x-6 gap-y-3 text-sm text-white/65">
              {[["wallet", "بدون اشتراک ماهانه"], ["zap", "استریم و ابزارها"], ["shield-check", "سقف هزینه برای هر کلید"], ["eye-off", "بدون ذخیره متن"]].map(([ic, t]) => <li key={t} className="flex items-center gap-2"><Icon name={ic} size={16} className="acc" />{t}</li>)}
            </ul>
          </div>
          <div className={GLASS + " rounded-[1.5rem] overflow-hidden text-left"} dir="ltr">
            <div className="flex gap-1.5 px-4 py-3 border-b border-white/[0.08]" aria-hidden="true"><span className="w-3 h-3 rounded-full bg-rose-400/70" /><span className="w-3 h-3 rounded-full bg-amber-300/70" /><span className="w-3 h-3 rounded-full bg-emerald-400/70" /></div>
            <pre tabIndex={0} aria-label="نمونه اتصال Claude Code" className="p-5 text-[12px] sm:text-[12.5px] leading-7 font-mono text-white/80 overflow-x-auto">
              <span className="text-white/45"># Claude Code</span>{"\n"}
              export <span className="text-sky-200">ANTHROPIC_BASE_URL</span>=<span className="acc">{endpoint}</span>{"\n"}
              export <span className="text-sky-200">ANTHROPIC_AUTH_TOKEN</span>=gk-…{"\n"}
              claude{"\n\n"}
              <span className="text-white/45"># OpenAI SDK / Cursor / n8n</span>{"\n"}
              <span className="text-sky-200">base_url</span> = <span className="acc">&quot;{endpoint}/v1&quot;</span>{"\n\n"}
              <span className="text-white/45"># Gemini SDK</span>{"\n"}
              <span className="text-sky-200">http_options</span> = {"{"}&quot;base_url&quot;: <span className="acc">&quot;{endpoint}&quot;</span>{"}"}
            </pre>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="یک درگاه، همه فرمت‌ها" sub="درخواست را با هر فرمتی بفرستید؛ پاسخ را با همان فرمت تحویل می‌گیرید." />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AI_FEATURES.map(([ic, t, d]) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}><Icon name={ic} size={22} className="acc" /><h3 className="font-extrabold mt-3">{t}</h3><p className="text-white/60 text-sm leading-7 mt-1.5">{d}</p></li>
          ))}
        </ul>
        <p className="text-center text-sm text-white/55 mt-8">سازگار با {TOOLS.join(" · ")} و هر ابزار دیگری که آدرس API را می‌پذیرد.</p>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <SectionHead title="مدل‌ها و قیمت" sub="به تومان و به ازای یک میلیون توکن. هزینه هر درخواست دقیقاً بر اساس توکن مصرفی محاسبه می‌شود." />
        <div className="space-y-6">
          {vendors.map((v) => (
            <div key={v}>
              <h3 className="font-extrabold mb-3">{AI_VENDORS[v] ?? v}</h3>
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {models.filter((m) => m.vendor === v).map((m) => (
                  <li key={m.id} className={GLASS_SOFT + " rounded-2xl p-5"}>
                    <div className="flex items-start justify-between gap-3"><b className="leading-7">{m.name}</b><span className="text-[11px] text-white/45 mt-1.5 tabular" dir="ltr">{m.context >= 1e6 ? fa(Math.round(m.context / 1e5) / 10) + "M" : fa(Math.round(m.context / 1000)) + "K"} ctx</span></div>
                    <code dir="ltr" className="block text-[11px] text-white/50 mt-1 text-right">{m.id}</code>
                    <dl className="grid grid-cols-2 gap-2 mt-3 text-xs">
                      <div className="rounded-xl bg-white/[0.04] p-2.5"><dt className="text-white/50">ورودی</dt><dd className="tabular font-bold mt-0.5">{fa(m.inPrice)}</dd></div>
                      <div className="rounded-xl bg-white/[0.04] p-2.5"><dt className="text-white/50">خروجی</dt><dd className="tabular font-bold text-emerald-300 mt-0.5">{fa(m.outPrice)}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="سه قدم تا اولین درخواست" />
        <ol className="grid md:grid-cols-3 gap-4">
          {[["user-plus", "ثبت‌نام و شارژ", "حساب گره بسازید و کیف پول را با درگاه بانکی شارژ کنید؛ موجودی بین همه سرویس‌ها مشترک است."], ["key-round", "ساخت کلید", "در پنل کلید بسازید و برای امنیت سقف هزینه روزانه و مدل‌های مجاز تعیین کنید."], ["rocket", "تغییر آدرس", "آدرس API را در برنامه یا ابزارتان به " + endpoint + " تغییر دهید؛ تمام."]].map(([ic, t, d], i) => (
            <li key={t} className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
              <span className="text-xs text-white/45">قدم {["اول", "دوم", "سوم"][i]}</span>
              <Icon name={ic} size={22} className="acc mt-3" />
              <h3 className="font-extrabold mt-3">{t}</h3>
              <p className="text-white/60 text-sm leading-7 mt-1 break-words">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <PaasFaq items={AI_FAQ} />

      <section className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className={GLASS + " rounded-[2rem] p-8 sm:p-12 text-center"}>
          <h2 className="text-2xl sm:text-4xl font-black leading-[1.4]">همین حالا اولین درخواست را بفرستید</h2>
          <p className="mt-4 text-white/65 leading-8">بدون حداقل خرید؛ با چند هزار تومان شارژ هم می‌توانید شروع کنید.</p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={"/panel/ai" as never} className={BTN_P + " h-12 px-7"}><Icon name="key-round" size={18} />دریافت کلید API</Link>
            <Link href="/contact" className={BTN_G + " h-12 px-6"}>مصرف سازمانی؟ با فروش صحبت کنید</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
