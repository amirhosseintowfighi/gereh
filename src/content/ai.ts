/* Copy for the AI API: quick-start snippets (panel and docs share them), landing-page features and FAQ. */

export type AiSnippet = { id: string; label: string; icon: string; note: string; lang: string; code: (base: string, key: string) => string };

export const AI_SNIPPETS: AiSnippet[] = [
  {
    id: "claude-code", label: "Claude Code", icon: "terminal", lang: "bash",
    note: "Claude Code مستقیم با فرمت Anthropic به گره وصل می‌شود؛ ابزارها، استریم و فایل‌خوانی همه کار می‌کنند.",
    code: (base, key) => `export ANTHROPIC_BASE_URL=${base}
export ANTHROPIC_AUTH_TOKEN=${key}
export ANTHROPIC_MODEL=claude-opus-5.5
export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-sonnet-5
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
    model="claude-sonnet-5", max_tokens=1024,
    messages=[{"role": "user", "content": "سلام!"}],
)
print(msg.content[0].text)`,
  },
  {
    id: "gemini", label: "Gemini SDK", icon: "gem", lang: "python",
    note: "SDK گوگل (google-genai) با آدرس گره؛ مدل‌های دیگر هم با همین فرمت قابل فراخوانی‌اند.",
    code: (base, key) => `from google import genai

client = genai.Client(api_key="${key}", http_options={"base_url": "${base}"})
r = client.models.generate_content(model="gemini-3.7-flash", contents="سلام!")
print(r.text)`,
  },
  {
    id: "openai-js", label: "OpenAI SDK (JS)", icon: "braces", lang: "javascript",
    note: "کتابخانه رسمی openai برای Node.js؛ chat، embeddings، images و audio همه با همین client کار می‌کنند.",
    code: (base, key) => `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}/v1", apiKey: "${key}" });
const r = await client.chat.completions.create({
  model: "<model-id>", // از GET /v1/models
  messages: [{ role: "user", content: "سلام!" }],
});
console.log(r.choices[0].message.content);

const e = await client.embeddings.create({ model: "<embedding-model-id>", input: ["متن اول", "متن دوم"] });
console.log(e.data[0].embedding.length);`,
  },
  {
    id: "vercel-ai", label: "Vercel AI SDK", icon: "zap", lang: "typescript",
    note: "با @ai-sdk/openai-compatible (یا createOpenAI) و آدرس گره؛ streamText، generateText و embed پشتیبانی می‌شوند.",
    code: (base, key) => `import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";

const gereh = createOpenAICompatible({ name: "gereh", baseURL: "${base}/v1", apiKey: "${key}" });
const result = streamText({ model: gereh("<model-id>"), prompt: "یک شعر کوتاه بنویس" });
for await (const part of result.textStream) process.stdout.write(part);`,
  },
  {
    id: "n8n", label: "n8n", icon: "workflow", lang: "text",
    note: "در n8n یک اعتبارنامه از نوع OpenAI بسازید؛ نودهای OpenAI Chat Model، Embeddings OpenAI و AI Agent بدون تغییر کار می‌کنند.",
    code: (base, key) => `Credentials › New › OpenAI API
  API Key:   ${key}
  Base URL:  ${base}/v1

AI Agent › Chat Model › OpenAI Chat Model
  Credential: (همین اعتبارنامه)
  Model:      From list (فهرست از /v1/models خوانده می‌شود)`,
  },
  {
    id: "openwebui", label: "Open WebUI", icon: "bot", lang: "bash",
    note: "Open WebUI را با اتصال OpenAI گره اجرا کنید؛ همه مدل‌های گفتگو در فهرست مدل‌ها ظاهر می‌شوند (یا از Admin › Settings › Connections اضافه کنید).",
    code: (base, key) => `docker run -d -p 3000:8080 \
  -e OPENAI_API_BASE_URL=${base}/v1 \
  -e OPENAI_API_KEY=${key} \
  -v open-webui:/app/backend/data \
  --name open-webui ghcr.io/open-webui/open-webui:main`,
  },
  {
    id: "cline", label: "Cline", icon: "code-xml", lang: "text",
    note: "در افزونه Cline (VS Code): Settings › API Provider را «OpenAI Compatible» بگذارید.",
    code: (base, key) => `API Provider:  OpenAI Compatible
Base URL:      ${base}/v1
API Key:       ${key}
Model ID:      <model-id>   (از GET /v1/models)`,
  },
  {
    id: "curl", label: "cURL", icon: "terminal", lang: "bash",
    note: "ساده‌ترین تست از ترمینال.",
    code: (base, key) => `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.6-luna","messages":[{"role":"user","content":"سلام!"}]}'`,
  },
];

