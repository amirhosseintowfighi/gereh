/* Gereh Apps build and runtime options: defaults, validation and the deploy-failure classifier,
   shared by the panel and the server (no server imports here). */

export type HealthType = "http" | "command" | "tcp";
export type RuntimeConfig = {
  preBuild: string; postBuild: string; preStart: string;
  healthType: HealthType; healthCommand: string; healthCodes: string;
  healthInterval: number; healthTimeout: number; healthRetries: number; healthStartPeriod: number;
  zeroDowntime: boolean; buildCache: boolean; mirror: boolean; buildArgs: Record<string, string>; dockerfile: string;
  timezone: string; readOnlyFs: boolean; dnsServers: string[]; nginxConf: string; phpIni: string;
  defaultDomain: boolean; authPath: string; authUser: string;
  budget: number; budgetAlertPct: number; budgetStop: boolean; trafficAlertGb: number;
};

export const DEFAULT_RUNTIME: RuntimeConfig = {
  preBuild: "", postBuild: "", preStart: "",
  healthType: "http", healthCommand: "", healthCodes: "200-399", healthInterval: 5, healthTimeout: 3, healthRetries: 3, healthStartPeriod: 0,
  zeroDowntime: true, buildCache: true, mirror: true, buildArgs: {}, dockerfile: "Dockerfile",
  timezone: "Asia/Tehran", readOnlyFs: false, dnsServers: [], nginxConf: "", phpIni: "",
  defaultDomain: true, authPath: "", authUser: "",
  budget: 0, budgetAlertPct: 80, budgetStop: false, trafficAlertGb: 0,
};

export const MAX_DNS = 4;
export const MAX_BUILD_ARGS = 30;
export const MAX_CONF_BYTES = 32_768;
/** stacks served by nginx (config override) and by PHP (php.ini) */
export const NGINX_STACKS = new Set(["php", "laravel", "wordpress", "static"]);
export const PHP_STACKS = new Set(["php", "laravel", "wordpress"]);

export const TIMEZONES = ["Asia/Tehran", "UTC", "Asia/Dubai", "Asia/Istanbul", "Europe/Istanbul", "Europe/Berlin", "Europe/London", "Europe/Amsterdam", "Asia/Baku", "Asia/Yerevan", "Asia/Kabul", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
export function timezoneError(tz: string) {
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return "منطقه زمانی معتبر نیست؛ مثل Asia/Tehran";
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return null; } catch { return "منطقه زمانی «" + tz + "» شناخته نشد."; }
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;
export function dnsError(list: string[]) {
  if (list.length > MAX_DNS) return "حداکثر " + MAX_DNS.toLocaleString("fa-IR") + " سرور DNS.";
  for (const s of list) if (!IPV4.test(s) && !(IPV6.test(s) && s.includes(":"))) return "«" + s + "» نشانی IP معتبری برای سرور DNS نیست.";
  if (new Set(list).size !== list.length) return "سرورهای DNS تکراری‌اند.";
  return null;
}

/** "200-399" or "200,204,301-302" → the codes; null when malformed */
export function expandCodes(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{3})(?:-(\d{3}))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a < 100 || b > 599 || b < a) return null;
    for (let c = a; c <= b; c++) out.add(c);
  }
  return out.size ? [...out].sort((x, y) => x - y) : null;
}
export const healthCodesError = (spec: string) => (expandCodes(spec) ? null : "کدهای وضعیت مجاز معتبر نیست؛ مثل 200-399 یا 200,204");

export function buildArgsError(args: Record<string, string>) {
  const keys = Object.keys(args);
  if (keys.length > MAX_BUILD_ARGS) return "حداکثر " + MAX_BUILD_ARGS.toLocaleString("fa-IR") + " آرگومان بیلد.";
  for (const k of keys) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k)) return "نام آرگومان «" + k + "» معتبر نیست (حروف انگلیسی، عدد و _).";
    if (args[k].length > 4096 || /[\r\n]/.test(args[k])) return "مقدار آرگومان " + k + " باید یک خط و کوتاه‌تر از ۴۰۹۶ نویسه باشد.";
  }
  return null;
}
export const dockerfileError = (p: string) => (/^[\w.-]+(\/[\w.-]+)*$/.test(p) && !p.split("/").includes("..") && p.length <= 200 ? null : "مسیر Dockerfile معتبر نیست؛ مثل Dockerfile یا docker/prod.Dockerfile");

