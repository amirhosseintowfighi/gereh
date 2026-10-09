/* Copy for the AI API: quick-start snippets (panel and docs share them), landing-page features and FAQ. */

export type AiSnippet = { id: string; label: string; icon: string; note: string; lang: string; code: (base: string, key: string) => string };

export const AI_SNIPPETS: AiSnippet[] = [
  {
    id: "claude-code", label: "Claude Code", icon: "terminal", lang: "bash",
    note: "Claude Code مستقیم با فرمت Anthropic به گره وصل می‌شود؛ ابزارها، استریم و فایل‌خوانی همه کار می‌کنند.",
    code: (base, key) => `export ANTHROPIC_BASE_URL=${base}
export ANTHROPIC_AUTH_TOKEN=${key}
export ANTHROPIC_MODEL=claude-opus-5.5
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4.5
claude`,
  },
  {
    id: "codex", label: "Codex CLI", icon: "code-xml", lang: "toml",
    note: "در ‎~/.codex/config.toml بگذارید و کلید را در متغیر GEREH_API_KEY قرار دهید (export GEREH_API_KEY=…).",
    code: (base) => `model = "gpt-5.5"
model_provider = "gereh"

[model_providers.gereh]
name = "Gereh"
base_url = "${base}/v1"
env_key = "GEREH_API_KEY"
wire_api = "responses"`,
  },
  {
    id: "openai", label: "OpenAI SDK", icon: "braces", lang: "python",
    note: "هر برنامه یا کتابخانه سازگار با OpenAI (LangChain، n8n، Cursor، Continue، LibreChat…) فقط با تغییر base URL کار می‌کند.",
    code: (base, key) => `from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key="${key}")
r = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "سلام!"}],
)
print(r.choices[0].message.content)`,
  },
  {
    id: "anthropic", label: "Anthropic SDK", icon: "sparkles", lang: "python",
    note: "SDK رسمی Anthropic؛ ابزارها (tool use)، تصویر و استریم پشتیبانی می‌شوند.",
    code: (base, key) => `import anthropic

client = anthropic.Anthropic(base_url="${base}", api_key="${key}")
msg = client.messages.create(
    model="claude-sonnet-5.5", max_tokens=1024,
    messages=[{"role": "user", "content": "سلام!"}],
)
print(msg.content[0].text)`,
  },
  {
    id: "gemini", label: "Gemini SDK", icon: "gem", lang: "python",
    note: "SDK گوگل (google-genai) با آدرس گره؛ مدل‌های دیگر هم با همین فرمت قابل فراخوانی‌اند.",
    code: (base, key) => `from google import genai

client = genai.Client(api_key="${key}", http_options={"base_url": "${base}"})
r = client.models.generate_content(model="gemini-3.8-flash", contents="سلام!")
print(r.text)`,
  },
  {
    id: "curl", label: "cURL", icon: "terminal", lang: "bash",
    note: "ساده‌ترین تست از ترمینال.",
    code: (base, key) => `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"سلام!"}]}'`,
  },
];

export const AI_ENDPOINTS: [string, string, string][] = [
  ["POST", "/v1/chat/completions", "OpenAI Chat Completions (استریم، ابزار، تصویر، JSON mode)"],
  ["POST", "/v1/responses", "OpenAI Responses — برای Codex؛ بدون حالت ذخیره‌شده (store)"],
  ["POST", "/v1/messages", "Anthropic Messages — برای Claude Code و SDK رسمی Anthropic"],
  ["POST", "/v1/messages/count_tokens", "شمارش تقریبی توکن ورودی (Anthropic)"],
  ["POST", "/v1beta/models/{model}:generateContent", "Google Gemini (و ‎:streamGenerateContent?alt=sse)"],
  ["GET", "/v1/models", "فهرست مدل‌ها (با هدر anthropic-version به شکل Anthropic)"],
  ["GET", "/v1beta/models", "فهرست مدل‌ها به شکل Gemini"],
];

export const AI_FEATURES: [string, string, string][] = [
  ["layers", "همه مدل‌ها با یک کلید", "Claude، GPT، Gemini، DeepSeek، Qwen و GLM؛ بدون حساب خارجی، کارت ارزی یا VPN."],
  ["plug", "سازگار با هر ابزار", "فرمت‌های OpenAI، Anthropic و Gemini روی یک آدرس؛ Claude Code، Codex، Cursor و n8n بدون تغییر کد."],
  ["wallet", "پرداخت تومانی به ازای مصرف", "هزینه هر درخواست دقیقاً بر اساس توکن مصرفی از کیف پول کم می‌شود؛ بدون اشتراک ماهانه."],
  ["shield-check", "کنترل کامل هزینه", "برای هر کلید سقف روزانه و ماهانه، محدودیت مدل و تعداد درخواست در دقیقه تعیین کنید."],
  ["activity", "گزارش لحظه‌ای", "تک‌تک درخواست‌ها با مدل، توکن، هزینه و زمان پاسخ در پنل دیده می‌شوند."],
  ["zap", "استریم و ابزارها", "پاسخ استریم (SSE)، فراخوانی ابزار (function calling)، ورودی تصویر و خروجی JSON."],
];

