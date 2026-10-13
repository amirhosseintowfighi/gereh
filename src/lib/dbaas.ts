/* Managed database extras shared by the panel and the server: extra users and databases, temporary
   web admin panels, firewall allowlists, tunable parameters, PostgreSQL extensions, imports and the
   data inspector. Engine basics (versions, ports, env keys) live in DB_ENGINES (./paas.ts). */
import { engineOf } from "./paas";

/* ---------- users and databases ---------- */
/** engines whose extra users and databases (RabbitMQ: vhosts) Gereh manages */
export const MANAGED_ENGINES = ["postgres", "mysql", "mariadb", "mongodb", "mssql", "clickhouse", "rabbitmq"] as const;
export const canManage = (engine: string) => (MANAGED_ENGINES as readonly string[]).includes(engine);
/** what a "database" is called for the engine */
export const dbNoun = (engine: string) => (engine === "rabbitmq" ? "vhost" : engine === "cassandra" ? "keyspace" : "پایگاه داده");
export const IDENT_RE = /^[a-z][a-z0-9_]{1,30}$/;
const RESERVED = new Set([
  "postgres", "template0", "template1", "public", "pg_monitor", "mysql", "information_schema", "performance_schema", "sys", "root", "admin", "local", "config",
  "master", "tempdb", "model", "msdb", "sa", "system", "default", "guest", "gereh", "replication", "mariadb_sys", "mysql_sys",
]);
/** null when the name can be a user or database name, else a Persian error */
export function identError(name: string, what: "user" | "db") {
  if (!IDENT_RE.test(name)) return (what === "user" ? "نام کاربر" : "نام") + " فقط حروف کوچک انگلیسی، عدد و _ ؛ ۲ تا ۳۱ نویسه و با حرف شروع شود.";
  if (RESERVED.has(name) || name.startsWith("pg_") || name.startsWith("gereh_")) return "این نام رزرو شده است.";
  return null;
}
export type DbAccess = "ro" | "rw";
export type DbGrant = { db: string; access: DbAccess };
export const MAX_DB_USERS = 20;
export const MAX_EXTRA_DBS = 20;

/* ---------- temporary web admin panels ---------- */
export type AdminTool = { id: string; label: string; engines: string[]; hint: string };
export const ADMIN_TOOLS: AdminTool[] = [
  { id: "phpmyadmin", label: "phpMyAdmin", engines: ["mysql", "mariadb"], hint: "مدیریت MySQL و MariaDB در مرورگر" },
  { id: "pgadmin", label: "pgAdmin", engines: ["postgres"], hint: "ابزار رسمی مدیریت PostgreSQL" },
  { id: "adminer", label: "Adminer", engines: ["postgres", "mysql", "mariadb"], hint: "سبک و تک‌فایلی" },
  { id: "redisinsight", label: "RedisInsight", engines: ["redis"], hint: "مرور کلیدها و پایش Redis" },
  { id: "mongo-express", label: "Mongo Express", engines: ["mongodb"], hint: "مرور و ویرایش سندهای MongoDB" },
  { id: "rabbitmq", label: "RabbitMQ Management", engines: ["rabbitmq"], hint: "صف‌ها، exchangeها و کاربران" },
];
export const toolsFor = (engine: string) => ADMIN_TOOLS.filter((t) => t.engines.includes(engine));
export const PANEL_HOURS_DEFAULT = 5;
export const PANEL_HOURS_MAX = 24;

/* ---------- firewall ---------- */
export const MAX_ALLOW = 50;
const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp("^" + octet + "(\\." + octet + "){3}$");
/** normalises an IPv4 address or CIDR (a bare address becomes /32); returns null when invalid */
export function normCidr(input: string): string | null {
  const s = input.trim();
  const [ip, bits, extra] = s.split("/");
  if (extra !== undefined || !IPV4.test(ip)) return null;
  const n = bits === undefined ? 32 : /^\d{1,2}$/.test(bits) ? Number(bits) : -1;
  // wider than /8 is effectively "open to everyone": use public access without a list instead
  if (n < 8 || n > 32) return null;
  // the network address of the block
  const v = ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
  const net = n === 0 ? 0 : Math.floor(v / 2 ** (32 - n)) * 2 ** (32 - n);
  return [24, 16, 8, 0].map((sh) => Math.floor(net / 2 ** sh) % 256).join(".") + "/" + n;
}

