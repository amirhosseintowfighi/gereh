/* «قالب ترکیبی» (multi-service template): one YAML file that creates several apps and managed
   databases together and wires them up. Parsed and validated here (panel editor and server alike);
   the server creates the resources in paas.createStack.

     name: docmost
     databases:
       - { id: main, engine: postgres, version: "16" }
       - { id: cache, engine: redis, version: "7.4" }
     apps:
       - name: $APP_NAME
         image: docmost/docmost:0.96.0
         port: 3000
         plan: app-small
         disk: { size: 5, mount: /app/data/storage }
         env:
           APP_URL: $APP_URL
           APP_SECRET: $RANDOM_STRING
           DATABASE_URL: $DB_main_URL
           REDIS_URL: $DB_cache_URL

   Variables: $APP_NAME (the name chosen at creation; other apps are $APP_NAME-<suffix>), $APP_URL and
   $APP_HOST (the first app's address), $RANDOM_STRING (64 random letters and digits), $RANDOM_HEX
   (32 hex digits) and $RANDOM_BASE64 (32 random bytes in base64, e.g. Laravel's APP_KEY), each new at
   every use unless suffixed with _<label> (one value shared by every use of that label), and $DB_<id>_URL / _HOST / _PORT / _USER / _PASSWORD / _NAME (a database's connection; the
   whole value must be the variable, and it stays current when the password is rotated). */
import { parse, parseDocument, stringify } from "yaml";
import { DB_ENGINES, ENV_KEY_RE, ENV_RESERVED, GIT_URL_RE, IMAGE_RE, STACKS, stackVersions } from "./paas";
import type { DbField } from "./paas-templates";

export const STACK_LIMITS = { apps: 6, databases: 4, env: 60 };
const DB_ID_RE = /^[a-z][a-z0-9]{0,15}$/;
const SUFFIX_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DB_VAR = /\$DB_([A-Za-z0-9]+)_(URL|HOST|PORT|USER|PASSWORD|NAME)\b/;
const VAR_FIELD: Record<string, DbField> = { URL: "url", HOST: "host", PORT: "port", USER: "user", PASSWORD: "password", NAME: "name" };

export type StackDb = { id: string; engine: string; version: string; planId: string };
export type StackEnv = { key: string; value: string } | { key: string; db: string; field: DbField };
export type StackApp = {
  /** "" for the main app ($APP_NAME), else the part after "$APP_NAME-" */
  suffix: string;
  image?: string; git?: { url: string; branch: string }; stack: string; version?: string;
  port: number; planId: string; start: string; build: string; health?: string; instances: number;
  disk?: { sizeGb: number; mount: string };
  env: StackEnv[];
};
export type StackPlan = { name: string; description: string; databases: StackDb[]; apps: StackApp[] };
export class StackError extends Error {}

const bad = (m: string): never => { throw new StackError(m); };
const str = (v: unknown, what: string, max = 300) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") bad(what + " باید متن باشد.");
  const s = String(v).trim();
  if (s.length > max) bad(what + " بیش از حد طولانی است.");
  return s;
};
const obj = (v: unknown, what: string) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(what + " باید یک نگاشت (کلید: مقدار) باشد."));
const only = (o: Record<string, unknown>, keys: string[], what: string) => { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(what + ": کلید «" + k + "» شناخته نشد."); };

