/* How «پرسش از دیتابیس» reaches a customer database, picked like dbaas(): on Kubernetes a command runs inside the
   database pod over the exec API (src/server/paas/exec.ts), with the client the image already ships (psql, mysql,
   mongosh, redis-cli); otherwise the simulator (./sim.ts) answers from a seeded demo database (PGlite).
   Read-only is enforced by the database itself, not only by ./validate.ts:
   - a dedicated login with read rights only, created lazily: PostgreSQL role gereh_ro (SELECT grants and default
     privileges, default_transaction_read_only, no password so it can only log in over the pod's local socket),
     MySQL/MariaDB 'gereh_ro'@'localhost' with SELECT, MongoDB gereh_ro with the read role, Redis ACL user gereh_ro
     limited to read commands;
   - every SQL query inside BEGIN TRANSACTION READ ONLY (MySQL: SET SESSION TRANSACTION READ ONLY + START TRANSACTION
     READ ONLY) with a statement timeout, always rolled back; MongoDB aggregate with maxTimeMS.
   Should the dedicated login be unavailable (an old server, a changed pg_hba), the main login runs the query in the
   same read-only transaction. */
import "server-only";
import { demoMode, unconfigured } from "../demo";
import { createHmac } from "node:crypto";
import { DBQ_LIMITS, type Cell } from "@/lib/dbquery";
import type { DbSpec } from "../paas/driver";
import type { ExecResult } from "../paas/exec";
import type { MongoPlan } from "./validate";

export type RawColumn = { name: string; type?: string };
export type Raw = { columns: RawColumn[]; rows: Cell[][]; note?: string };
export type SchemaColumn = { name: string; type: string; pk?: boolean; ref?: string; samples?: string[] };
export type SchemaTable = { name: string; rows: number; columns: SchemaColumn[] };
export type RunReq =
  | { lang: "sql"; database: string; sql: string }
  | { lang: "mongo"; database: string; plan: MongoPlan }
  | { lang: "redis"; database: string; commands: string[][] };

export interface DbqRunner {
  readonly name: "kubernetes" | "simulator";
  /** tables (collections, key patterns) with columns; sample values only when `samples` (for the named tables) */
  introspect(d: DbSpec, database: string, o: { samples: string[] | null }): Promise<SchemaTable[]>;
  /** runs an already validated, limited query read-only; never validates by itself */
  run(d: DbSpec, req: RunReq): Promise<Raw>;
}

export const RO_USER = "gereh_ro";
const T = DBQ_LIMITS.timeoutMs;
/** the read-only login's password: derived per database, never stored */
export const roPassword = (dbId: string) => createHmac("sha256", process.env.APP_SECRET || "gereh-dev-only-secret").update("dbq-ro:" + dbId).digest("base64url").slice(0, 32);

