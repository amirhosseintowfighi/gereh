import Link from "next/link";
import { notFound } from "next/navigation";
import { GirihField } from "@/components/girih";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { DevopsFaq, DevopsRequest, DevopsServicesGrid, devopsServiceLd, DevopsTrust } from "@/components/site/devops-sections";
import { SectionHead } from "@/components/ui";
import { DEVOPS_FAQ, DEVOPS_PACKAGES, DEVOPS_SERVICES, devopsService } from "@/content/devops";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { fa } from "@/lib/format";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => DEVOPS_SERVICES.map((s) => ({ service: s.slug }));

export async function generateMetadata({ params }: PageProps<"/devops/[service]">) {
  const s = devopsService((await params).service);
  return s ? pageMeta({ title: s.seoTitle, description: s.seoDesc, path: "/devops/" + s.slug }) : {};
}

export default async function DevopsServicePage({ params }: PageProps<"/devops/[service]">) {
  const s = devopsService((await params).service);
  if (!s) notFound();
  const path = "/devops/" + s.slug;
  const faq = [...s.faq, ...DEVOPS_FAQ.slice(0, 3)];
  const from = Math.min(...DEVOPS_PACKAGES.filter((p) => p.price).map((p) => p.price!));
  return (
    <div className="fade-page pb-10 space-y-20">
      <JsonLd data={[breadcrumbLd([["خدمات دواپس", "/devops"], [s.title, path]]), devopsServiceLd(s.seoTitle, s.seoDesc, path, s.title), faqLd(faq)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 text-center hero-in">
          <nav aria-label="مسیر صفحه" className="flex flex-wrap items-center justify-center gap-2 text-xs text-white/55">
            <Link href="/" className="hover:text-white flex items-center gap-1"><Icon name="house" size={13} />خانه</Link>
            <Icon name="chevron-left" size={13} /><Link href="/devops" className="hover:text-white">خدمات دواپس</Link>
            <Icon name="chevron-left" size={13} /><span className="text-white/75" aria-current="page">{s.title}</span>
          </nav>
          <span className="mt-8 mx-auto w-16 h-16 rounded-[1.25rem] grid place-items-center bg-white/[0.08] border border-white/15 acc"><Icon name={s.icon} size={28} /></span>
          <h1 className="hero-title mt-6 text-[2rem] sm:text-6xl font-black leading-[1.35] tracking-tight">{s.title}</h1>
          <p className="mt-5 text-white/70 max-w-2xl mx-auto leading-8 sm:text-lg">{s.short}</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#request" className={BTN_P + " px-7 py-3.5"}><Icon name="message-circle" size={18} />مشاوره رایگان</a>
            <Link href="/devops#pricing" className={BTN_G + " px-7 py-3.5"}>بسته‌ها از {fa(from / 1e6)} میلیون تومان در ماه</Link>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 grid lg:grid-cols-[1fr_1.2fr] gap-6">
        <div className={GLASS_SOFT + " rounded-[1.5rem] p-7"}>
          <h2 className="text-xl font-black flex items-center gap-2"><Icon name="circle-alert" size={20} className="text-amber-300" />مسئله</h2>
          <p className="mt-4 text-white/70 leading-8">{s.problem}</p>
          <h3 className="mt-6 font-extrabold">نتیجه‌ای که دنبالش هستیم</h3>
          <ul className="mt-3 space-y-2 text-sm">{s.outcomes.map((o) => <li key={o} className="flex gap-2"><Icon name="trending-up" size={16} className="text-emerald-300 shrink-0 mt-1" /><span className="leading-7">{o}</span></li>)}</ul>
        </div>
        <div className={GLASS + " rounded-[1.5rem] p-7"}>
          <h2 className="text-xl font-black">چه چیزی تحویل می‌گیرید</h2>
          <ul className="mt-5 space-y-3">{s.deliverables.map((d) => <li key={d} className="flex gap-3"><Icon name="circle-check" size={18} className="acc shrink-0 mt-1" /><span className="leading-7 text-white/85">{d}</span></li>)}</ul>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6">
        <h2 className="text-xl font-black mb-4">ابزارها</h2>
        <ul className="flex flex-wrap gap-2" dir="ltr">{s.tools.map((t) => <li key={t} className="text-sm px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/[0.1]">{t}</li>)}</ul>
        <p className="mt-3 text-sm text-white/55">ابزار نهایی را با توجه به پشته فعلی و توان تیم شما انتخاب می‌کنیم.</p>
      </section>

      <DevopsTrust />
      <DevopsFaq items={faq} />
      <DevopsRequest preset={s.slug} source={path} title={"درخواست مشاوره: " + s.title} />
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <SectionHead title="خدمات دیگر" />
        <DevopsServicesGrid exclude={s.slug} />
      </section>
    </div>
  );
}