/** parses and validates a template; throws StackError with a Persian message */
export function parseStack(text: string): StackPlan {
  if (text.length > 64_000) bad("قالب حداکثر ۶۴ کیلوبایت است.");
  let doc: unknown;
  try {
    const d = parseDocument(text);
    if (d.errors.length) throw d.errors[0];
    doc = d.toJS({ maxAliasCount: 20 });
  } catch (e) { bad("YAML خوانا نیست: " + String((e as Error).message).split("\n")[0]); }
  const root = obj(doc, "قالب");
  only(root, ["name", "description", "databases", "apps"], "قالب");
  const dbs = root.databases === undefined ? [] : Array.isArray(root.databases) ? root.databases : bad("databases باید فهرست باشد.");
  const apps = Array.isArray(root.apps) ? root.apps : bad("بخش apps (فهرست اپ‌ها) لازم است.");
  if (!apps.length) bad("دست‌کم یک اپ لازم است.");
  if (apps.length > STACK_LIMITS.apps) bad("حداکثر " + STACK_LIMITS.apps + " اپ در هر قالب.");
  if (dbs.length > STACK_LIMITS.databases) bad("حداکثر " + STACK_LIMITS.databases + " پایگاه داده در هر قالب.");

  const databases: StackDb[] = dbs.map((raw, i) => {
    const d = obj(raw, "databases[" + i + "]");
    only(d, ["id", "engine", "version", "plan"], "پایگاه داده " + (i + 1));
    const id = str(d.id, "id پایگاه داده", 16);
    if (!DB_ID_RE.test(id)) bad("id پایگاه داده «" + id + "» باید با حرف کوچک انگلیسی شروع شود و فقط حرف و عدد داشته باشد (حداکثر ۱۶).");
    const e = DB_ENGINES.find((x) => x.id === str(d.engine, "engine")) ?? bad("موتور پایگاه داده «" + str(d.engine, "engine") + "» پشتیبانی نمی‌شود.");
    const version = str(d.version, "version", 10) || e.versions[0];
    if (!e.versions.includes(version)) bad(e.label + " نسخه " + version + " ندارد؛ نسخه‌ها: " + e.versions.join("، "));
    return { id, engine: e.id, version, planId: str(d.plan, "plan", 40) || "db-micro" };
  });
  if (new Set(databases.map((d) => d.id)).size !== databases.length) bad("id پایگاه‌های داده تکراری است.");

  const out: StackApp[] = apps.map((raw, i) => {
    const a = obj(raw, "apps[" + i + "]");
    const label = "اپ " + (i + 1);
    only(a, ["name", "image", "git", "stack", "version", "port", "plan", "start", "build", "health", "instances", "disk", "env"], label);
    const name = str(a.name, "name", 40) || (i === 0 ? "$APP_NAME" : "");
    const m = /^\$APP_NAME(?:-(.+))?$/.exec(name) ?? bad(label + ": نام باید $APP_NAME یا $APP_NAME-<پسوند> باشد.");
    const suffix = m[1] ?? "";
    if (suffix && (!SUFFIX_RE.test(suffix) || suffix.length > 12)) bad(label + ": پسوند نام «" + suffix + "» باید حروف کوچک انگلیسی، عدد و خط تیره باشد (حداکثر ۱۲).");
    const image = str(a.image, "image");
    let git: StackApp["git"];
    if (a.git !== undefined) {
      const g = typeof a.git === "string" ? { url: a.git } : obj(a.git, label + " git");
      only(g, ["url", "branch"], label + " git");
      git = { url: str(g.url, "git.url"), branch: str(g.branch, "git.branch", 100) || "main" };
      if (!GIT_URL_RE.test(git.url)) bad(label + ": نشانی مخزن گیت معتبر نیست.");
      if (!/^[\w./-]{1,100}$/.test(git.branch)) bad(label + ": نام شاخه معتبر نیست.");
    }
    if (!!image === !!git) bad(label + ": دقیقاً یکی از image یا git را بنویسید.");
    if (image && !IMAGE_RE.test(image)) bad(label + ": نام ایمیج «" + image + "» معتبر نیست.");
    const stack = str(a.stack, "stack", 20) || (image ? "docker" : "node");
    const st = STACKS.find((s) => s.id === stack && s.id !== "compose" && !s.template) ?? bad(label + ": پشته «" + stack + "» شناخته نشد.");
    const version = str(a.version, "version", 20) || undefined;
    if (version && (!git || !stackVersions(stack).includes(version))) bad(label + ": نسخه " + version + " برای پشته " + st.label + " در دسترس نیست.");
    const port = a.port === undefined ? st.port : Number(a.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) bad(label + ": پورت باید عدد ۱ تا ۶۵۵۳۵ باشد.");
    const instances = a.instances === undefined ? 1 : Number(a.instances);
    if (!Number.isInteger(instances) || instances < 1 || instances > 10) bad(label + ": instances باید ۱ تا ۱۰ باشد.");
    const health = str(a.health, "health", 200) || undefined;
    if (health && !/^\/[\w./?=&%-]*$/.test(health)) bad(label + ": health باید مسیری مثل /healthz باشد.");
    let disk: StackApp["disk"];
    if (a.disk !== undefined) {
      const d = obj(a.disk, label + " disk");
      only(d, ["size", "mount"], label + " disk");
      const size = Number(d.size), mount = str(d.mount, "disk.mount", 200);
      if (!Number.isInteger(size) || size < 1 || size > 500) bad(label + ": اندازه دیسک باید ۱ تا ۵۰۰ گیگابایت باشد.");
      if (!/^\/[\w./-]*$/.test(mount) || mount.split("/").includes("..")) bad(label + ": مسیر دیسک باید مطلق باشد؛ مثل /data");
      if (instances > 1) bad(label + ": دیسک دائمی فقط با یک نمونه ممکن است.");
      disk = { sizeGb: size, mount };
    }
    const env: StackEnv[] = Object.entries(a.env === undefined ? {} : obj(a.env, label + " env")).map(([key, v]) => {
      if (!ENV_KEY_RE.test(key)) bad(label + ": نام متغیر «" + key + "» معتبر نیست.");
      if (ENV_RESERVED.has(key)) bad(label + ": متغیر " + key + " را پلتفرم تنظیم می‌کند.");
      const value = str(v, "مقدار " + key, 4000);
      const dbm = DB_VAR.exec(value);
      if (dbm) {
        if (value !== dbm[0]) bad(label + ": " + key + " — متغیر " + dbm[0] + " باید کل مقدار باشد.");
        if (!databases.some((d) => d.id === dbm[1])) bad(label + ": " + key + " — پایگاه داده «" + dbm[1] + "» در databases تعریف نشده است.");
        return { key, db: dbm[1], field: VAR_FIELD[dbm[2]] };
      }
      const unknown = /\$(DB_[A-Za-z0-9_]*|APP_[A-Z_]*|RANDOM_[A-Za-z0-9_]*)/g;
      for (const u of value.matchAll(unknown)) if (!/^(APP_NAME|APP_URL|APP_HOST|RANDOM_(STRING|HEX|BASE64)(_[A-Za-z0-9]+)?)$/.test(u[1])) bad(label + ": متغیر $" + u[1] + " شناخته نشد.");
      return { key, value };
    });
    if (env.length > STACK_LIMITS.env) bad(label + ": حداکثر " + STACK_LIMITS.env + " متغیر.");
    return { suffix, image: image || undefined, git, stack, version, port, planId: str(a.plan, "plan", 40) || "app-micro", start: str(a.start, "start", 500), build: str(a.build, "build", 500), health, instances, disk, env };
  });
  if (new Set(out.map((a) => a.suffix)).size !== out.length) bad("نام اپ‌ها تکراری است.");
  if (out[0].suffix) bad("نام اپ اول باید $APP_NAME باشد (آدرس اصلی).");
  return { name: str(root.name, "name", 60), description: str(root.description, "description", 300), databases, apps: out };
}

