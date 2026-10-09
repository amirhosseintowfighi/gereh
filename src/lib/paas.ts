/* Gereh Apps (PaaS): stacks, database engines and helpers shared by the panel, the public pages
   and the server. Plans and prices live in the database (paas_plans) so staff can change them. */

export type StackId =
  | "node" | "nextjs" | "nuxt" | "react" | "nestjs" | "sveltekit" | "astro" | "remix" | "angular" | "bun" | "deno"
  | "python" | "django" | "fastapi" | "flask"
  | "php" | "laravel" | "wordpress" | "go" | "rust" | "java" | "dotnet" | "ruby" | "static" | "docker" | "compose";

export type Stack = { id: StackId; label: string; group: string; port: number; build?: string; start?: string; hint: string };

export const STACKS: Stack[] = [
  { id: "nextjs", label: "Next.js", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "npm start", hint: "SSR، ISR و App Router" },
  { id: "node", label: "Node.js", group: "جاوااسکریپت", port: 3000, start: "npm start", hint: "Express، NestJS، Fastify و…" },
  { id: "nuxt", label: "Nuxt", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "node .output/server/index.mjs", hint: "Vue با رندر سمت سرور" },
  { id: "nestjs", label: "NestJS", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "node dist/main.js", hint: "API ساخت‌یافته با TypeScript" },
  { id: "sveltekit", label: "SvelteKit", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "node build", hint: "با adapter-node" },
  { id: "astro", label: "Astro", group: "جاوااسکریپت", port: 4321, build: "npm run build", hint: "سایت محتوایی سریع؛ استاتیک یا SSR" },
  { id: "remix", label: "Remix / React Router", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "npm start", hint: "فول‌استک React" },
  { id: "angular", label: "Angular", group: "جاوااسکریپت", port: 80, build: "npm run build", hint: "SPA پشت Nginx" },
  { id: "bun", label: "Bun", group: "جاوااسکریپت", port: 3000, start: "bun run start", hint: "رانتایم سریع جاوااسکریپت" },
  { id: "deno", label: "Deno", group: "جاوااسکریپت", port: 8000, start: "deno task start", hint: "TypeScript بدون تنظیمات" },
  { id: "react", label: "React / Vite", group: "جاوااسکریپت", port: 80, build: "npm run build", hint: "خروجی استاتیک پشت CDN" },
  { id: "django", label: "Django", group: "پایتون", port: 8000, start: "gunicorn config.wsgi", hint: "با collectstatic و migrate خودکار" },
  { id: "fastapi", label: "FastAPI", group: "پایتون", port: 8000, start: "uvicorn main:app --host 0.0.0.0", hint: "ASGI با uvicorn" },
  { id: "flask", label: "Flask", group: "پایتون", port: 8000, start: "gunicorn app:app", hint: "WSGI با gunicorn" },
  { id: "python", label: "Python", group: "پایتون", port: 8000, hint: "هر اپلیکیشن پایتون" },
  { id: "laravel", label: "Laravel", group: "PHP", port: 80, hint: "PHP-FPM و Nginx، queue و scheduler" },
  { id: "php", label: "PHP", group: "PHP", port: 80, hint: "PHP 8 با Nginx" },
  { id: "wordpress", label: "WordPress", group: "PHP", port: 80, hint: "با دیسک دائمی برای uploads" },
  { id: "go", label: "Go", group: "کامپایلی", port: 8080, hint: "باینری سبک و سریع" },
  { id: "rust", label: "Rust", group: "کامپایلی", port: 8080, hint: "Axum، Actix و…؛ cargo build --release" },
  { id: "java", label: "Java / Spring", group: "کامپایلی", port: 8080, hint: "Maven یا Gradle" },
  { id: "dotnet", label: ".NET", group: "کامپایلی", port: 8080, hint: "ASP.NET Core" },
  { id: "ruby", label: "Ruby on Rails", group: "سایر", port: 3000, hint: "با Puma" },
  { id: "static", label: "سایت استاتیک", group: "سایر", port: 80, hint: "HTML، CSS و JS ساده" },
  { id: "docker", label: "Dockerfile", group: "کانتینر", port: 8080, hint: "هر چیزی که Dockerfile دارد" },
  { id: "compose", label: "Docker Compose", group: "کانتینر", port: 8080, hint: "چند سرویس با هم" },
];
export const stackOf = (id: string) => STACKS.find((s) => s.id === id);

