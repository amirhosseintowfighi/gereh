/* The «پرسش از دیتابیس» simulator, for development, demos and tests (no Kubernetes, no AI_UPSTREAM_KEY):
   - SimRunner: every SQL database is an embedded PGlite seeded with a small shop (customers, products, orders,
     order_items) and read through the same read-only frame as production (READ ONLY transaction, a SELECT-only
     gereh_ro role, always rolled back); MongoDB and Redis are small in-memory copies of the same data;
   - simulateQuery: a deterministic natural-language → query translator for the common questions (counts, top-N,
     sums by day, group-bys), in Persian or English, over whatever schema it is given. */
import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import type { Cell, DbqChart } from "@/lib/dbquery";
import type { DbSpec } from "../paas/driver";
import { mergeRedis, objectsToRaw, PG_SCHEMA_SQL, pgSamplesSql, redisPatterns, redisRows, RO_USER, samplesOf, type DbqRunner, type Raw, type RunReq, type SchemaTable } from "./runner";

/* ---------- the demo shop ---------- */
const FIRST = ["علی", "مریم", "رضا", "زهرا", "حسین", "فاطمه", "مهدی", "سارا", "امیر", "نرگس"];
const LAST = ["احمدی", "محمدی", "حسینی", "رضایی", "کریمی", "موسوی", "جعفری", "صادقی", "رحیمی", "نوری"];
const CITIES = ["تهران", "اصفهان", "شیراز", "مشهد", "تبریز", "کرج"];
const CATS = ["کتاب", "پوشاک", "دیجیتال", "خانه"];
const STATUSES = ["paid", "paid", "paid", "shipped", "pending", "cancelled"];
const arr = (xs: string[]) => "ARRAY[" + xs.map((x) => "'" + x + "'").join(", ") + "]";

export const DEMO_SQL = `
CREATE TABLE customers (id integer PRIMARY KEY, name text NOT NULL, city text NOT NULL, email text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE products (id integer PRIMARY KEY, title text NOT NULL, category text NOT NULL, price integer NOT NULL);
CREATE TABLE orders (id integer PRIMARY KEY, customer_id integer NOT NULL REFERENCES customers(id), status text NOT NULL, total integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL);
CREATE TABLE order_items (id serial PRIMARY KEY, order_id integer NOT NULL REFERENCES orders(id), product_id integer NOT NULL REFERENCES products(id), qty integer NOT NULL, price integer NOT NULL);
INSERT INTO customers SELECT i, (${arr(FIRST)})[1 + i % 10] || ' ' || (${arr(LAST)})[1 + (i * 7) % 10], (${arr(CITIES)})[1 + (i * 5) % 6], 'user' || i || '@example.ir', date_trunc('day', now()) - ((i * 37) % 300) * interval '1 day' FROM generate_series(1, 60) i;
INSERT INTO products SELECT i, 'محصول ' || i, (${arr(CATS)})[1 + i % 4], 50000 + ((i * 7919) % 400) * 1000 FROM generate_series(1, 24) i;
INSERT INTO orders (id, customer_id, status, created_at) SELECT i, 1 + (i * 17) % 60, (${arr(STATUSES)})[1 + i % 6], date_trunc('day', now()) - ((i * 13) % 60) * interval '1 day' + (i % 20) * interval '1 hour' FROM generate_series(1, 600) i;
INSERT INTO order_items (order_id, product_id, qty, price) SELECT o, p.id, 1 + (o + k) % 3, p.price FROM generate_series(1, 600) o CROSS JOIN generate_series(1, 3) k JOIN products p ON p.id = 1 + (o * k * 7) % 24 WHERE k <= 1 + o % 3;
UPDATE orders SET total = s.t FROM (SELECT order_id, sum(qty * price) AS t FROM order_items GROUP BY order_id) s WHERE s.order_id = orders.id;
ANALYZE;
CREATE ROLE ${RO_USER} NOLOGIN;
GRANT USAGE ON SCHEMA public TO ${RO_USER};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${RO_USER};
`;

