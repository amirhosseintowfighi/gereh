#!/usr/bin/env node
/* Builds the token-optimizer benchmark dataset in tests/fixtures/ai-opt/ (deterministic: run it again and
   the files are identical). Each fixture is a representative SHAPE of Gereh traffic — synthetic content,
   no customer data: Persian, English, mixed, a long Markdown document, a long assistant history with
   tool results, a بافت project, JSON-heavy, code-heavy, multimodal, tool calls, and a public-API request.
   Usage: node scripts/ai-opt-fixtures.mjs */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "tests/fixtures/ai-opt");
mkdirSync(OUT, { recursive: true });

// a tiny deterministic PRNG so the "random" variety is the same every run
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const range = (n) => Array.from({ length: n }, (_, i) => i);

const write = (name, fx) => writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(fx, null, 2) + "\n");

/* ---------- 1. Persian support conversation (پشتیبانی AI) ---------- */
{
  const turns = [
    ["سلام، سرور مجازی من با شناسه srv-4821 از دیشب ساعت ۲۳:۴۰ در دسترس نیست. لطفاً بررسی کنید.", "سلام. وضعیت سرور srv-4821 را بررسی کردم: سرور روشن است اما پورت ۲۲ و ۴۴۳ پاسخ نمی‌دهند. احتمالاً فایروال تغییر کرده است. آیا دیروز قانون جدیدی به فایروال اضافه کردید؟"],
    ["بله، دیروز یک قانون برای مسدود کردن IP 185.12.44.7 اضافه کردم. ولی نباید پورت ۲۲ را ببندد.", "قانونی که اضافه کرده‌اید به‌جای IP منفرد، بازه 185.12.0.0/16 را بسته است و IP خودتان هم در همین بازه است. پیشنهاد می‌کنم قانون را به 185.12.44.7/32 تغییر دهید. تصمیم گرفتیم ابتدا از کنسول VNC وارد شوید."],
    ["از VNC وارد شدم. دستور ufw status را زدم و خروجی‌اش طولانی بود. حالا چه کار کنم؟", "قانون شماره ۳ را حذف کنید و دوباره با /32 اضافه کنید. هرگز همه پورت‌ها را باز نکنید؛ فقط همان قانون اشتباه را اصلاح کنید."],
    ["انجام شد و الان SSH کار می‌کند. ولی سایتم هنوز روی https://shop.example.ir بالا نمی‌آید؟", "Nginx روی سرور در حال اجراست اما گواهی SSL در تاریخ 1403/08/12 منقضی شده است. باید گواهی را تمدید کنید. اگر از certbot استفاده می‌کنید، دستور تمدید را اجرا کنید."],
    ["certbot ندارم. گواهی را از پنل گره گرفته بودم. چطور تمدیدش کنم؟", "در پنل گره › دامنه‌ها › shop.example.ir › گواهی SSL، دکمه «تمدید» را بزنید. تمدید رایگان است و حدود ۲ دقیقه طول می‌کشد. قرار شد بعد از تمدید، فایل /etc/nginx/sites-available/shop را بررسی کنیم."],
    ["تمدید شد. فایل nginx را هم نگاه کردم، مسیر گواهی درست است. ولی هنوز خطای ۵۰۲ می‌دهد.", "خطای ۵۰۲ یعنی Nginx به برنامه پشتی (پورت 3000) وصل نمی‌شود. سرویس node شما متوقف شده است. با دستور systemctl status shop وضعیت را ببینید."],
    ["وضعیت می‌گوید failed و پیام ENOMEM دارد. یعنی چه؟", "یعنی حافظه کم آمده است. سرور شما پلن ۲ گیگابایتی دارد و برنامه حدود ۱.۸ گیگابایت مصرف می‌کرد. دو راه دارید: ارتقای پلن به ۴ گیگابایت (ماهانه ۴۸۰٬۰۰۰ تومان) یا افزودن swap. تا وقتی مشکل حافظه حل نشده، سرویس را بدون محدودیت حافظه اجرا نکنید."],
    ["swap چطور اضافه کنم؟ ارتقا فعلاً بودجه‌اش را ندارم.", "یک فایل swap دو گیگابایتی بسازید و در /etc/fstab ثبت کنید. این راه موقت است و جای ارتقا را نمی‌گیرد. بعد از آن سرویس را دوباره راه‌اندازی کنید."],
    ["swap ساختم و سرویس بالا آمد. سایت باز می‌شود. ممنون! فقط سؤال آخر: چطور جلوی تکرار این مشکل را بگیرم؟", "برای پایش، «پایش هوشمند» گره را برای سرور srv-4821 فعال کنید تا مصرف حافظه بالای ۸۵٪ هشدار بدهد. همچنین در برنامه، محدودیت حافظه node را با --max-old-space-size=1536 تنظیم کنید."],
  ];
  const messages = [{ role: "system", content: "شما دستیار پشتیبانی گره هستید. فقط بر اساس اطلاعات واقعی حساب مشتری پاسخ دهید.\nهرگز رمز عبور یا کلید API را در پاسخ تکرار نکنید.\nاگر مطمئن نیستید، تیکت را به کارشناس انسانی ارجاع دهید.\nپاسخ‌ها کوتاه و به فارسی باشند." }];
  for (const [u, a] of turns) messages.push({ role: "user", content: u }, { role: "assistant", content: a });
  messages.push({ role: "user", content: "یک سؤال دیگر: آیا می‌توانم همین swap را روی سرور دوم srv-4822 هم بسازم؟ آن سرور هم پلن ۲ گیگابایتی دارد." });
  write("persian-support", { id: "persian-support", workload: "Persian", feature: "support-ai", description: "Persian support thread, 9 earlier turns with ids, IPs, dates and negations", request: { messages }, check: { kind: "contains", expect: ["srv-4822"] } });
}