export type DbEngine = "postgres" | "mysql" | "mariadb" | "mongodb" | "redis";
export const DB_ENGINES: { id: DbEngine; label: string; versions: string[]; port: number; icon: string; hint: string }[] = [
  { id: "postgres", label: "PostgreSQL", versions: ["17", "16", "15"], port: 5432, icon: "database", hint: "قابل اعتماد و همه‌کاره، با PostGIS و pgvector" },
  { id: "mysql", label: "MySQL", versions: ["8.4", "8.0"], port: 3306, icon: "database", hint: "محبوب‌ترین پایگاه داده وب" },
  { id: "mariadb", label: "MariaDB", versions: ["11.4", "10.11"], port: 3306, icon: "database", hint: "جایگزین سازگار با MySQL" },
  { id: "mongodb", label: "MongoDB", versions: ["7.0", "6.0"], port: 27017, icon: "database", hint: "پایگاه داده سندمحور" },
  { id: "redis", label: "Redis", versions: ["7.4"], port: 6379, icon: "zap", hint: "کش، صف و نشست" },
];
export const engineOf = (id: string) => DB_ENGINES.find((e) => e.id === id);

/** app and database names become DNS labels: <name>.<apps domain> */
export const PAAS_NAME_RE = /^[a-z](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const PAAS_RESERVED = new Set(["www", "api", "admin", "panel", "app", "apps", "mail", "ftp", "ns1", "ns2", "status", "gereh", "dashboard", "console", "registry", "git", "cdn", "static"]);
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** variables the platform sets itself */
export const ENV_RESERVED = new Set(["PORT", "GEREH_APP", "GEREH_DEPLOYMENT", "KUBERNETES_SERVICE_HOST"]);

export const DISK_PRICE_GB = 15_000; // Toman per GB per month (Paasta: 30k)
export const HOURS_PER_MONTH = 720;
/** hourly charge for a monthly price (rounded up to whole Toman, minimum 1) */
export const hourlyOf = (monthly: number) => Math.max(1, Math.ceil(monthly / HOURS_PER_MONTH));

export type PaasPlan = { id: string; kind: "app" | "db"; name: string; cpu: number; ramMb: number; diskGb: number; price: number; active: boolean };
/** monthly cost of an app: plan × instances + persistent disk */
export const appMonthly = (plan: Pick<PaasPlan, "price">, instances: number, diskGb: number) => plan.price * Math.max(1, instances) + diskGb * DISK_PRICE_GB;

/* ---------- stack detection from a file listing (ZIP upload, CLI) ---------- */
type Files = Map<string, string | null>; // path → content (only small manifest files are read)

const has = (f: Files, p: string) => f.has(p);
const json = (f: Files, p: string): Record<string, unknown> | null => { try { return JSON.parse(f.get(p) ?? ""); } catch { return null; } };
const deps = (pkg: Record<string, unknown> | null) => ({ ...(pkg?.dependencies as object), ...(pkg?.devDependencies as object) }) as Record<string, string>;

/** best guess of the stack; paths are relative to the project root */
export function detectStack(files: Files): StackId | null {
  if (has(files, "docker-compose.yml") || has(files, "docker-compose.yaml") || has(files, "compose.yml") || has(files, "compose.yaml")) return "compose";
  if (has(files, "Dockerfile")) return "docker";
  if (has(files, "deno.json") || has(files, "deno.jsonc")) return "deno";
  if (has(files, "package.json")) {
    const d = deps(json(files, "package.json"));
    if (d.next) return "nextjs";
    if (d.nuxt) return "nuxt";
    if (d["@nestjs/core"]) return "nestjs";
    if (d["@sveltejs/kit"]) return "sveltekit";
    if (d.astro) return "astro";
    if (d["@remix-run/node"] || d["@react-router/node"] || d["@react-router/serve"]) return "remix";
    if (d["@angular/core"]) return "angular";
    if (has(files, "bun.lockb") || has(files, "bun.lock")) return "bun";
    if (d.vite || d["react-scripts"]) return d.express || d.fastify ? "node" : "react";
    return "node";
  }
  const py = [files.get("requirements.txt"), files.get("pyproject.toml"), files.get("Pipfile")].filter(Boolean).join("\n").toLowerCase();
  if (py || has(files, "requirements.txt") || has(files, "pyproject.toml")) {
    if (/\bdjango\b/.test(py) || has(files, "manage.py")) return "django";
    if (/\bfastapi\b/.test(py)) return "fastapi";
    if (/\bflask\b/.test(py)) return "flask";
    return "python";
  }
  if (has(files, "composer.json")) {
    const c = json(files, "composer.json");
    return (c?.require as Record<string, string> | undefined)?.["laravel/framework"] ? "laravel" : "php";
  }
  if (has(files, "wp-config.php") || has(files, "wp-config-sample.php")) return "wordpress";
  if (has(files, "go.mod")) return "go";
  if (has(files, "Cargo.toml")) return "rust";
  if (has(files, "pom.xml") || has(files, "build.gradle") || has(files, "build.gradle.kts")) return "java";
  if ([...files.keys()].some((p) => /\.(csproj|fsproj|sln)$/.test(p))) return "dotnet";
  if (has(files, "Gemfile")) return "ruby";
  if (has(files, "index.php")) return "php";
  if (has(files, "index.html")) return "static";
  return null;
}
/** files whose content detectStack() looks at */
export const DETECT_READ = new Set(["package.json", "composer.json", "requirements.txt", "pyproject.toml", "Pipfile"]);

export const APP_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  creating: ["در حال ساخت", "blue"], building: ["در حال بیلد", "blue"], running: ["فعال", "green"], stopped: ["متوقف", "gray"],
  failed: ["خطا", "red"], suspended: ["معلق", "amber"],
};
export const DEPLOY_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  queued: ["در صف", "gray"], building: ["در حال بیلد", "blue"], deploying: ["در حال استقرار", "blue"], live: ["فعال", "green"],
  failed: ["ناموفق", "red"], superseded: ["جایگزین شد", "gray"], cancelled: ["لغو شد", "gray"],
};

