/* Gereh Apps (PaaS): stacks, database engines and helpers shared by the panel, the public pages
   and the server. Plans and prices live in the database (paas_plans) so staff can change them. */

export type StackId =
  | "node" | "nextjs" | "nuxt" | "react" | "vue" | "nestjs" | "sveltekit" | "astro" | "remix" | "angular" | "gatsby" | "eleventy" | "bun" | "deno"
  | "python" | "django" | "fastapi" | "flask"
  | "php" | "laravel" | "wordpress" | "go" | "rust" | "java" | "dotnet" | "ruby" | "elixir"
  | "hugo" | "jekyll" | "static" | "docker" | "compose" | "n8n";

/* ---------- language runtimes and their selectable versions ----------
   The chosen version is kept as the build arg GEREH_RUNTIME_VERSION. Versions Nixpacks installs itself
   are passed to it through its own variable; the others (older or newer releases, Hugo, Jekyll) build
   from the official language image with a generated Dockerfile (src/lib/paas-build.ts). */
export type RuntimeId = "node" | "bun" | "deno" | "python" | "php" | "go" | "rust" | "java" | "dotnet" | "ruby" | "elixir" | "hugo";
export type RuntimeInfo = { id: RuntimeId; label: string; versions: string[]; default: string; nixpacks?: { env: string; versions: string[] } };
export const RUNTIMES: Record<RuntimeId, RuntimeInfo> = {
  node: { id: "node", label: "Node.js", versions: ["24", "22", "20", "18", "16", "14", "12", "10", "8"], default: "22", nixpacks: { env: "NIXPACKS_NODE_VERSION", versions: ["22", "20", "18", "16"] } },
  bun: { id: "bun", label: "Bun", versions: ["1.3", "1.2", "1.1"], default: "1.3" },
  deno: { id: "deno", label: "Deno", versions: ["2.9.7", "2.5.6", "1.46.3"], default: "2.9.7" },
  python: { id: "python", label: "Python", versions: ["3.13", "3.12", "3.11", "3.10", "3.9", "3.8", "3.7"], default: "3.12", nixpacks: { env: "NIXPACKS_PYTHON_VERSION", versions: ["3.13", "3.12", "3.11", "3.10", "3.9", "3.8"] } },
  php: { id: "php", label: "PHP", versions: ["8.4", "8.3", "8.2", "8.1", "8.0", "7.4", "7.3", "7.2"], default: "8.3" },
  go: { id: "go", label: "Go", versions: ["1.25", "1.24", "1.23", "1.22", "1.21"], default: "1.24" },
  rust: { id: "rust", label: "Rust", versions: ["1.89.0", "1.85.0", "1.80.0", "1.75.0"], default: "1.89.0", nixpacks: { env: "NIXPACKS_RUST_VERSION", versions: ["1.89.0", "1.85.0", "1.80.0", "1.75.0"] } },
  java: { id: "java", label: "Java (JDK)", versions: ["21", "17", "11", "8"], default: "21", nixpacks: { env: "NIXPACKS_JDK_VERSION", versions: ["21", "17", "11", "8"] } },
  dotnet: { id: "dotnet", label: ".NET", versions: ["10.0", "9.0", "8.0", "7.0", "6.0", "5.0", "3.1", "2.1"], default: "8.0" },
  ruby: { id: "ruby", label: "Ruby", versions: ["3.4", "3.3", "3.2", "3.1", "3.0", "2.7"], default: "3.3" },
  elixir: { id: "elixir", label: "Elixir", versions: ["1.17", "1.16", "1.15", "1.14"], default: "1.17", nixpacks: { env: "NIXPACKS_ELIXIR_VERSION", versions: ["1.17", "1.16", "1.15", "1.14"] } },
  hugo: { id: "hugo", label: "Hugo", versions: ["0.152.2", "0.147.9", "0.139.4", "0.128.2", "0.120.4"], default: "0.152.2" },
};
/** build arg that holds the chosen runtime version */
export const VERSION_ARG = "GEREH_RUNTIME_VERSION";

export type Stack = {
  id: StackId; label: string; group: string; port: number; build?: string; start?: string; hint: string;
  runtime?: RuntimeId;
  /** oldest runtime version the framework supports */
  min?: string;
  /** the build output is static files served by nginx */
  spa?: boolean;
  /** created from this one-click template instead of a build */
  template?: string;
};

