/* Gereh Apps one-click templates: popular open-source apps from their official images, with the disk,
   database and generated secrets they need. Env values may use placeholders:
   ${secret} a random 32-character string (each occurrence new), ${url} the app's https URL,
   ${email} the customer's email. */

export type PaasTemplate = {
  id: string; name: string; category: string; icon: string; desc: string; image: string; port: number;
  planId: string; diskGb: number; diskMount: string; health?: string;
  env: Record<string, string>;
  /** a managed database created and linked under this env key */
  db?: { engine: "postgres" | "mysql" | "redis"; version: string; envKey: string; planId: string };
  /** env keys shown to the customer once after creation (generated passwords) */
  show?: { key: string; label: string }[];
  /** what to do after the app is live */
  next: string;
  docs: string;
};

export const TEMPLATE_CATEGORIES = ["اتوماسیون", "تحلیل و داده", "توسعه", "مدیریت محتوا", "امنیت", "ابزار"];

export const PAAS_TEMPLATES: PaasTemplate[] = [
  { id: "n8n", name: "n8n", category: "اتوماسیون", icon: "workflow", desc: "اتوماسیون گردش کار با ۴۰۰+ اتصال؛ جایگزین Zapier", image: "docker.n8n.io/n8nio/n8n:1.72.1", port: 5678, planId: "app-small", diskGb: 5, diskMount: "/home/node/.n8n", health: "/healthz",
    env: { WEBHOOK_URL: "${url}/", N8N_PROXY_HOPS: "1", N8N_ENCRYPTION_KEY: "${secret}", GENERIC_TIMEZONE: "Asia/Tehran", TZ: "Asia/Tehran" }, next: "آدرس اپ را باز کنید و حساب مالک را بسازید.", docs: "https://docs.n8n.io" },
  { id: "uptime-kuma", name: "Uptime Kuma", category: "ابزار", icon: "activity", desc: "پایش در دسترس بودن سایت‌ها و سرویس‌ها با هشدار تلگرام", image: "louislam/uptime-kuma:1.23.16", port: 3001, planId: "app-micro", diskGb: 1, diskMount: "/app/data",
    env: {}, next: "آدرس اپ را باز کنید و کاربر مدیر را بسازید.", docs: "https://github.com/louislam/uptime-kuma/wiki" },
  { id: "metabase", name: "Metabase", category: "تحلیل و داده", icon: "chart-column", desc: "داشبورد و گزارش‌گیری از پایگاه داده بدون کدنویسی", image: "metabase/metabase:v0.51.9", port: 3000, planId: "app-medium", diskGb: 0, diskMount: "/data", health: "/api/health",
    env: { MB_SITE_URL: "${url}", JAVA_TIMEZONE: "Asia/Tehran" }, db: { engine: "postgres", version: "16", envKey: "MB_DB_CONNECTION_URI", planId: "db-micro" }, next: "آدرس اپ را باز کنید، حساب مدیر بسازید و پایگاه داده خود را اضافه کنید.", docs: "https://www.metabase.com/docs" },
  { id: "umami", name: "Umami", category: "تحلیل و داده", icon: "chart-column", desc: "آمار بازدید سایت ساده و حافظ حریم خصوصی؛ جایگزین Google Analytics", image: "ghcr.io/umami-software/umami:postgresql-v2.14.0", port: 3000, planId: "app-micro", diskGb: 0, diskMount: "/data", health: "/api/heartbeat",
    env: { APP_SECRET: "${secret}" }, db: { engine: "postgres", version: "16", envKey: "DATABASE_URL", planId: "db-micro" }, next: "با admin / umami وارد شوید و فوراً رمز را عوض کنید.", docs: "https://umami.is/docs" },
  { id: "grafana", name: "Grafana", category: "تحلیل و داده", icon: "gauge", desc: "نمودار و هشدار برای Prometheus، Loki، پایگاه داده‌ها و…", image: "grafana/grafana-oss:11.4.0", port: 3000, planId: "app-micro", diskGb: 2, diskMount: "/var/lib/grafana", health: "/api/health",
    env: { GF_SERVER_ROOT_URL: "${url}", GF_SECURITY_ADMIN_USER: "admin", GF_SECURITY_ADMIN_PASSWORD: "${secret}", GF_USERS_ALLOW_SIGN_UP: "false" }, show: [{ key: "GF_SECURITY_ADMIN_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://grafana.com/docs" },
  { id: "gitea", name: "Gitea", category: "توسعه", icon: "git-branch", desc: "مخزن گیت خصوصی سبک با Issue، Pull Request و CI", image: "gitea/gitea:1.22.6", port: 3000, planId: "app-micro", diskGb: 10, diskMount: "/data", health: "/api/healthz",
    env: { GITEA__server__ROOT_URL: "${url}/", GITEA__security__SECRET_KEY: "${secret}", GITEA__security__INSTALL_LOCK: "false" }, next: "صفحه نصب را باز کنید (SQLite پیش‌فرض کافی است) و حساب مدیر بسازید.", docs: "https://docs.gitea.com" },
  { id: "code-server", name: "VS Code (code-server)", category: "توسعه", icon: "code-xml", desc: "VS Code کامل در مرورگر، روی سرور ایرانی", image: "codercom/code-server:4.96.2", port: 8080, planId: "app-small", diskGb: 10, diskMount: "/home/coder",
    env: { PASSWORD: "${secret}" }, show: [{ key: "PASSWORD", label: "رمز ورود" }], next: "با رمز نمایش‌داده‌شده وارد شوید.", docs: "https://coder.com/docs/code-server" },
  { id: "meilisearch", name: "Meilisearch", category: "توسعه", icon: "search", desc: "موتور جست‌وجوی سریع با پشتیبانی فارسی برای سایت و اپ", image: "getmeili/meilisearch:v1.11.3", port: 7700, planId: "app-micro", diskGb: 5, diskMount: "/meili_data", health: "/health",
    env: { MEILI_MASTER_KEY: "${secret}", MEILI_ENV: "production" }, show: [{ key: "MEILI_MASTER_KEY", label: "Master key" }], next: "با Master key از SDK یا API به آن وصل شوید.", docs: "https://www.meilisearch.com/docs" },
  { id: "adminer", name: "Adminer", category: "توسعه", icon: "database", desc: "مدیریت تحت وب PostgreSQL و MySQL در یک فایل", image: "adminer:4.8.1", port: 8080, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس پایگاه داده (بخش اتصال پنل) را وارد کنید.", docs: "https://www.adminer.org" },
  { id: "directus", name: "Directus", category: "مدیریت محتوا", icon: "layers", desc: "Headless CMS و API آماده روی پایگاه داده", image: "directus/directus:11.3.5", port: 8055, planId: "app-small", diskGb: 5, diskMount: "/directus/uploads", health: "/server/health",
    env: { PUBLIC_URL: "${url}", KEY: "${secret}", SECRET: "${secret}", DB_CLIENT: "pg", ADMIN_EMAIL: "${email}", ADMIN_PASSWORD: "${secret}" }, db: { engine: "postgres", version: "16", envKey: "DB_CONNECTION_STRING", planId: "db-micro" },
    show: [{ key: "ADMIN_PASSWORD", label: "رمز مدیر (ایمیل حساب شما)" }], next: "با ایمیل حساب گره و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://docs.directus.io" },
  { id: "ghost", name: "Ghost", category: "مدیریت محتوا", icon: "newspaper", desc: "پلتفرم وبلاگ و خبرنامه حرفه‌ای", image: "ghost:5.105-alpine", port: 2368, planId: "app-small", diskGb: 5, diskMount: "/var/lib/ghost/content",
    env: { url: "${url}", database__client: "sqlite3", database__connection__filename: "/var/lib/ghost/content/data/ghost.db", NODE_ENV: "production" }, next: "به ‎/ghost‎ بروید و حساب مدیر را بسازید.", docs: "https://ghost.org/docs" },
  { id: "nocodb", name: "NocoDB", category: "ابزار", icon: "table", desc: "صفحه‌گسترده و پایگاه داده بدون کد؛ جایگزین Airtable", image: "nocodb/nocodb:0.258.10", port: 8080, planId: "app-micro", diskGb: 5, diskMount: "/usr/app/data",
    env: { NC_PUBLIC_URL: "${url}", NC_AUTH_JWT_SECRET: "${secret}" }, next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.nocodb.com" },
  { id: "vaultwarden", name: "Vaultwarden", category: "امنیت", icon: "lock", desc: "مدیر رمز عبور سازگار با اپ‌های Bitwarden", image: "vaultwarden/server:1.32.7", port: 80, planId: "app-nano", diskGb: 1, diskMount: "/data", health: "/alive",
    env: { DOMAIN: "${url}", ADMIN_TOKEN: "${secret}", SIGNUPS_ALLOWED: "true" }, show: [{ key: "ADMIN_TOKEN", label: "توکن صفحه ‎/admin‎" }], next: "حساب بسازید و پس از ساخت حساب‌ها، SIGNUPS_ALLOWED را false کنید.", docs: "https://github.com/dani-garcia/vaultwarden/wiki" },
  { id: "excalidraw", name: "Excalidraw", category: "ابزار", icon: "pencil", desc: "تخته سفید و دیاگرام دست‌نویس", image: "excalidraw/excalidraw:latest", port: 80, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://github.com/excalidraw/excalidraw" },
  { id: "it-tools", name: "IT Tools", category: "ابزار", icon: "terminal", desc: "۸۰+ ابزار کاربردی برنامه‌نویس (JWT، Base64، UUID…)", image: "corentinth/it-tools:2024.10.22-7ca5933", port: 80, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://github.com/CorentinTh/it-tools" },
];
export const templateOf = (id: string) => PAAS_TEMPLATES.find((t) => t.id === id);