/* ---------- 2. English panel chat with a long history ---------- */
{
  const topics = ["Postgres connection pooling", "Redis eviction policy", "Docker image size", "Nginx rate limiting", "Kubernetes liveness probes", "S3 lifecycle rules", "TLS certificate renewal", "cron job monitoring"];
  const messages = [{ role: "system", content: "You are a helpful DevOps assistant on the Gereh panel.  Answer   concisely.\n\n\n\nAlways include the exact commands when relevant.\nAlways include the exact commands when relevant.\nNever suggest disabling TLS verification." }];
  for (const [i, t] of topics.entries()) {
    messages.push({ role: "user", content: `Question ${i + 1}: how should I configure ${t} for an app that handles about ${(i + 2) * 150} requests per second? We run version ${i + 1}.${i * 2}.0 in production.` });
    messages.push({ role: "assistant", content: `For ${t} at around ${(i + 2) * 150} req/s, start with conservative defaults and measure.\n\n1. Set the limit to ${(i + 1) * 64} and keep a 20% headroom.\n2. Do not raise timeouts above ${30 + i * 5} seconds unless you see queueing.\n3. We decided to monitor the p95 latency for one week before changing anything else.\n\nIf the error rate goes over 1%, roll back to version ${i + 1}.${i * 2}.0.\n\n${"Keep in mind that every environment differs, so treat these numbers as a starting point and verify them under real load. ".repeat(3)}` });
  }
  messages.push({ role: "user", content: "Thanks. Now summarize which of these settings matter most for a small VPS with 2 GB RAM." });
  write("english-chat", { id: "english-chat", workload: "English", feature: "panel-chat", description: "English panel chat, 8 earlier technical turns with numbers and repeated boilerplate", request: { messages }, check: { kind: "free" } });
}