/* ---------- commands (exported for tests) ---------- */
const sh = (script: string, ...args: string[]) => ["/bin/sh", "-c", script, "sh", ...args];
const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const pgId = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const myId = (s: string) => "`" + s.replace(/`/g, "``") + "`";
const js = (v: unknown) => JSON.stringify(v);
export const MARK = "GEREH:";
const pgJson = (inner: string) => `SELECT '${MARK}' || translate(coalesce((${inner}), '[]'), E'\\n', ' ')`;
/** PostgreSQL's read-only frame: nothing in it can be committed */
export const PG_FRAME = `BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = '${T / 1000}s'; SET LOCAL idle_in_transaction_session_timeout = '${(T + 5000) / 1000}s'; SET LOCAL lock_timeout = '2s'; `;
export const pgQualified = (t: string) => { const i = t.indexOf("."); return i > 0 ? pgId(t.slice(0, i)) + "." + pgId(t.slice(i + 1)) : pgId(t); };

export const pgCmds = {
  ensureRo: (database: string) => sh('psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -c "$2"', database, [
    `DO $g$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RO_USER}') THEN CREATE ROLE ${RO_USER} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3; END IF; END $g$`,
    `ALTER ROLE ${RO_USER} PASSWORD NULL`,
    `ALTER ROLE ${RO_USER} SET default_transaction_read_only = on`,
    `ALTER ROLE ${RO_USER} SET statement_timeout = '${T / 1000}s'`,
    `GRANT CONNECT ON DATABASE ${pgId(database)} TO ${RO_USER}`,
    `DO $g$ DECLARE s text; BEGIN FOR s IN SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_%' LOOP EXECUTE format('GRANT USAGE ON SCHEMA %I TO ${RO_USER}', s); EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO ${RO_USER}', s); END LOOP; END $g$`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${RO_USER}`,
  ].join("; ")),
  /** the body runs in the read-only frame as gereh_ro (local socket, no password) or the main login; always rolled back */
  script: (database: string, body: string, ro: boolean) => sh(`psql -X -q -At -v ON_ERROR_STOP=1 -U ${ro ? RO_USER : '"$POSTGRES_USER"'} -d "$1" -c "$2"`, database, PG_FRAME + pgJson(body) + "; ROLLBACK"),
  run: (database: string, sql: string, ro: boolean) => pgCmds.script(database, `SELECT json_agg(_r)::text FROM (${sql}) _r`, ro),
  schema: (database: string) => pgCmds.script(database, PG_SCHEMA_SQL, false),
  samples: (database: string, tables: string[], ro: boolean) => pgCmds.script(database, pgSamplesSql(tables), ro),
};

/* the catalog query: tables, views, row estimates, columns with types, primary and foreign keys */
export const PG_SCHEMA_SQL = `SELECT json_agg(t)::text FROM (
  SELECT CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END AS name, greatest(c.reltuples, 0)::bigint AS rows,
    (SELECT json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'pk', EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p' AND a.attnum = ANY (k.conkey)),
      'ref', (SELECT CASE WHEN fn.nspname = 'public' THEN fc.relname ELSE fn.nspname || '.' || fc.relname END || '.' || fa.attname
        FROM pg_constraint k JOIN pg_class fc ON fc.oid = k.confrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
        JOIN pg_attribute fa ON fa.attrelid = k.confrelid AND fa.attnum = k.confkey[array_position(k.conkey, a.attnum)]
        WHERE k.conrelid = c.oid AND k.contype = 'f' AND a.attnum = ANY (k.conkey) LIMIT 1)) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'v', 'm', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
  ORDER BY c.reltuples DESC, 1 LIMIT 200) t`;
/** three rows per table, as JSON text per row */
export const pgSamplesSql = (tables: string[]) => `SELECT json_agg(x)::text FROM (${tables.map((t) => `SELECT ${lit(t)} AS t, row_to_json(s)::text AS r FROM (SELECT * FROM ${pgQualified(t)} LIMIT 3) s`).join(" UNION ALL ")}) x`;

const myCli = (d: Pick<DbSpec, "engine">) => (d.engine === "mariadb" ? "mariadb" : "mysql");
const myRoot = (d: Pick<DbSpec, "engine">) => (d.engine === "mariadb" ? "$MARIADB_ROOT_PASSWORD" : "$MYSQL_ROOT_PASSWORD");
const myTimeout = (d: Pick<DbSpec, "engine">) => (d.engine === "mariadb" ? `SET SESSION max_statement_time = ${T / 1000}; ` : `SET SESSION max_execution_time = ${T}; `);
export const MY_FRAME = (d: Pick<DbSpec, "engine">) => "SET SESSION TRANSACTION READ ONLY; " + myTimeout(d) + "START TRANSACTION READ ONLY; ";
export const myCmds = {
  ensureRo: (d: Pick<DbSpec, "engine" | "id">, database: string) => sh(`MYSQL_PWD="${myRoot(d)}" ${myCli(d)} -uroot -B -N -e "$1"`, [
    `CREATE USER IF NOT EXISTS '${RO_USER}'@'localhost' IDENTIFIED BY ${lit(roPassword(d.id))}`,
    `ALTER USER '${RO_USER}'@'localhost' IDENTIFIED BY ${lit(roPassword(d.id))} WITH MAX_USER_CONNECTIONS 3`,
    `GRANT SELECT, SHOW VIEW ON ${myId(database)}.* TO '${RO_USER}'@'localhost'`,
  ].join("; ")),
  run: (d: Pick<DbSpec, "engine" | "id">, database: string, sql: string, ro: boolean) => ro
    ? sh(`MYSQL_PWD="$1" ${myCli(d)} -u${RO_USER} -B -e "$2" "$3"`, roPassword(d.id), MY_FRAME(d) + sql + "; ROLLBACK", database)
    : sh(`MYSQL_PWD="${myRoot(d)}" ${myCli(d)} -uroot -B -e "$1" "$2"`, MY_FRAME(d) + sql + "; ROLLBACK", database),
  schema: (d: Pick<DbSpec, "engine">, database: string) => sh(`MYSQL_PWD="${myRoot(d)}" ${myCli(d)} -uroot -B -N -e "$1"`, MY_FRAME(d) +
    "SELECT c.TABLE_NAME, IFNULL(t.TABLE_ROWS, 0), c.COLUMN_NAME, c.COLUMN_TYPE, c.COLUMN_KEY, IFNULL(CONCAT(k.REFERENCED_TABLE_NAME, '.', k.REFERENCED_COLUMN_NAME), '') " +
    "FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME " +
    "LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL " +
    `WHERE c.TABLE_SCHEMA = ${lit(database)} ORDER BY t.TABLE_ROWS DESC, c.TABLE_NAME, c.ORDINAL_POSITION LIMIT 3000; ROLLBACK`),
  sample: (d: Pick<DbSpec, "engine" | "id">, database: string, table: string, ro: boolean) => myCmds.run(d, database, `SELECT * FROM ${myId(table)} LIMIT 3`, ro),
};

const MONGO_ROOT = 'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "$1"';
const MONGO_RO = `mongosh --quiet -u ${RO_USER} -p "$1" --authenticationDatabase admin --eval "$2"`;
export const mongoCmds = {
  ensureRo: (dbId: string, database: string) => sh(MONGO_ROOT, `const a = db.getSiblingDB("admin"); const pw = ${js(roPassword(dbId))}; const want = { role: "read", db: ${js(database)} };
const u = a.getUser(${js(RO_USER)});
if (!u) a.createUser({ user: ${js(RO_USER)}, pwd: pw, roles: [want] });
else a.updateUser(${js(RO_USER)}, { pwd: pw, roles: [...u.roles.filter((r) => r.role === "read" && r.db !== want.db), want] });
print("OK")`),
  schema: (dbId: string, database: string, samples: boolean, ro: boolean) => {
    const script = `const d = db.getSiblingDB(${js(database)}); const out = [];
for (const c of d.getCollectionInfos({ type: "collection" }, { nameOnly: true }).slice(0, 100)) {
  const coll = d.getCollection(c.name); const fields = {};
  for (const doc of coll.aggregate([{ $sample: { size: 20 } }], { maxTimeMS: 5000 }).toArray()) for (const [k, v] of Object.entries(doc)) {
    const t = v === null ? "null" : Array.isArray(v) ? "array" : v instanceof Date ? "date" : v && v._bsontype ? v._bsontype : typeof v;
    const f = (fields[k] ??= { types: [], samples: [] }); if (!f.types.includes(t)) f.types.push(t);
    if (${samples} && f.samples.length < 3 && (v === null || typeof v !== "object" || v instanceof Date)) f.samples.push(String(v).slice(0, 40));
  }
  out.push({ name: c.name, rows: coll.estimatedDocumentCount(), columns: Object.entries(fields).slice(0, 40).map(([k, f]) => ({ name: k, type: f.types.join("|"), samples: f.samples })) });
}
print(${js(MARK)} + EJSON.stringify(out, { relaxed: true }))`;
    return ro ? sh(MONGO_RO, roPassword(dbId), script) : sh(MONGO_ROOT, script);
  },
  run: (dbId: string, database: string, p: MongoPlan, ro: boolean) => {
    // the pipeline travels as JSON text and is parsed as data, never evaluated as code
    const script = `print(${js(MARK)} + EJSON.stringify(db.getSiblingDB(${js(database)}).getCollection(${js(p.collection)}).aggregate(EJSON.parse(${js(JSON.stringify(p.pipeline))}), { maxTimeMS: ${T} }).toArray(), { relaxed: true }))`;
    return ro ? sh(MONGO_RO, roPassword(dbId), script) : sh(MONGO_ROOT, script);
  },
};

export const REDIS_RO_CMDS = ["get", "mget", "hget", "hgetall", "lrange", "smembers", "zrange", "scan", "type", "ttl", "info", "exists", "strlen", "llen", "scard", "zcard", "hlen", "dbsize", "ping"];
export const redisCmds = {
  ensureRo: (dbId: string) => sh('redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ACL SETUSER ' + RO_USER + ' reset on ">$1" "~*" "-@all" ' + REDIS_RO_CMDS.map((c) => "+" + c).join(" "), roPassword(dbId)),
  run: (dbId: string, cmd: string[], ro: boolean) => ro
    ? sh(`p="$1"; shift; redis-cli --user ${RO_USER} --pass "$p" --no-auth-warning --raw "$@"`, roPassword(dbId), ...cmd)
    : sh('redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --raw "$@"', ...cmd),
  keys: () => sh('redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --count 200 | head -n 200 | while IFS= read -r k; do printf "%s\\t%s\\n" "$(redis-cli -a "$REDIS_PASSWORD" --no-auth-warning TYPE "$k")" "$k"; done'),
};

/* ---------- parsing ---------- */
/** the JSON after the marker line */
export function marked<T>(out: string): T {
  const line = out.split("\n").reverse().find((l) => l.startsWith(MARK));
  if (line === undefined) throw new Error("unexpected output from the database client");
  return JSON.parse(line.slice(MARK.length)) as T;
}
/** `mysql -B` output: tab-separated, \t \n \\ escaped, NULL */
export function tsv(out: string, header: boolean): { columns: string[]; rows: (string | null)[][] } {
  const unesc = (v: string) => (v === "NULL" ? null : v.replace(/\\(.)/g, (_, c: string) => ({ t: "\t", n: "\n", "\\": "\\", "0": "\0" } as Record<string, string>)[c] ?? c));
  const rows = out.split("\n").filter((l) => l.length).map((l) => l.split("\t").map(unesc));
  return header ? { columns: (rows.shift() ?? []).map((c) => c ?? ""), rows } : { columns: [], rows };
}
/** documents (or JSON row objects) as a grid: the union of top-level keys, nested values as JSON text */
export function objectsToRaw(list: Record<string, unknown>[]): Raw {
  const names: string[] = [];
  for (const o of list) for (const k of Object.keys(o ?? {})) if (!names.includes(k) && names.length < 60) names.push(k);
  const cell = (v: unknown): Cell => (v === undefined || v === null ? null : typeof v === "object" ? JSON.stringify(v) : (v as Cell));
  return { columns: names.map((name) => ({ name })), rows: list.map((o) => names.map((k) => cell(o?.[k]))) };
}
/** redis-cli --raw output of one command as rows */
export function redisRows(cmd: string[], out: string): Raw {
  const name = cmd[0].toUpperCase();
  const lines = out.replace(/\n$/, "").split("\n");
  if (/^(ERR|WRONGTYPE|NOPERM|NOAUTH)/.test(lines[0] ?? "")) throw new Error(lines[0]);
  switch (name) {
    case "HGETALL": { const rows: Cell[][] = []; for (let i = 0; i + 1 < lines.length; i += 2) rows.push([lines[i], lines[i + 1]]); return { columns: [{ name: "field" }, { name: "value" }], rows }; }
    case "ZRANGE": if (cmd.some((a) => a.toUpperCase() === "WITHSCORES")) { const rows: Cell[][] = []; for (let i = 0; i + 1 < lines.length; i += 2) rows.push([lines[i], lines[i + 1]]); return { columns: [{ name: "member" }, { name: "score" }], rows }; }
      return { columns: [{ name: "member" }], rows: lines.filter((l) => l !== "").map((l) => [l]) };
    case "LRANGE": case "SMEMBERS": return { columns: [{ name: "value" }], rows: lines.filter((l, i) => l !== "" || i < lines.length - 1).map((l) => [l]) };
    case "MGET": return { columns: [{ name: "key" }, { name: "value" }], rows: cmd.slice(1).map((k, i) => [k, lines[i] === "" ? null : lines[i] ?? null]) };
    case "SCAN": return { columns: [{ name: "key" }], rows: lines.slice(1).filter(Boolean).map((l) => [l]), note: "cursor بعدی: " + (lines[0] || "0") };
    case "INFO": return { columns: [{ name: "name" }, { name: "value" }], rows: lines.map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes(":")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1)]) };
    default: return { columns: [{ name: "key" }, { name: "value" }], rows: [[cmd[1] ?? name.toLowerCase(), lines.join("\n") === "" ? null : lines.join("\n")]] };
  }
}
/** several commands: one grid with the command in front */
export function mergeRedis(parts: { cmd: string[]; raw: Raw }[]): Raw {
  if (parts.length === 1) return parts[0].raw;
  const rows: Cell[][] = [];
  for (const p of parts) for (const r of p.raw.rows) rows.push([p.cmd.join(" ").slice(0, 80), r.length > 1 ? r[0] : null, r.length > 1 ? r.slice(1).join(" ") : r[0]]);
  return { columns: [{ name: "command" }, { name: "item" }, { name: "value" }], rows, note: parts.map((p) => p.raw.note).filter(Boolean).join("؛ ") || undefined };
}
/** a key's pattern: numbers, UUIDs and long hex runs become * */
export const keyPattern = (k: string) => k.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "*").replace(/\b[0-9a-f]{16,}\b/gi, "*").replace(/\d+/g, "*");
export function redisPatterns(pairs: [string, string][]): SchemaTable[] {
  const by = new Map<string, { n: number; types: Set<string> }>();
  for (const [type, key] of pairs) { const p = keyPattern(key); const e = by.get(p) ?? { n: 0, types: new Set() }; e.n++; e.types.add(type); by.set(p, e); }
  return [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 60).map(([name, e]) => ({ name, rows: e.n, columns: [...e.types].map((t) => ({ name: "(" + t + ")", type: t })) }));
}
/** three values per column from sample rows */
export function samplesOf(rows: Record<string, unknown>[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    const list = out.get(k) ?? [];
    const s = String(v).slice(0, 40);
    if (list.length < 3 && !list.includes(s)) list.push(s);
    out.set(k, list);
  }
  return out;
}

/* ---------- Kubernetes ---------- */
export type ExecFn = (d: DbSpec, cmd: string[], o: { timeoutMs: number; maxOut: number }) => Promise<ExecResult>;
const podExecFn: ExecFn = async (d, cmd, o) => {
  const [{ nsOf, dbName }, { podExec }] = await Promise.all([import("../paas/kubernetes"), import("../paas/exec")]);
  return podExec(nsOf(d.userId), dbName(d) + "-0", "db", cmd, o);
};
const clean = (s: string) => s.split("\n").filter((l) => l.trim() && !/Using a password on the command line|Warning: Using a password/.test(l)).slice(-4).join("\n").slice(0, 500);
const isAuthError = (m: string) => /password authentication|no password supplied|role "gereh_ro" does not exist|Access denied for user 'gereh_ro'|Authentication failed|WRONGPASS|NOAUTH|peer authentication/i.test(m);

export class KubeRunner implements DbqRunner {
  readonly name = "kubernetes" as const;
  /** per database: until when the read-only login is known to be set up, or false when it cannot be */
  private ro = new Map<string, number | false>();
  constructor(private exec: ExecFn = podExecFn) {}

  private async x(d: DbSpec, cmd: string[], timeoutMs = T + 10_000) {
    const r = await this.exec(d, cmd, { timeoutMs, maxOut: 8 * DBQ_LIMITS.bytes });
    if (r.code !== 0) throw new Error(clean(r.stderr || r.stdout) || "the database client exited with code " + r.code);
    if (d.engine === "redis" && /^(ERR|NOPERM|WRONGPASS|NOAUTH)/m.test(r.stdout)) throw new Error(clean(r.stdout));
    return r.stdout;
  }
  /** sets up the read-only login once per 30 minutes per database; false when it cannot be used */
  private async readOnlyLogin(d: DbSpec, database: string): Promise<boolean> {
    const key = d.id + "/" + (d.engine === "redis" ? "" : database);
    const s = this.ro.get(key);
    if (s === false) return false;
    if (s && s > Date.now()) return true;
    try {
      const cmd = d.engine === "postgres" ? pgCmds.ensureRo(database) : d.engine === "mongodb" ? mongoCmds.ensureRo(d.id, database) : d.engine === "redis" ? redisCmds.ensureRo(d.id) : myCmds.ensureRo(d, database);
      const out = await this.x(d, cmd, 30_000);
      if (d.engine === "redis" && !/OK/.test(out)) throw new Error(out);
      this.ro.set(key, Date.now() + 30 * 60_000);
      return true;
    } catch (e) {
      console.warn("[dbquery] read-only login unavailable for", d.id, (e as Error).message.slice(0, 200));
      this.ro.set(key, false);
      return false;
    }
  }
  /** runs as the read-only login; if that login cannot authenticate, once more as the main login (same read-only frame) */
  private async withRo<T>(d: DbSpec, database: string, f: (ro: boolean) => Promise<T>): Promise<T> {
    const ro = await this.readOnlyLogin(d, database);
    try { return await f(ro); } catch (e) {
      if (!ro || !isAuthError((e as Error).message)) throw e;
      this.ro.set(d.id + "/" + (d.engine === "redis" ? "" : database), false);
      return f(false);
    }
  }

  async introspect(d: DbSpec, database: string, o: { samples: string[] | null }): Promise<SchemaTable[]> {
    switch (d.engine) {
      case "postgres": {
        const out = await this.x(d, pgCmds.schema(database));
        const tables = marked<SchemaTable[]>(out).map((t) => ({ ...t, rows: Number(t.rows) || 0, columns: t.columns ?? [] }));
        if (o.samples?.length) {
          const picked = o.samples.filter((n) => tables.some((t) => t.name === n)).slice(0, 10);
          const rows = picked.length ? await this.withRo(d, database, async (ro) => marked<{ t: string; r: string }[] | null>(await this.x(d, pgCmds.samples(database, picked, ro))) ?? []) : [];
          for (const t of tables) {
            const s = samplesOf(rows.filter((r) => r.t === t.name).map((r) => JSON.parse(r.r) as Record<string, unknown>));
            for (const c of t.columns) if (s.has(c.name)) c.samples = s.get(c.name);
          }
        }
        return tables;
      }
      case "mysql": case "mariadb": {
        const g = tsv(await this.x(d, myCmds.schema(d, database)), false);
        const tables: SchemaTable[] = [];
        for (const [name, rows, col, type, key, ref] of g.rows) {
          let t = tables.find((x) => x.name === name);
          if (!t) { if (tables.length >= 200) continue; tables.push((t = { name: name ?? "", rows: Number(rows) || 0, columns: [] })); }
          t.columns.push({ name: col ?? "", type: type ?? "", ...(key === "PRI" ? { pk: true } : {}), ...(ref ? { ref } : {}) });
        }
        for (const name of (o.samples ?? []).filter((n) => tables.some((t) => t.name === n)).slice(0, 8)) {
          const g2 = await this.withRo(d, database, async (ro) => tsv(await this.x(d, myCmds.sample(d, database, name, ro)), true)).catch(() => null);
          if (!g2) continue;
          const s = samplesOf(g2.rows.map((r) => Object.fromEntries(g2.columns.map((c, i) => [c, r[i]]))));
          for (const c of tables.find((t) => t.name === name)!.columns) if (s.has(c.name)) c.samples = s.get(c.name);
        }
        return tables;
      }
      case "mongodb": return this.withRo(d, database, async (ro) => marked<SchemaTable[]>(await this.x(d, mongoCmds.schema(d.id, database, !!o.samples, ro))));
      case "redis": {
        const out = await this.x(d, redisCmds.keys(), 30_000);
        return redisPatterns(out.split("\n").filter((l) => l.includes("\t")).map((l) => [l.slice(0, l.indexOf("\t")), l.slice(l.indexOf("\t") + 1)] as [string, string]));
      }
      default: throw new Error("engine not supported: " + d.engine);
    }
  }

  async run(d: DbSpec, req: RunReq): Promise<Raw> {
    switch (req.lang) {
      case "sql": {
        if (d.engine === "postgres") return this.withRo(d, req.database, async (ro) => {
          const list = marked<Record<string, unknown>[] | null>(await this.x(d, pgCmds.run(req.database, req.sql, ro))) ?? [];
          return objectsToRaw(list);
        });
        return this.withRo(d, req.database, async (ro) => {
          const g = tsv(await this.x(d, myCmds.run(d, req.database, req.sql, ro)), true);
          return { columns: g.columns.map((name) => ({ name })), rows: g.rows };
        });
      }
      case "mongo": return this.withRo(d, req.database, async (ro) => objectsToRaw(marked<Record<string, unknown>[]>(await this.x(d, mongoCmds.run(d.id, req.database, req.plan, ro)))));
      case "redis": return this.withRo(d, "", async (ro) => {
        const parts: { cmd: string[]; raw: Raw }[] = [];
        for (const cmd of req.commands) parts.push({ cmd, raw: redisRows(cmd, await this.x(d, redisCmds.run(d.id, cmd, ro))) });
        return mergeRedis(parts);
      });
    }
  }
}

let cached: DbqRunner | null = null;
/** the configured runner (Kubernetes when PAAS_K8S_API + PAAS_K8S_TOKEN are set, else the simulator) */
export async function dbqRunner(): Promise<DbqRunner> {
  if (!cached) cached = process.env.PAAS_K8S_API && process.env.PAAS_K8S_TOKEN ? new KubeRunner() : demoMode() ? new (await import("./sim")).SimRunner() : unconfigured<DbqRunner>("اجرای کوئری روی کلاستر (Kubernetes)");
  return cached;
}
export const setDbqRunner = (r: DbqRunner | null) => { cached = r; };
