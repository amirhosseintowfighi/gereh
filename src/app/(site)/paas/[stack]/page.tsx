import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { PaasCta, PaasFaq, PaasStacks } from "@/components/site/paas-sections";
import { guideBySlug, PAAS_FAQ, STACK_GUIDES } from "@/content/paas";
import { GLASS, GLASS_SOFT } from "@/lib/cls";
import { stackOf } from "@/lib/paas";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => STACK_GUIDES.map((g) => ({ stack: g.slug }));

export async function generateMetadata({ params }: PageProps<"/paas/[stack]">) {
  const g = guideBySlug((await params).stack);
  if (!g) return {};
  return pageMeta({ title: g.title + " با استقرار از Git", description: g.intro + " SSL خودکار، دامنه اختصاصی و پرداخت ساعتی.", path: "/paas/" + g.slug });
}

export default async function Page({ params }: PageProps<"/paas/[stack]">) {
  const g = guideBySlug((await params).stack);
  if (!g) notFound();
  const s = stackOf(g.id);
  const faq = PAAS_FAQ.slice(0, 5);
  const steps: [string, string][] = [
    ["ساخت اپ", "در پنل «اپ جدید» را بزنید و مخزن Git را وصل یا پوشه پروژه را ZIP کنید."],
    ["تشخیص خودکار", "گره از روی " + g.detect + " پروژه را " + (s?.label ?? g.id) + " تشخیص می‌دهد" + (s?.build ? " و دستور «" + s.build + "» را اجرا می‌کند." : ".")],
    ["متغیرها و پایگاه داده", "متغیرهای محیطی را تعریف کنید و در صورت نیاز یک پایگاه داده مدیریت‌شده وصل کنید."],
    ["آنلاین", "اپ روی پورت " + (s?.port ?? 8080) + " اجرا و با HTTPS روی <نام>.gereh.app در دسترس می‌شود."],
  ];
  return (
    <div className="fade-page pb-10 space-y-20">
      <JsonLd data={[breadcrumbLd([["گره اپ", "/paas"], [g.title, "/paas/" + g.slug]]), faqLd(faq), {
        "@type": "HowTo", name: "استقرار " + (s?.label ?? g.id) + " روی گره اپ", step: steps.map(([name, text], i) => ({ "@type": "HowToStep", position: i + 1, name, text })),
      }]} />
      <PageHeader icon="rocket" crumb={g.title} title={g.title} sub={g.intro} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-6 items-start">
        <div className="min-w-0">
          <h2 className="text-2xl font-black">چهار قدم تا آنلاین شدن</h2>
          <ol className="mt-5 space-y-3">
            {steps.map(([t, d], i) => (
              <li key={t} className={GLASS_SOFT + " rounded-2xl p-5 flex gap-4"}>
                <span className="w-8 h-8 rounded-full acc-bg grid place-items-center font-black text-sm shrink-0">{i + 1}</span>
                <span><b>{t}</b><span className="block text-sm text-white/65 leading-7 mt-1">{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-4 min-w-0">
          {g.sample && (
            <div className={GLASS + " rounded-[1.5rem] overflow-hidden"}>
              <div className="px-5 py-3 border-b border-white/[0.08] text-xs text-white/60">{g.sample.file}</div>
              <pre dir="ltr" tabIndex={0} aria-label={"نمونه " + g.sample.file} className="p-5 text-[12.5px] leading-7 font-mono text-left overflow-x-auto">{g.sample.code}</pre>
            </div>
          )}
          <div className={GLASS_SOFT + " rounded-[1.5rem] p-6"}>
            <h2 className="font-extrabold flex items-center gap-2"><Icon name="sparkles" size={18} className="acc" />نکته‌های {s?.label}</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {g.tips.map((t) => <li key={t} className="flex gap-2.5"><Icon name="check" size={16} className="acc shrink-0 mt-1" /><span className="leading-7 text-white/75">{t}</span></li>)}
            </ul>
          </div>
          <p className="text-sm text-white/60">راهنمای کامل: <Link href={"/docs/paas" as never} className="acc underline underline-offset-4">مستندات گره اپ</Link> · <Link href="/paas#pricing" className="acc underline underline-offset-4">قیمت‌ها</Link></p>
        </div>
      </section>
      <PaasStacks title="زبان‌ها و فریم‌ورک‌های دیگر" />
      <PaasFaq items={faq} />
      <PaasCta title={"اپ " + (s?.label ?? "") + " خود را همین الان مستقر کنید"} />
    </div>
  );
}
