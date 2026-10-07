/* /docs/api body (Markdown subset). Kept next to the KB so docs and articles share one renderer. */
export const API_DOCS = `API گره همان کارهایی را که در پنل انجام می‌دهید از طریق HTTP در اختیار اسکریپت‌ها، CI/CD و Terraform می‌گذارد. همه درخواست‌ها و پاسخ‌ها JSON هستند و مبالغ به **تومان** است.

## نشانی پایه

\`\`\`
https://gereh.net/api/v1
\`\`\`

مشخصات کامل در قالب [OpenAPI 3.1](/api/v1/openapi.json) منتشر شده است و می‌توانید آن را در Postman، Insomnia یا هر تولیدکننده SDK وارد کنید.

## احراز هویت

از **پنل › SSH و API** یک توکن بسازید. توکن فقط یک بار نمایش داده می‌شود و با \`grh_\` شروع می‌شود. آن را در سربرگ \`Authorization\` بفرستید:

\`\`\`bash
export GEREH_TOKEN="grh_..."
curl -s https://gereh.net/api/v1/account -H "Authorization: Bearer $GEREH_TOKEN"
\`\`\`

| نوع توکن | مجاز |
|---|---|
| فقط خواندنی | فقط درخواست‌های \`GET\` |
| خواندن و نوشتن | همه درخواست‌ها |

توکن‌ها می‌توانند تاریخ انقضا داشته باشند و هر زمان از پنل باطل شوند. اگر حساب تعلیق شود، توکن‌های آن هم کار نمی‌کنند.

## محدودیت درخواست

هر توکن حداکثر **۱۲۰ درخواست در دقیقه** مجاز است. بیش از آن پاسخ \`429\` برمی‌گردد؛ چند ثانیه صبر کنید و دوباره بفرستید.

## خطاها

خطاها با کد وضعیت HTTP مناسب و این ساختار برمی‌گردند:

\`\`\`json
{ "error": { "message": "Not found" } }
\`\`\`

| کد | معنی |
|---|---|
| 401 | توکن نیست، نادرست است یا منقضی شده |
| 403 | توکن فقط خواندنی است یا سرویس معلق است |
| 404 | منبع وجود ندارد یا متعلق به حساب شما نیست |
| 422 | ورودی نامعتبر است |
| 429 | از سقف درخواست عبور کرده‌اید |

## سرورها

| متد | مسیر | توضیح |
|---|---|---|
| GET | \`/servers\` | فهرست سرورها |
| GET | \`/servers/{id}\` | جزئیات یک سرور |
| POST | \`/servers/{id}/actions\` | روشن، خاموش یا راه‌اندازی مجدد |

\`\`\`bash
curl -s https://gereh.net/api/v1/servers -H "Authorization: Bearer $GEREH_TOKEN"

curl -s -X POST https://gereh.net/api/v1/servers/srv-1042/actions \\
  -H "Authorization: Bearer $GEREH_TOKEN" -H "Content-Type: application/json" \\
  -d '{"action":"reboot"}'
\`\`\`

مقدار \`action\` یکی از \`start\`، \`stop\` یا \`reboot\` است.

## دامنه‌ها و DNS

| متد | مسیر | توضیح |
|---|---|---|
| GET | \`/domains\` | فهرست دامنه‌ها |
| GET | \`/domains/{id}/records\` | رکوردهای DNS |
| POST | \`/domains/{id}/records\` | ساخت رکورد |
| PUT | \`/domains/{id}/records/{rid}\` | جایگزینی رکورد |
| DELETE | \`/domains/{id}/records/{rid}\` | حذف رکورد |

\`\`\`bash
curl -s -X POST https://gereh.net/api/v1/domains/dom-501/records \\
  -H "Authorization: Bearer $GEREH_TOKEN" -H "Content-Type: application/json" \\
  -d '{"type":"A","name":"api","value":"185.143.232.17","ttl":300}'
\`\`\`

نوع رکورد یکی از \`A\`، \`AAAA\`، \`CNAME\`، \`MX\`، \`TXT\`، \`NS\`، \`SRV\` یا \`CAA\` است؛ برای ریشه دامنه نام را \`@\` بگذارید و \`priority\` فقط برای MX و SRV لازم است.

## حساب و صورتحساب‌ها

| متد | مسیر | توضیح |
|---|---|---|
| GET | \`/account\` | نام، ایمیل و موجودی کیف پول |
| GET | \`/invoices\` | صورتحساب‌ها با وضعیت و مبلغ |

## Terraform

provider رسمی گره رکوردهای DNS را به‌صورت کد مدیریت می‌کند و مشخصات سرورها را می‌خواند:

\`\`\`hcl
terraform {
  required_providers {
    gereh = { source = "gereh/gereh" }
  }
}

provider "gereh" {} # GEREH_TOKEN از متغیر محیطی خوانده می‌شود

data "gereh_server" "web" {
  id = "srv-1042"
}

resource "gereh_dns_record" "api" {
  domain_id = "dom-501"
  type      = "A"
  name      = "api"
  value     = data.gereh_server.web.ipv4
  ttl       = 300
}
\`\`\`

## پشتیبانی

اگر به endpoint دیگری نیاز دارید یا رفتار API با این مستندات نمی‌خواند، از [تیکت فنی](/panel/tickets) خبر دهید.`;
