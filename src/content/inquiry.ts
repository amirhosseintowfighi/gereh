/* Copy for /inquiry and /docs/inquiry. Service details come from src/lib/inquiry.ts, prices from the
   database, so the docs and the price list never disagree with the API. */
import { INQUIRY_CATEGORIES, INQUIRY_SERVICES, type InquiryField } from "@/lib/inquiry";

export const INQ_USECASES: { icon: string; title: string; text: string; services: string[] }[] = [
  { icon: "shopping-cart", title: "فروشگاه اینترنتی", text: "پیش از پرداخت، مالکیت کارت را با کد ملی خریدار تطبیق دهید و جلوی خرید با کارت‌های سرقتی و شکایت بانکی را بگیرید.", services: ["card_owner", "shahkar_lite"] },
  { icon: "wallet", title: "فین‌تک و کیف پول", text: "احراز هویت کامل در ثبت‌نام: ثبت احوال، تطبیق موبایل (شاهکار)، خواندن کارت ملی و تطبیق چهره؛ بدون فرم کاغذی.", services: ["identity_v2", "shahkar_lite", "national_card_ocr", "face_match"] },
  { icon: "store", title: "مارکت‌پلیس و پلتفرم‌ها", text: "شبای فروشندگان را پیش از تسویه استعلام کنید تا پول به حساب درست و به نام خود فروشنده برود.", services: ["ibans", "iban_owner", "company"] },
  { icon: "file-check", title: "اجاره، اقساط و وام", text: "پیش از تحویل کالا یا قرارداد، رنگ چک صیادی و هویت متقاضی را در چند ثانیه بررسی کنید.", services: ["sayad_cheque", "identity_v2"] },
  { icon: "truck", title: "ارسال و لجستیک", text: "نشانی کامل را از کد پستی بگیرید؛ خطای نشانی، مرجوعی و تماس‌های اضافه کم می‌شود.", services: ["postal_code"] },
  { icon: "building-2", title: "B2B و فاکتور رسمی", text: "اطلاعات ثبتی و کد اقتصادی مشتری حقوقی را برای قرارداد و سامانه مودیان بدون خطا تکمیل کنید.", services: ["company", "economic_code"] },
];

export const INQ_BILLING: [string, string, boolean][] = [
  ["پاسخ موفق", "اطلاعات پیدا شد و برگشت داده شد", true],
  ["یافت نشد", "پاسخ قطعی: چنین رکوردی وجود ندارد (مثلاً شبا بسته شده)", true],
  ["ورودی نامعتبر", "کد ملی، کارت یا شبای اشتباه؛ پیش از ارسال به سرویس‌دهنده رد می‌شود", false],
  ["خطای سرویس‌دهنده", "سامانه مرجع پاسخ نداد؛ مبلغ خودکار برمی‌گردد", false],
];

export const INQ_FAQ: [string, string][] = [
  ["هزینه چطور حساب می‌شود؟", "هزینه ماهانه، ورودیه یا حداقل خرید ندارد. کیف پول را شارژ می‌کنید و هر درخواستی که پاسخ قطعی بگیرد (موفق یا «یافت نشد») به قیمت همان سرویس از کیف پول کم می‌شود. ورودی اشتباه و خطای سامانه مرجع رایگان است."],
  ["برای شروع چه چیزی لازم است؟", "ثبت‌نام، احراز هویت حساب در گره و شارژ کیف پول. کلید API بلافاصله ساخته می‌شود و با حالت sandbox می‌توانید بدون هزینه برنامه را توسعه دهید."],
  ["چرا بعضی سرویس‌ها نیاز به تأیید دارند؟", "سرویس‌هایی مثل ثبت احوال، شاهکار، تطبیق چهره و چک صیادی با اطلاعات شخصی سروکار دارند و طبق مقررات فقط برای کاربرد مشخص و قانونی ارائه می‌شوند. کاربرد خود را در پنل بنویسید؛ معمولاً ظرف یک روز کاری بررسی می‌شود."],
  ["اطلاعات کاربران من کجا ذخیره می‌شود؟", "گره فقط چهار رقم آخر ورودی‌ها را برای گزارش و کد پیگیری نگه می‌دارد. پاسخ استعلام ذخیره نمی‌شود و مستقیم به برنامه شما برمی‌گردد."],
  ["محدودیت تعداد درخواست چقدر است؟", "هر حساب تا ۶۰۰ درخواست در دقیقه. اگر حجم بیشتری لازم دارید، با فروش تماس بگیرید."],
  ["فاکتور رسمی می‌دهید؟", "بله. شارژ کیف پول با فاکتور رسمی و قابل ثبت در سامانه مودیان صادر می‌شود."],
  ["با چه زبان‌هایی کار می‌کند؟", "API یک REST ساده با JSON است و با هر زبانی کار می‌کند. نمونه کد PHP، Python، Node.js و cURL در مستندات آمده است."],
];