/* ---------- 3. mixed Persian/English ---------- */
{
  const messages = [{ role: "system", content: "You are Gereh's coding assistant. The customer writes in Persian; keep code, commands and identifiers in English." }];
  const qs = [
    ["چطور متغیر DATABASE_URL را در Gereh Apps تنظیم کنم؟", "در پنل › برنامه‌ها › تنظیمات › متغیرها، کلید `DATABASE_URL` را با مقدار `postgres://app:secret@db.internal:5432/shop` اضافه کنید. بعد از ذخیره، برنامه دوباره deploy می‌شود."],
    ["خطای `ECONNREFUSED 127.0.0.1:5432` می‌گیرم.", "یعنی برنامه به localhost وصل می‌شود نه به `db.internal`. مقدار `DATABASE_URL` را بررسی کنید؛ نباید `localhost` باشد. فایل `src/config/db.ts` را هم ببینید."],
    ["در src/config/db.ts این را دارم: `const url = process.env.DB_URL ?? 'postgres://localhost/shop'`", "نام متغیر اشتباه است: کد `DB_URL` را می‌خواند اما شما `DATABASE_URL` تنظیم کرده‌اید. یکی را تغییر دهید. تصمیم گرفتیم نام `DATABASE_URL` بماند و کد اصلاح شود."],
    ["اصلاح کردم و deploy شد. حالا migration ها اجرا نمی‌شوند.", "دستور `npx drizzle-kit migrate` را در Release command قرار دهید، نه در Start command. اگر migration شکست بخورد، deploy متوقف می‌شود و نسخه قبلی فعال می‌ماند."],
    ["Release command را گذاشتم ولی لاگ می‌گوید permission denied for schema public.", "کاربر `app` روی schema `public` دسترسی CREATE ندارد. در پنل › پایگاه داده › کاربران، به `app` نقش `owner` بدهید یا دستور `GRANT CREATE ON SCHEMA public TO app;` را اجرا کنید."],
  ];
  for (const [u, a] of qs) messages.push({ role: "user", content: u }, { role: "assistant", content: a });
  messages.push({ role: "user", content: "دسترسی را دادم. آیا برای محیط staging هم باید همین کار را بکنم؟ نام دیتابیس staging هست shop_staging." });
  write("mixed-fa-en", { id: "mixed-fa-en", workload: "mixed", feature: "panel-chat", description: "Persian questions with English code, identifiers, URLs and paths", request: { messages }, check: { kind: "contains", expect: ["shop_staging"] } });
}

/* ---------- 4. a long Markdown document (knowledge-base context) ---------- */
{
  const products = ["VPS", "Gereh Apps", "Managed Postgres", "Object Storage", "Mail", "Domains", "Geo DNS", "Mirror", "AI API", "Monitoring", "Backups", "Kubernetes", "WordPress", "Load Balancer", "Firewall", "CDN", "Snapshots", "Billing", "Team access", "Support"];
  let doc = "# Gereh platform handbook\n\nThis handbook is the reference the support assistant answers from. Prices are in Toman.\n\n";
  for (const [i, p] of products.entries()) {
    doc += `## ${p}\n\n${p} is part of the Gereh platform. It is available in the Tehran and Frankfurt regions and is billed hourly, with a monthly cap.\n\n`;
    doc += `### ${p} limits\n\n- Maximum instances per account: ${(i + 1) * 5}\n- Default quota: ${(i + 2) * 10} GB\n- API rate limit: ${(i + 1) * 60} requests per minute\n\n`;
    doc += `### ${p} pricing\n\n| Plan | Monthly price | Hourly price |\n|---|---|---|\n| Small | ${(i + 1) * 90_000} | ${(i + 1) * 125} |\n| Medium | ${(i + 1) * 180_000} | ${(i + 1) * 250} |\n| Large | ${(i + 1) * 360_000} | ${(i + 1) * 500} |\n\n`;
    doc += `### ${p} how-to\n\n${"To get started, open the panel, choose the region, pick a plan and confirm. Provisioning usually finishes within a few minutes; you get an email when it is ready. ".repeat(2)}\n\n\`\`\`bash\ngereh ${p.toLowerCase().replace(/\s+/g, "-")} create --region thr --plan small\n\`\`\`\n\n`;
  }
  doc += "## Security\n\nNever share API keys in tickets. Staff will never ask for your password.\n\n";
  const messages = [
    { role: "system", content: "Answer from the handbook below. Cite the section you used.\n\n" + doc },
    { role: "user", content: "What is the API rate limit of Managed Postgres, and how much is the Medium plan per month?" },
  ];
  write("markdown-doc", { id: "markdown-doc", workload: "long Markdown", feature: "panel-chat", description: "A 20-product handbook (≈80 sections) in the system prompt, one specific question", request: { messages }, check: { kind: "contains", expect: ["180"] } });
}

