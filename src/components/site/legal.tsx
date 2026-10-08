import Link from "next/link";
import { GLASS } from "@/lib/cls";
import { JsonLd } from "../json-ld";
import { breadcrumbLd } from "@/lib/seo";
import { PageHeader } from "./page-header";

export const LEGAL = {
  terms: { title: "قوانین استفاده", path: "/terms", sections: [
    ["پذیرش قوانین", "استفاده از خدمات گره به معنی پذیرش این قوانین است. حساب کاربری شخصی است و مسئولیت فعالیت‌های آن با دارنده حساب است."],
    ["استفاده مجاز", "هرگونه فعالیت مغایر با قوانین جمهوری اسلامی ایران، ارسال اسپم، حملات شبکه و استخراج رمزارز روی سرورهای ابری ممنوع است و به تعلیق سرویس منجر می‌شود."],
    ["پرداخت و تمدید", "سرویس‌ها پیش‌پرداخت هستند. در صورت عدم تمدید، سرویس ۷ روز پس از سررسید معلق و ۱۴ روز بعد حذف می‌شود."],
    ["ضمانت بازگشت وجه", "تا ۷ روز پس از اولین خرید، کل مبلغ سرورهای ابری و هاست بازگردانده می‌شود. ثبت دامنه شامل این ضمانت نیست."],
  ] },
  privacy: { title: "حریم خصوصی", path: "/privacy", sections: [
    ["اطلاعاتی که جمع می‌کنیم", "نام، ایمیل، شماره موبایل و اطلاعات احراز هویت برای ارائه سرویس و الزامات قانونی نگهداری می‌شود."],
    ["محتوای سرورهای شما", "گره به محتوای سرورها و هاست‌های شما دسترسی ندارد، مگر با درخواست صریح شما در تیکت پشتیبانی."],
    ["درخواست‌های خدمات دواپس", "اطلاعاتی که در فرم مشاوره دواپس وارد می‌کنید (نام، شرکت، راه تماس و شرح نیاز) فقط برای پاسخ به همان درخواست و تهیه پیشنهاد استفاده می‌شود و اگر قراردادی بسته نشود، پس از ۲۴ ماه یا هر زمان که درخواست کنید حذف می‌شود. دسترسی مهندسان گره به زیرساخت مشتریان دواپس فقط پس از امضای قرارداد و توافق‌نامه محرمانگی، با حساب‌های نام‌دار و ثبت‌شده و در حدود همان قرارداد است."],
    ["اشتراک‌گذاری", "اطلاعات شما به هیچ شخص ثالثی فروخته نمی‌شود و فقط در موارد قانونی و با حکم مرجع قضایی ارائه می‌شود."],
  ] },
  sla: { title: "توافق سطح خدمات", path: "/sla", sections: [
    ["تعهد آپتایم", "گره آپتایم ۹۹٫۹٪ ماهانه را برای همه سرویس‌ها تضمین می‌کند."],
    ["جبران خسارت", "به ازای هر ۰٫۱٪ کاهش آپتایم، ۱۰٪ هزینه ماه آن سرویس به کیف پول بازگردانده می‌شود؛ حداکثر تا ۱۰۰٪."],
    ["نگهداری برنامه‌ریزی‌شده", "عملیات نگهداری حداقل ۴۸ ساعت قبل اطلاع‌رسانی می‌شود و در محاسبه آپتایم لحاظ نمی‌شود."],
  ] },
} as const;

export function LegalPage({ doc }: { doc: keyof typeof LEGAL }) {
  const d = LEGAL[doc];
  return (
    <div className="fade-page pb-10">
      <JsonLd data={breadcrumbLd([[d.title, d.path]])} />
      <PageHeader icon="file-text" crumb={d.title} title="قوانین و تعهدات" sub="آخرین به‌روزرسانی: مهر ۱۴۰۴" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <nav aria-label="اسناد حقوقی" className="flex justify-center mb-8">
          <div className="max-w-full overflow-x-auto no-scrollbar"><div className="inline-flex p-1 rounded-2xl bg-white/[0.07] border border-white/15">
            {(Object.keys(LEGAL) as (keyof typeof LEGAL)[]).map((k) => (
              <Link key={k} href={LEGAL[k].path} aria-current={k === doc ? "page" : undefined}
                className={"px-4 py-2 text-sm rounded-xl whitespace-nowrap transition-colors " + (k === doc ? "bg-[#f5f7fb] text-slate-900 font-bold" : "text-white/70 hover:text-white")}>{LEGAL[k].title}</Link>
            ))}
          </div></div>
        </nav>
        <article className={GLASS + " fade-in rounded-[1.6rem] p-6 sm:p-10 space-y-8"}>
          <h2 className="text-2xl font-black">{d.title}</h2>
          {d.sections.map(([h, p], i) => (
            <section key={h}>
              <h3 className="font-extrabold text-lg flex items-center gap-3"><span className="mono text-xs text-white/50">{String(i + 1).padStart(2, "0")}</span>{h}</h3>
              <p className="text-white/65 leading-8 mt-2">{p}</p>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}
