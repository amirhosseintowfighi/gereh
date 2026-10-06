import { Builder } from "@/components/home/interactive";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { VpsPlans } from "@/components/site/plans";
import { VPS } from "@/lib/catalog";
import { breadcrumbLd, offerLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "خرید سرور ابری و سرور اختصاصی",
  description: "سرور ابری (VPS) با دیسک NVMe، دسترسی root و آماده‌سازی زیر یک دقیقه از ۳۹۰ هزار تومان؛ سرور اختصاصی AMD EPYC و Intel Xeon در دیتاسنتر تهران، اصفهان، فرانکفورت و آمستردام.",
  path: "/vps",
});

export default function VpsPage() {
  return (
    <div className="fade-page pb-8">
      <JsonLd data={[
        breadcrumbLd([["سرور ابری", "/vps"]]),
        offerLd("سرور ابری گره", "سرور مجازی KVM با دیسک NVMe و منابع تضمین‌شده", VPS.cloud.map((p) => p.price), "/vps"),
        offerLd("سرور اختصاصی گره", "سرور اختصاصی AMD EPYC و Intel Xeon با رم ECC", VPS.metal.map((p) => p.price), "/vps#dedicated"),
      ]} />
      <PageHeader icon="server" crumb="سرور ابری" title="سرور ابری و اختصاصی" sub="منابع تضمین‌شده، دیسک NVMe و دسترسی کامل root؛ در چهار دیتاسنتر داخلی و اروپایی." />
      <VpsPlans />
      <div className="mt-24"><Builder /></div>
    </div>
  );
}