/* ---------- 5. assistant: long history with tool calls and results ---------- */
{
  const tools = ["list_servers", "server_metrics", "app_logs", "list_invoices", "dns_records"].map((name) => ({ type: "function", function: { name, description: "Gereh tool " + name.replace(/_/g, " "), parameters: { type: "object", properties: { id: { type: "string" }, limit: { type: "integer" } } } } }));
  const messages = [{ role: "system", content: "You are دستیار گره, the Gereh assistant. Use the tools to read the customer's account. Never run an action without the customer's confirmation.\nAnswer in Persian." }];
  let call = 0;
  for (let t = 0; t < 10; t++) {
    messages.push({ role: "user", content: pick(["وضعیت سرورهایم چطور است؟", "لاگ‌های برنامه shop را نشان بده", "فاکتورهای این ماه را بیاور", "رکوردهای DNS دامنه example.ir را ببین", "مصرف CPU سرور srv-4821 چقدر است؟"]) + " (" + (t + 1) + ")" });
    const name = pick(tools).function.name, id = "call_" + (++call);
    messages.push({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify({ id: "srv-48" + (20 + t), limit: 50 }) } }] });
    let result;
    if (name === "app_logs") result = range(120).map((i) => `2026-11-0${1 + (i % 7)}T1${i % 10}:0${i % 6}:${10 + (i % 50)}Z ${i % 17 === 0 ? "ERROR" : i % 9 === 0 ? "WARN" : "INFO"} [web] ${i % 17 === 0 ? "upstream timed out after 30000ms on GET /api/orders" : "GET /api/products 200 " + (20 + (i * 7) % 180) + "ms"}`).join("\n");
    else if (name === "list_invoices") result = JSON.stringify({ invoices: range(40).map((i) => ({ id: "INV-" + (9000 + i), amount: (i + 1) * 12_500, status: i % 5 ? "paid" : "unpaid", due: "1403/0" + (1 + (i % 9)) + "/1" + (i % 9) })) });
    else result = JSON.stringify({ servers: range(25).map((i) => ({ id: "srv-48" + (10 + i), cpu: (i * 13) % 100, ram: (i * 7) % 100, status: i % 6 ? "running" : "stopped", ip: "185.12." + (40 + i) + "." + (i * 3) })) });
    messages.push({ role: "tool", tool_call_id: id, content: result });
    messages.push({ role: "assistant", content: "نتیجه را بررسی کردم. " + pick(["سرور srv-4821 پایدار است.", "دو خطای timeout در لاگ‌ها هست.", "یک فاکتور پرداخت‌نشده دارید.", "رکوردها درست هستند."]) });
  }
  messages.push({ role: "user", content: "خلاصه کن: کدام سرورها متوقف شده‌اند و چه کاری پیشنهاد می‌کنی؟" });
  write("assistant-history", { id: "assistant-history", workload: "assistant history + tool results", feature: "assistant", description: "10 turns of tool calls: 120-line logs, 40-invoice and 25-server JSON results", request: { messages, tools }, check: { kind: "free" } });
}

