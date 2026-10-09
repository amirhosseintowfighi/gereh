/* MCP (agent) connection snippets, shared by Panel › SSH و API and /docs/mcp. */

export type McpClient = { id: string; label: string; file: string; lang: string; note: string; code: (origin: string, token: string) => string };

export const MCP_CLIENTS: McpClient[] = [
  {
    id: "cli", label: "خودکار (CLI)", file: "ترمینال", lang: "bash",
    note: "CLI گره ابزارهای نصب‌شده (Claude Code، Cursor، VS Code و Codex) را پیدا می‌کند و اتصال را برایشان می‌سازد.",
    code: () => "npx @gereh/cli login\nnpx @gereh/cli setup agent",
  },
  {
    id: "claude", label: "Claude Code", file: "ترمینال", lang: "bash",
    note: "یک بار اجرا کنید؛ از آن به بعد کافی است به Claude بگویید «اپ shop را دیپلوی کن و لاگ را بررسی کن».",
    code: (origin, token) => `claude mcp add --transport http --scope user gereh ${origin}/api/mcp \\\n  --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "cursor", label: "Cursor", file: "~/.cursor/mcp.json", lang: "json",
    note: "پس از ذخیره، در Settings › MCP سرور gereh را فعال کنید.",
    code: (origin, token) => JSON.stringify({ mcpServers: { gereh: { url: origin + "/api/mcp", headers: { Authorization: "Bearer " + token } } } }, null, 2),
  },
  {
    id: "vscode", label: "VS Code", file: ".vscode/mcp.json", lang: "json",
    note: "توکن در فایل ذخیره نمی‌شود؛ VS Code بار اول آن را می‌پرسد و در حافظه امن خودش نگه می‌دارد. با Copilot در حالت Agent کار می‌کند.",
    code: (origin) => JSON.stringify({
      inputs: [{ type: "promptString", id: "gereh-token", description: "Gereh API token (grh_…)", password: true }],
      servers: { gereh: { type: "http", url: origin + "/api/mcp", headers: { Authorization: "Bearer ${input:gereh-token}" } } },
    }, null, 2),
  },
  {
    id: "codex", label: "Codex", file: "~/.codex/config.toml", lang: "toml",
    note: "توکن را در متغیر GEREH_TOKEN قرار دهید (export GEREH_TOKEN=grh_…).",
    code: (origin) => `[mcp_servers.gereh]\nurl = "${origin}/api/mcp"\nbearer_token_env_var = "GEREH_TOKEN"`,
  },
];

export function mcpDocs(origin: string, tools: { name: string; description: string; write?: boolean }[]) {
  const block = (c: McpClient) => "### " + c.label + "\n\n" + c.note + (c.file !== "ترمینال" ? " فایل: `" + c.file + "`" : "") + "\n\n```" + c.lang + "\n" + c.code(origin, "grh_YOUR_TOKEN") + "\n```";
  return `با سرور MCP گره، ایجنت‌های برنامه‌نویسی مثل **Claude Code**، **Cursor**، **Codex** و **Copilot در VS Code** می‌توانند مستقیم اپ‌ها، پایگاه‌های داده، سرورها و دامنه‌های شما را ببینند و مدیریت کنند: دیپلوی، خواندن لاگ و خطای بیلد، تنظیم متغیرها، ری‌استارت و ویرایش DNS؛ همه با زبان طبیعی.

## نشانی

\`\`\`
${origin}/api/mcp
\`\`\`

پروتکل: MCP با انتقال Streamable HTTP. احراز هویت با همان توکن‌های [API عمومی](/docs/api): هدر \`Authorization: Bearer grh_…\`.

## ساخت توکن

در [پنل › SSH و API](/panel/keys) یک توکن بسازید:

- **فقط خواندن**: ایجنت فقط وضعیت، لاگ و فهرست‌ها را می‌بیند. برای شروع امن‌تر است.
- **خواندن و نوشتن**: ایجنت می‌تواند دیپلوی، ری‌استارت و تغییر تنظیمات هم انجام دهد.

برای هر ابزار یا هر سیستم یک توکن جدا بسازید تا در صورت نیاز فقط همان را باطل کنید.

## اتصال

${MCP_CLIENTS.map(block).join("\n\n")}

## ابزارها

| ابزار | کار | نیاز به دسترسی نوشتن |
|---|---|---|
${tools.map((t) => "| `" + t.name + "` | " + t.description.split(". ")[0].replace(/\|/g, "\\|") + " | " + (t.write ? "بله" : "—") + " |").join("\n")}

## نمونه درخواست‌ها

- «وضعیت همه اپ‌هایم را بگو و اگر استقراری ناموفق بوده، علتش را از لاگ بیلد پیدا کن.»
- «اپ shop را دوباره دیپلوی کن و تا فعال شدن صبر کن.»
- «متغیر SENTRY_DSN را به‌صورت secret روی اپ api تنظیم کن.»
- «برای دامنه example.ir یک رکورد CNAME با نام www به shop.gereh.dev بساز.»

## امنیت

- هر کاری که ایجنت انجام می‌دهد با همان بررسی‌های مالکیت و اعتبارسنجی پنل انجام و در گزارش فعالیت حساب ثبت می‌شود.
- اکثر ایجنت‌ها پیش از اجرای ابزارهای نوشتنی از شما تأیید می‌گیرند؛ ابزارهای خواندنی با برچسب readOnly اعلام شده‌اند.
- توکن را در مخزن گیت قرار ندهید. برای VS Code از فرم بالا استفاده کنید که توکن را در فایل نمی‌نویسد.
`;
}