/* PostgreSQL type oids → the panel's column types */
const NUM_OIDS = new Set([20, 21, 23, 26, 700, 701, 1700]), DATE_OIDS = new Set([1082, 1083, 1114, 1184]), JSON_OIDS = new Set([114, 3802]);
const typeOf = (oid: number) => (NUM_OIDS.has(oid) ? "number" : oid === 16 ? "bool" : DATE_OIDS.has(oid) ? "date" : JSON_OIDS.has(oid) ? "json" : "text");
const cellOf = (v: unknown): Cell => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : typeof v === "object" ? JSON.stringify(v) : (v as Cell));

type Pg = { db: PGlite; lock: Promise<unknown> };
const pgs = new Map<string, Promise<Pg>>();
/** the demo database of `dbId` (seeded on first use) */
export function simPg(dbId: string): Promise<Pg> {
  let p = pgs.get(dbId);
  if (!p) {
    p = (async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      const db = new PGlite();
      await db.exec(DEMO_SQL);
      return { db, lock: Promise.resolve() };
    })();
    p.catch(() => pgs.delete(dbId));
    pgs.set(dbId, p);
  }
  return p;
}
export const resetSim = async () => { for (const p of pgs.values()) await (await p).db.close().catch(() => {}); pgs.clear(); };

/** one query at a time per database: READ ONLY transaction, the SELECT-only role, then always ROLLBACK.
    The query goes through the extended protocol, which refuses more than one statement. */