/* ---------- background processes & cron ---------- */
export const PROC_NAME_RE = /^[a-z][a-z0-9-]{0,18}[a-z0-9]$/;
export const MAX_PROCESSES = 5;
export const MAX_CRONS = 10;
export const CRON_PRESETS: { value: string; label: string }[] = [
  { value: "*/5 * * * *", label: "هر ۵ دقیقه" }, { value: "*/15 * * * *", label: "هر ۱۵ دقیقه" }, { value: "0 * * * *", label: "هر ساعت" },
  { value: "0 3 * * *", label: "هر شب ساعت ۳" }, { value: "0 9 * * 6", label: "شنبه‌ها ساعت ۹" }, { value: "0 0 1 * *", label: "اول هر ماه" },
];
const CRON_FIELD = /^(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?(,(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?)*$/;
const CRON_MAX = [59, 23, 31, 12, 7];
/** null when valid, else a Persian error. 5 fields (Tehran time), every 5 minutes at most */
export function cronError(expr: string): string | null {
  const e = expr.trim();
  if (["@hourly", "@daily", "@weekly", "@monthly", "@yearly"].includes(e)) return null;
  const f = e.split(/\s+/);
  if (f.length !== 5 || !f.every((x) => CRON_FIELD.test(x))) return "زمان‌بندی باید ۵ بخش cron باشد؛ مثل 0 3 * * * (هر شب ساعت ۳).";
  for (let i = 0; i < 5; i++) for (const n of f[i].match(/\d+/g) ?? []) if (Number(n) > CRON_MAX[i] && !f[i].includes("/" + n)) return "عدد " + n + " در بخش " + (i + 1) + " زمان‌بندی خارج از محدوده است.";
  const step = /^\*\/(\d+)$/.exec(f[0]);
  if (f[0] === "*" || (step && Number(step[1]) < 5)) return "کمترین فاصله اجرا ۵ دقیقه است.";
  return null;
}

/** env variable a linked database is exposed as by default */
export const defaultEnvKeyFor = (engine: string) => (engine === "redis" ? "REDIS_URL" : engine === "mongodb" ? "MONGODB_URI" : "DATABASE_URL");