const fieldRow = (f: InquiryField) => "| `" + f.key + "` | " + f.label + " | `" + (f.kind === "image" ? "data:image/jpeg;base64,…" : f.example) + "` |";

/** the full /docs/inquiry body; `prices` are the live prices */
export function inquiryDocs(origin: string, prices: Record<string, number>) {
  const toman = (n: number) => n.toLocaleString("fa-IR") + " تومان";
  const services = INQUIRY_CATEGORIES.map((c) => {
    const list = INQUIRY_SERVICES.filter((s) => s.category === c.id && prices[s.id] !== undefined);
    if (!list.length) return "";
    return "## " + c.label + "\n\n" + list.map((s) => [
      "### " + s.name + " — `" + s.id + "`",
      "",
      s.summary + " **قیمت: " + toman(prices[s.id]) + "**" + (s.approval ? " · نیاز به تأیید کاربرد" : ""),
      "",
      "| پارامتر | توضیح | نمونه |", "|---|---|---|", ...s.fields.map(fieldRow),
      "",
      "```bash",
      "curl -s -X POST " + origin + "/api/inquiry/v1/" + s.id + " \\",
      "  -H \"X-Api-Key: $GEREH_KEY\" -H \"X-Api-Password: $GEREH_PASSWORD\" \\",
      "  -H \"Content-Type: application/json\" \\",
      "  -d '" + JSON.stringify(Object.fromEntries(s.fields.map((f) => [f.key, f.kind === "image" ? "data:image/jpeg;base64,…" : f.example]))) + "'",
      "```",
      "",
      "```json",
      JSON.stringify({ ok: true, trackId: "INQ-M1X2Y3Z4AB", service: s.id, status: "success", result: s.sample, charged: prices[s.id], balance: 1250000 }, null, 2),
      "```",
    ].join("\n")).join("\n\n");
  }).filter(Boolean).join("\n\n");

  return `API استعلام گره یک REST API ساده است: یک درخواست POST با ورودی‌های JSON می‌فرستید و پاسخ را در قالب JSON می‌گیرید. همه مبالغ به **تومان** است.

## شروع سریع

1. در گره ثبت‌نام کنید و احراز هویت حساب را کامل کنید.
2. در [پنل › API استعلام](/panel/inquiry) دکمه «فعال‌سازی API» را بزنید؛ **API Key** و **API Password** ساخته می‌شود.
3. با حالت sandbox (رایگان) برنامه را توسعه دهید، سپس کیف پول را شارژ کنید و درخواست واقعی بفرستید.

## نشانی پایه

\`\`\`
${origin}/api/inquiry/v1
\`\`\`

## احراز هویت

کلید و رمز را در سربرگ‌های \`X-Api-Key\` و \`X-Api-Password\` بفرستید (یا با HTTP Basic به شکل \`key:password\`). رمز را فقط سمت سرور نگه دارید؛ هرگز در اپ موبایل یا کد مرورگر قرار ندهید.

\`\`\`bash
export GEREH_KEY="..."        # API Key
export GEREH_PASSWORD="..."   # API Password
curl -s ${origin}/api/inquiry/v1/balance -H "X-Api-Key: $GEREH_KEY" -H "X-Api-Password: $GEREH_PASSWORD"
\`\`\`

برای امنیت بیشتر، در تب «امنیت» پنل، IP سرورهای خود را ثبت کنید تا درخواست از جای دیگر پذیرفته نشود.

## حالت آزمایشی (sandbox)

سربرگ \`X-Sandbox: 1\` را بفرستید تا پاسخ نمونه با همان ساختار واقعی برگردد. این درخواست‌ها **رایگان** هستند، به سامانه مرجع نمی‌روند و در گزارش با برچسب sandbox دیده می‌شوند. در sandbox ورودی‌ای که با \`0000\` تمام شود پاسخ «یافت نشد» و ورودی‌ای که با \`9999\` تمام شود خطای سرویس‌دهنده برمی‌گرداند تا مسیرهای خطا را هم تست کنید.

## قالب پاسخ

\`\`\`json
{
  "ok": true,
  "trackId": "INQ-M1X2Y3Z4AB",
  "service": "cards",
  "status": "success",
  "result": { "bank": "بانک ملی", "owner": "علی محمدی" },
  "charged": 572,
  "balance": 1249428
}
\`\`\`

| فیلد | توضیح |
|---|---|
| \`status\` | \`success\` (پیدا شد) یا \`not_found\` (پاسخ قطعی: وجود ندارد) |
| \`result\` | داده‌های استعلام؛ در \`not_found\` برابر \`null\` |
| \`charged\` | مبلغی که برای این درخواست کسر شد |
| \`trackId\` | کد پیگیری؛ در گزارش پنل و برای پشتیبانی |

## هزینه

| نتیجه | هزینه |
|---|---|
| موفق | قیمت سرویس |
| یافت نشد | قیمت سرویس |
| ورودی نامعتبر | رایگان |
| خطای سامانه مرجع | رایگان (مبلغ خودکار برمی‌گردد) |

## خطاها

\`\`\`json
{ "ok": false, "error": { "code": "invalid_input", "message": "…", "fields": { "card": "شماره کارت: شماره کارت معتبر نیست" } } }
\`\`\`

| HTTP | code | معنی |
|---|---|---|
| 400 | \`invalid_input\` | ورودی نامعتبر (رایگان)؛ جزئیات در \`fields\` |
| 401 | \`unauthorized\` | کلید یا رمز نادرست |
| 402 | \`insufficient_balance\` | موجودی کیف پول کافی نیست |
| 403 | \`access_required\` | سرویس نیاز به تأیید کاربرد دارد |
| 403 | \`ip_not_allowed\` | درخواست از IP مجاز نیامده |
| 404 | \`unknown_service\` | شناسه سرویس اشتباه است |
| 429 | \`rate_limited\` | بیش از ۶۰۰ درخواست در دقیقه |
| 502 | \`upstream_error\` | سامانه مرجع پاسخ نداد (رایگان)؛ کمی بعد دوباره تلاش کنید |

## مسیرهای عمومی

| متد | مسیر | توضیح |
|---|---|---|
| GET | \`/balance\` | موجودی کیف پول |
| GET | \`/services\` | فهرست سرویس‌ها، قیمت و وضعیت دسترسی شما |
| POST | \`/{service}\` | استعلام |

## نمونه کد

### PHP

\`\`\`php
$ch = curl_init("${origin}/api/inquiry/v1/cards");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ["X-Api-Key: " . getenv("GEREH_KEY"), "X-Api-Password: " . getenv("GEREH_PASSWORD"), "Content-Type: application/json"],
  CURLOPT_POSTFIELDS => json_encode(["card" => "6037991234567893"]),
]);
$res = json_decode(curl_exec($ch), true);
echo $res["ok"] ? $res["result"]["owner"] : $res["error"]["message"];
\`\`\`

### Python

\`\`\`python
import os, requests
r = requests.post("${origin}/api/inquiry/v1/cards",
    headers={"X-Api-Key": os.environ["GEREH_KEY"], "X-Api-Password": os.environ["GEREH_PASSWORD"]},
    json={"card": "6037991234567893"}, timeout=20)
data = r.json()
print(data["result"]["owner"] if data["ok"] else data["error"]["message"])
\`\`\`

### Node.js

\`\`\`js
const res = await fetch("${origin}/api/inquiry/v1/cards", {
  method: "POST",
  headers: { "X-Api-Key": process.env.GEREH_KEY, "X-Api-Password": process.env.GEREH_PASSWORD, "Content-Type": "application/json" },
  body: JSON.stringify({ card: "6037991234567893" }),
});
const data = await res.json();
console.log(data.ok ? data.result.owner : data.error.message);
\`\`\`

${services}

## نکته‌های ورودی

- اعداد فارسی و عربی، فاصله و خط تیره خودکار پاک می‌شوند (\`۶۰۳۷-۹۹۱۲-...\` پذیرفته است).
- شبا را با یا بدون \`IR\` بفرستید.
- تاریخ تولد شمسی و به شکل \`1370/05/12\` است.
- تصویرها به‌صورت data URL (JPEG، PNG یا WebP) و کمتر از ۲ مگابایت.
`;
}