export const AI_FAQ: [string, string][] = [
  ["قیمت‌ها چطور محاسبه می‌شوند؟", "قیمت هر مدل به ازای یک میلیون توکن ورودی و خروجی جدا اعلام می‌شود. هزینه هر درخواست = (توکن ورودی × قیمت ورودی + توکن خروجی × قیمت خروجی) ÷ یک میلیون، به تومان. درخواست‌های ناموفق هزینه‌ای ندارند."],
  ["چرا موقع ارسال درخواست مبلغی از کیف پول رزرو می‌شود؟", "برای جلوگیری از منفی شدن موجودی، پیش از ارسال حداکثر هزینه ممکن رزرو می‌شود و بلافاصله پس از پاسخ، مازاد آن برمی‌گردد. در گزارش فقط هزینه واقعی ثبت می‌شود."],
  ["با Claude Code و Codex کار می‌کند؟", "بله. Claude Code از مسیر ‎/v1/messages‎ (فرمت Anthropic) و Codex از ‎/v1/responses‎ استفاده می‌کند و هر دو کامل پشتیبانی می‌شوند؛ دستور راه‌اندازی در پنل و مستندات آمده است."],
  ["اطلاعات درخواست‌های من ذخیره می‌شود؟", "خیر. گره متن درخواست و پاسخ را ذخیره نمی‌کند؛ فقط مدل، تعداد توکن، هزینه و زمان پاسخ برای گزارش و صورتحساب نگه داشته می‌شود."],
  ["کلیدم لو رفت؛ چه کنم؟", "از پنل › API هوش مصنوعی کلید را باطل کنید و کلید جدید بسازید. با تعیین سقف روزانه برای هر کلید، خسارت احتمالی همیشه محدود است."],
  ["محدودیت سرعت دارد؟", "به‌طور پیش‌فرض ۱۲۰ درخواست در دقیقه برای هر کلید؛ تا ۶۰۰ درخواست قابل تنظیم است. برای نیاز بیشتر تیکت بزنید."],
];

