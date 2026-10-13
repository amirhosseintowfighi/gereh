/* Gereh Apps one-click templates: popular open-source apps from their official images, with the disk,
   database and generated secrets they need. Env values may use placeholders:
   ${secret} a random 32-character string (each occurrence new), ${hex} 64 random hex digits,
   ${hex32} 32 random hex digits, ${url} the app's https URL, ${host} its host name,
   ${email} the customer's email.
   A database link's envKey is a variable name (the connection URL), "@parts:PREFIX_" or
   "@map:KEY=field,…" (see dbMap) for images that take host, port, user… separately. */

export type TemplateDbEngine = "postgres" | "mysql" | "mariadb" | "mongodb" | "redis";
export type PaasTemplate = {
  id: string; name: string; category: string; icon: string; desc: string;
  /** default image with its tag */
  image: string;
  /** selectable tags of the same image, newest first; the default image's tag is one of them */
  versions?: string[];
  port: number;
  planId: string; diskGb: number; diskMount: string; health?: string;
  /** replaces the image's entrypoint (run with /bin/sh -c) */
  start?: string;
  env: Record<string, string>;
  /** a managed database created and linked under this env key */
  db?: { engine: TemplateDbEngine; version: string; envKey: string; planId: string };
  /** the app has no login of its own: put it behind the platform's password (shown once) */
  auth?: boolean;
  /** env keys shown to the customer once after creation (generated passwords) */
  show?: { key: string; label: string }[];
  /** what to do after the app is live */
  next: string;
  docs: string;
};

export const TEMPLATE_CATEGORIES = ["اتوماسیون", "هوش مصنوعی", "تحلیل و داده", "توسعه", "پایگاه داده و جست‌وجو", "مدیریت محتوا", "کسب‌وکار و فروشگاه", "همکاری و ارتباط", "امنیت", "ابزار"];

/** fields a "@map:" link can expose */
export const DB_FIELDS = ["host", "port", "hostport", "user", "password", "name", "url", "jdbc"] as const;
export type DbField = (typeof DB_FIELDS)[number];
/** "@map:" link key: env name → database field ("url?sslmode=disable" appends a query) */
export const dbMap = (m: Record<string, string>) => "@map:" + Object.entries(m).map(([k, f]) => k + "=" + f).join(",");
/** parses an "@map:" link key; null when it is not one or is malformed */
export function parseDbMap(key: string): { env: string; field: DbField; query: string }[] | null {
  if (!key.startsWith("@map:")) return null;
  const out = [];
  for (const pair of key.slice(5).split(",")) {
    const i = pair.indexOf("=");
    if (i < 1) return null;
    const env = pair.slice(0, i), spec = pair.slice(i + 1);
    const q = spec.indexOf("?"), field = q < 0 ? spec : spec.slice(0, q), query = q < 0 ? "" : spec.slice(q + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env) || !(DB_FIELDS as readonly string[]).includes(field)) return null;
    if (query && field !== "url") return null;
    out.push({ env, field: field as DbField, query });
  }
  return out.length ? out : null;
}

const PG = (envKey = "DATABASE_URL"): PaasTemplate["db"] => ({ engine: "postgres", version: "16", envKey, planId: "db-micro" });
const MY = (envKey: string): PaasTemplate["db"] => ({ engine: "mysql", version: "8.0", envKey, planId: "db-micro" });
const TZ = { TZ: "Asia/Tehran" };