export async function readOnly<T>(dbId: string, f: (db: PGlite) => Promise<T>, role = true): Promise<T> {
  const pg = await simPg(dbId);
  const prev = pg.lock;
  let release!: () => void;
  pg.lock = new Promise<void>((r) => { release = r; });
  await prev.catch(() => {});
  try {
    await pg.db.exec("BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = '10s';" + (role ? " SET LOCAL ROLE " + RO_USER + ";" : ""));
    try { return await f(pg.db); } finally { await pg.db.exec("ROLLBACK"); }
  } finally { release(); }
}
/** MySQL-only syntax the generated queries use, for the PGlite stand-in */
const fromMysql = (sql: string) => sql.replace(/INTERVAL\s+(\d+)\s+DAY\b/gi, "INTERVAL '$1 days'").replace(/`([^`]*)`/g, '"$1"');

/* ---------- MongoDB and Redis stand-ins ---------- */
type Doc = Record<string, unknown>;
let docsCache: Record<string, Doc[]> | null = null;
function mongoDocs(): Record<string, Doc[]> {
  if (docsCache) return docsCache;
  const day = (n: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - n * 86400_000).toISOString(); };
  const customers = Array.from({ length: 60 }, (_, k) => { const i = k + 1; return { _id: i, name: FIRST[i % 10] + " " + LAST[(i * 7) % 10], city: CITIES[(i * 5) % 6], email: "user" + i + "@example.ir", created_at: day((i * 37) % 300) }; });
  const products = Array.from({ length: 24 }, (_, k) => { const i = k + 1; return { _id: i, title: "محصول " + i, category: CATS[i % 4], price: 50000 + ((i * 7919) % 400) * 1000 }; });
  const orders = Array.from({ length: 600 }, (_, k) => { const i = k + 1; const items = Array.from({ length: 1 + (i % 3) }, (_, j) => { const p = products[((i * (j + 1) * 7) % 24 || 24) - 1]; return { product_id: p._id, qty: 1 + ((i + j + 1) % 3), price: p.price }; });
    return { _id: i, customer_id: 1 + ((i * 17) % 60), status: STATUSES[i % 6], total: items.reduce((s, x) => s + x.qty * x.price, 0), items, created_at: day((i * 13) % 60) }; });
  return (docsCache = { customers, products, orders });
}
const get = (d: Doc, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Doc)[k] : undefined), d);
function expr(d: Doc, e: unknown): unknown {
  if (typeof e === "string" && e.startsWith("$")) return get(d, e.slice(1));
  if (e && typeof e === "object" && !Array.isArray(e)) {
    const [op, a] = Object.entries(e)[0] ?? [];
    if (op === "$dateToString") { const v = expr(d, (a as Doc).date); return typeof v === "string" ? v.slice(0, 10) : v; }
    if (op === "$substrBytes" || op === "$substr") { const [x, s, n] = a as unknown[]; return String(expr(d, x) ?? "").slice(Number(s), Number(s) + Number(n)); }
    if (op === "$multiply") return (a as unknown[]).reduce<number>((p, x) => p * Number(expr(d, x)), 1);
    if (op === "$size") { const v = expr(d, a); return Array.isArray(v) ? v.length : 0; }
    if (op) throw new Error("simulator: operator " + op + " is not supported");
  }
  return e;
}
function matches(d: Doc, q: Doc): boolean {
  return Object.entries(q).every(([k, v]) => {
    if (k === "$and") return (v as Doc[]).every((x) => matches(d, x));
    if (k === "$or") return (v as Doc[]).some((x) => matches(d, x));
    const x = get(d, k);
    if (v && typeof v === "object" && !Array.isArray(v)) return Object.entries(v).every(([op, w]) => {
      const a = x as never, b = w as never;
      switch (op) { case "$gte": return a >= b; case "$gt": return a > b; case "$lte": return a <= b; case "$lt": return a < b; case "$ne": return a !== b; case "$in": return (w as unknown[]).includes(x); case "$nin": return !(w as unknown[]).includes(x); case "$exists": return (x !== undefined) === !!w; default: throw new Error("simulator: " + op + " is not supported"); }
    });
    return x === v;
  });
}
export function simAggregate(collection: string, pipeline: Doc[]): Doc[] {
  let rows: Doc[] = [...(mongoDocs()[collection] ?? [])];
  for (const st of pipeline) {
    const [k, a] = Object.entries(st)[0];
    switch (k) {
      case "$match": rows = rows.filter((d) => matches(d, a as Doc)); break;
      case "$limit": rows = rows.slice(0, Number(a)); break;
      case "$skip": rows = rows.slice(Number(a)); break;
      case "$count": rows = [{ [String(a)]: rows.length }]; break;
      case "$sort": { const keys = Object.entries(a as Doc); rows.sort((x, y) => { for (const [f, dir] of keys) { const p = get(x, f) as never, q = get(y, f) as never; if (p !== q) return (p < q ? -1 : 1) * Number(dir); } return 0; }); break; }
      case "$project": { const keep = Object.entries(a as Doc); rows = rows.map((d) => Object.fromEntries([...(keep.some(([f, v]) => f === "_id" && !v) ? [] : [["_id", d._id]]), ...keep.filter(([f, v]) => f !== "_id" && v).map(([f, v]) => [f, v === 1 || v === true ? get(d, f) : expr(d, v)])])); break; }
      case "$unwind": { const f = String(a).slice(1); rows = rows.flatMap((d) => (Array.isArray(d[f]) ? (d[f] as unknown[]).map((x) => ({ ...d, [f]: x })) : [])); break; }
      case "$group": {
        const g = a as Doc, by = new Map<string, Doc>();
        for (const d of rows) {
          const id = expr(d, g._id), key = JSON.stringify(id);
          const acc = by.get(key) ?? { _id: id, __n: 0 };
          acc.__n = Number(acc.__n) + 1;
          for (const [f, spec] of Object.entries(g)) {
            if (f === "_id") continue;
            const [op, e] = Object.entries(spec as Doc)[0];
            const v = Number(expr(d, e)) || 0;
            if (op === "$sum") acc[f] = Number(acc[f] ?? 0) + v;
            else if (op === "$avg") acc[f] = Number(acc[f] ?? 0) + v;
            else if (op === "$max") acc[f] = Math.max(Number(acc[f] ?? -Infinity), v);
            else if (op === "$min") acc[f] = Math.min(Number(acc[f] ?? Infinity), v);
            else throw new Error("simulator: " + op + " is not supported");
          }
          by.set(key, acc);
        }
        rows = [...by.values()].map(({ __n, ...r }) => { for (const [f, spec] of Object.entries(g)) if (f !== "_id" && "$avg" in (spec as Doc)) r[f] = Math.round((Number(r[f]) / Number(__n)) * 100) / 100; return r; });
        break;
      }
      default: throw new Error("simulator: stage " + k + " is not supported");
    }
  }
  return rows;
}
const REDIS_SIM: Record<string, { type: string; v: unknown }> = {
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => ["session:" + (1000 + i), { type: "hash", v: { user_id: String(1 + i * 5), ip: "10.0.0." + (i + 2), agent: "Mozilla/5.0" } }])),
  ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => ["cart:" + (i + 1), { type: "list", v: Array.from({ length: 1 + (i % 3) }, (_, j) => "product:" + (1 + ((i + j) * 5) % 24)) }])),
  "stats:visits": { type: "string", v: "48211" },
  "stats:signups": { type: "string", v: "317" },
  leaderboard: { type: "zset", v: [["user:12", "980"], ["user:7", "870"], ["user:31", "640"], ["user:3", "420"]] },
};
const glob = (p: string) => new RegExp("^" + p.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
function simRedis(cmd: string[]): string {
  const [name, ...a] = cmd, e = REDIS_SIM[a[0]];
  switch (name) {
    case "GET": return e?.type === "string" ? String(e.v) : "";
    case "MGET": return a.map((k) => (REDIS_SIM[k]?.type === "string" ? String(REDIS_SIM[k].v) : "")).join("\n");
    case "HGETALL": return e?.type === "hash" ? Object.entries(e.v as Doc).flat().join("\n") : "";
    case "HGET": return e?.type === "hash" ? String((e.v as Doc)[a[1]] ?? "") : "";
    case "LRANGE": { const l = e?.type === "list" ? (e.v as string[]) : []; const s = Number(a[1]), t = Number(a[2]); return l.slice(s < 0 ? l.length + s : s, t < 0 ? l.length + t + 1 : t + 1).join("\n"); }
    case "SMEMBERS": return "";
    case "ZRANGE": { const z = e?.type === "zset" ? [...(e.v as string[][])].reverse() : []; const part = z.slice(Number(a[1]), Number(a[2]) < 0 ? undefined : Number(a[2]) + 1); return (a[3] ? part.flat() : part.map((x) => x[0])).join("\n"); }
    case "SCAN": { const mi = a.findIndex((x) => x.toUpperCase() === "MATCH"); const re = glob(mi > 0 ? a[mi + 1] : "*"); return ["0", ...Object.keys(REDIS_SIM).filter((k) => re.test(k))].join("\n"); }
    case "TYPE": return e?.type ?? "none";
    case "TTL": return e ? "-1" : "-2";
    case "EXISTS": return String(a.filter((k) => REDIS_SIM[k]).length);
    case "DBSIZE": return String(Object.keys(REDIS_SIM).length);
    case "INFO": return "# Memory\nused_memory:1048576\nused_memory_human:1.00M\nmaxmemory_policy:noeviction";
    default: { const v = e?.v; return Array.isArray(v) ? String(v.length) : v && typeof v === "object" ? String(Object.keys(v).length) : v !== undefined ? String(String(v).length) : "0"; }
  }
}

export class SimRunner implements DbqRunner {
  readonly name = "simulator" as const;
  async introspect(d: DbSpec, _database: string, o: { samples: string[] | null }): Promise<SchemaTable[]> {
    if (d.engine === "redis") return redisPatterns(Object.entries(REDIS_SIM).map(([k, e]) => [e.type, k]));
    if (d.engine === "mongodb") {
      return Object.entries(mongoDocs()).map(([name, docs]) => {
        const first = docs[0] ?? {};
        const s = samplesOf(docs.slice(0, 3));
        return { name, rows: docs.length, columns: Object.entries(first).map(([k, v]) => ({ name: k, type: Array.isArray(v) ? "array" : typeof v === "number" ? (k === "_id" ? "int" : "double") : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? "date" : typeof v, ...(o.samples && s.has(k) ? { samples: s.get(k) } : {}) })) };
      });
    }
    const tables = await readOnly(d.id, async (db) => {
      const r = await db.query<{ json_agg: string }>(PG_SCHEMA_SQL.replace("SELECT json_agg(t)::text FROM", "SELECT json_agg(t)::text AS json_agg FROM"));
      return (JSON.parse(r.rows[0]?.json_agg ?? "[]") as SchemaTable[]).map((t) => ({ ...t, rows: Number(t.rows) || 0 }));
    }, false);
    const picked = (o.samples ?? []).filter((n) => tables.some((t) => t.name === n)).slice(0, 10);
    if (picked.length) {
      const rows = await readOnly(d.id, async (db) => JSON.parse((await db.query<{ v: string }>(pgSamplesSql(picked).replace("SELECT json_agg(x)::text FROM", "SELECT json_agg(x)::text AS v FROM"))).rows[0]?.v ?? "[]") as { t: string; r: string }[]);
      for (const t of tables) {
        const s = samplesOf(rows.filter((r) => r.t === t.name).map((r) => JSON.parse(r.r) as Doc));
        for (const c of t.columns) if (s.has(c.name)) c.samples = s.get(c.name);
      }
    }
    return tables;
  }
  async run(d: DbSpec, req: RunReq): Promise<Raw> {
    if (req.lang === "redis") return mergeRedis(req.commands.map((cmd) => ({ cmd, raw: redisRows(cmd, simRedis(cmd)) })));
    if (req.lang === "mongo") return objectsToRaw(simAggregate(req.plan.collection, req.plan.pipeline));
    const sql = d.engine === "mysql" || d.engine === "mariadb" ? fromMysql(req.sql) : req.sql;
    return readOnly(d.id, async (db) => {
      const r = await db.query<unknown[]>(sql, [], { rowMode: "array" });
      return { columns: r.fields.map((f) => ({ name: f.name, type: typeOf(f.dataTypeID) })), rows: r.rows.map((row) => row.map(cellOf)) };
    });
  }
}

/* ---------- natural language → query, without a model ---------- */
export type SimAnswer = { query: string; explanation: string; chart: DbqChart };
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹", AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const norm = (s: string) => s.replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c))).replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c))).replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase();
export const isPersian = (s: string) => /[؀-ۿ]/.test(s);
const SYN: [RegExp, string[]][] = [
  [/مشتری|مشتریان|customer|client/, ["customers", "customer", "clients", "users"]],
  [/سفارش|order|خرید/, ["orders", "order"]],
  [/محصول|کالا|product|item/, ["products", "product", "items"]],
  [/کاربر|user|عضو/, ["users", "user", "members", "customers"]],
  [/پرداخت|payment|تراکنش|transaction/, ["payments", "transactions", "invoices"]],
  [/فروش|درآمد|sales|revenue|income/, ["orders", "sales", "invoices", "payments"]],
];
const base = (name: string) => name.split(".").pop()!.toLowerCase();
function findTable(q: string, tables: SchemaTable[], prefer?: RegExp): SchemaTable | undefined {
  for (const [re, names] of SYN) if ((!prefer || re.source === prefer.source) && re.test(q)) { const t = tables.find((x) => names.includes(base(x.name))); if (t) return t; }
  return tables.find((t) => q.includes(base(t.name)) || q.includes(base(t.name).replace(/s$/, "")));
}
const isNumType = (t: string) => /int|numeric|decimal|real|double|float|money|number/.test(t.toLowerCase());
const isDateType = (t: string) => /date|time/.test(t.toLowerCase());
const col = (t: SchemaTable | undefined, test: (c: SchemaTable["columns"][number]) => boolean) => t?.columns.find(test);
const amountCol = (t?: SchemaTable) => col(t, (c) => /^(total|amount|price|sum|revenue|grand_total|total_price|paid)$/.test(c.name.toLowerCase()) && (isNumType(c.type) || c.type === "double" || c.type === "int"));
const dateCol = (t?: SchemaTable) => col(t, (c) => /^(created_at|createdat|created|date|order_date|paid_at|timestamp|time)$/.test(c.name.toLowerCase())) ?? col(t, (c) => isDateType(c.type));
const GROUPS: [RegExp, RegExp][] = [[/شهر|city/, /^city$/], [/وضعیت|status/, /^status$/], [/دسته|category/, /^category$/], [/کشور|country/, /^country$/]];

/** a query for common questions over `tables`, or null when the question is not one of them */
export function simulateQuery(question: string, engine: string, tables: SchemaTable[]): SimAnswer | null {
  const q = norm(question), fa = isPersian(question);
  const mysql = engine === "mysql" || engine === "mariadb";
  const id = (s: string) => (mysql ? "`" + s.replace(/`/g, "``") + "`" : /^[a-z_][a-z0-9_]*$/.test(s) ? s : '"' + s.replace(/"/g, '""') + '"');
  const tbl = (t: SchemaTable) => (mysql ? id(t.name) : t.name.split(".").map(id).join("."));
  const n = Math.min(100, Math.max(1, Number(/(\d{1,3})/.exec(q)?.[1] ?? 10)));
  const days = /هفته|week|7 روز|۷ روز/.test(q) ? 7 : /ماه|month|30 روز/.test(q) ? 30 : /امروز|today/.test(q) ? 1 : /سال|year/.test(q) ? 365 : (/(\d{1,3}) ?(روز|day)/.exec(q) ? Number(/(\d{1,3}) ?(روز|day)/.exec(q)![1]) : 0);
  const since = (c: string) => (days ? " WHERE " + id(c) + " >= CURRENT_DATE - " + (mysql ? "INTERVAL " + days + " DAY" : "INTERVAL '" + days + " days'") : "");
  const period = days ? (fa ? (days === 7 ? " در هفته گذشته" : days === 30 ? " در ماه گذشته" : days === 1 ? " امروز" : " در " + days + " روز گذشته") : " in the last " + days + " days") : "";

  if (engine === "redis") {
    if (/info|حافظه|memory|وضعیت سرور/.test(q)) return { query: "INFO memory", explanation: fa ? "مصرف حافظه Redis از بخش memory فرمان INFO." : "Redis memory usage from INFO memory.", chart: { type: "table", x: "", y: "" } };
    const t = tables.find((x) => q.includes(x.name.split(":")[0])) ?? tables[0];
    const pat = t?.name ?? "*";
    return { query: "SCAN 0 MATCH " + pat + " COUNT 100", explanation: fa ? "کلیدهای منطبق بر الگوی " + pat + " با SCAN (بدون قفل کردن سرور)." : "Keys matching " + pat + " via SCAN (non-blocking).", chart: { type: "table", x: "", y: "" } };
  }

  const salesy = /فروش|درآمد|sales|revenue|income|مبلغ|amount/.test(q);
  const top = /بیشترین|برترین|پرفروش|top|most|best|largest|highest/.test(q);
  const listing = /لیست|فهرست|list|show me|نشان بده|نمایش/.test(q);
  const orders = findTable(q, tables, SYN[1][0]) ?? (salesy ? findTable(q, tables, SYN[5][0]) : undefined);
  const customers = findTable(q, tables, SYN[0][0]) ?? findTable(q, tables, SYN[3][0]);
  const products = findTable(q, tables, SYN[2][0]);

  if (engine === "mongodb") {
    const t = orders ?? findTable(q, tables);
    if (!t) return null;
    const dc = dateCol(t)?.name, ac = amountCol(t)?.name;
    if (/به تفکیک روز|روزانه|هر روز|by day|per day|daily/.test(q) && dc) {
      const pipeline = [{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$" + dc } }, value: salesy && ac ? { $sum: "$" + ac } : { $sum: 1 } } }, { $sort: { _id: -1 } }, { $limit: days || 30 }, { $sort: { _id: 1 } }];
      return { query: JSON.stringify({ collection: t.name, pipeline }, null, 1), explanation: fa ? (salesy && ac ? "مجموع " + ac : "تعداد اسناد") + " مجموعه " + t.name + " به تفکیک روز." : (salesy && ac ? "Sum of " + ac : "Document count") + " in " + t.name + " by day.", chart: { type: "line", x: "_id", y: "value" } };
    }
    const fk = col(t, (c) => (customers && customers !== t ? c.name === base(customers.name).replace(/s$/, "") + "_id" : /_id$/.test(c.name) && c.name !== "_id"));
    if (top && fk) {
      const pipeline = [{ $group: { _id: "$" + fk.name, count: { $sum: 1 }, ...(ac ? { total: { $sum: "$" + ac } } : {}) } }, { $sort: { count: -1 } }, { $limit: n }];
      return { query: JSON.stringify({ collection: t.name, pipeline }, null, 1), explanation: fa ? n + " " + fk.name + " با بیشترین تعداد سند در " + t.name + "." : "Top " + n + " " + fk.name + " by number of " + t.name + ".", chart: { type: "bar", x: "_id", y: "count" } };
    }
    const g = GROUPS.find(([re]) => re.test(q));
    const gt = (g && [t, ...tables].find((x) => col(x, (c) => g[1].test(c.name.toLowerCase())))) || undefined;
    const gc = g && gt && col(gt, (c) => g[1].test(c.name.toLowerCase()));
    if (gt && gc) return { query: JSON.stringify({ collection: gt.name, pipeline: [{ $group: { _id: "$" + gc.name, count: { $sum: 1 } } }, { $sort: { count: -1 } }] }, null, 1), explanation: fa ? "تعداد اسناد " + gt.name + " به تفکیک " + gc.name + "." : "Count of " + gt.name + " by " + gc.name + ".", chart: { type: "pie", x: "_id", y: "count" } };
    if (listing) return { query: JSON.stringify({ collection: t.name, pipeline: [{ $sort: { [dc ?? "_id"]: -1 } }, { $limit: 100 }] }, null, 1), explanation: fa ? "آخرین اسناد مجموعه " + t.name + "." : "Latest documents in " + t.name + ".", chart: { type: "table", x: "", y: "" } };
    return { query: JSON.stringify({ collection: t.name, pipeline: [{ $count: "count" }] }), explanation: fa ? "تعداد کل اسناد مجموعه " + t.name + "." : "Total documents in " + t.name + ".", chart: { type: "table", x: "", y: "" } };
  }

  // SQL
  const byDay = /به تفکیک روز|روزانه|هر روز|by day|per day|daily|each day/.test(q);
  if (orders && byDay && dateCol(orders)) {
    const dc = dateCol(orders)!.name, ac = amountCol(orders)?.name;
    const value = salesy && ac ? "SUM(" + id(ac) + ")" : "COUNT(*)";
    const sql = "SELECT CAST(" + id(dc) + " AS DATE) AS day, " + value + " AS " + (salesy && ac ? "sales" : "count") + " FROM " + tbl(orders) + since(dc) + " GROUP BY CAST(" + id(dc) + " AS DATE) ORDER BY day";
    return { query: sql, explanation: fa ? (salesy && ac ? "مجموع " + ac : "تعداد ردیف‌های") + " جدول " + orders.name + period + " به تفکیک روز." : (salesy && ac ? "Total " + ac : "Row count") + " of " + orders.name + period + " per day.", chart: { type: "line", x: "day", y: salesy && ac ? "sales" : "count" } };
  }
  if (top && customers && orders && customers !== orders) {
    const fk = col(orders, (c) => c.ref?.split(".")[0] === base(customers.name) || c.name.toLowerCase() === base(customers.name).replace(/s$/, "") + "_id");
    const pk = col(customers, (c) => !!c.pk)?.name ?? "id";
    const label = col(customers, (c) => /^(name|full_name|title|email|username)$/.test(c.name.toLowerCase()))?.name;
    const ac = amountCol(orders)?.name;
    if (fk) {
      const by = salesy && ac ? "total" : "orders";
      const sql = "SELECT c." + id(pk) + (label ? ", c." + id(label) : "") + ", COUNT(o." + id(fk.name) + ") AS orders" + (ac ? ", SUM(o." + id(ac) + ") AS total" : "") + " FROM " + tbl(customers) + " c JOIN " + tbl(orders) + " o ON o." + id(fk.name) + " = c." + id(pk) +
        (days && dateCol(orders) ? " WHERE o." + id(dateCol(orders)!.name) + " >= CURRENT_DATE - " + (mysql ? "INTERVAL " + days + " DAY" : "INTERVAL '" + days + " days'") : "") +
        " GROUP BY c." + id(pk) + (label ? ", c." + id(label) : "") + " ORDER BY " + by + " DESC LIMIT " + n;
      return { query: sql, explanation: fa ? n + " ردیف " + customers.name + " با بیشترین " + (by === "total" ? "مبلغ" : "تعداد") + " " + orders.name + period + "." : "Top " + n + " " + customers.name + " by " + (by === "total" ? "total amount" : "number") + " of " + orders.name + period + ".", chart: { type: "bar", x: label ?? pk, y: by } };
    }
  }
  // best-selling products: a line-items table pointing at the products table, summed by quantity
  if (top && products) {
    const items = tables.find((x) => x !== products && col(x, (c) => c.ref?.split(".")[0] === base(products.name)) && col(x, (c) => /^(qty|quantity|count)$/.test(c.name.toLowerCase())));
    if (items) {
      const fk = col(items, (c) => c.ref?.split(".")[0] === base(products.name))!, qty = col(items, (c) => /^(qty|quantity|count)$/.test(c.name.toLowerCase()))!;
      const pk = col(products, (c) => !!c.pk)?.name ?? "id", label = col(products, (c) => /^(title|name)$/.test(c.name.toLowerCase()))?.name;
      const sql = "SELECT p." + id(pk) + (label ? ", p." + id(label) : "") + ", SUM(i." + id(qty.name) + ") AS sold FROM " + tbl(products) + " p JOIN " + tbl(items) + " i ON i." + id(fk.name) + " = p." + id(pk) + " GROUP BY p." + id(pk) + (label ? ", p." + id(label) : "") + " ORDER BY sold DESC LIMIT " + n;
      return { query: sql, explanation: fa ? n + " ردیف " + products.name + " با بیشترین تعداد فروش (مجموع " + qty.name + " در " + items.name + ")." : "Top " + n + " " + products.name + " by quantity sold (sum of " + items.name + "." + qty.name + ").", chart: { type: "bar", x: label ?? pk, y: "sold" } };
    }
  }
  const t = orders ?? customers ?? findTable(q, tables);
  if (!t) return null;
  const g = GROUPS.find(([re]) => re.test(q));
  const gc = g && col(t, (c) => g[1].test(c.name.toLowerCase()));
  if (gc) {
    const ac = amountCol(t)?.name, dc = dateCol(t)?.name;
    const sql = "SELECT " + id(gc.name) + ", COUNT(*) AS count" + (salesy && ac ? ", SUM(" + id(ac) + ") AS total" : "") + " FROM " + tbl(t) + (dc ? since(dc) : "") + " GROUP BY " + id(gc.name) + " ORDER BY count DESC";
    return { query: sql, explanation: fa ? "تعداد ردیف‌های " + t.name + " به تفکیک " + gc.name + period + "." : "Count of " + t.name + " by " + gc.name + period + ".", chart: { type: "pie", x: gc.name, y: salesy && ac ? "total" : "count" } };
  }
  if (top) {
    const ac = amountCol(t)?.name ?? col(t, (c) => isNumType(c.type) && !c.pk && !c.ref)?.name;
    if (ac) {
      const label = col(t, (c) => /^(name|title|email)$/.test(c.name.toLowerCase()))?.name ?? col(t, (c) => !!c.pk)?.name ?? t.columns[0]?.name;
      return { query: "SELECT * FROM " + tbl(t) + " ORDER BY " + id(ac) + " DESC LIMIT " + n, explanation: fa ? n + " ردیف " + t.name + " با بیشترین " + ac + "." : "Top " + n + " " + t.name + " by " + ac + ".", chart: { type: "bar", x: label ?? "", y: ac } };
    }
  }
  if (listing) {
    const order = dateCol(t)?.name ?? col(t, (c) => !!c.pk)?.name;
    return { query: "SELECT * FROM " + tbl(t) + (order ? " ORDER BY " + id(order) + " DESC" : ""), explanation: fa ? "ردیف‌های جدول " + t.name + (order ? "، جدیدترین اول." : ".") : "Rows of " + t.name + (order ? ", newest first." : "."), chart: { type: "table", x: "", y: "" } };
  }
  if (salesy) {
    const ac = amountCol(t)?.name, dc = dateCol(t)?.name;
    if (ac) return { query: "SELECT SUM(" + id(ac) + ") AS total, COUNT(*) AS count FROM " + tbl(t) + (dc ? since(dc) : ""), explanation: fa ? "مجموع " + ac + " و تعداد ردیف‌های " + t.name + period + "." : "Total " + ac + " and row count of " + t.name + period + ".", chart: { type: "table", x: "", y: "" } };
  }
  const dc = dateCol(t)?.name;
  return { query: "SELECT COUNT(*) AS count FROM " + tbl(t) + (dc ? since(dc) : ""), explanation: fa ? "تعداد ردیف‌های جدول " + t.name + period + "." : "Number of rows in " + t.name + period + ".", chart: { type: "table", x: "", y: "" } };
}