/* ---------- tunable parameters ---------- */
export type DbParam = { key: string; label: string; min: number; max: number | ((ramMb: number) => number); def: number | ((ramMb: number) => number); unit?: string; options?: string[] };
const r = (f: number) => (ram: number) => Math.max(16, Math.floor(ram * f));
const MYSQL_PARAMS: DbParam[] = [
  { key: "max_connections", label: "حداکثر اتصال هم‌زمان", min: 10, max: 2000, def: 151 },
  { key: "max_allowed_packet", label: "بزرگ‌ترین بسته", min: 1, max: 1024, def: 64, unit: "MB" },
  { key: "connect_timeout", label: "مهلت اتصال", min: 2, max: 3600, def: 10, unit: "ثانیه" },
  { key: "wait_timeout", label: "بستن اتصال بی‌کار پس از", min: 60, max: 86400, def: 28800, unit: "ثانیه" },
  { key: "innodb_buffer_pool_size", label: "حافظه InnoDB", min: 32, max: r(0.75), def: r(0.5), unit: "MB" },
  { key: "long_query_time", label: "ثبت کوئری کند بیش از", min: 0, max: 60, def: 10, unit: "ثانیه" },
];
export const DB_PARAMS: Record<string, DbParam[]> = {
  postgres: [
    { key: "max_connections", label: "حداکثر اتصال هم‌زمان", min: 10, max: 1000, def: 100 },
    { key: "shared_buffers", label: "shared_buffers", min: 16, max: r(0.4), def: r(0.25), unit: "MB" },
    { key: "work_mem", label: "work_mem", min: 1, max: 1024, def: 4, unit: "MB" },
    { key: "maintenance_work_mem", label: "maintenance_work_mem", min: 16, max: r(0.5), def: 64, unit: "MB" },
    { key: "effective_cache_size", label: "effective_cache_size", min: 32, max: r(1), def: r(0.5), unit: "MB" },
    { key: "statement_timeout", label: "مهلت هر کوئری (۰ = بدون مهلت)", min: 0, max: 3_600_000, def: 0, unit: "ms" },
    { key: "idle_in_transaction_session_timeout", label: "بستن تراکنش بی‌کار پس از", min: 0, max: 3_600_000, def: 0, unit: "ms" },
    { key: "log_min_duration_statement", label: "ثبت کوئری کند بیش از (‎-1 = خاموش)", min: -1, max: 600_000, def: -1, unit: "ms" },
  ],
  mysql: MYSQL_PARAMS,
  mariadb: MYSQL_PARAMS,
  mongodb: [
    { key: "maxConns", label: "حداکثر اتصال هم‌زمان", min: 10, max: 20000, def: 1000 },
    { key: "wiredTigerCacheSizeMB", label: "حافظه کش WiredTiger", min: 256, max: r(0.6), def: r(0.5), unit: "MB" },
  ],
  redis: [
    { key: "maxmemory-policy", label: "سیاست حذف کلید هنگام پر شدن حافظه", min: 0, max: 0, def: 0, options: ["noeviction", "allkeys-lru", "allkeys-lfu", "volatile-lru", "volatile-lfu", "allkeys-random", "volatile-random", "volatile-ttl"] },
    { key: "maxclients", label: "حداکثر اتصال هم‌زمان", min: 10, max: 50000, def: 10000 },
    { key: "timeout", label: "بستن اتصال بی‌کار پس از (۰ = هرگز)", min: 0, max: 86400, def: 0, unit: "ثانیه" },
  ],
};
export const paramsFor = (engine: string) => DB_PARAMS[engine] ?? [];
const val = (x: number | ((ram: number) => number), ram: number) => (typeof x === "function" ? x(ram) : x);
export const paramMax = (p: DbParam, ramMb: number) => val(p.max, ramMb);
export const paramDefault = (p: DbParam, ramMb: number) => (p.options ? p.options[0] : String(val(p.def, ramMb)));
/** null when every value is valid for the engine and plan, else a Persian error */
export function paramsError(engine: string, values: Record<string, string>, ramMb: number): string | null {
  const defs = paramsFor(engine);
  if (!defs.length) return "تنظیم پارامتر برای این موتور پشتیبانی نمی‌شود.";
  for (const [k, v] of Object.entries(values)) {
    const p = defs.find((x) => x.key === k);
    if (!p) return "پارامتر «" + k + "» پشتیبانی نمی‌شود.";
    if (p.options) { if (!p.options.includes(v)) return "مقدار «" + v + "» برای " + k + " مجاز نیست."; continue; }
    if (!/^-?\d+$/.test(v)) return "مقدار " + k + " باید عدد صحیح باشد.";
    const n = Number(v), max = paramMax(p, ramMb);
    if (n < p.min || n > max) return "مقدار " + k + " باید بین " + p.min.toLocaleString("fa-IR") + " و " + max.toLocaleString("fa-IR") + (p.unit ? " " + p.unit : "") + " باشد" + (typeof p.max === "function" ? " (بسته به حافظه پلن)" : "") + ".";
  }
  return null;
}