export const AI_ENDPOINTS: [string, string, string][] = [
  ["POST", "/v1/chat/completions", "OpenAI Chat Completions (استریم، ابزار، تصویر، JSON mode)"],
  ["POST", "/v1/responses", "OpenAI Responses — برای Codex؛ بدون حالت ذخیره‌شده (store)"],
  ["POST", "/v1/messages", "Anthropic Messages — برای Claude Code و SDK رسمی Anthropic"],
  ["POST", "/v1/messages/count_tokens", "شمارش تقریبی توکن ورودی (Anthropic)"],
  ["POST", "/v1beta/models/{model}:generateContent", "Google Gemini (و ‎:streamGenerateContent?alt=sse)"],
  ["POST", "/v1/embeddings", "بردار Embedding متن (OpenAI)؛ هزینه به ازای توکن ورودی"],
  ["POST", "/v1/images/generations", "ساخت تصویر؛ هزینه به ازای هر تصویر"],
  ["POST", "/v1/images/edits", "ویرایش تصویر (multipart/form-data)"],
  ["POST", "/v1/audio/speech", "تبدیل متن به گفتار؛ هزینه به ازای نویسه"],
  ["POST", "/v1/audio/transcriptions", "تبدیل گفتار به متن (multipart/form-data)؛ هزینه به ازای دقیقه"],
  ["POST", "/v1/rerank", "مرتب‌سازی اسناد بر اساس ارتباط با پرسش؛ هزینه به ازای هر ۱۰۰۰ جست‌وجو"],
  ["POST", "/kb/{id}/query", "جست‌وجوی معنایی در پایگاه دانش (RAG) شما"],
  ["GET", "/v1/models", "فهرست مدل‌ها با نوع و واحد قیمت (با هدر anthropic-version به شکل Anthropic)"],
  ["GET", "/v1beta/models", "فهرست مدل‌ها به شکل Gemini"],
];

export const AI_FEATURES: [string, string, string][] = [
  ["layers", "همه مدل‌ها با یک کلید", "Claude، GPT، Gemini، DeepSeek، Qwen و GLM؛ بدون حساب خارجی، کارت ارزی یا VPN."],
  ["plug", "سازگار با هر ابزار", "فرمت‌های OpenAI، Anthropic و Gemini روی یک آدرس؛ Claude Code، Codex، Cursor و n8n بدون تغییر کد."],
  ["wallet", "پرداخت تومانی به ازای مصرف", "هزینه هر درخواست دقیقاً بر اساس توکن مصرفی از کیف پول کم می‌شود؛ بدون اشتراک ماهانه."],
  ["shield-check", "کنترل کامل هزینه", "برای هر کلید سقف روزانه و ماهانه، محدودیت مدل و تعداد درخواست در دقیقه تعیین کنید."],
  ["activity", "گزارش لحظه‌ای", "تک‌تک درخواست‌ها با کلید، مدل، توکن، هزینه، تأخیر و دلیل پایان؛ داشبورد روزانه، مدل و کلید با خروجی CSV."],
  ["sparkles", "Embedding، تصویر و صوت", "‎/v1/embeddings، ساخت و ویرایش تصویر، تبدیل متن و گفتار و Rerank با همان کلید و پرداخت تومانی."],
  ["book-open", "پایگاه دانش و چت", "فایل‌هایتان را بارگذاری کنید، در چت پنل با آن‌ها گفتگو کنید یا از API و MCP جست‌وجو کنید."],
  ["zap", "استریم و ابزارها", "پاسخ استریم (SSE)، فراخوانی ابزار (function calling)، ورودی تصویر و خروجی JSON."],
];

