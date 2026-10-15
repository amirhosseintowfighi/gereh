import { GirihField } from "@/components/girih";
import { Faq } from "@/components/home/interactive";
import { JsonLd } from "@/components/json-ld";
import { BuilderCta, BuilderFeatures, BuilderHero, BuilderSteps } from "@/components/site/builder-sections";
import { SectionHead } from "@/components/ui";
import { BUILDER } from "@/lib/builder";
import { breadcrumbLd, faqLd, pageMeta } from "@/lib/seo";

const TITLE = BUILDER.name + ": " + BUILDER.tagline;
const DESC = "ایده سایت یا اپ را به فارسی بنویسید؛ هوش مصنوعی کد را می‌نویسد، پیش‌نمایش زنده می‌دهد، با یک کلیک روی زیرساخت گره منتشر می‌کند، خطای بیلد را خودش رفع می‌کند و اپ را پس از انتشار نگه می‌دارد.";
export const metadata = pageMeta({ title: TITLE, description: DESC, path: "/build" });

const FAQ: [string, string][] = [
  ["برای استفاده باید برنامه‌نویسی بلد باشم؟", "نه. ایده را مثل یک پیام معمولی به فارسی بنویسید و تغییرات را هم در گفتگو بخواهید؛ مثلاً «رنگ را سبز کن» یا «فرم ثبت‌نام اضافه کن». اگر برنامه‌نویس هستید، کد کامل را می‌بینید و ویرایش می‌کنید."],
  ["هزینه‌اش چطور حساب می‌شود؟", "هر درخواست به AI به اندازه مصرف واقعی از کیف پول کم می‌شود و هزینه هر مرحله کنار آن نمایش داده می‌شود. پس از انتشار، اپ مثل هر اپ دیگر گره اپ ساعتی و با ارزان‌ترین پلن (قابل تغییر) حساب می‌شود."],
  ["اگر انتشار با خطا روبه‌رو شود چه می‌شود؟", "AI لاگ بیلد را می‌خواند، علت را پیدا می‌کند، کد را اصلاح می‌کند و دوباره منتشر می‌کند؛ تا سه بار و هر بار با توضیح فارسی."],
  ["کد و اطلاعات متعلق به کیست؟", "کد و داده‌ها کاملاً متعلق به شماست. همه نسخه‌ها ذخیره می‌شوند و هر وقت بخواهید نسخه قبلی را برمی‌گردانید."],
  ["عامل نگهداری چه کار می‌کند؟", "اپ منتشرشده را زیر نظر دارد؛ اگر از کار بیفتد، حافظه کم بیاورد یا بررسی سلامت شکست بخورد، علت را توضیح می‌دهد و وصله پیشنهاد می‌کند. با «نگهداری خودکار»، وصله با سقف هزینه مشخص خودکار منتشر می‌شود."],
];

export default function BuildPage() {
  return (
    <div className="fade-page pb-10 space-y-24">
      <JsonLd data={[breadcrumbLd([[BUILDER.name, "/build"]]), faqLd(FAQ)]} />
      <section className="relative overflow-hidden">
        <GirihField />
        <BuilderHero />
      </section>
      <BuilderSteps />
      <BuilderFeatures />
      <section className="max-w-3xl mx-auto px-4 sm:px-6">
        <SectionHead title="پرسش‌های رایج" />
        <Faq id="faq" items={FAQ} />
      </section>
      <BuilderCta />
    </div>
  );
}