/** the resolved name of each app */
export const stackAppName = (base: string, a: Pick<StackApp, "suffix">) => (a.suffix ? base + "-" + a.suffix : base);

const bytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
export const RANDOM: Record<"STRING" | "HEX" | "BASE64", () => string> = {
  STRING: () => b64(bytes(48)).replace(/[+/=]/g, "").padEnd(64, "0").slice(0, 64),
  HEX: () => Array.from(bytes(16), (x) => x.toString(16).padStart(2, "0")).join(""),
  BASE64: () => b64(bytes(32)),
};
/** fills the non-database variables of one value; `shared` keeps the $RANDOM_*_<label> values */
export function fillStackValue(v: string, ctx: { name: string; url: string; host: string; shared: Map<string, string> }) {
  return v.replace(/\$(APP_NAME|APP_URL|APP_HOST|RANDOM_(STRING|HEX|BASE64)(_[A-Za-z0-9]+)?)\b/g, (k: string, name: string, kind: "STRING" | "HEX" | "BASE64" | undefined, label: string | undefined) => {
    if (name === "APP_NAME") return ctx.name;
    if (name === "APP_URL") return ctx.url;
    if (name === "APP_HOST") return ctx.host;
    if (!label) return RANDOM[kind!]();
    if (!ctx.shared.has(k)) ctx.shared.set(k, RANDOM[kind!]());
    return ctx.shared.get(k)!;
  });
}