/* ---------- 6. بافت (builder) project ---------- */
{
  const rule = (s) => "- " + s;
  const skills = [
    ["UI", ["Use semantic HTML elements.", "Every image needs an alt text.", "Keep the layout responsive from 320px up.", "Do not use inline styles.", "Prefer CSS variables for colors."]],
    ["Accessibility", ["Every image needs an alt text.", "Use semantic HTML elements.", "Form fields need visible labels.", "Never remove the focus outline.", "Contrast must be at least 4.5:1."]],
    ["Security", ["Never put secrets in client code.", "Escape user input before rendering it.", "Use parameterized SQL queries only.", "Do not disable CSRF protection.", "Set the Content-Security-Policy header."]],
    ["Performance", ["Lazy-load images below the fold.", "Use semantic HTML elements.", "Keep the bundle under 200 KB gzipped.", "Do not block rendering with synchronous scripts.", "Cache static assets for one year."]],
    ["RTL", ["Set dir=\"rtl\" and lang=\"fa\" on <html>.", "Use logical CSS properties (margin-inline-start).", "Keep the layout responsive from 320px up.", "Numbers in Persian digits in the UI text."]],
  ];
  let sys = "You are بافت, the AI app builder of Gereh.   Output complete files only.\n\n\n";
  for (const [title, rules] of skills) sys += "## Skill: " + title + "\n\n" + rules.map(rule).join("\n") + "\n\n\n";
  sys += "## Output format\n\nWrap each file as <file path=\"...\">…</file>.  Do not output anything outside <plan>, <file> and <summary>.\n";
  const files = {
    "index.html": "<!doctype html>\n<html lang=\"fa\" dir=\"rtl\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>فروشگاه</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <main id=\"app\"></main>\n  <script src=\"app.js\"></script>\n</body>\n</html>\n",
    "styles.css": range(60).map((i) => `.c${i} { margin-inline-start: ${i}px; color: var(--c${i % 5}); }`).join("\n") + "\n",
    "app.js": range(80).map((i) => `export function item${i}(x) { return x * ${i} + ${i % 7}; }`).join("\n") + "\n",
  };
  const ctx = Object.entries(files).map(([p, c]) => "<file path=\"" + p + "\">\n" + c + "</file>").join("\n\n");
  const messages = [{ role: "system", content: sys }, { role: "user", content: "<project_files>\n" + ctx + "\n</project_files>\n\n<user_request>\nیک صفحه سبد خرید اضافه کن\n</user_request>\n\nChange the project as requested." }];
  write("builder-project", { id: "builder-project", workload: "بافت project", feature: "builder", description: "Builder: skills blocks with repeated rules + project files in the (untouched) latest message", request: { messages }, check: { kind: "free" } });
}

/* ---------- 7. JSON-heavy (dbquery-like history) ---------- */
{
  const schema = { tables: range(30).map((i) => ({ name: "t_" + i, columns: range(8).map((j) => ({ name: "col_" + j, type: pick(["int", "text", "timestamptz", "numeric", "jsonb"]) })) })) };
  const messages = [{ role: "system", content: "Translate the question to one read-only PostgreSQL SELECT. Schema:\n" + JSON.stringify(schema) }];
  for (let i = 0; i < 6; i++) {
    messages.push({ role: "user", content: "تعداد ردیف‌های جدول t_" + i + " در ماه گذشته چند است؟" });
    messages.push({ role: "assistant", content: "```sql\nSELECT count(*) FROM t_" + i + " WHERE col_2 >= now() - interval '1 month';\n```" });
    messages.push({ role: "user", content: "نتیجه:\n" + JSON.stringify({ rows: range(60).map((k) => ({ id: k, value: (k * 37) % 1000, at: "2026-10-" + (10 + (k % 20)) })) }) });
    messages.push({ role: "assistant", content: "نتیجه ثبت شد." });
  }
  messages.push({ role: "user", content: "حالا میانگین col_3 در جدول t_7 را برای ردیف‌هایی که col_1 آن‌ها خالی نیست بده." });
  write("json-heavy", { id: "json-heavy", workload: "JSON-heavy", feature: "dbquery", description: "A 30-table JSON schema in the system prompt and JSON result dumps in history", request: { messages }, check: { kind: "contains", expect: ["t_7"] } });
}