export const STACKS: Stack[] = [
  { id: "nextjs", label: "Next.js", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "npm start", hint: "SSR، ISR و App Router", runtime: "node", min: "18" },
  { id: "node", label: "Node.js", group: "جاوااسکریپت", port: 3000, start: "npm start", hint: "Express، NestJS، Fastify و…", runtime: "node" },
  { id: "nuxt", label: "Nuxt", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "node .output/server/index.mjs", hint: "Vue با رندر سمت سرور", runtime: "node", min: "18" },
  { id: "nestjs", label: "NestJS", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "node dist/main.js", hint: "API ساخت‌یافته با TypeScript", runtime: "node", min: "16" },
  { id: "sveltekit", label: "SvelteKit", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "node build", hint: "با adapter-node", runtime: "node", min: "18" },
  { id: "astro", label: "Astro", group: "جاوااسکریپت", port: 4321, build: "npm run build", hint: "سایت محتوایی سریع؛ استاتیک یا SSR", runtime: "node", min: "18" },
  { id: "remix", label: "Remix / React Router", group: "جاوااسکریپت", port: 3000, build: "npm run build", start: "npm start", hint: "فول‌استک React", runtime: "node", min: "18" },
  { id: "angular", label: "Angular", group: "جاوااسکریپت", port: 80, build: "npm run build", hint: "SPA پشت Nginx", runtime: "node", min: "18", spa: true },
  { id: "bun", label: "Bun", group: "جاوااسکریپت", port: 3000, start: "bun run start", hint: "رانتایم سریع جاوااسکریپت", runtime: "bun" },
  { id: "deno", label: "Deno", group: "جاوااسکریپت", port: 8000, start: "deno task start", hint: "TypeScript بدون تنظیمات", runtime: "deno" },
  { id: "react", label: "React / Vite", group: "جاوااسکریپت", port: 80, build: "npm run build", hint: "خروجی استاتیک پشت CDN", runtime: "node", min: "14", spa: true },
  { id: "vue", label: "Vue", group: "جاوااسکریپت", port: 80, build: "npm run build", hint: "SPA با Vite پشت Nginx", runtime: "node", min: "14", spa: true },
  { id: "django", label: "Django", group: "پایتون", port: 8000, start: "gunicorn config.wsgi", hint: "با collectstatic و migrate خودکار", runtime: "python" },
  { id: "fastapi", label: "FastAPI", group: "پایتون", port: 8000, start: "uvicorn main:app --host 0.0.0.0", hint: "ASGI با uvicorn", runtime: "python", min: "3.8" },
  { id: "flask", label: "Flask", group: "پایتون", port: 8000, start: "gunicorn app:app", hint: "WSGI با gunicorn", runtime: "python" },
  { id: "python", label: "Python", group: "پایتون", port: 8000, hint: "هر اپلیکیشن پایتون", runtime: "python" },
  { id: "laravel", label: "Laravel", group: "PHP", port: 80, hint: "PHP-FPM و Nginx، queue و scheduler", runtime: "php" },
  { id: "php", label: "PHP", group: "PHP", port: 80, hint: "PHP 7.2 تا 8.4", runtime: "php" },
  { id: "wordpress", label: "WordPress", group: "PHP", port: 80, hint: "با دیسک دائمی برای uploads", runtime: "php", min: "7.4" },
  { id: "go", label: "Go", group: "کامپایلی", port: 8080, hint: "باینری سبک و سریع", runtime: "go" },
  { id: "rust", label: "Rust", group: "کامپایلی", port: 8080, hint: "Axum، Actix و…؛ cargo build --release", runtime: "rust" },
  { id: "java", label: "Java / Spring", group: "کامپایلی", port: 8080, hint: "Maven یا Gradle", runtime: "java" },
  { id: "dotnet", label: ".NET", group: "کامپایلی", port: 8080, hint: "ASP.NET Core از 2.1 تا 10", runtime: "dotnet" },
  { id: "ruby", label: "Ruby on Rails", group: "سایر", port: 3000, hint: "با Puma", runtime: "ruby" },
  { id: "elixir", label: "Elixir / Phoenix", group: "سایر", port: 4000, hint: "Phoenix و برنامه‌های mix", runtime: "elixir" },
  { id: "static", label: "سایت استاتیک", group: "سایت استاتیک", port: 80, hint: "HTML، CSS و JS ساده" },
  { id: "hugo", label: "Hugo", group: "سایت استاتیک", port: 80, hint: "سایت‌ساز Go (نسخه extended)", runtime: "hugo", spa: true },
  { id: "jekyll", label: "Jekyll", group: "سایت استاتیک", port: 80, hint: "سایت‌ساز Ruby، سازگار با GitHub Pages", runtime: "ruby", min: "2.7", spa: true },
  { id: "gatsby", label: "Gatsby", group: "سایت استاتیک", port: 80, build: "npm run build", hint: "سایت استاتیک با React", runtime: "node", min: "18", spa: true },
  { id: "eleventy", label: "Eleventy (11ty)", group: "سایت استاتیک", port: 80, build: "npm run build", hint: "سایت‌ساز ساده و سریع", runtime: "node", min: "14", spa: true },
  { id: "docker", label: "Dockerfile", group: "کانتینر", port: 8080, hint: "هر چیزی که Dockerfile دارد" },
  { id: "compose", label: "Docker Compose", group: "کانتینر", port: 8080, hint: "چند سرویس با هم" },
  { id: "n8n", label: "n8n", group: "کانتینر", port: 5678, hint: "اتوماسیون؛ ایمیج رسمی با نسخه دلخواه", template: "n8n" },
];
export const stackOf = (id: string) => STACKS.find((s) => s.id === id);
const vnum = (v: string) => v.split(".").reduce((a, n, i) => a + Number(n) / 1000 ** i, 0);
/** runtime versions offered for a stack, newest first (empty when the stack has none to pick) */
export function stackVersions(id: string): string[] {
  const s = stackOf(id), r = s?.runtime && RUNTIMES[s.runtime];
  if (!s || !r) return [];
  return s.min ? r.versions.filter((v) => vnum(v) >= vnum(s.min!)) : r.versions;
}
export function stackDefaultVersion(id: string) {
  const s = stackOf(id), list = stackVersions(id), d = s?.runtime ? RUNTIMES[s.runtime].default : undefined;
  return d && list.includes(d) ? d : list[0];
}