/* ---------- docker-compose.yml → template (editor import) ---------- */
const DB_IMAGES: [RegExp, string][] = [[/^(docker\.io\/)?(library\/)?postgres(:|$)/, "postgres"], [/^(docker\.io\/)?(library\/)?(mysql)(:|$)/, "mysql"], [/^(docker\.io\/)?(library\/)?mariadb(:|$)/, "mariadb"], [/^(docker\.io\/)?(library\/)?mongo(:|$)/, "mongodb"], [/^(docker\.io\/)?(library\/)?(redis|valkey\/valkey)(:|$)/, "redis"]];
/** turns a compose file's image services into a template: database images become managed databases,
    the first service with ports becomes $APP_NAME. Environment references to a database service's
    host are replaced with its $DB_<id>_URL only where the whole value is a URL to it. */
export function stackFromCompose(text: string): { yaml: string; notes: string[] } {
  let doc: unknown;
  try { doc = parse(text, { maxAliasCount: 20 }); } catch (e) { bad("فایل compose خوانا نیست: " + String((e as Error).message).split("\n")[0]); }
  const services = obj((doc as { services?: unknown })?.services, "services");
  const notes: string[] = [];
  const databases: Record<string, unknown>[] = [];
  const dbIds = new Map<string, string>();
  for (const [name, raw] of Object.entries(services)) {
    const s = obj(raw, name);
    const image = typeof s.image === "string" ? s.image : "";
    const hit = DB_IMAGES.find(([re]) => re.test(image));
    if (!hit) continue;
    const e = DB_ENGINES.find((x) => x.id === hit[1])!;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^[0-9]+/, "").slice(0, 16) || "db" + databases.length;
    const tag = image.split(":")[1] ?? "";
    const version = e.versions.find((v) => tag === v || tag.startsWith(v + ".") || tag.startsWith(v + "-")) ?? e.versions[0];
    databases.push({ id, engine: e.id, version });
    dbIds.set(name, id);
    notes.push(name + ": به " + e.label + " " + version + " مدیریت‌شده تبدیل شد.");
  }
  const apps: Record<string, unknown>[] = [];
  const rest = Object.entries(services).filter(([n]) => !dbIds.has(n));
  const first = rest.find(([, s]) => Array.isArray((s as { ports?: unknown }).ports)) ?? rest[0];
  for (const [name, raw] of first ? [first, ...rest.filter((r) => r !== first)] : []) {
    const s = obj(raw, name);
    if (typeof s.image !== "string") { notes.push(name + ": سرویس‌های build پشتیبانی نمی‌شوند؛ آن را با git: جایگزین کنید."); continue; }
    const ports = Array.isArray(s.ports) ? s.ports : [];
    const p = ports.length ? Number(String(typeof ports[0] === "object" ? (ports[0] as { target?: unknown }).target : ports[0]).split("/")[0].split(":").pop()) : NaN;
    const env: Record<string, string> = {};
    const rawEnv = Array.isArray(s.environment) ? Object.fromEntries(s.environment.map((l) => { const t = String(l); const i = t.indexOf("="); return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ""]; })) : s.environment ? obj(s.environment, name + " environment") : {};
    for (const [k, v] of Object.entries(rawEnv)) {
      const val = v === null || v === undefined ? "" : String(v);
      const ref = [...dbIds].find(([svc]) => new RegExp("^[a-z+]+://([^@/]*@)?" + svc + "(:\\d+)?(/|$)").test(val));
      env[k] = ref ? "$DB_" + ref[1] + "_URL" : val;
    }
    const vols = Array.isArray(s.volumes) ? s.volumes.map(String).filter((v) => v.includes(":/")) : [];
    const app: Record<string, unknown> = { name: apps.length ? "$APP_NAME-" + (name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "svc" + apps.length) : "$APP_NAME", image: s.image };
    if (Number.isInteger(p) && p > 0) app.port = p;
    if (s.command) app.start = Array.isArray(s.command) ? s.command.map(String).join(" ") : String(s.command);
    if (vols.length) { app.disk = { size: 5, mount: vols[0].split(":")[1] }; if (vols.length > 1) notes.push(name + ": فقط اولین volume به دیسک دائمی تبدیل شد."); }
    if (Object.keys(env).length) app.env = env;
    apps.push(app);
  }
  if (!apps.length) bad("هیچ سرویس ایمیجی (غیر از پایگاه داده) در فایل compose نیست.");
  return { yaml: stringify({ name: "from-compose", ...(databases.length ? { databases } : {}), apps }, { lineWidth: 0 }), notes };
}