/* ---------- PostgreSQL extensions ---------- */
/** `image`: needs the Gereh PostgreSQL image (PostGIS + pgvector); `preload`: shared_preload_libraries */
export type PgExtension = { id: string; label: string; hint: string; image?: boolean; preload?: boolean; minVersion?: number; requires?: string[] };
export const PG_EXTENSIONS: PgExtension[] = [
  { id: "postgis", label: "PostGIS", hint: "داده‌های مکانی و نقشه", image: true },
  { id: "vector", label: "pgvector", hint: "جست‌وجوی برداری (embedding)", image: true, minVersion: 13 },
  { id: "pg_trgm", label: "pg_trgm", hint: "جست‌وجوی متنی فازی با سه‌حرفی‌ها" },
  { id: "uuid-ossp", label: "uuid-ossp", hint: "تولید UUID" },
  { id: "pgcrypto", label: "pgcrypto", hint: "هش و رمزنگاری، gen_random_uuid" },
  { id: "hstore", label: "hstore", hint: "کلید-مقدار در یک ستون" },
  { id: "citext", label: "citext", hint: "متن بدون حساسیت به بزرگی حروف" },
  { id: "pg_stat_statements", label: "pg_stat_statements", hint: "آمار کوئری‌ها (نیاز به ری‌استارت)", preload: true },
  { id: "unaccent", label: "unaccent", hint: "حذف اعراب در جست‌وجو" },
  { id: "fuzzystrmatch", label: "fuzzystrmatch", hint: "levenshtein و soundex" },
  { id: "btree_gin", label: "btree_gin", hint: "ایندکس GIN برای انواع ساده" },
  { id: "btree_gist", label: "btree_gist", hint: "ایندکس GiST برای انواع ساده" },
  { id: "ltree", label: "ltree", hint: "داده‌های درختی" },
  { id: "intarray", label: "intarray", hint: "عملگرهای آرایه عددی" },
  { id: "tablefunc", label: "tablefunc", hint: "crosstab و pivot" },
  { id: "cube", label: "cube", hint: "داده‌های چندبعدی" },
  { id: "earthdistance", label: "earthdistance", hint: "فاصله روی کره زمین", requires: ["cube"] },
];
export const pgExtension = (id: string) => PG_EXTENSIONS.find((e) => e.id === id);

