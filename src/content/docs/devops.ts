/* /docs/devops — how a DevOps engagement works. Everything is generated from src/content/devops.ts, the source of /devops. */
import { DEVOPS_FAQ, DEVOPS_ONEOFF, DEVOPS_PACKAGES, DEVOPS_PROCESS, DEVOPS_SERVICES, DEVOPS_SLA, DEVOPS_TRUST } from "@/content/devops";
import { toman } from "@/lib/format";

export const devopsDocs = () => `خدمات دواپس گره برای تیم‌هایی است که مهندس زیرساخت ندارند یا به کمک بیشتری نیاز دارند: از راه‌اندازی CI/CD و کوبرنتیز تا پایش شبانه‌روزی و پاسخ به حادثه. روی زیرساخت گره، سرویس‌دهنده دیگر یا سرورهای داخل سازمان شما کار می‌کنیم.

## خدمات

| خدمت | خلاصه |
|---|---|
${DEVOPS_SERVICES.map((s) => `| [${s.title}](/devops/${s.slug}) | ${s.short} |`).join("\n")}

جزئیات هر خدمت (مشکلی که حل می‌کند، خروجی‌ها، ابزارها و نتیجه) در صفحه همان خدمت آمده است.

## مراحل همکاری

${DEVOPS_PROCESS.map(([, t, d], i) => `${i + 1}. **${t}:** ${d}`).join("\n")}

برای شروع، [فرم درخواست مشاوره](/devops#request) را پر کنید؛ اندازه تیم، زیرساخت فعلی، بودجه و فوریت را بنویسید تا جلسه آشنایی دقیق‌تر باشد.

## بسته‌های ماهانه

${DEVOPS_PACKAGES.map((p) => `### ${p.name}\n\n${p.for} · ${p.price ? toman(p.price) + " در ماه" : p.unit}\n\n${p.features.map((f) => "- " + f).join("\n")}`).join("\n\n")}

## خدمات یک‌باره

${DEVOPS_ONEOFF.map((o) => `- **${o.name}${o.price ? " (" + toman(o.price) + ")" : ""}:** ${o.desc}`).join("\n")}

مبالغ بدون مالیات بر ارزش افزوده است.

## زمان پاسخ به حادثه

| شدت | تعریف | استارتاپ | رشد | سازمانی |
|---|---|---|---|---|
${DEVOPS_SLA.map((r) => `| ${r.sev} | ${r.desc} | ${r.startup} | ${r.growth} | ${r.enterprise} |`).join("\n")}

## دسترسی و امنیت

${DEVOPS_TRUST.map(([, t, d]) => `- **${t}:** ${d}`).join("\n")}

## پیگیری در پنل

پس از شروع قرارداد، در [پنل › خدمات دواپس](/panel/devops) پیشرفت پروژه، ساعت‌های مهندسی مصرف‌شده و گزارش‌های تیم را می‌بینید. صورتحساب‌ها هم در همان پنل صادر می‌شوند.

## پرسش‌های رایج

${DEVOPS_FAQ.map(([q, a]) => `### ${q}\n\n${a}`).join("\n\n")}
`;