/* ---------- gallery ---------- */
export type StackSample = { id: string; name: string; icon: string; desc: string; yaml: string };
export const STACK_GALLERY: StackSample[] = [
  { id: "docmost", name: "Docmost", icon: "book-open", desc: "ویکی و مستندات تیمی؛ جایگزین Confluence (PostgreSQL + Redis)", yaml: `name: docmost
description: ویکی تیمی با PostgreSQL و Redis
databases:
  - { id: main, engine: postgres, version: "16" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    image: docmost/docmost:0.96.0
    port: 3000
    plan: app-small
    disk: { size: 5, mount: /app/data/storage }
    env:
      APP_URL: $APP_URL
      APP_SECRET: $RANDOM_STRING
      DATABASE_URL: $DB_main_URL
      REDIS_URL: $DB_cache_URL
` },
  { id: "infisical", name: "Infisical", icon: "key-round", desc: "مدیریت متمرکز secretها و متغیرهای محیطی تیم (PostgreSQL + Redis)", yaml: `name: infisical
description: مدیریت secretها
databases:
  - { id: main, engine: postgres, version: "16" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    image: infisical/infisical:v0.166.5
    port: 8080
    plan: app-small
    health: /api/status
    env:
      SITE_URL: $APP_URL
      ENCRYPTION_KEY: $RANDOM_HEX
      AUTH_SECRET: $RANDOM_STRING
      DB_CONNECTION_URI: $DB_main_URL
      REDIS_URL: $DB_cache_URL
      TELEMETRY_ENABLED: "false"
` },
  { id: "chatwoot", name: "Chatwoot", icon: "headset", desc: "پشتیبانی مشتری چندکاناله با ویجت چت؛ وب + worker", yaml: `name: chatwoot
description: وب و worker با PostgreSQL و Redis مشترک
databases:
  - { id: main, engine: postgres, version: "16" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    image: chatwoot/chatwoot:v4.18.0
    port: 3000
    plan: app-small
    start: bundle exec rails db:chatwoot_prepare && exec bundle exec rails s -p 3000 -b 0.0.0.0
    disk: { size: 5, mount: /app/storage }
    env: &env
      FRONTEND_URL: $APP_URL
      SECRET_KEY_BASE: $RANDOM_STRING_rails
      DATABASE_URL: $DB_main_URL
      REDIS_URL: $DB_cache_URL
      RAILS_ENV: production
      NODE_ENV: production
      INSTALLATION_ENV: docker
      ACTIVE_STORAGE_SERVICE: local
      RAILS_LOG_TO_STDOUT: "true"
  - name: $APP_NAME-worker
    image: chatwoot/chatwoot:v4.18.0
    plan: app-small
    start: exec bundle exec sidekiq -C config/sidekiq.yml
    env: *env
` },
  { id: "activepieces", name: "Activepieces", icon: "workflow", desc: "اتوماسیون بدون کد با ۲۰۰+ اتصال (PostgreSQL + Redis)", yaml: `name: activepieces
databases:
  - { id: main, engine: postgres, version: "16" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    image: activepieces/activepieces:0.92.3
    port: 80
    plan: app-small
    env:
      AP_FRONTEND_URL: $APP_URL
      AP_ENCRYPTION_KEY: $RANDOM_HEX
      AP_JWT_SECRET: $RANDOM_STRING
      AP_POSTGRES_URL: $DB_main_URL
      AP_REDIS_URL: $DB_cache_URL
      AP_ENVIRONMENT: prod
      AP_EXECUTION_MODE: UNSANDBOXED
      AP_TELEMETRY_ENABLED: "false"
` },
  { id: "n8n-queue", name: "n8n (حالت صف)", icon: "workflow", desc: "n8n مقیاس‌پذیر: اپ اصلی + worker با PostgreSQL و Redis", yaml: `name: n8n-queue
description: n8n با worker جداگانه برای اجرای گردش کارها
databases:
  - { id: main, engine: postgres, version: "16" }
  - { id: queue, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    image: n8nio/n8n:2.44.5
    port: 5678
    plan: app-small
    health: /healthz
    env: &env
      WEBHOOK_URL: $APP_URL/
      N8N_ENCRYPTION_KEY: $RANDOM_STRING_key
      N8N_PROXY_HOPS: "1"
      EXECUTIONS_MODE: queue
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: $DB_main_HOST
      DB_POSTGRESDB_PORT: $DB_main_PORT
      DB_POSTGRESDB_DATABASE: $DB_main_NAME
      DB_POSTGRESDB_USER: $DB_main_USER
      DB_POSTGRESDB_PASSWORD: $DB_main_PASSWORD
      QUEUE_BULL_REDIS_HOST: $DB_queue_HOST
      QUEUE_BULL_REDIS_PORT: $DB_queue_PORT
      QUEUE_BULL_REDIS_PASSWORD: $DB_queue_PASSWORD
      GENERIC_TIMEZONE: Asia/Tehran
  - name: $APP_NAME-worker
    image: n8nio/n8n:2.44.5
    plan: app-small
    start: exec n8n worker
    env: *env
` },
  { id: "laravel", name: "Laravel + MySQL + صف", icon: "code-xml", desc: "پروژه Laravel شما از Git با MySQL، Redis و worker صف", yaml: `name: laravel
description: نشانی مخزن را با پروژه خودتان عوض کنید
databases:
  - { id: db, engine: mysql, version: "8.4" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    git: { url: https://github.com/your-org/your-laravel-app.git, branch: main }
    stack: laravel
    version: "8.3"
    port: 80
    plan: app-small
    env: &env
      APP_ENV: production
      APP_URL: $APP_URL
      APP_KEY: base64:$RANDOM_BASE64_appkey
      DB_CONNECTION: mysql
      DB_URL: $DB_db_URL
      REDIS_URL: $DB_cache_URL
      QUEUE_CONNECTION: redis
      CACHE_STORE: redis
  - name: $APP_NAME-queue
    git: { url: https://github.com/your-org/your-laravel-app.git, branch: main }
    stack: laravel
    version: "8.3"
    plan: app-micro
    start: php artisan queue:work --tries=3
    env: *env
` },
  { id: "nextjs-pg", name: "Next.js + PostgreSQL", icon: "rocket", desc: "اپ Next.js شما از Git با PostgreSQL و Redis", yaml: `name: nextjs
description: نشانی مخزن را با پروژه خودتان عوض کنید
databases:
  - { id: main, engine: postgres, version: "17" }
  - { id: cache, engine: redis, version: "7.4" }
apps:
  - name: $APP_NAME
    git: { url: https://github.com/your-org/your-next-app.git, branch: main }
    stack: nextjs
    version: "22"
    port: 3000
    plan: app-small
    env:
      NEXT_PUBLIC_SITE_URL: $APP_URL
      AUTH_SECRET: $RANDOM_STRING
      DATABASE_URL: $DB_main_URL
      REDIS_URL: $DB_cache_URL
` },
];