/** nginx server-level config: no modules, no reading files outside the app, no other ports */
export function nginxConfError(conf: string) {
  if (new TextEncoder().encode(conf).length > MAX_CONF_BYTES) return "پیکربندی nginx حداکثر ۳۲ کیلوبایت.";
  if (/\b(load_module|lua_\w+|perl_\w+|js_import|ssl_certificate)\b/.test(conf)) return "دستورهای load_module، lua، perl، js و گواهی SSL در پیکربندی nginx مجاز نیست.";
  let depth = 0;
  for (const ch of conf.replace(/#[^\n]*/g, "").replace(/(["'])(?:\\.|(?!\1).)*\1/g, "")) { if (ch === "{") depth++; else if (ch === "}" && --depth < 0) break; }
  return depth === 0 ? null : "آکولادهای پیکربندی nginx باز و بسته نمی‌شوند.";
}
export function phpIniError(ini: string) {
  if (new TextEncoder().encode(ini).length > MAX_CONF_BYTES) return "php.ini حداکثر ۳۲ کیلوبایت.";
  for (const raw of ini.split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith(";") || l.startsWith("#") || /^\[[\w .-]+\]$/.test(l)) continue;
    if (!/^[\w.-]+\s*=\s*.*$/.test(l)) return "خط «" + l.slice(0, 40) + "» در php.ini معتبر نیست (کلید = مقدار).";
    if (/^(extension|zend_extension|extension_dir|auto_prepend_file|auto_append_file)\s*=/.test(l)) return "تنظیم «" + l.split("=")[0].trim() + "» در php.ini مجاز نیست.";
  }
  return null;
}
export const authPathError = (p: string) => (/^\/[\w./~-]{0,199}$/.test(p) && !p.includes("..") ? null : "مسیر باید با / شروع شود؛ مثل /admin");

/* ---------- deploy-failure classification ---------- */
export type FailureKind = "port" | "oom" | "start" | "deps" | "health" | "timeout";
export const FAILURES: Record<FailureKind, { title: string; explain: string; fix: string[] }> = {
  port: {
    title: "ناهماهنگی پورت",
    explain: "اپ روی پورتی غیر از پورت تنظیم‌شده گوش می‌دهد یا فقط به localhost متصل است؛ بررسی سلامت به آن نمی‌رسد.",
    fix: ["اپ را روی 0.0.0.0 و پورت متغیر PORT اجرا کنید (مثلاً app.listen(process.env.PORT)).", "یا در تنظیمات اپ، پورت را همان پورتی بگذارید که در لاگ «listening on» آمده است."],
  },
  oom: {
    title: "کمبود حافظه (OOM)",
    explain: "مصرف حافظه از سقف پلن بیشتر شد و سیستم‌عامل پردازه را متوقف کرد.",
    fix: ["پلن بزرگ‌تری انتخاب کنید یا تعداد workerها/threadها را کم کنید.", "برای Node.js سقف heap را تنظیم کنید: NODE_OPTIONS=--max-old-space-size=<حدود ۷۵٪ حافظه پلن>", "اگر بیلد کمبود حافظه دارد، بخش‌های سنگین را در CI بیلد و ایمیج آماده را مستقر کنید."],
  },
  start: {
    title: "دستور اجرا پیدا نشد",
    explain: "برای اجرای اپ دستوری تعریف نشده است (مثلاً اسکریپت start در package.json وجود ندارد).",
    fix: ["در package.json اسکریپت \"start\" اضافه کنید.", "یا در تنظیمات اپ «دستور اجرا» را بنویسید؛ مثل node server.js یا gunicorn app:app.", "یا در gereh.json کلید \"start\" را تعریف کنید."],
  },
  deps: {
    title: "نصب وابستگی‌ها ناموفق بود",
    explain: "مدیر بسته (npm، pip، composer، go…) نتوانست وابستگی‌ها را نصب کند؛ معمولاً به‌خاطر نسخه‌های ناسازگار یا فایل قفل قدیمی.",
    fix: ["فایل قفل (package-lock.json، composer.lock، go.sum…) را به‌روز و commit کنید.", "برای خطای ERESOLVE در npm: نسخه‌ها را هماهنگ کنید یا در .npmrc بنویسید legacy-peer-deps=true.", "اگر بسته از اینترنت بین‌الملل دریافت نمی‌شود، «آینه بسته‌ها» را در تنظیمات بیلد روشن کنید."],
  },
  health: {
    title: "بررسی سلامت ناموفق",
    explain: "نسخه جدید اجرا شد اما به بررسی سلامت پاسخ موفق نداد؛ نسخه قبلی همچنان فعال ماند.",
    fix: ["مسیر سلامت را بررسی کنید: باید بدون ورود و با کد ۲xx پاسخ دهد.", "اگر اپ دیر بالا می‌آید، «مهلت شروع» بررسی سلامت را بیشتر کنید.", "لاگ‌های اپ را برای خطای زمان اجرا (اتصال پایگاه داده، متغیر محیطی جاافتاده) ببینید."],
  },
  timeout: {
    title: "زمان بیلد تمام شد",
    explain: "بیلد از سقف زمان مجاز پلن طولانی‌تر شد و متوقف شد.",
    fix: ["کش بیلد را روشن نگه دارید تا لایه‌ها دوباره ساخته نشوند.", "مراحل سنگین (تست‌ها، دانلودهای بزرگ) را از بیلد حذف کنید یا در CI انجام دهید.", "پلن بزرگ‌تر سقف زمان بیلد بیشتری دارد."],
  },
};

const RULES: [FailureKind, RegExp][] = [
  ["timeout", /build timed out after|DeadlineExceeded|Job was active longer than specified deadline/i],
  ["oom", /OOMKilled|JavaScript heap out of memory|Cannot allocate memory|Out of memory|exit code 137|signal: killed/i],
  ["start", /Missing script:? "?start"?|No start command could be found|no start command|Nixpacks was unable to generate a build plan|could not determine how to start/i],
  ["deps", /npm ERR!|ERESOLVE|ERR_PNPM_|error An unexpected error occurred: .*yarn|Could not find a version that satisfies|No matching distribution found|Your requirements could not be resolved|missing go\.sum entry|go: .* not found|failed to select a version for|Bundler could not find compatible versions|pip.*subprocess-exited-with-error/i],
  ["port", /connect: connection refused|ECONNREFUSED|port mismatch|no process listening on port/i],
  ["health", /did not become healthy|Readiness probe failed|Startup probe failed|Liveness probe failed|health check failed/i],
];
/** best guess of why a deployment failed, from its log ("" when unknown) */
export function classifyFailure(log: string): FailureKind | "" {
  for (const [k, re] of RULES) if (re.test(log)) return k;
  return "";
}

/* ---------- time keys (Tehran) ---------- */
/** Jalali month of a moment in Tehran: "1405-07" */
export function monthKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value.replace(/\D/g, "") ?? "0";
  const m = parts.find((p) => p.type === "month")?.value.replace(/\D/g, "") ?? "0";
  return y + "-" + m.padStart(2, "0");
}
/** Gregorian day in Tehran: "2026-10-12" */
export const dayKey = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const GB = 1024 ** 3;