export type DbEngine =
  | "postgres" | "mysql" | "mariadb" | "mongodb" | "redis" | "mssql" | "elasticsearch" | "rabbitmq" | "clickhouse"
  | "cassandra" | "couchdb" | "influxdb" | "neo4j" | "arangodb" | "rethinkdb" | "prometheus";
export type DbEngineInfo = {
  id: DbEngine; label: string; versions: string[]; port: number; icon: string; hint: string; group: string;
  /** env variable a linked app gets by default */
  envKey: string;
  /** nightly/manual dumps, restore, download and import */
  backups: boolean;
  /** smallest plan (MB of RAM) the engine runs on */
  minRamMb?: number;
  /** false: no authentication of its own, so only the customer's apps reach it */
  publicOk?: boolean;
  /** fixed admin user (the engine does not let us choose one); "" = no user */
  user?: string;
};
export const DB_ENGINES: DbEngineInfo[] = [
  { id: "postgres", label: "PostgreSQL", versions: ["18", "17", "16", "15", "14", "13", "12", "11"], port: 5432, icon: "database", group: "رابطه‌ای", envKey: "DATABASE_URL", backups: true, hint: "قابل اعتماد و همه‌کاره، با PostGIS و pgvector" },
  { id: "mysql", label: "MySQL", versions: ["9.0", "8.4", "8.0", "5.7"], port: 3306, icon: "database", group: "رابطه‌ای", envKey: "DATABASE_URL", backups: true, hint: "محبوب‌ترین پایگاه داده وب" },
  { id: "mariadb", label: "MariaDB", versions: ["11.4", "10.11", "10.6"], port: 3306, icon: "database", group: "رابطه‌ای", envKey: "DATABASE_URL", backups: true, hint: "جایگزین سازگار با MySQL" },
  { id: "mssql", label: "SQL Server", versions: ["2022", "2019"], port: 1433, icon: "database", group: "رابطه‌ای", envKey: "DATABASE_URL", backups: true, minRamMb: 2048, user: "sa", hint: "Microsoft SQL Server (ویرایش Express)" },
  { id: "mongodb", label: "MongoDB", versions: ["8.0", "7.0", "6.0"], port: 27017, icon: "database", group: "سندمحور", envKey: "MONGODB_URI", backups: true, hint: "پایگاه داده سندمحور" },
  { id: "couchdb", label: "CouchDB", versions: ["3.4", "3.3"], port: 5984, icon: "database", group: "سندمحور", envKey: "COUCHDB_URL", backups: false, hint: "سندمحور با API ‏HTTP و همگام‌سازی" },
  { id: "arangodb", label: "ArangoDB", versions: ["3.12", "3.11"], port: 8529, icon: "database", group: "سندمحور", envKey: "ARANGODB_URL", backups: false, user: "root", hint: "چندمدلی: سند، گراف و کلید-مقدار" },
  { id: "rethinkdb", label: "RethinkDB", versions: ["2.4"], port: 28015, icon: "database", group: "سندمحور", envKey: "RETHINKDB_URL", backups: false, user: "admin", hint: "سندمحور بلادرنگ با changefeed" },
  { id: "redis", label: "Redis", versions: ["7.4", "7.2"], port: 6379, icon: "zap", group: "کلید-مقدار و صف", envKey: "REDIS_URL", backups: true, user: "default", hint: "کش، صف و نشست" },
  { id: "rabbitmq", label: "RabbitMQ", versions: ["4.0", "3.13"], port: 5672, icon: "send", group: "کلید-مقدار و صف", envKey: "AMQP_URL", backups: false, hint: "صف پیام AMQP با پنل مدیریت" },
  { id: "elasticsearch", label: "Elasticsearch", versions: ["8.15", "7.17"], port: 9200, icon: "search", group: "جست‌وجو و تحلیل", envKey: "ELASTICSEARCH_URL", backups: false, minRamMb: 2048, user: "elastic", hint: "جست‌وجوی متن کامل و لاگ" },
  { id: "clickhouse", label: "ClickHouse", versions: ["24.8", "24.3"], port: 8123, icon: "chart-column", group: "جست‌وجو و تحلیل", envKey: "CLICKHOUSE_URL", backups: false, minRamMb: 1024, hint: "تحلیل ستونی بسیار سریع" },
  { id: "cassandra", label: "Cassandra", versions: ["5.0", "4.1"], port: 9042, icon: "layers", group: "جست‌وجو و تحلیل", envKey: "CASSANDRA_URL", backups: false, minRamMb: 2048, hint: "ستون‌گسترده با نوشتن بسیار سریع" },
  { id: "influxdb", label: "InfluxDB", versions: ["2.7"], port: 8086, icon: "trending-up", group: "سری زمانی و گراف", envKey: "INFLUXDB_URL", backups: false, hint: "داده‌های سری زمانی و IoT" },
  { id: "prometheus", label: "Prometheus", versions: ["3.0", "2.54"], port: 9090, icon: "gauge", group: "سری زمانی و گراف", envKey: "PROMETHEUS_URL", backups: false, publicOk: false, user: "", hint: "متریک با remote write؛ فقط از داخل" },
  { id: "neo4j", label: "Neo4j", versions: ["5.24", "4.4"], port: 7687, icon: "share-2", group: "سری زمانی و گراف", envKey: "NEO4J_URI", backups: false, minRamMb: 1024, user: "neo4j", hint: "پایگاه داده گراف (Cypher)" },
];
export const engineOf = (id: string) => DB_ENGINES.find((e) => e.id === id);