/* ---------- imports ---------- */
export type ImportFormat = "sql" | "sql.gz" | "pgdump" | "bak" | "mongo-archive" | "mongo-archive.gz";
/** dump formats each engine can import */
export const IMPORT_FORMATS: Record<string, ImportFormat[]> = {
  postgres: ["sql", "sql.gz", "pgdump"], mysql: ["sql", "sql.gz"], mariadb: ["sql", "sql.gz"], mssql: ["bak"], mongodb: ["mongo-archive", "mongo-archive.gz"],
};
export const IMPORT_LABEL: Record<ImportFormat, string> = { sql: "فایل SQL", "sql.gz": "SQL فشرده (gz)", pgdump: "pg_dump سفارشی (‎-Fc)", bak: "پشتیبان SQL Server ‏(.bak)", "mongo-archive": "mongodump ‏--archive", "mongo-archive.gz": "mongodump ‏--archive --gzip" };
export const MAX_IMPORT = 2 * 1024 ** 3;
/** the dump's format from its first bytes (and, for gzip, the engine) */
export function sniffDump(head: Uint8Array, engine: string): ImportFormat | null {
  const hex = Array.from(head.subarray(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  const ascii = String.fromCharCode(...head.subarray(0, 5));
  if (hex.startsWith("1f8b")) return engine === "mongodb" ? "mongo-archive.gz" : "sql.gz";
  if (ascii === "PGDMP") return "pgdump";
  if (ascii.startsWith("TAPE")) return "bak";
  if (hex === "6de29981") return "mongo-archive";
  // text dumps: printable ASCII / UTF-8 (BOM allowed)
  if (head.length && Array.from(head.subarray(0, 64)).every((b) => b === 9 || b === 10 || b === 13 || b >= 32)) return "sql";
  return null;
}

/* ---------- data inspector ---------- */
export const INSPECT_ENGINES = ["postgres", "mysql", "mariadb", "mongodb"];
export const QUERY_ENGINES = ["postgres", "mysql", "mariadb"];
export const INSPECT_PAGE = 50;
export const QUERY_LIMIT = 500;
export const QUERY_TIMEOUT_MS = 5000;
/** null when the text can run as one read-only query, else a Persian error */
export function readQueryError(q: string): string | null {
  const s = q.trim().replace(/;\s*$/, "");
  if (!s) return "کوئری خالی است.";
  if (s.length > 10_000) return "کوئری بیش از حد طولانی است.";
  if (s.includes(";")) return "فقط یک کوئری بدون «;» در میانه آن مجاز است.";
  if (s.includes("\\")) return "نویسه \\ در کوئری مجاز نیست.";
  if (!/^(select|with|values|table|show|explain)\b/i.test(s)) return "فقط کوئری خواندنی (SELECT، WITH، SHOW، EXPLAIN) مجاز است.";
  return null;
}
/** Mongo find filters may not run JavaScript on the server */
export function mongoFilterError(filter: string): string | null {
  let v: unknown;
  try { v = JSON.parse(filter || "{}"); } catch { return "فیلتر باید JSON معتبر باشد؛ مثل {\"status\": \"paid\"}"; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return "فیلتر باید یک شیء JSON باشد.";
  if (/"\$(where|function|accumulator|expr)"/.test(JSON.stringify(v))) return "عملگرهای $where، $function، $accumulator و $expr مجاز نیستند.";
  return null;
}

/* ---------- connection guidance ---------- */
export const POOLING: Record<string, string> = {
  postgres: "هر اتصال PostgreSQL یک پردازه جداست؛ در اپ از pool استفاده کنید (مثلاً pg.Pool با max=10، یا connection_limit در Prisma) و مجموع اتصال‌های همه نمونه‌های اپ را زیر max_connections نگه دارید. برای سرورلس یا تعداد زیاد نمونه، PgBouncer در حالت transaction جلوی پایگاه داده بگذارید.",
  mysql: "pool اتصال (mysql2 createPool با connectionLimit=10، یا pool_size در SQLAlchemy) را برای هر نمونه اپ تنظیم کنید و wait_timeout را از زمان بی‌کاری pool بیشتر نگه دارید تا اتصال‌ها وسط کار بسته نشوند.",
  mariadb: "pool اتصال (connectionLimit=10) را برای هر نمونه اپ تنظیم کنید و wait_timeout را از زمان بی‌کاری pool بیشتر نگه دارید.",
  mongodb: "MongoClient را یک بار در شروع اپ بسازید و همه درخواست‌ها از همان استفاده کنند (maxPoolSize پیش‌فرض ۱۰۰ است؛ برای پلن‌های کوچک ۱۰ تا ۲۰ کافی است). برای تراکنش و change stream گزینه Replica Set را روشن کنید.",
  redis: "یک اتصال مشترک (یا pool کوچک) در کل اپ کافی است؛ برای صف‌ها (BullMQ) اتصال جدا بسازید و maxRetriesPerRequest را تنظیم کنید.",
  mssql: "pool پیش‌فرض درایورها (tedious/mssql با max=10) کافی است؛ اتصال را یک بار بسازید و دوباره استفاده کنید.",
  rabbitmq: "در هر پردازه یک اتصال AMQP بسازید و برای هر نخ یا مصرف‌کننده channel جدا باز کنید؛ اتصال را برای هر پیام باز و بسته نکنید.",
  clickhouse: "درج را دسته‌ای (هزاران ردیف در هر INSERT) یا با async_insert انجام دهید؛ درج تک‌ردیفی پرتکرار کارایی را پایین می‌آورد.",
};
export const poolingFor = (engine: string) => POOLING[engine] ?? "";

/** whether the engine can be reached from outside the platform */
export const publicAllowed = (engine: string) => engineOf(engine)?.publicOk !== false;
