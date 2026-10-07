import Link from "next/link";
import { Icon } from "@/components/icon";
import { JsonLd } from "@/components/json-ld";
import { PageHeader } from "@/components/site/page-header";
import { BTN_G, BTN_P, GLASS, GLASS_SOFT } from "@/lib/cls";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "مقایسه گره با هاستینگ سنتی و ابرهای خارجی",
  description: "گره را با سرویس‌دهنده‌های سنتی هاست ایرانی و ابرهای خارجی مقایسه کنید: دیسک NVMe، پرداخت ریالی، صورتحساب ساعتی، API و Terraform، دیتاسنتر داخل ایران و پشتیبانی فارسی.",
  path: "/compare",
});

type V = true | false | string;
const COLS = ["گره", "هاستینگ سنتی ایرانی", "ابرهای خارجی"];
const ROWS: [string, V, V, V][] = [
  ["دیسک NVMe روی همه پلن‌ها", true, "معمولاً فقط پلن‌های گران", true],
  ["پرداخت ریالی با درگاه بانکی", true, true, false],
  ["دیتاسنتر داخل ایران (تأخیر کم برای کاربران ایرانی)", true, true, false],
  ["لوکیشن اروپا در همان پنل", true, "به‌ندرت", true],
  ["صورتحساب ساعتی", true, false, true],
  ["آماده‌سازی سرور کمتر از یک دقیقه", true, "دستی، تا چند ساعت", true],
  ["REST API و Terraform provider", true, false, true],
  ["دسترسی تیمی با نقش‌های جدا", true, false, true],
  ["فاکتور رسمی با کد اقتصادی", true, "گاهی", false],
  ["صفحه وضعیت عمومی و گزارش رخداد", true, "به‌ندرت", true],
  ["پشتیبانی فارسی شبانه‌روزی", true, "ساعات اداری", false],
  ["بدون نیاز به ارز و کارت بین‌المللی", true, true, false],
];
const FAQ: [string, string][] = [
  ["چرا نام شرکت‌ها را نیاورده‌اید؟", "شرایط سرویس‌دهنده‌ها مدام تغییر می‌کند؛ این جدول ویژگی‌های رایج هر دسته را نشان می‌دهد. پیش از انتخاب، شرایط فعلی هر سرویس را خودتان بررسی کنید."],
  ["مهاجرت از سرویس فعلی به گره چقدر طول می‌کشد؟", "برای هاست‌های cPanel، تیم ما انتقال فایل‌ها، پایگاه داده و ایمیل را رایگان انجام می‌دهد و معمولاً کمتر از یک روز طول می‌کشد."],
  ["اگر راضی نبودم؟", "سرورهای ساعتی را هر لحظه می‌توانید حذف کنید و فقط ساعات استفاده را می‌پردازید."],
];

function Mark({ v }: { v: V }) {
  if (v === true) return <span className="inline-flex items-center gap-1 text-emerald-300"><Icon name="circle-check" size={18} /><span className="sr-only">دارد</span></span>;
  if (v === false) return <span className="inline-flex items-center gap-1 text-white/50"><Icon name="minus" size={18} /><span className="sr-only">ندارد</span></span>;
  return <span className="text-xs text-white/65">{v}</span>;
}

export default function ComparePage() {
  return (
    <div className="fade-page pb-10">
      <JsonLd data={[breadcrumbLd([["مقایسه", "/compare"]]), faqLd(FAQ)]} />
      <PageHeader icon="scale" crumb="مقایسه" title="چرا گره؟" sub="بهترین‌های هاستینگ ایرانی و ابرهای جهانی، کنار هم و در یک پنل." />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-12">
        <div className={GLASS + " rounded-2xl overflow-x-auto"} tabIndex={0} role="region" aria-label="جدول مقایسه">
          <table className="w-full text-sm min-w-[640px]">
            <caption className="sr-only">مقایسه ویژگی‌های گره با هاستینگ سنتی ایرانی و ابرهای خارجی</caption>
            <thead><tr className="bg-white/[0.04]"><th scope="col" className="text-right p-4 font-bold">ویژگی</th>{COLS.map((c, i) => <th key={c} scope="col" className={"p-4 text-center font-bold " + (i === 0 ? "acc" : "text-white/75")}>{c}</th>)}</tr></thead>
            <tbody>{ROWS.map(([f, ...vals]) => (
              <tr key={f} className="border-t border-white/[0.06]"><th scope="row" className="text-right p-4 font-medium leading-7">{f}</th>{vals.map((v, i) => <td key={i} className={"p-4 text-center " + (i === 0 ? "bg-sky-400/[0.04]" : "")}><Mark v={v} /></td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <section>
          <h2 className="text-xl font-black mb-4">پرسش‌های رایج</h2>
          <div className="space-y-3">{FAQ.map(([q, a]) => <details key={q} className={GLASS_SOFT + " rounded-2xl p-5 group"}><summary className="font-bold cursor-pointer list-none flex justify-between gap-3">{q}<Icon name="chevron-down" size={18} className="group-open:rotate-180 transition shrink-0" /></summary><p className="mt-3 text-white/70 leading-8 text-sm">{a}</p></details>)}</div>
        </section>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/vps" className={BTN_P + " h-12 px-6"}><Icon name="server" size={18} />مشاهده پلن‌های سرور ابری</Link>
          <Link href="/contact" className={BTN_G + " h-12 px-6"}>درخواست مهاجرت رایگان</Link>
        </div>
      </div>
    </div>
  );
}