export const PAAS_TEMPLATES: PaasTemplate[] = [
  /* ---------- automation ---------- */
  { id: "n8n", name: "n8n", category: "اتوماسیون", icon: "workflow", desc: "اتوماسیون گردش کار با ۴۰۰+ اتصال؛ جایگزین Zapier", image: "n8nio/n8n:2.44.0", versions: ["2.44.0", "1.123.84"], port: 5678, planId: "app-small", diskGb: 5, diskMount: "/home/node/.n8n", health: "/healthz",
    env: { WEBHOOK_URL: "${url}/", N8N_PROXY_HOPS: "1", N8N_ENCRYPTION_KEY: "${secret}", GENERIC_TIMEZONE: "Asia/Tehran", ...TZ }, next: "آدرس اپ را باز کنید و حساب مالک را بسازید.", docs: "https://docs.n8n.io" },
  { id: "changedetection", name: "changedetection.io", category: "اتوماسیون", icon: "eye", desc: "پایش تغییر صفحه‌های وب و قیمت‌ها با هشدار", image: "dgtlmoon/changedetection.io:0.60.9", port: 5000, planId: "app-micro", diskGb: 1, diskMount: "/datastore",
    env: { BASE_URL: "${url}" }, auth: true, next: "با نام کاربری admin و رمز نمایش‌داده‌شده وارد شوید و صفحه‌ها را اضافه کنید.", docs: "https://github.com/dgtlmoon/changedetection.io/wiki" },
  { id: "node-red", name: "Node-RED", category: "اتوماسیون", icon: "workflow", desc: "برنامه‌نویسی جریانی برای IoT، API و اتوماسیون", image: "nodered/node-red:4.1", versions: ["5.0", "4.1", "3.1"], port: 1880, planId: "app-micro", diskGb: 2, diskMount: "/data",
    env: { ...TZ }, auth: true, next: "با نام کاربری admin و رمز نمایش‌داده‌شده وارد ویرایشگر شوید.", docs: "https://nodered.org/docs" },
  { id: "ntfy", name: "ntfy", category: "اتوماسیون", icon: "bell", desc: "ارسال اعلان به موبایل و دسکتاپ با یک درخواست HTTP", image: "binwiederhier/ntfy:v2.30.0", port: 80, planId: "app-nano", diskGb: 1, diskMount: "/var/cache/ntfy", health: "/v1/health", start: "ntfy serve",
    env: { NTFY_BASE_URL: "${url}", NTFY_BEHIND_PROXY: "true", NTFY_CACHE_FILE: "/var/cache/ntfy/cache.db", NTFY_ATTACHMENT_CACHE_DIR: "/var/cache/ntfy/attachments" }, next: "با curl -d \"سلام\" آدرس‌اپ/موضوع پیام بفرستید و در اپ ntfy مشترک شوید.", docs: "https://docs.ntfy.sh" },

  /* ---------- AI ---------- */
  { id: "open-webui", name: "Open WebUI", category: "هوش مصنوعی", icon: "bot", desc: "رابط گفت‌وگوی تحت وب برای مدل‌های زبانی با API سازگار OpenAI", image: "ghcr.io/open-webui/open-webui:v0.12.0", versions: ["v0.12.0", "v0.11.4"], port: 8080, planId: "app-small", diskGb: 5, diskMount: "/app/backend/data", health: "/health",
    env: { WEBUI_SECRET_KEY: "${secret}", WEBUI_URL: "${url}" }, next: "اولین حسابی که می‌سازید مدیر است؛ سپس در تنظیمات، آدرس و کلید API مدل را وارد کنید.", docs: "https://docs.openwebui.com" },
  { id: "flowise", name: "Flowise", category: "هوش مصنوعی", icon: "bot", desc: "ساخت ایجنت و چت‌بات با کشیدن و رها کردن", image: "flowiseai/flowise:3.1.4", port: 3000, planId: "app-small", diskGb: 5, diskMount: "/root/.flowise",
    env: { DATABASE_PATH: "/root/.flowise", SECRETKEY_PATH: "/root/.flowise", BLOB_STORAGE_PATH: "/root/.flowise/storage" }, next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.flowiseai.com" },
  { id: "langflow", name: "Langflow", category: "هوش مصنوعی", icon: "bot", desc: "طراحی بصری ایجنت‌ها و RAG با پایتون", image: "langflowai/langflow:1.12.6", port: 7860, planId: "app-medium", diskGb: 5, diskMount: "/app/langflow",
    env: { LANGFLOW_CONFIG_DIR: "/app/langflow", LANGFLOW_DATABASE_URL: "sqlite:////app/langflow/langflow.db", LANGFLOW_AUTO_LOGIN: "false", LANGFLOW_SUPERUSER: "admin", LANGFLOW_SUPERUSER_PASSWORD: "${secret}", LANGFLOW_SECRET_KEY: "${secret}" },
    show: [{ key: "LANGFLOW_SUPERUSER_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://docs.langflow.org" },
  { id: "anythingllm", name: "AnythingLLM", category: "هوش مصنوعی", icon: "bot", desc: "گفت‌وگو با اسناد خودتان (RAG) با هر مدل زبانی", image: "mintplexlabs/anythingllm:1.18.0", port: 3001, planId: "app-small", diskGb: 5, diskMount: "/app/server/storage",
    env: { STORAGE_DIR: "/app/server/storage", JWT_SECRET: "${secret}" }, next: "آدرس اپ را باز کنید، مدل و رمز ورود را تنظیم کنید.", docs: "https://docs.anythingllm.com" },
  { id: "lobe-chat", name: "Lobe Chat", category: "هوش مصنوعی", icon: "message-circle", desc: "رابط گفت‌وگوی زیبا با پشتیبانی از چند مدل و افزونه", image: "lobehub/lobe-chat:1.143.3", port: 3210, planId: "app-micro", diskGb: 0, diskMount: "/data",
    env: { ACCESS_CODE: "${secret}" }, show: [{ key: "ACCESS_CODE", label: "رمز دسترسی" }], next: "با رمز دسترسی وارد شوید و کلید API مدل را در تنظیمات بگذارید.", docs: "https://lobehub.com/docs" },
  { id: "libretranslate", name: "LibreTranslate", category: "هوش مصنوعی", icon: "languages", desc: "API ترجمه ماشینی آفلاین، با پشتیبانی فارسی", image: "libretranslate/libretranslate:v1.9.6", port: 5000, planId: "app-medium", diskGb: 10, diskMount: "/home/libretranslate/.local",
    env: { LT_LOAD_ONLY: "en,fa,ar,tr", LT_API_KEYS: "false" }, next: "بار اول مدل‌های زبان دانلود می‌شوند (چند دقیقه)؛ سپس از ‎/translate‎ استفاده کنید.", docs: "https://docs.libretranslate.com" },

  /* ---------- analytics & data ---------- */
  { id: "metabase", name: "Metabase", category: "تحلیل و داده", icon: "chart-column", desc: "داشبورد و گزارش‌گیری از پایگاه داده بدون کدنویسی", image: "metabase/metabase:v0.64.2", versions: ["v0.64.2", "v0.58.36"], port: 3000, planId: "app-medium", diskGb: 0, diskMount: "/data", health: "/api/health",
    env: { MB_SITE_URL: "${url}", JAVA_TIMEZONE: "Asia/Tehran" }, db: PG("MB_DB_CONNECTION_URI"), next: "آدرس اپ را باز کنید، حساب مدیر بسازید و پایگاه داده خود را اضافه کنید.", docs: "https://www.metabase.com/docs" },
  { id: "umami", name: "Umami", category: "تحلیل و داده", icon: "chart-column", desc: "آمار بازدید سایت ساده و حافظ حریم خصوصی؛ جایگزین Google Analytics", image: "ghcr.io/umami-software/umami:postgresql-v2.20.2", versions: ["postgresql-v2.20.2", "postgresql-v2.14.0"], port: 3000, planId: "app-micro", diskGb: 0, diskMount: "/data", health: "/api/heartbeat",
    env: { APP_SECRET: "${secret}" }, db: PG(), next: "با admin / umami وارد شوید و فوراً رمز را عوض کنید.", docs: "https://umami.is/docs" },
  { id: "matomo", name: "Matomo", category: "تحلیل و داده", icon: "chart-line", desc: "آمار وب کامل و متن‌باز با مالکیت کامل داده", image: "matomo:5-apache", versions: ["5-apache", "4-apache"], port: 80, planId: "app-small", diskGb: 5, diskMount: "/var/www/html",
    env: { MATOMO_DATABASE_ADAPTER: "mysql", MATOMO_DATABASE_TABLES_PREFIX: "matomo_" },
    db: MY(dbMap({ MATOMO_DATABASE_HOST: "host", MATOMO_DATABASE_USERNAME: "user", MATOMO_DATABASE_PASSWORD: "password", MATOMO_DATABASE_DBNAME: "name" })), next: "آدرس اپ را باز کنید؛ اطلاعات پایگاه داده از پیش پر شده است. مراحل نصب را تمام کنید.", docs: "https://matomo.org/docs" },
  { id: "grafana", name: "Grafana", category: "تحلیل و داده", icon: "gauge", desc: "نمودار و هشدار برای Prometheus، Loki، پایگاه داده‌ها و…", image: "grafana/grafana-oss:11.4.0", versions: ["13.0.2", "12.4.3", "11.4.0"], port: 3000, planId: "app-micro", diskGb: 2, diskMount: "/var/lib/grafana", health: "/api/health",
    env: { GF_SERVER_ROOT_URL: "${url}", GF_SECURITY_ADMIN_USER: "admin", GF_SECURITY_ADMIN_PASSWORD: "${secret}", GF_USERS_ALLOW_SIGN_UP: "false" }, show: [{ key: "GF_SECURITY_ADMIN_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://grafana.com/docs" },
  { id: "jupyter", name: "Jupyter Notebook", category: "تحلیل و داده", icon: "code-xml", desc: "نوت‌بوک پایتون برای تحلیل داده و آموزش", image: "jupyter/minimal-notebook:python-3.11", port: 8888, planId: "app-small", diskGb: 10, diskMount: "/home/jovyan/work",
    env: { JUPYTER_TOKEN: "${secret}" }, show: [{ key: "JUPYTER_TOKEN", label: "توکن ورود" }], next: "با توکن نمایش‌داده‌شده وارد شوید؛ فایل‌ها را در پوشه work ذخیره کنید.", docs: "https://jupyter-docker-stacks.readthedocs.io" },
  { id: "grist", name: "Grist", category: "تحلیل و داده", icon: "table", desc: "صفحه‌گسترده رابطه‌ای با فرمول پایتون", image: "gristlabs/grist:1.7.21", port: 8484, planId: "app-small", diskGb: 5, diskMount: "/persist",
    env: { GRIST_SESSION_SECRET: "${secret}", APP_HOME_URL: "${url}", GRIST_DEFAULT_EMAIL: "${email}" }, next: "با ایمیل حساب گره وارد شوید.", docs: "https://support.getgrist.com/self-managed" },

  /* ---------- development ---------- */
  { id: "gitea", name: "Gitea", category: "توسعه", icon: "git-branch", desc: "مخزن گیت خصوصی سبک با Issue، Pull Request و CI", image: "gitea/gitea:1.22.6", versions: ["1.27.3", "1.26.4", "1.22.6"], port: 3000, planId: "app-micro", diskGb: 10, diskMount: "/data", health: "/api/healthz",
    env: { GITEA__server__ROOT_URL: "${url}/", GITEA__security__SECRET_KEY: "${secret}", GITEA__security__INSTALL_LOCK: "false" }, next: "صفحه نصب را باز کنید (SQLite پیش‌فرض کافی است) و حساب مدیر بسازید.", docs: "https://docs.gitea.com" },
  { id: "onedev", name: "OneDev", category: "توسعه", icon: "git-branch", desc: "گیت، CI/CD، Issue و Kanban در یک سرویس", image: "1dev/server:16.8.8", port: 6610, planId: "app-small", diskGb: 10, diskMount: "/opt/onedev",
    env: {}, next: "آدرس اپ را باز کنید و ویزارد راه‌اندازی را تمام کنید.", docs: "https://docs.onedev.io" },
  { id: "code-server", name: "VS Code (code-server)", category: "توسعه", icon: "code-xml", desc: "VS Code کامل در مرورگر، روی سرور ایرانی", image: "codercom/code-server:4.96.2", versions: ["4.141.0", "4.96.2"], port: 8080, planId: "app-small", diskGb: 10, diskMount: "/home/coder",
    env: { PASSWORD: "${secret}" }, show: [{ key: "PASSWORD", label: "رمز ورود" }], next: "با رمز نمایش‌داده‌شده وارد شوید.", docs: "https://coder.com/docs/code-server" },
  { id: "browserless", name: "Headless Chrome (browserless)", category: "توسعه", icon: "globe", desc: "کروم بدون رابط برای Puppeteer و Playwright: اسکرین‌شات، PDF و اسکرپ", image: "ghcr.io/browserless/chromium:v2.57.0", versions: ["v2.57.0", "v2.56.7"], port: 3000, planId: "app-small", diskGb: 0, diskMount: "/data",
    env: { TOKEN: "${secret}", CONCURRENT: "5", TIMEOUT: "60000" }, show: [{ key: "TOKEN", label: "توکن API" }], next: "با wss://آدرس-اپ?token=توکن از Puppeteer یا Playwright وصل شوید.", docs: "https://docs.browserless.io" },
  { id: "imgproxy", name: "imgproxy", category: "توسعه", icon: "camera", desc: "تغییر اندازه و بهینه‌سازی تصویر در لحظه با WebP و AVIF", image: "darthsim/imgproxy:v3.31.4", port: 8080, planId: "app-micro", diskGb: 0, diskMount: "/data", health: "/health",
    env: { IMGPROXY_KEY: "${hex}", IMGPROXY_SALT: "${hex}", IMGPROXY_USE_ETAG: "true", IMGPROXY_ENABLE_WEBP_DETECTION: "true", IMGPROXY_ENABLE_AVIF_DETECTION: "true" },
    show: [{ key: "IMGPROXY_KEY", label: "کلید امضا (KEY)" }, { key: "IMGPROXY_SALT", label: "SALT امضا" }], next: "نشانی تصاویر را با KEY و SALT امضا کنید و از CDN اپ استفاده کنید.", docs: "https://docs.imgproxy.net" },
  { id: "unleash", name: "Unleash", category: "توسعه", icon: "sliders-horizontal", desc: "مدیریت Feature Flag و انتشار تدریجی", image: "unleashorg/unleash-server:7.6.5", versions: ["8.2.0", "7.6.5"], port: 4242, planId: "app-micro", diskGb: 0, diskMount: "/data", health: "/health",
    env: { DATABASE_SSL: "false" }, db: PG(), next: "با admin / unleash4all وارد شوید و فوراً رمز را عوض کنید.", docs: "https://docs.getunleash.io" },
  { id: "verdaccio", name: "Verdaccio", category: "توسعه", icon: "package-open", desc: "رجیستری خصوصی npm با کش بسته‌های عمومی", image: "verdaccio/verdaccio:6.10.5", port: 4873, planId: "app-micro", diskGb: 10, diskMount: "/verdaccio/storage",
    env: { VERDACCIO_PUBLIC_URL: "${url}" }, next: "npm adduser --registry آدرس-اپ را بزنید و بسته‌ها را منتشر کنید.", docs: "https://verdaccio.org/docs" },
  { id: "nexus", name: "Nexus Repository", category: "توسعه", icon: "package-open", desc: "مخزن بسته Maven، npm، PyPI و Docker", image: "sonatype/nexus3:3.96.4", port: 8081, planId: "app-medium", diskGb: 20, diskMount: "/nexus-data",
    env: {}, next: "رمز اولیه admin در فایل ‎/nexus-data/admin.password‎ است (از مدیر فایل اپ ببینید).", docs: "https://help.sonatype.com/repomanager3" },
  { id: "registry", name: "Docker Registry", category: "توسعه", icon: "box", desc: "رجیستری خصوصی ایمیج‌های Docker", image: "registry:3.1.2", port: 5000, planId: "app-micro", diskGb: 20, diskMount: "/var/lib/registry",
    env: { REGISTRY_STORAGE_DELETE_ENABLED: "true" }, auth: true, next: "با docker login آدرس-اپ و نام کاربری admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://distribution.github.io/distribution" },
  { id: "it-tools", name: "IT Tools", category: "توسعه", icon: "terminal", desc: "۸۰+ ابزار کاربردی برنامه‌نویس (JWT، Base64، UUID…)", image: "corentinth/it-tools:2024.10.22-7ca5933", port: 80, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://github.com/CorentinTh/it-tools" },
  { id: "cyberchef", name: "CyberChef", category: "توسعه", icon: "terminal", desc: "چاقوی سوئیسی رمزگذاری، کدگذاری و تحلیل داده", image: "ghcr.io/gchq/cyberchef:11.5.0", port: 80, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://github.com/gchq/CyberChef" },

  /* ---------- databases & search ---------- */
  { id: "meilisearch", name: "Meilisearch", category: "پایگاه داده و جست‌وجو", icon: "search", desc: "موتور جست‌وجوی سریع با پشتیبانی فارسی برای سایت و اپ", image: "getmeili/meilisearch:v1.11.3", versions: ["v1.55.0", "v1.11.3"], port: 7700, planId: "app-micro", diskGb: 5, diskMount: "/meili_data", health: "/health",
    env: { MEILI_MASTER_KEY: "${secret}", MEILI_ENV: "production" }, show: [{ key: "MEILI_MASTER_KEY", label: "Master key" }], next: "با Master key از SDK یا API به آن وصل شوید.", docs: "https://www.meilisearch.com/docs" },
  { id: "typesense", name: "Typesense", category: "پایگاه داده و جست‌وجو", icon: "search", desc: "جست‌وجوی تایپوپذیر و برداری بسیار سریع", image: "typesense/typesense:30.1", versions: ["30.1", "29.1"], port: 8108, planId: "app-micro", diskGb: 5, diskMount: "/data", health: "/health",
    env: { TYPESENSE_API_KEY: "${secret}", TYPESENSE_DATA_DIR: "/data", TYPESENSE_ENABLE_CORS: "true" }, show: [{ key: "TYPESENSE_API_KEY", label: "کلید API مدیر" }], next: "با کلید API از SDK وصل شوید.", docs: "https://typesense.org/docs" },
  { id: "qdrant", name: "Qdrant", category: "پایگاه داده و جست‌وجو", icon: "database", desc: "پایگاه داده برداری برای RAG و جست‌وجوی معنایی", image: "qdrant/qdrant:v1.19.2", versions: ["v1.19.2", "v1.18.3"], port: 6333, planId: "app-small", diskGb: 10, diskMount: "/qdrant/storage", health: "/healthz",
    env: { QDRANT__SERVICE__API_KEY: "${secret}" }, show: [{ key: "QDRANT__SERVICE__API_KEY", label: "کلید API" }], next: "با هدر api-key از SDK وصل شوید؛ داشبورد در ‎/dashboard‎ است.", docs: "https://qdrant.tech/documentation" },
  { id: "chroma", name: "Chroma", category: "پایگاه داده و جست‌وجو", icon: "database", desc: "پایگاه داده برداری ساده برای اپ‌های هوش مصنوعی", image: "chromadb/chroma:1.5.0", versions: ["1.5.0", "1.4.0", "1.0.20"], port: 8000, planId: "app-small", diskGb: 5, diskMount: "/data", health: "/api/v2/heartbeat",
    env: {}, auth: true, next: "از کلاینت HttpClient با هدر Authorization (Basic، کاربر admin) وصل شوید.", docs: "https://docs.trychroma.com" },
  { id: "adminer", name: "Adminer", category: "پایگاه داده و جست‌وجو", icon: "database", desc: "مدیریت تحت وب PostgreSQL و MySQL در یک فایل", image: "adminer:4.8.1", versions: ["5.4.1", "4.8.1"], port: 8080, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس پایگاه داده (بخش اتصال پنل) را وارد کنید.", docs: "https://www.adminer.org" },
  { id: "pgadmin", name: "pgAdmin", category: "پایگاه داده و جست‌وجو", icon: "database", desc: "مدیریت کامل PostgreSQL در مرورگر", image: "dpage/pgadmin4:9.18", versions: ["9.18", "8.14"], port: 80, planId: "app-micro", diskGb: 1, diskMount: "/var/lib/pgadmin",
    env: { PGADMIN_DEFAULT_EMAIL: "${email}", PGADMIN_DEFAULT_PASSWORD: "${secret}", PGADMIN_CONFIG_ENHANCED_COOKIE_PROTECTION: "False" }, show: [{ key: "PGADMIN_DEFAULT_PASSWORD", label: "رمز ورود (با ایمیل حساب شما)" }], next: "با ایمیل حساب گره و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://www.pgadmin.org/docs" },
  { id: "phpmyadmin", name: "phpMyAdmin", category: "پایگاه داده و جست‌وجو", icon: "database", desc: "مدیریت MySQL و MariaDB در مرورگر", image: "phpmyadmin:5.2.3", port: 80, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: { PMA_ARBITRARY: "1", UPLOAD_LIMIT: "256M" }, next: "نشانی، کاربر و رمز پایگاه داده را از بخش اتصال پنل وارد کنید.", docs: "https://docs.phpmyadmin.net" },
  { id: "redisinsight", name: "Redis Insight", category: "پایگاه داده و جست‌وجو", icon: "zap", desc: "مدیریت و پایش Redis در مرورگر", image: "redis/redisinsight:3.8.0", port: 5540, planId: "app-micro", diskGb: 1, diskMount: "/data",
    env: {}, auth: true, next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید و پایگاه داده Redis خود را اضافه کنید.", docs: "https://redis.io/docs/latest/operate/redisinsight" },
  { id: "pghero", name: "PgHero", category: "پایگاه داده و جست‌وجو", icon: "gauge", desc: "داشبورد کارایی PostgreSQL: کوئری‌های کند، ایندکس‌ها و فضا", image: "ankane/pghero:v4.0.1", versions: ["v4.0.1", "v3.8.0"], port: 8080, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: { PGHERO_USERNAME: "admin", PGHERO_PASSWORD: "${secret}" }, show: [{ key: "PGHERO_PASSWORD", label: "رمز کاربر admin" }], next: "از بخش پایگاه داده، PostgreSQL مورد نظر را با کلید DATABASE_URL به این اپ وصل کنید.", docs: "https://github.com/ankane/pghero" },

  /* ---------- content ---------- */
  { id: "directus", name: "Directus", category: "مدیریت محتوا", icon: "layers", desc: "Headless CMS و API آماده روی پایگاه داده", image: "directus/directus:11.3.5", versions: ["12.5.0", "11.3.5"], port: 8055, planId: "app-small", diskGb: 5, diskMount: "/directus/uploads", health: "/server/health",
    env: { PUBLIC_URL: "${url}", KEY: "${secret}", SECRET: "${secret}", DB_CLIENT: "pg", ADMIN_EMAIL: "${email}", ADMIN_PASSWORD: "${secret}" }, db: PG("DB_CONNECTION_STRING"),
    show: [{ key: "ADMIN_PASSWORD", label: "رمز مدیر (ایمیل حساب شما)" }], next: "با ایمیل حساب گره و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://docs.directus.io" },
  { id: "ghost", name: "Ghost", category: "مدیریت محتوا", icon: "newspaper", desc: "پلتفرم وبلاگ و خبرنامه حرفه‌ای", image: "ghost:5.105-alpine", port: 2368, planId: "app-small", diskGb: 5, diskMount: "/var/lib/ghost/content",
    env: { url: "${url}", database__client: "sqlite3", database__connection__filename: "/var/lib/ghost/content/data/ghost.db", NODE_ENV: "production" }, next: "به ‎/ghost‎ بروید و حساب مدیر را بسازید.", docs: "https://ghost.org/docs" },
  { id: "wikijs", name: "Wiki.js", category: "مدیریت محتوا", icon: "book-open", desc: "ویکی مدرن با ویرایشگر Markdown و جست‌وجو", image: "requarks/wiki:2.5.316", port: 3000, planId: "app-small", diskGb: 0, diskMount: "/data", health: "/healthz",
    env: { DB_TYPE: "postgres" }, db: PG(dbMap({ DB_HOST: "host", DB_PORT: "port", DB_USER: "user", DB_PASS: "password", DB_NAME: "name" })), next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.requarks.io" },
  { id: "drupal", name: "Drupal", category: "مدیریت محتوا", icon: "layers", desc: "CMS سازمانی قدرتمند و چندزبانه", image: "drupal:11-apache", versions: ["11-apache", "10-apache"], port: 80, planId: "app-small", diskGb: 5, diskMount: "/data",
    start: "set -e; [ -d /data/sites ] || cp -a /opt/drupal/web/sites /data/sites; rm -rf /opt/drupal/web/sites; ln -s /data/sites /opt/drupal/web/sites; chown -R www-data:www-data /data/sites; exec docker-php-entrypoint apache2-foreground",
    env: {}, db: MY("DATABASE_URL"), next: "در نصب‌کننده، نشانی، کاربر و رمز پایگاه داده را از بخش اتصال پنل وارد کنید.", docs: "https://www.drupal.org/docs" },
  { id: "joomla", name: "Joomla", category: "مدیریت محتوا", icon: "layers", desc: "CMS محبوب با هزاران افزونه و قالب", image: "joomla:5-apache", versions: ["6-apache", "5-apache", "4-apache"], port: 80, planId: "app-small", diskGb: 5, diskMount: "/var/www/html",
    env: {}, db: MY(dbMap({ JOOMLA_DB_HOST: "hostport", JOOMLA_DB_USER: "user", JOOMLA_DB_PASSWORD: "password", JOOMLA_DB_NAME: "name" })), next: "نصب‌کننده را باز کنید؛ اطلاعات پایگاه داده همان متغیرهای اپ است.", docs: "https://docs.joomla.org" },
  { id: "nginx", name: "Nginx (سایت استاتیک)", category: "مدیریت محتوا", icon: "globe", desc: "میزبانی فایل‌های HTML روی دیسک دائمی؛ ویرایش با مدیر فایل", image: "nginx:1.29-alpine", versions: ["1.30-alpine", "1.29-alpine", "1.28-alpine"], port: 80, planId: "app-nano", diskGb: 1, diskMount: "/usr/share/nginx/html",
    env: {}, next: "فایل‌های سایت را از تب «فایل‌ها» یا SFTP بارگذاری کنید.", docs: "https://nginx.org/en/docs" },
  { id: "answer", name: "Apache Answer", category: "مدیریت محتوا", icon: "message-circle", desc: "انجمن پرسش و پاسخ مثل Stack Overflow", image: "apache/answer:2.0.3", port: 80, planId: "app-micro", diskGb: 2, diskMount: "/data",
    env: {}, next: "نصب‌کننده را باز کنید (SQLite کافی است) و حساب مدیر بسازید.", docs: "https://answer.apache.org/docs" },
  { id: "trilium", name: "Trilium Notes", category: "مدیریت محتوا", icon: "book-open", desc: "یادداشت‌برداری درختی و پایگاه دانش شخصی", image: "triliumnext/trilium:v0.106.0", port: 8080, planId: "app-micro", diskGb: 2, diskMount: "/home/node/trilium-data",
    env: { TRILIUM_DATA_DIR: "/home/node/trilium-data" }, next: "آدرس اپ را باز کنید و رمز ورود را تعیین کنید.", docs: "https://docs.triliumnotes.org" },
  { id: "memos", name: "Memos", category: "مدیریت محتوا", icon: "pencil", desc: "یادداشت کوتاه سبک و خصوصی", image: "neosmemo/memos:0.31.0", port: 5230, planId: "app-nano", diskGb: 1, diskMount: "/var/opt/memos",
    env: {}, next: "اولین حسابی که می‌سازید مدیر است.", docs: "https://usememos.com/docs" },
  { id: "freshrss", name: "FreshRSS", category: "مدیریت محتوا", icon: "newspaper", desc: "خبرخوان RSS چندکاربره", image: "freshrss/freshrss:1.30.1", port: 80, planId: "app-nano", diskGb: 1, diskMount: "/var/www/FreshRSS/data",
    env: { CRON_MIN: "*/20", ...TZ }, next: "نصب‌کننده را باز کنید (SQLite) و حساب مدیر بسازید.", docs: "https://freshrss.github.io/FreshRSS" },
  { id: "miniflux", name: "Miniflux", category: "مدیریت محتوا", icon: "newspaper", desc: "خبرخوان مینیمال و سریع", image: "miniflux/miniflux:2.3.3", port: 8080, planId: "app-nano", diskGb: 0, diskMount: "/data", health: "/healthcheck",
    env: { RUN_MIGRATIONS: "1", CREATE_ADMIN: "1", ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "${secret}", BASE_URL: "${url}" }, db: PG(dbMap({ DATABASE_URL: "url?sslmode=disable" })),
    show: [{ key: "ADMIN_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://miniflux.app/docs" },
  { id: "mealie", name: "Mealie", category: "مدیریت محتوا", icon: "book-open", desc: "مدیریت دستور پخت و برنامه غذایی", image: "ghcr.io/mealie-recipes/mealie:v3.28.0", port: 9000, planId: "app-micro", diskGb: 2, diskMount: "/app/data",
    env: { BASE_URL: "${url}", ALLOW_SIGNUP: "false", ...TZ }, next: "با changeme@example.com / MyPassword وارد شوید و فوراً حساب را عوض کنید.", docs: "https://docs.mealie.io" },

  /* ---------- business & shop ---------- */
  { id: "prestashop", name: "PrestaShop", category: "کسب‌وکار و فروشگاه", icon: "shopping-cart", desc: "فروشگاه‌ساز متن‌باز با مدیریت محصول و سفارش", image: "prestashop/prestashop:8.2", versions: ["9.0", "8.2"], port: 80, planId: "app-small", diskGb: 10, diskMount: "/var/www/html",
    env: { PS_INSTALL_AUTO: "1", PS_DOMAIN: "${host}", PS_ENABLE_SSL: "1", PS_LANGUAGE: "fa", PS_COUNTRY: "IR", PS_FOLDER_ADMIN: "admin-gereh", PS_FOLDER_INSTALL: "install-gereh", ADMIN_MAIL: "${email}", ADMIN_PASSWD: "${secret}" },
    db: MY(dbMap({ DB_SERVER: "host", DB_PORT: "port", DB_USER: "user", DB_PASSWD: "password", DB_NAME: "name" })), show: [{ key: "ADMIN_PASSWD", label: "رمز مدیر (ایمیل حساب شما)" }],
    next: "پنل مدیریت در ‎/admin-gereh‎ است؛ با ایمیل حساب گره و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://devdocs.prestashop-project.org" },
  { id: "dolibarr", name: "Dolibarr", category: "کسب‌وکار و فروشگاه", icon: "building-2", desc: "ERP و CRM سبک: فاکتور، انبار، مشتری و پروژه", image: "dolibarr/dolibarr:22.0.5", versions: ["22.0.5", "21.0.4", "20.0.4"], port: 80, planId: "app-small", diskGb: 5, diskMount: "/var/www/documents",
    env: { DOLI_URL_ROOT: "${url}", DOLI_ADMIN_LOGIN: "admin", DOLI_ADMIN_PASSWORD: "${secret}", DOLI_INIT_DEMO: "0", DOLI_DB_TYPE: "mysqli", ...TZ },
    db: MY(dbMap({ DOLI_DB_HOST: "host", DOLI_DB_HOST_PORT: "port", DOLI_DB_USER: "user", DOLI_DB_PASSWORD: "password", DOLI_DB_NAME: "name" })), show: [{ key: "DOLI_ADMIN_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://wiki.dolibarr.org" },
  { id: "listmonk", name: "listmonk", category: "کسب‌وکار و فروشگاه", icon: "mail", desc: "خبرنامه و ایمیل انبوه با آمار باز شدن و کلیک", image: "listmonk/listmonk:v6.2.0", versions: ["v6.2.0", "v6.1.0"], port: 9000, planId: "app-micro", diskGb: 2, diskMount: "/listmonk/uploads",
    start: "./listmonk --install --idempotent --yes --config '' && ./listmonk --upgrade --yes --config '' && exec ./listmonk --config ''",
    env: { LISTMONK_app__address: "0.0.0.0:9000", LISTMONK_db__ssl_mode: "disable", LISTMONK_ADMIN_USER: "admin", LISTMONK_ADMIN_PASSWORD: "${secret}", ...TZ },
    db: PG(dbMap({ LISTMONK_db__host: "host", LISTMONK_db__port: "port", LISTMONK_db__user: "user", LISTMONK_db__password: "password", LISTMONK_db__database: "name" })), show: [{ key: "LISTMONK_ADMIN_PASSWORD", label: "رمز کاربر admin" }],
    next: "با کاربر admin وارد شوید و SMTP (مثلاً سرویس ایمیل گره) را در تنظیمات وارد کنید.", docs: "https://listmonk.app/docs" },
  { id: "docuseal", name: "DocuSeal", category: "کسب‌وکار و فروشگاه", icon: "file-pen", desc: "امضای الکترونیک و فرم‌های قابل پر کردن PDF", image: "docuseal/docuseal:3.3.2", port: 3000, planId: "app-small", diskGb: 5, diskMount: "/data",
    env: {}, db: PG(), next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://www.docuseal.com/docs" },
  { id: "actual", name: "Actual Budget", category: "کسب‌وکار و فروشگاه", icon: "wallet", desc: "مدیریت بودجه و هزینه‌های شخصی", image: "actualbudget/actual-server:26.10.0", port: 5006, planId: "app-nano", diskGb: 1, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید و رمز سرور را تعیین کنید.", docs: "https://actualbudget.org/docs" },

  /* ---------- collaboration ---------- */
  { id: "nextcloud", name: "Nextcloud", category: "همکاری و ارتباط", icon: "cloud", desc: "فضای ابری خصوصی: فایل، تقویم، مخاطبین و همکاری", image: "nextcloud:31-apache", versions: ["32-apache", "31-apache", "30-apache"], port: 80, planId: "app-small", diskGb: 20, diskMount: "/var/www/html", health: "/status.php",
    env: { NEXTCLOUD_ADMIN_USER: "admin", NEXTCLOUD_ADMIN_PASSWORD: "${secret}", NEXTCLOUD_TRUSTED_DOMAINS: "${host}", OVERWRITEPROTOCOL: "https", TRUSTED_PROXIES: "10.0.0.0/8 172.16.0.0/12 192.168.0.0/16" },
    db: PG(dbMap({ POSTGRES_HOST: "hostport", POSTGRES_USER: "user", POSTGRES_PASSWORD: "password", POSTGRES_DB: "name" })), show: [{ key: "NEXTCLOUD_ADMIN_PASSWORD", label: "رمز کاربر admin" }],
    next: "نصب چند دقیقه طول می‌کشد؛ سپس با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://docs.nextcloud.com" },
  { id: "mattermost", name: "Mattermost", category: "همکاری و ارتباط", icon: "message-circle", desc: "پیام‌رسان تیمی متن‌باز؛ جایگزین Slack", image: "mattermost/mattermost-team-edition:10.11.24", versions: ["11.7.12", "10.11.24"], port: 8065, planId: "app-small", diskGb: 10, diskMount: "/mattermost/data", health: "/api/v4/system/ping",
    env: { MM_SQLSETTINGS_DRIVERNAME: "postgres", MM_SERVICESETTINGS_SITEURL: "${url}" }, db: PG(dbMap({ MM_SQLSETTINGS_DATASOURCE: "url?sslmode=disable&connect_timeout=10" })), next: "آدرس اپ را باز کنید و اولین حساب (مدیر) را بسازید.", docs: "https://docs.mattermost.com" },
  { id: "openproject", name: "OpenProject", category: "همکاری و ارتباط", icon: "list-checks", desc: "مدیریت پروژه حرفه‌ای: گانت، اسکرام و زمان‌سنجی", image: "openproject/openproject:17", port: 80, planId: "app-medium", diskGb: 10, diskMount: "/var/openproject/assets",
    env: { OPENPROJECT_SECRET_KEY_BASE: "${secret}", OPENPROJECT_HOST__NAME: "${host}", OPENPROJECT_HTTPS: "true", OPENPROJECT_DEFAULT__LANGUAGE: "fa" }, db: PG(), next: "با admin / admin وارد شوید و رمز را عوض کنید.", docs: "https://www.openproject.org/docs" },
  { id: "vikunja", name: "Vikunja", category: "همکاری و ارتباط", icon: "list-checks", desc: "فهرست کارها و پروژه با نمای کانبان و گانت", image: "vikunja/vikunja:2.7.0", port: 3456, planId: "app-nano", diskGb: 2, diskMount: "/app/vikunja/files", health: "/api/v1/info",
    env: { VIKUNJA_SERVICE_PUBLICURL: "${url}/", VIKUNJA_SERVICE_JWTSECRET: "${secret}", VIKUNJA_DATABASE_TYPE: "sqlite", VIKUNJA_DATABASE_PATH: "/app/vikunja/files/vikunja.db" }, next: "آدرس اپ را باز کنید و حساب بسازید.", docs: "https://vikunja.io/docs" },
  { id: "etherpad", name: "Etherpad", category: "همکاری و ارتباط", icon: "file-text", desc: "ویرایش هم‌زمان متن به‌صورت گروهی", image: "etherpad/etherpad:3.3.8", port: 9001, planId: "app-micro", diskGb: 0, diskMount: "/data",
    env: { DB_TYPE: "postgres", ADMIN_PASSWORD: "${secret}", TRUST_PROXY: "true" }, db: PG(dbMap({ DB_HOST: "host", DB_PORT: "port", DB_NAME: "name", DB_USER: "user", DB_PASS: "password" })),
    show: [{ key: "ADMIN_PASSWORD", label: "رمز admin (مسیر ‎/admin‎)" }], next: "آدرس اپ را باز کنید و یک سند بسازید.", docs: "https://docs.etherpad.org" },
  { id: "rallly", name: "Rallly", category: "همکاری و ارتباط", icon: "clock", desc: "زمان‌بندی جلسه با نظرسنجی؛ جایگزین Doodle", image: "lukevella/rallly:4.15.4", port: 3000, planId: "app-micro", diskGb: 0, diskMount: "/data",
    env: { SECRET_PASSWORD: "${secret}", NEXT_PUBLIC_BASE_URL: "${url}", SUPPORT_EMAIL: "${email}", NOREPLY_EMAIL: "${email}" }, db: PG(), next: "ورود با ایمیل است: متغیرهای SMTP_HOST، SMTP_USER و SMTP_PWD را در تب «متغیرها» بگذارید.", docs: "https://support.rallly.co/self-hosting" },
  { id: "kanboard", name: "Kanboard", category: "همکاری و ارتباط", icon: "list-checks", desc: "مدیریت پروژه کانبان ساده و سبک", image: "kanboard/kanboard:v1.2.54", port: 80, planId: "app-nano", diskGb: 1, diskMount: "/var/www/app/data",
    env: {}, next: "با admin / admin وارد شوید و فوراً رمز را عوض کنید.", docs: "https://docs.kanboard.org" },
  { id: "excalidraw", name: "Excalidraw", category: "همکاری و ارتباط", icon: "pencil", desc: "تخته سفید و دیاگرام دست‌نویس", image: "excalidraw/excalidraw:latest", port: 80, planId: "app-nano", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://github.com/excalidraw/excalidraw" },
  { id: "gotify", name: "Gotify", category: "همکاری و ارتباط", icon: "bell-ring", desc: "سرور اعلان بلادرنگ با اپ اندروید", image: "gotify/server:2.9", versions: ["3.1.1", "2.9"], port: 80, planId: "app-nano", diskGb: 1, diskMount: "/app/data",
    env: { GOTIFY_DEFAULTUSER_PASS: "${secret}", ...TZ }, show: [{ key: "GOTIFY_DEFAULTUSER_PASS", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://gotify.net/docs" },

  /* ---------- security ---------- */
  { id: "vaultwarden", name: "Vaultwarden", category: "امنیت", icon: "lock", desc: "مدیر رمز عبور سازگار با اپ‌های Bitwarden", image: "vaultwarden/server:1.32.7", versions: ["1.37.4", "1.32.7"], port: 80, planId: "app-nano", diskGb: 1, diskMount: "/data", health: "/alive",
    env: { DOMAIN: "${url}", ADMIN_TOKEN: "${secret}", SIGNUPS_ALLOWED: "true" }, show: [{ key: "ADMIN_TOKEN", label: "توکن صفحه ‎/admin‎" }], next: "حساب بسازید و پس از ساخت حساب‌ها، SIGNUPS_ALLOWED را false کنید.", docs: "https://github.com/dani-garcia/vaultwarden/wiki" },
  { id: "passbolt", name: "Passbolt", category: "امنیت", icon: "key-round", desc: "مدیر رمز تیمی با رمزنگاری OpenPGP", image: "passbolt/passbolt:5.16.0-1-ce", versions: ["5.16.0-1-ce", "5.15.0-1-ce"], port: 80, planId: "app-small", diskGb: 1, diskMount: "/etc/passbolt/gpg",
    env: { APP_FULL_BASE_URL: "${url}", PASSBOLT_SSL_FORCE: "false" }, db: MY(dbMap({ DATASOURCES_DEFAULT_HOST: "host", DATASOURCES_DEFAULT_PORT: "port", DATASOURCES_DEFAULT_USERNAME: "user", DATASOURCES_DEFAULT_PASSWORD: "password", DATASOURCES_DEFAULT_DATABASE: "name" })),
    next: "متغیرهای EMAIL_TRANSPORT_DEFAULT_* را بگذارید، سپس از تب «کنسول» دستور ثبت مدیر (cake passbolt register_user) را اجرا کنید.", docs: "https://www.passbolt.com/docs/hosting" },
  { id: "keycloak", name: "Keycloak", category: "امنیت", icon: "shield-check", desc: "ورود یکپارچه (SSO)، OAuth2 و OpenID Connect", image: "keycloak/keycloak:26.8", versions: ["26.8", "26.4"], port: 8080, planId: "app-small", diskGb: 0, diskMount: "/data", start: "/opt/keycloak/bin/kc.sh start",
    env: { KC_DB: "postgres", KC_HOSTNAME: "${url}", KC_HTTP_ENABLED: "true", KC_PROXY_HEADERS: "xforwarded", KC_HEALTH_ENABLED: "true", KC_BOOTSTRAP_ADMIN_USERNAME: "admin", KC_BOOTSTRAP_ADMIN_PASSWORD: "${secret}" },
    db: PG(dbMap({ KC_DB_URL: "jdbc", KC_DB_USERNAME: "user", KC_DB_PASSWORD: "password" })), show: [{ key: "KC_BOOTSTRAP_ADMIN_PASSWORD", label: "رمز موقت admin" }], next: "با admin و رمز موقت وارد کنسول شوید و یک مدیر دائمی بسازید.", docs: "https://www.keycloak.org/documentation" },
  { id: "supertokens", name: "SuperTokens", category: "امنیت", icon: "fingerprint", desc: "هسته احراز هویت: ورود، نشست و ورود اجتماعی", image: "supertokens/supertokens-postgresql:12.2", port: 3567, planId: "app-micro", diskGb: 0, diskMount: "/data", health: "/hello",
    env: { API_KEYS: "${secret}" }, db: PG("POSTGRESQL_CONNECTION_URI"), show: [{ key: "API_KEYS", label: "کلید API هسته" }], next: "connectionURI بک‌اند خود را آدرس اپ و apiKey را کلید نمایش‌داده‌شده بگذارید.", docs: "https://supertokens.com/docs" },
  { id: "privatebin", name: "PrivateBin", category: "امنیت", icon: "lock", desc: "اشتراک متن رمزنگاری‌شده سرتاسری با تاریخ انقضا", image: "privatebin/nginx-fpm-alpine:2.0.6", port: 8080, planId: "app-nano", diskGb: 1, diskMount: "/srv/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://github.com/PrivateBin/PrivateBin/wiki" },

  /* ---------- tools ---------- */
  { id: "uptime-kuma", name: "Uptime Kuma", category: "ابزار", icon: "activity", desc: "پایش در دسترس بودن سایت‌ها و سرویس‌ها با هشدار تلگرام", image: "louislam/uptime-kuma:1.23.16", versions: ["2.5.6", "1.23.16"], port: 3001, planId: "app-micro", diskGb: 1, diskMount: "/app/data",
    env: {}, next: "آدرس اپ را باز کنید و کاربر مدیر را بسازید.", docs: "https://github.com/louislam/uptime-kuma/wiki" },
  { id: "nocodb", name: "NocoDB", category: "ابزار", icon: "table", desc: "صفحه‌گسترده و پایگاه داده بدون کد؛ جایگزین Airtable", image: "nocodb/nocodb:0.258.10", versions: ["0.301.5", "0.258.10"], port: 8080, planId: "app-micro", diskGb: 5, diskMount: "/usr/app/data",
    env: { NC_PUBLIC_URL: "${url}", NC_AUTH_JWT_SECRET: "${secret}" }, next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.nocodb.com" },
  { id: "nocobase", name: "NocoBase", category: "ابزار", icon: "layout-dashboard", desc: "ساخت سیستم‌های اداری و CRM بدون کد با افزونه", image: "nocobase/nocobase:2.2.24", port: 80, planId: "app-small", diskGb: 5, diskMount: "/app/nocobase/storage",
    env: { APP_KEY: "${secret}", DB_DIALECT: "postgres", INIT_ROOT_EMAIL: "${email}", INIT_ROOT_PASSWORD: "${secret}", ...TZ },
    db: PG(dbMap({ DB_HOST: "host", DB_PORT: "port", DB_DATABASE: "name", DB_USER: "user", DB_PASSWORD: "password" })), show: [{ key: "INIT_ROOT_PASSWORD", label: "رمز مدیر (ایمیل حساب شما)" }], next: "با ایمیل حساب گره و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://docs.nocobase.com" },
  { id: "appsmith", name: "Appsmith", category: "ابزار", icon: "layout-dashboard", desc: "ساخت پنل‌های داخلی و داشبورد روی API و پایگاه داده", image: "appsmith/appsmith-ce:v2.5.0", port: 80, planId: "app-medium", diskGb: 10, diskMount: "/appsmith-stacks", health: "/api/v1/health",
    env: {}, next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.appsmith.com" },
  { id: "budibase", name: "Budibase", category: "ابزار", icon: "layout-dashboard", desc: "ساخت اپ داخلی، فرم و گردش کار بدون کد", image: "budibase/budibase:3.41.3", port: 80, planId: "app-medium", diskGb: 5, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.budibase.com" },
  { id: "lowcoder", name: "Lowcoder", category: "ابزار", icon: "layout-dashboard", desc: "ساخت رابط کاربری داخلی با کد کم؛ جایگزین Retool", image: "lowcoderorg/lowcoder-ce:2.7.6", versions: ["3.0.0", "2.7.6"], port: 3000, planId: "app-medium", diskGb: 5, diskMount: "/lowcoder-stacks",
    env: { LOWCODER_PUBLIC_URL: "${url}/", LOWCODER_DB_ENCRYPTION_PASSWORD: "${secret}", LOWCODER_DB_ENCRYPTION_SALT: "${secret}", LOWCODER_API_KEY_SECRET: "${secret}" }, next: "آدرس اپ را باز کنید و حساب مدیر را بسازید.", docs: "https://docs.lowcoder.cloud" },
  { id: "paperless", name: "Paperless-ngx", category: "ابزار", icon: "file-text", desc: "بایگانی دیجیتال اسناد با OCR و جست‌وجو", image: "ghcr.io/paperless-ngx/paperless-ngx:3.3.1", port: 8000, planId: "app-small", diskGb: 10, diskMount: "/usr/src/paperless/data",
    env: { PAPERLESS_URL: "${url}", PAPERLESS_SECRET_KEY: "${secret}", PAPERLESS_ADMIN_USER: "admin", PAPERLESS_ADMIN_PASSWORD: "${secret}", PAPERLESS_MEDIA_ROOT: "/usr/src/paperless/data/media", PAPERLESS_CONSUMPTION_DIR: "/usr/src/paperless/data/consume", PAPERLESS_TIME_ZONE: "Asia/Tehran" },
    db: { engine: "redis", version: "7.4", envKey: "PAPERLESS_REDIS", planId: "db-micro" }, show: [{ key: "PAPERLESS_ADMIN_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://docs.paperless-ngx.com" },
  { id: "stirling-pdf", name: "Stirling PDF", category: "ابزار", icon: "file-text", desc: "ادغام، تقسیم، فشرده‌سازی و تبدیل PDF در مرورگر", image: "stirlingtools/stirling-pdf:2.14.3", versions: ["3.1.0", "2.14.3"], port: 8080, planId: "app-small", diskGb: 0, diskMount: "/data",
    env: {}, next: "آدرس اپ را باز کنید.", docs: "https://docs.stirlingpdf.com" },
  { id: "linkding", name: "linkding", category: "ابزار", icon: "paperclip", desc: "مدیریت بوکمارک ساده و سریع", image: "sissbruecker/linkding:1.47.0", port: 9090, planId: "app-nano", diskGb: 1, diskMount: "/etc/linkding/data",
    env: { LD_SUPERUSER_NAME: "admin", LD_SUPERUSER_PASSWORD: "${secret}" }, show: [{ key: "LD_SUPERUSER_PASSWORD", label: "رمز کاربر admin" }], next: "با کاربر admin و رمز نمایش‌داده‌شده وارد شوید.", docs: "https://linkding.link" },
  { id: "kutt", name: "Kutt", category: "ابزار", icon: "share-2", desc: "کوتاه‌کننده لینک با آمار و دامنه اختصاصی", image: "kutt/kutt:v3.2.6", port: 3000, planId: "app-micro", diskGb: 1, diskMount: "/var/lib/kutt",
    env: { JWT_SECRET: "${secret}", DEFAULT_DOMAIN: "${host}", TRUST_PROXY: "true", DB_FILENAME: "/var/lib/kutt/data.sqlite" }, next: "آدرس اپ را باز کنید؛ اولین حساب مدیر است.", docs: "https://github.com/thedevs-network/kutt" },
  { id: "shlink", name: "Shlink", category: "ابزار", icon: "share-2", desc: "کوتاه‌کننده لینک با API و آمار", image: "shlinkio/shlink:4.6", versions: ["5.1", "4.6"], port: 8080, planId: "app-micro", diskGb: 0, diskMount: "/data",
    env: { DEFAULT_DOMAIN: "${host}", IS_HTTPS_ENABLED: "true", INITIAL_API_KEY: "${secret}", DB_DRIVER: "postgres" },
    db: PG(dbMap({ DB_HOST: "host", DB_PORT: "port", DB_NAME: "name", DB_USER: "user", DB_PASSWORD: "password" })), show: [{ key: "INITIAL_API_KEY", label: "کلید API" }], next: "با کلید API از app.shlink.io یا API به آن وصل شوید.", docs: "https://shlink.io/documentation" },
  { id: "searxng", name: "SearXNG", category: "ابزار", icon: "search", desc: "موتور فراجست‌وجوی خصوصی بدون ردیابی", image: "searxng/searxng:2026.10.13-22c64b8d3", port: 8080, planId: "app-micro", diskGb: 0, diskMount: "/data",
    env: { SEARXNG_BASE_URL: "${url}/", SEARXNG_SECRET: "${secret}" }, next: "آدرس اپ را باز کنید.", docs: "https://docs.searxng.org" },
];
export const templateOf = (id: string) => PAAS_TEMPLATES.find((t) => t.id === id);

/** the template's image at a chosen tag (the default tag when none or an unknown one is given) */
export function templateImage(t: Pick<PaasTemplate, "image" | "versions">, version?: string) {
  if (!version || !t.versions?.includes(version)) return t.image;
  return t.image.replace(/:[^:/]+$/, ":" + version);
}
export const templateTag = (t: Pick<PaasTemplate, "image">) => t.image.slice(t.image.lastIndexOf(":") + 1);

const randomHex = (bytes: number) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const randomSecret = () => btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");
/** fills the env placeholders of a template value (each random placeholder gets a fresh value) */
export function fillTemplate(v: string, ctx: { url: string; host: string; email: string }) {
  return v.replaceAll("${url}", ctx.url).replaceAll("${host}", ctx.host).replaceAll("${email}", ctx.email)
    .replace(/\$\{secret\}/g, randomSecret).replace(/\$\{hex32\}/g, () => randomHex(16)).replace(/\$\{hex\}/g, () => randomHex(32));
}

/** apps that are better on a cloud server than on Gereh Apps: shown with the reason instead of a deploy button */
export type VpsOnlyApp = { id: string; name: string; icon: string; category: string; desc: string; reason: string; docs: string; vpsApp?: string };
export const VPS_ONLY_APPS: VpsOnlyApp[] = [
  { id: "supabase", name: "Supabase", icon: "database", category: "توسعه", desc: "Backend کامل روی PostgreSQL؛ جایگزین Firebase", reason: "بیش از ۱۰ سرویس به هم وابسته (Kong، GoTrue، Realtime، Storage…) دارد و روی سرور ابری با docker compose رسمی پایدارتر است.", docs: "https://supabase.com/docs/guides/self-hosting/docker" },
  { id: "appwrite", name: "Appwrite", icon: "layers", category: "توسعه", desc: "Backend آماده: احراز هویت، پایگاه داده، فایل و توابع", reason: "به Docker socket برای اجرای توابع و حدود ۲۰ کانتینر نیاز دارد؛ نصب‌کننده رسمی آن روی سرور ابری اجرا می‌شود.", docs: "https://appwrite.io/docs/advanced/self-hosting" },
  { id: "sentry", name: "Sentry", icon: "bug", category: "توسعه", desc: "ردیابی خطا و کارایی برنامه", reason: "Kafka، ClickHouse، Redis و چندین worker لازم دارد و دست‌کم ۱۶ گیگابایت رم می‌خواهد.", docs: "https://develop.sentry.dev/self-hosted" },
  { id: "gitlab", name: "GitLab CE", icon: "git-branch", category: "توسعه", desc: "گیت، CI/CD و رجیستری سازمانی", reason: "ایمیج Omnibus چندین سرویس (PostgreSQL، Redis، Gitaly) را در یک کانتینر با دسترسی SSH اجرا می‌کند؛ سرور ابری با نصب یک‌کلیکی GitLab مناسب‌تر است. برای گیت سبک Gitea یا OneDev را ببینید.", docs: "https://docs.gitlab.com/install/docker", vpsApp: "gitlab" },
  { id: "discourse", name: "Discourse", icon: "message-circle", category: "همکاری و ارتباط", desc: "انجمن گفت‌وگوی مدرن", reason: "فقط با ابزار رسمی discourse_docker روی سرور نصب و به‌روزرسانی می‌شود.", docs: "https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md" },
  { id: "jitsi", name: "Jitsi Meet", icon: "camera", category: "همکاری و ارتباط", desc: "تماس تصویری و جلسه آنلاین", reason: "تصویر و صدا از پورت UDP ‏10000 عبور می‌کند که در گره اپ (فقط HTTP) در دسترس نیست.", docs: "https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-docker" },
  { id: "rocketchat", name: "Rocket.Chat", icon: "message-circle", category: "همکاری و ارتباط", desc: "پیام‌رسان سازمانی", reason: "به MongoDB با Replica Set و oplog نیاز دارد؛ روی سرور ابری با compose رسمی راه‌اندازی کنید یا Mattermost را از همین فهرست بردارید.", docs: "https://docs.rocket.chat/docs/deploy-with-docker-docker-compose" },
  { id: "odoo", name: "Odoo", icon: "building-2", category: "کسب‌وکار و فروشگاه", desc: "ERP کامل: حسابداری، انبار، فروش و منابع انسانی", reason: "مدیر پایگاه داده Odoo دسترسی ساخت پایگاه داده (CREATEDB) و worker طولانی‌مدت می‌خواهد؛ روی سرور ابری با PostgreSQL خودتان پایدارتر است.", docs: "https://www.odoo.com/documentation/18.0/administration/install/install.html" },
  { id: "moodle", name: "Moodle", icon: "book-open", category: "مدیریت محتوا", desc: "سامانه آموزش آنلاین (LMS)", reason: "ایمیج رسمی production ندارد و به cron و چند پوشه داده دائمی نیاز دارد؛ روی سرور ابری نصب کنید.", docs: "https://docs.moodle.org/en/Installing_Moodle" },
  { id: "mautic", name: "Mautic", icon: "megaphone", category: "کسب‌وکار و فروشگاه", desc: "اتوماسیون بازاریابی", reason: "سه نقش web، cron و worker با پوشه‌های مشترک لازم دارد؛ روی سرور ابری با compose رسمی اجرا کنید.", docs: "https://docs.mautic.org/en/5.x/getting_started/how_to_install_mautic.html" },
  { id: "portainer", name: "Portainer", icon: "box", category: "ابزار", desc: "مدیریت Docker در مرورگر", reason: "به Docker socket میزبان نیاز دارد که در گره اپ در دسترس نیست؛ سرور ابری با نصب یک‌کلیکی Portainer را بگیرید.", docs: "https://docs.portainer.io", vpsApp: "portainer" },
];
