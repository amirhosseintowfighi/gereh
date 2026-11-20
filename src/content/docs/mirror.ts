/* /docs/mirror — the package mirror. Every snippet is generated from src/lib/mirror.ts, the same source as /mirror. */
import { MIRROR_ECOSYSTEMS, MIRROR_GROUPS, mirrorEnv } from "@/lib/mirror";

export const mirrorDocs = (base: string, site: string) => {
  const b = base.replace(/\/$/, "");
  const groups = MIRROR_GROUPS.map((g) => {
    const items = MIRROR_ECOSYSTEMS.filter((e) => e.group === g.id).map((e) => {
      const s = e.snippet(b);
      return `### ${e.label}\n\nمخزن اصلی: \`${e.upstream}\`${s.file ? " · فایل: \`" + s.file + "\`" : ""}\n\n\`\`\`${s.lang}\n${s.code}\n\`\`\``;
    }).join("\n\n");
    return `## ${g.label}\n\n${g.sub}.\n\n${items}`;
  }).join("\n\n");
  const env = Object.entries(mirrorEnv(b)).map(([k, v]) => `export ${k}=${v}`).join("\n");
  return `میرور گره (\`${b}\`) یک کش از مخازن عمومی بسته‌هاست: npm، PyPI، Docker Hub، apt و ده‌ها مخزن دیگر. با آن \`npm install\`، \`pip install\`، \`docker pull\` و \`apt update\` با سرعت شبکه داخلی انجام می‌شوند و در قطعی اینترنت بین‌الملل هم کار می‌کنند.

## نکته‌های کلیدی

- **رایگان و بدون حساب:** میرور برای همه آزاد است؛ لازم نیست مشتری گره باشید.
- **فقط کش:** بسته‌ها دست‌نخورده تحویل داده می‌شوند و امضا و checksum آن‌ها (lockfile، \`go.sum\`، امضای apt) مثل همیشه بررسی می‌شود.
- **دریافت هنگام نیاز:** اگر بسته‌ای در کش نباشد، همان لحظه از مخزن اصلی گرفته و ذخیره می‌شود. در قطعی کامل اینترنت بین‌الملل فقط بسته‌هایی در دسترس‌اند که دست‌کم یک بار قبلاً دریافت شده باشند.
- **گره اپ خودکار:** بیلد اپ‌ها در [گره اپ](/docs/paas) ایمیج‌های پایه و بسته‌ها را از میرور می‌گیرد؛ تنظیمی لازم نیست.

## راه‌اندازی خودکار روی سرور

روی یک سرور لینوکس (اوبونتو، دبیان، آلپاین، فدورا، روکی، آلما، openSUSE، آرچ و…) این دستور مخازن سیستم‌عامل، Docker، npm، pip و Go را به میرور وصل می‌کند:

\`\`\`bash
curl -fsSL ${site}/mirror/setup.sh | sudo sh
\`\`\`

پیش از اجرا می‌توانید اسکریپت را ببینید: [${site}/mirror/setup.sh](${site}/mirror/setup.sh).

## متغیرهای محیطی برای CI و Docker build

برای GitHub Actions، GitLab CI یا \`Dockerfile\` کافی است این متغیرها را تنظیم کنید:

\`\`\`bash
${env}
\`\`\`

در Dockerfile:

\`\`\`dockerfile
ARG NPM_CONFIG_REGISTRY=${b}/repository/npm/
ARG PIP_INDEX_URL=${b}/repository/pypi/simple
RUN npm ci
\`\`\`

${groups}

## برگرداندن تنظیمات

برای برگشت به مخزن اصلی، همان تنظیم را حذف کنید؛ مثلاً \`npm config delete registry\`، حذف \`registry-mirrors\` از \`/etc/docker/daemon.json\` و ری‌استارت Docker، یا \`go env -u GOPROXY\`.

## رفع مشکل

| مشکل | راه‌حل |
|---|---|
| \`404\` برای یک بسته | نام یا نسخه را بررسی کنید؛ اگر اینترنت بین‌الملل قطع است و بسته قبلاً کش نشده، در دسترس نیست |
| \`docker pull\` هنوز از Docker Hub می‌گیرد | بعد از ویرایش \`daemon.json\`، Docker را ری‌استارت کنید: \`sudo systemctl restart docker\` |
| خطای checksum در npm یا pip | کش محلی را پاک کنید (\`npm cache clean --force\`، \`pip cache purge\`) و دوباره نصب کنید |
| ایمیج GHCR یا Quay پیدا نمی‌شود | این رجیستری‌ها با پیشوند در نشانی میرور در دسترس‌اند (نمونه‌ها بالا) |
`;
};