export const AI_FAQ: [string, string][] = [
  ["قیمت‌ها چطور محاسبه می‌شوند؟", "قیمت هر مدل به ازای یک میلیون توکن ورودی و خروجی جدا اعلام می‌شود. هزینه هر درخواست = (توکن ورودی × قیمت ورودی + توکن خروجی × قیمت خروجی) ÷ یک میلیون، به تومان. درخواست‌های ناموفق هزینه‌ای ندارند."],
  ["چرا موقع ارسال درخواست مبلغی از کیف پول رزرو می‌شود؟", "برای جلوگیری از منفی شدن موجودی، پیش از ارسال حداکثر هزینه ممکن رزرو می‌شود و بلافاصله پس از پاسخ، مازاد آن برمی‌گردد. در گزارش فقط هزینه واقعی ثبت می‌شود."],
  ["با Claude Code و Codex کار می‌کند؟", "بله. Claude Code از مسیر ‎/v1/messages‎ (فرمت Anthropic) و Codex از ‎/v1/responses‎ استفاده می‌کند و هر دو کامل پشتیبانی می‌شوند؛ دستور راه‌اندازی در پنل و مستندات آمده است."],
  ["اطلاعات درخواست‌های من ذخیره می‌شود؟", "به‌طور پیش‌فرض خیر. گره متن درخواست و پاسخ را ذخیره نمی‌کند؛ فقط مدل، تعداد توکن، هزینه و زمان پاسخ برای گزارش و صورتحساب ۳۰ یا ۶۰ روز نگه داشته می‌شود. ثبت متن فقط اگر خودتان برای اشکال‌زدایی روشن کنید انجام می‌شود."],
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

## OpenAI SDK در JavaScript

${snip("openai-js")}

## Vercel AI SDK

${snip("vercel-ai")}

## n8n

${snip("n8n")}

## Open WebUI

${snip("openwebui")}

## Cline

${snip("cline")}

## cURL

${snip("curl")}

## Embedding، تصویر، صوت و Rerank

هر مدل یک **نوع** دارد (گفتگو، Embedding، تصویر، متن به گفتار، گفتار به متن، Rerank) که در \`GET /v1/models\` (فیلد \`kind\` و \`pricing\`) آمده است و فقط روی مسیر همان نوع پذیرفته می‌شود. واحد قیمت هر نوع:

| نوع | مسیر | واحد قیمت |
|---|---|---|
| گفتگو | \`/v1/chat/completions\`، \`/v1/responses\`، \`/v1/messages\` | یک میلیون توکن ورودی و خروجی |
| Embedding | \`/v1/embeddings\` | یک میلیون توکن ورودی |
| تصویر | \`/v1/images/generations\`، \`/v1/images/edits\` | هر تصویر |
| متن به گفتار | \`/v1/audio/speech\` | یک میلیون نویسه |
| گفتار به متن | \`/v1/audio/transcriptions\` | هر دقیقه صوت |
| Rerank | \`/v1/rerank\` | هر ۱۰۰۰ جست‌وجو (هر ۱۰۰ سند یک جست‌وجو) |

\`\`\`bash
curl ${base}/v1/embeddings -H "Authorization: Bearer gk-YOUR-KEY" -H "Content-Type: application/json" \\
  -d '{"model":"<embedding-model-id>","input":["سلام","درود"]}'

curl ${base}/v1/audio/transcriptions -H "Authorization: Bearer gk-YOUR-KEY" \\
  -F model=<stt-model-id> -F file=@voice.mp3 -F response_format=verbose_json
\`\`\`

## پایگاه دانش (RAG)

در [پنل › API هوش مصنوعی › پایگاه دانش](/panel/ai) پایگاه بسازید و فایل txt، md، csv، json، html یا pdf متنی بارگذاری کنید؛ متن قطعه‌بندی و با مدل Embedding انتخابی بردار می‌شود (هزینه مانند Embedding). سپس:

\`\`\`bash
curl ${base}/kb/KB_ID/query -H "Authorization: Bearer gk-YOUR-KEY" -H "Content-Type: application/json" \\
  -d '{"query":"شرایط بازگشت وجه چیست؟","top_k":5}'
\`\`\`

پاسخ فهرست قطعه‌های مرتبط با \`text\`، \`score\` (شباهت کسینوسی)، \`document\` و \`chunk\` است. در «چت» پنل هم می‌توانید پایگاه دانش را برای یک گفتگو انتخاب کنید. ابزارهای \`list_knowledge_bases\` و \`query_knowledge_base\` در [سرور MCP](/docs/mcp) هم در دسترس‌اند.

## مسیریابی و جست‌وجوی وب

- برای هر کلید می‌توانید اولویت مسیریابی (ارزان‌ترین، بیشترین سرعت تولید یا کمترین تأخیر) را تعیین کنید؛ این ترجیح با هدر به سرویس‌دهنده بالادستی فرستاده می‌شود.
- پسوند \`:online\` روی شناسه مدل گفتگو (مثلاً \`<model-id>:online\`) بدون تغییر به سرویس‌دهنده می‌رسد و با قیمت همان مدل حساب می‌شود.

## استریم

در همه فرمت‌ها استریم پشتیبانی می‌شود: \`"stream": true\` در OpenAI و Anthropic و مسیر \`:streamGenerateContent?alt=sse\` در Gemini. رویدادها دقیقاً با قالب رسمی هر سازنده ارسال می‌شوند، پس SDKها و ابزارها بدون تغییر کار می‌کنند. در OpenAI Chat برای دریافت مصرف توکن در انتهای استریم \`"stream_options": {"include_usage": true}\` بفرستید.

## هزینه و صورتحساب

- هزینه هر درخواست = (توکن ورودی × قیمت ورودی + توکن خروجی × قیمت خروجی) ÷ ۱٬۰۰۰٬۰۰۰، به تومان و رو به بالا.
- پیش از ارسال، حداکثر هزینه ممکن (بر اساس \`max_tokens\`) از کیف پول **رزرو** و بلافاصله پس از پاسخ، مازاد آن برگردانده می‌شود. اگر \`max_tokens\` نفرستید ۸٬۱۹۲ در نظر گرفته می‌شود.
- درخواست ناموفق (خطای سرویس‌دهنده) هیچ هزینه‌ای ندارد.
- هر پاسخ موفق هدر \`x-gereh-charged-toman\` (هزینه به تومان) و \`x-gereh-request-id\` (شناسه پیگیری) دارد.
- مصرف هر ۱۰ دقیقه در یک تراکنش «مصرف» در صورتحساب جمع می‌شود.

## محدودیت‌ها

- برای هر کلید می‌توانید سقف هزینه روزانه و ماهانه، فهرست مدل‌های مجاز، IPهای مجاز، تعداد درخواست در دقیقه (پیش‌فرض ۱۲۰، حداکثر ۶۰۰) و تاریخ انقضا تعیین کنید و آن را موقتاً غیرفعال کنید.
- کلیدها را می‌توانید در **پروژه** گروه‌بندی کنید و برای هر پروژه سقف هزینه ماهانه بگذارید.
- برای کم شدن موجودی کیف پول از یک حد، هشدار تنظیم کنید.
- حداکثر حجم هر درخواست ۱۶ مگابایت است.
- در Responses API حالت ذخیره سمت سرور (\`previous_response_id\`، \`background\`، \`conversation\`) پشتیبانی نمی‌شود؛ تاریخچه را در \`input\` بفرستید. Codex به‌طور پیش‌فرض همین کار را می‌کند.
- متن درخواست‌ها و پاسخ‌ها به‌طور پیش‌فرض ذخیره نمی‌شود؛ فقط کلید، مدل، وضعیت، توکن، هزینه، زمان پاسخ و دلیل پایان در گزارش می‌ماند (۳۰ یا ۶۰ روز). ثبت متن برای اشکال‌زدایی اختیاری است و در تنظیمات روشن می‌شود.

## کدهای خطا

| HTTP | کد | معنی |
|---|---|---|
| 400 | \`invalid_request\` | بدنه یا پارامترها نادرست است |
| 401 | \`invalid_api_key\` / \`key_expired\` | کلید نامعتبر یا منقضی |
| 402 | \`insufficient_balance\` | موجودی کیف پول کافی نیست |
| 402 | \`key_budget_exceeded\` | سقف روزانه یا ماهانه کلید پر شده |
| 402 | \`project_budget_exceeded\` | سقف ماهانه پروژه کلید پر شده |
| 400 | \`wrong_model_kind\` | مدل برای این مسیر نیست (مثلاً مدل گفتگو روی ‎/v1/embeddings) |
| 403 | \`ip_not_allowed\` | درخواست از IP مجاز کلید نیامده است |
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