/* ---------- CI templates ---------- */
export function ciTemplates(app: { name: string; source: string; gitBranch: string }, siteUrl: string) {
  const branch = app.source === "git" ? app.gitBranch || "main" : "main";
  const api = siteUrl.replace(/\/$/, "") + "/api/v1/apps/" + app.name + "/deployments";
  const github = `# .github/workflows/gereh.yml
name: Deploy to Gereh
on:
  push:
    branches: [${branch}]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # Settings > Secrets and variables > Actions > New secret: GEREH_TOKEN (read-write token from Panel > SSH and API)
      - run: npx -y @gereh/cli deploy --app ${app.name} -m "\${{ github.event.head_commit.message }}"
        env:
          GEREH_TOKEN: \${{ secrets.GEREH_TOKEN }}
`;
  const gitlab = `# .gitlab-ci.yml
deploy:
  stage: deploy
  image: node:22-alpine
  rules:
    - if: $CI_COMMIT_BRANCH == "${branch}"
  # Settings > CI/CD > Variables: GEREH_TOKEN (masked)
  script:
    - npx -y @gereh/cli deploy --app ${app.name} -m "$CI_COMMIT_TITLE"
`;
  const curl = `curl -fsS -X POST ${api} \\
  -H "Authorization: Bearer $GEREH_TOKEN" -H "Content-Type: application/json" \\
  -d '{"message": "CI deploy"}'`;
  return { github, gitlab, curl };
}