export function aiDocs(base: string, models: { id: string; name: string; inPrice: number; outPrice: number; context: number }[]) {
  const t = (n: number) => n.toLocaleString("fa-IR");
  const snip = (id: string) => { const s = AI_SNIPPETS.find((x) => x.id === id)!; return s.note + "\n\n```" + s.lang + "\n" + s.code(base, "gk-YOUR-KEY") + "\n```"; };
  return `API هوش مصنوعی گره یک درگاه واحد برای مدل‌های Claude، GPT، Gemini، DeepSeek و دیگران است. همان API رسمی هر سازنده را روی آدرس گره صدا می‌زنید؛ گره درخواست را به مدل می‌رساند، پاسخ را در **همان فرمتی که فرستاده‌اید** برمی‌گرداند و هزینه را به تومان از کیف پول کم می‌کند.

## شروع سریع

1. در گره ثبت‌نام کنید و [کیف پول](/panel/billing) را شارژ کنید.
2. در [پنل › API هوش مصنوعی](/panel/ai) یک کلید بسازید. کلید با \`gk-\` شروع می‌شود و **فقط یک بار** نمایش داده می‌شود.
3. در برنامه یا ابزارتان آدرس پایه را به \`${base}\` تغییر دهید و کلید را به‌جای کلید OpenAI، Anthropic یا Gemini بگذارید.

## نشانی پایه

\`\`\`
${base}
\`\`\`

برای SDKهای OpenAI آدرس \`${base}/v1\` و برای Anthropic و Gemini خود \`${base}\` را بدهید.

## احراز هویت

کلید را به یکی از این روش‌ها بفرستید (هر SDK روش خودش را خودکار به‌کار می‌برد):

| روش | نمونه |
|---|---|
| هدر Authorization | \`Authorization: Bearer gk-…\` |
| هدر Anthropic | \`x-api-key: gk-…\` |
| هدر Gemini | \`x-goog-api-key: gk-…\` |
| پارامتر Gemini | \`?key=gk-…\` |

## مسیرها

| متد | مسیر | توضیح |
|---|---|---|
${AI_ENDPOINTS.map(([m, p, d]) => "| " + m + " | `" + p + "` | " + d + " |").join("\n")}

## Claude Code

${snip("claude-code")}

## Codex CLI

${snip("codex")}

## OpenAI SDK و ابزارهای سازگار

${snip("openai")}

در Cursor: Settings › Models › OpenAI API Key، کلید گره را وارد و «Override OpenAI Base URL» را روی \`${base}/v1\` بگذارید. در n8n، اعتبارنامه OpenAI را با Base URL همین آدرس بسازید.

## Anthropic SDK

${snip("anthropic")}

## Gemini SDK

${snip("gemini")}

## cURL

${snip("curl")}

## استریم

در همه فرمت‌ها استریم پشتیبانی می‌شود: \`"stream": true\` در OpenAI و Anthropic و مسیر \`:streamGenerateContent?alt=sse\` در Gemini. رویدادها دقیقاً با قالب رسمی هر سازنده ارسال می‌شوند، پس SDKها و ابزارها بدون تغییر کار می‌کنند. در OpenAI Chat برای دریافت مصرف توکن در انتهای استریم \`"stream_options": {"include_usage": true}\` بفرستید.

## هزینه و صورتحساب

- هزینه هر درخواست = (توکن ورودی × قیمت ورودی + توکن خروجی × قیمت خروجی) ÷ ۱٬۰۰۰٬۰۰۰، به تومان و رو به بالا.
- پیش از ارسال، حداکثر هزینه ممکن (بر اساس \`max_tokens\`) از کیف پول **رزرو** و بلافاصله پس از پاسخ، مازاد آن برگردانده می‌شود. اگر \`max_tokens\` نفرستید ۸٬۱۹۲ در نظر گرفته می‌شود.
- درخواست ناموفق (خطای سرویس‌دهنده) هیچ هزینه‌ای ندارد.
- هر پاسخ موفق هدر \`x-gereh-charged-toman\` (هزینه به تومان) و \`x-gereh-request-id\` (شناسه پیگیری) دارد.
- مصرف هر ۱۰ دقیقه در یک تراکنش «مصرف» در صورتحساب جمع می‌شود.

## محدودیت‌ها

- برای هر کلید می‌توانید سقف هزینه روزانه و ماهانه، فهرست مدل‌های مجاز، تعداد درخواست در دقیقه (پیش‌فرض ۱۲۰، حداکثر ۶۰۰) و تاریخ انقضا تعیین کنید.
- حداکثر حجم هر درخواست ۱۶ مگابایت است.
- در Responses API حالت ذخیره سمت سرور (\`previous_response_id\`، \`background\`، \`conversation\`) پشتیبانی نمی‌شود؛ تاریخچه را در \`input\` بفرستید. Codex به‌طور پیش‌فرض همین کار را می‌کند.
- متن درخواست‌ها و پاسخ‌ها ذخیره نمی‌شود؛ فقط مدل، توکن، هزینه و زمان پاسخ در گزارش می‌ماند.

## کدهای خطا

| HTTP | کد | معنی |
|---|---|---|
| 400 | \`invalid_request\` | بدنه یا پارامترها نادرست است |
| 401 | \`invalid_api_key\` / \`key_expired\` | کلید نامعتبر یا منقضی |
| 402 | \`insufficient_balance\` | موجودی کیف پول کافی نیست |
| 402 | \`key_budget_exceeded\` | سقف روزانه یا ماهانه کلید پر شده |
| 403 | \`key_disabled\` / \`model_not_allowed\` | کلید باطل شده یا مدل برای این کلید مجاز نیست |
| 404 | \`model_not_found\` | مدل وجود ندارد یا غیرفعال است |
| 429 | \`rate_limit_exceeded\` | سقف درخواست در دقیقه کلید |
| 429 | \`upstream_rate_limited\` | ظرفیت لحظه‌ای مدل پر است؛ دوباره تلاش کنید |
| 502 | \`upstream_error\` / \`upstream_unavailable\` | خطای سرویس‌دهنده مدل؛ هزینه‌ای کم نمی‌شود |

قالب بدنه خطا با فرمت درخواست یکی است (OpenAI، Anthropic یا Gemini) تا SDKها خطا را درست نمایش دهند.

## مدل‌ها و قیمت

قیمت‌ها به تومان و به ازای یک میلیون توکن است.

| مدل | شناسه | ورودی | خروجی | کانتکست |
|---|---|---|---|---|
${models.map((m) => "| " + m.name + " | `" + m.id + "` | " + t(m.inPrice) + " | " + t(m.outPrice) + " | " + t(Math.round(m.context / 1000)) + "K |").join("\n")}
`;
}