/** app and database names become DNS labels: <name>.<apps domain> */
export const PAAS_NAME_RE = /^[a-z](?:[a-z0-9-]{1,28}[a-z0-9])$/;
/** public image reference: registry/repo[:tag][@sha256:…] */
export const IMAGE_RE = /^[a-z0-9]+([._/-][a-z0-9]+)*(:[\w.-]{1,128})?(@sha256:[a-f0-9]{64})?$/;
export const GIT_URL_RE = /^(https:\/\/[\w.-]+(:\d+)?\/[\w./~-]+?(\.git)?|git@[\w.-]+:[\w./~-]+?(\.git)?)$/;
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
    if (d.gatsby) return "gatsby";
    if (d["@11ty/eleventy"]) return "eleventy";
    if (has(files, "bun.lockb") || has(files, "bun.lock")) return "bun";
    if (d.express || d.fastify || d.koa || d.hono) return "node";
    if (d.vue && (d.vite || d["@vue/cli-service"])) return "vue";
    if (d.vite || d["react-scripts"]) return "react";
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
  if (has(files, "mix.exs")) return "elixir";
  if (has(files, "Gemfile")) return /\bjekyll\b/i.test(files.get("Gemfile") ?? "") || has(files, "_config.yml") ? "jekyll" : "ruby";
  if (has(files, "hugo.toml") || has(files, "hugo.yaml") || has(files, "hugo.json")
    || ((has(files, "config.toml") || has(files, "config.yaml")) && [...files.keys()].some((p) => /^(content|layouts|archetypes)\//.test(p)))) return "hugo";
  if (has(files, "index.php")) return "php";
  if (has(files, "index.html")) return "static";
  return null;
}
/** files whose content detectStack() looks at */
export const DETECT_READ = new Set(["package.json", "composer.json", "requirements.txt", "pyproject.toml", "Pipfile", "Gemfile"]);

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
export const defaultEnvKeyFor = (engine: string) => engineOf(engine)?.envKey ?? "DATABASE_URL";