/* ---------- 8. code-heavy ---------- */
{
  const messages = [{ role: "system", content: "You are a senior TypeScript reviewer. Keep answers short." }];
  for (let i = 0; i < 6; i++) {
    const code = "```ts\n" + range(40).map((k) => `export function f${i}_${k}(a: number, b: number): number {\n  if (a < ${k}) return b;   // keep\n  return a * ${k} - b;\n}`).join("\n\n") + "\n```";
    messages.push({ role: "user", content: "Review this module " + i + ":\n\n" + code });
    messages.push({ role: "assistant", content: "Module " + i + " looks fine. Do not change the early return in f" + i + "_3; it is intentional.\n\n```ts\nexport function f" + i + "_3(a: number, b: number): number {\n  if (a < 3) return b;   // keep\n  return a * 3 - b;\n}\n```" });
  }
  messages.push({ role: "user", content: "Write a unit test for f5_7 with vitest." });
  write("code-heavy", { id: "code-heavy", workload: "code-heavy", feature: "panel-chat", description: "6 code-review turns of 40-function TypeScript modules (code must stay byte-identical)", request: { messages }, check: { kind: "code", expect: ["f5_7"] } });
}

/* ---------- 9. multimodal ---------- */
{
  const img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const messages = [{ role: "system", content: "You describe screenshots of the Gereh panel for support." }];
  for (let i = 0; i < 5; i++) {
    messages.push({ role: "user", content: [{ type: "text", text: "این تصویر صفحه " + (i + 1) + " پنل است. چه خطایی می‌بینی؟" }, { type: "image_url", image_url: { url: img } }] });
    messages.push({ role: "assistant", content: "در تصویر " + (i + 1) + " پیام «اتصال به سرور برقرار نشد» دیده می‌شود. " + "این خطا معمولاً یعنی اتصال اینترنت یا فایروال مسیر را بسته است. ".repeat(4) });
  }
  messages.push({ role: "user", content: [{ type: "text", text: "و این تصویر آخر؟" }, { type: "image_url", image_url: { url: img } }] });
  write("multimodal", { id: "multimodal", workload: "multimodal", feature: "panel-chat", description: "Screenshots (image parts) with Persian text; images must pass untouched", request: { messages }, check: { kind: "free" } });
}

/* ---------- 10. tool calls through the public API, opted in ---------- */
{
  const tools = [{ type: "function", function: { name: "get_weather", description: "Weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }];
  const messages = [{ role: "system", content: "You are a weather bot. Use get_weather for every city question." }];
  for (let i = 0; i < 8; i++) {
    const city = ["Tehran", "Shiraz", "Tabriz", "Mashhad", "Isfahan", "Rasht", "Yazd", "Kerman"][i];
    messages.push({ role: "user", content: "What's the weather in " + city + "?" });
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: "t" + i, type: "function", function: { name: "get_weather", arguments: JSON.stringify({ city }) } }] });
    messages.push({ role: "tool", tool_call_id: "t" + i, content: JSON.stringify({ city, hourly: range(48).map((h) => ({ h, temp: 10 + ((h * 3 + i) % 15), wind: (h * 7) % 30 })) }) });
    messages.push({ role: "assistant", content: city + " is " + (12 + i) + "°C now." });
  }
  messages.push({ role: "user", content: "And in Bandar Abbas?" });
  write("tool-calls", { id: "tool-calls", workload: "tool calls (public API, opted in)", feature: "api", optIn: true, description: "8 tool round-trips with 48-hour JSON results; the customer opted in (x-gereh-optimize: 1)", request: { messages, tools }, check: { kind: "tool", expect: ["get_weather"] } });
  write("api-default", { id: "api-default", workload: "public API (default)", feature: "api", optIn: false, description: "The same request without opt-in: content must reach the provider unchanged", request: { messages, tools }, check: { kind: "tool", expect: ["get_weather"] } });
}

console.log("fixtures written to " + OUT);
