/* The validator every «پرسش از دیتابیس» query passes before it runs, whether the model wrote it or the person edited
   it. It is the second wall: the database itself enforces read-only (a SELECT-only role and a READ ONLY transaction,
   ./runner.ts). SQL is lexed (comments stripped, strings and quoted names kept whole) and what runs is the stripped
   text that was checked; MongoDB pipelines are walked key by key; Redis commands come from an allowlist. */
import "server-only";
import { DBQ_LIMITS } from "@/lib/dbquery";

export type Dialect = "postgres" | "mysql";
type Tok = { t: "word" | "num" | "str" | "qid" | "op"; v: string; s: number; e: number; depth: number };
export type SqlOk = { ok: true; sql: string };
export type Bad = { ok: false; error: string };

const bad = (error: string): Bad => ({ ok: false, error });

/** tokens and the comment-free text they index into */
export function lexSql(src: string, dialect: Dialect): { tokens: Tok[]; text: string } | Bad {
  const tokens: Tok[] = [];
  let out = "", i = 0, depth = 0;
  const n = src.length;
  const push = (t: Tok["t"], raw: string, v = raw) => { tokens.push({ t, v, s: out.length, e: out.length + raw.length, depth }); out += raw; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "\\") return bad("نویسه \\ در کوئری مجاز نیست.");
    if (/\s/.test(c)) { if (!out.endsWith(" ")) out += " "; i++; continue; }
    if (c === "-" && d === "-" || dialect === "mysql" && c === "#") {
      while (i < n && src[i] !== "\n") i++;
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    if (c === "/" && d === "*") {
      // PostgreSQL nests block comments; MySQL ends at the first */ (and runs /*! … */, which stripping removes)
      let level = 1;
      i += 2;
      while (i < n && level > 0) {
        if (dialect === "postgres" && src[i] === "/" && src[i + 1] === "*") { level++; i += 2; continue; }
        if (src[i] === "*" && src[i + 1] === "/") { level--; i += 2; continue; }
        i++;
      }
      if (level > 0) return bad("توضیح (کامنت) کوئری بسته نشده است.");
      if (!out.endsWith(" ")) out += " ";
      continue;
    }
    if (c === "'" || c === '"' || (c === "`" && dialect === "mysql")) {
      let j = i + 1;
      for (;;) {
        if (j >= n) return bad("رشته یا نام نقل‌قول‌شده بسته نشده است.");
        if (src[j] === c) { if (src[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      const raw = src.slice(i, j + 1);
      const inner = raw.slice(1, -1).split(c + c).join(c);
      push(c === "'" || (c === '"' && dialect === "mysql") ? "str" : "qid", raw, inner);
      i = j + 1;
      continue;
    }
    if (c === "$" && dialect === "postgres") return bad("رشته‌های $$ و پارامترهای $ مجاز نیستند.");
    if (c === "`") return bad("نویسه ` در PostgreSQL مجاز نیست؛ برای نام‌ها از \" استفاده کنید.");
    if (dialect === "mysql" && c === "@") return bad("متغیرهای @ مجاز نیستند.");
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\u0080-￿]/.test(src[j])) j++;
      push("word", src.slice(i, j), src.slice(i, j).toLowerCase());
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(d ?? ""))) {
      let j = i + 1;
      while (j < n && /[\d.eE]/.test(src[j]) || (j < n && /[+-]/.test(src[j]) && /[eE]/.test(src[j - 1]))) j++;
      push("num", src.slice(i, j));
      i = j;
      continue;
    }
    if (c === ":" && d === "=") return bad("عملگر := مجاز نیست.");
    if (c === "(") { push("op", c); depth++; i++; continue; }
    if (c === ")") { depth--; if (depth < 0) return bad("پرانتزهای کوئری جفت نیستند."); push("op", c); i++; continue; }
    push("op", c);
    i++;
  }
  if (depth !== 0) return bad("پرانتزهای کوئری جفت نیستند.");
  return { tokens, text: out };
}

/* statements and clauses that change data, schema, sessions or files */
const DENY_WORDS = new Set([
  "insert", "update", "delete", "merge", "upsert", "truncate", "create", "alter", "drop", "grant", "revoke", "copy", "vacuum", "analyze", "analyse",
  "cluster", "reindex", "refresh", "call", "do", "execute", "prepare", "deallocate", "lock", "unlock", "set", "reset",
  "begin", "commit", "rollback", "savepoint", "into", "outfile", "dumpfile", "procedure",
]);
const DENY_PAIRS: [string, string][] = [["comment", "on"], ["start", "transaction"], ["for", "share"], ["share", "mode"], ["replace", "into"], ["for", "key"], ["load", "data"], ["load", "xml"], ["rename", "table"]];
/* functions that read files, open connections, sleep, take locks, write sequences or run a SQL string */
const DENY_FN = /^(pg_(?!typeof$|size_pretty$|column_size$|relation_size$|total_relation_size$|table_size$|indexes_size$).*|lo_\w+|dblink\w*|set_config|nextval|setval|currval|lastval|txid_current\w*|query_to_xml\w*|cursor_to_xml\w*|table_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|xml_is_well_formed\w*|sleep|benchmark|load_file|get_lock|release_lock|release_all_locks|is_free_lock|is_used_lock|master_pos_wait|source_pos_wait|sys_exec|sys_eval|current_setting_set|make_set_config|ts_stat|gtsvector_\w*|binary_upgrade_\w*)$/;

/** null when `q` may run as one read-only statement, with the text that runs (comments stripped) */
export function checkSql(q: string, dialect: Dialect): SqlOk | Bad {
  if (!q.trim()) return bad("کوئری خالی است.");
  if (q.length > DBQ_LIMITS.queryChars) return bad("کوئری بیش از حد طولانی است.");
  const lx = lexSql(q, dialect);
  if ("ok" in lx) return lx;
  let toks = lx.tokens;
  // one optional trailing ; (or several), never one in the middle
  while (toks.length && toks.at(-1)!.t === "op" && toks.at(-1)!.v === ";") toks = toks.slice(0, -1);
  if (!toks.length) return bad("کوئری خالی است.");
  if (toks.some((t) => t.t === "op" && t.v === ";")) return bad("فقط یک دستور مجاز است؛ چند دستور با «;» پشت سر هم اجرا نمی‌شود.");
  if (toks.length > 4000) return bad("کوئری بیش از حد طولانی است.");
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], next = toks[k + 1];
    if (t.t === "word" && DENY_WORDS.has(t.v)) return bad("«" + t.v.toUpperCase() + "» مجاز نیست؛ فقط خواندن داده ممکن است.");
    if (t.t === "word" && next?.t === "word" && DENY_PAIRS.some(([a, b]) => a === t.v && b === next.v)) return bad("«" + t.v.toUpperCase() + " " + next.v.toUpperCase() + "» مجاز نیست.");
    // a function call, by plain or quoted name (also schema-qualified: the name is the word before "(")
    if ((t.t === "word" || t.t === "qid" || (t.t === "str" && dialect === "mysql")) && next?.t === "op" && next.v === "(" && DENY_FN.test(t.v.toLowerCase())) return bad("تابع «" + t.v + "» مجاز نیست.");
  }
  const first = toks.find((t) => !(t.t === "op" && t.v === "("));
  if (!first || first.t !== "word" || (first.v !== "select" && first.v !== "with")) return bad("فقط کوئری خواندنی (SELECT یا WITH) مجاز است.");
  const text = lx.text.slice(0, toks.at(-1)!.e).trim();
  return { ok: true, sql: text };
}

/** the top-level LIMIT lowered to `cap` (or added); `sql` must have passed checkSql */
export function enforceLimit(sql: string, dialect: Dialect, cap: number): string {
  const lx = lexSql(sql, dialect);
  if ("ok" in lx) return sql;
  const toks = lx.tokens, text = lx.text;
  const top = (k: number) => toks[k].depth === 0;
  let li = -1;
  for (let k = toks.length - 1; k >= 0; k--) if (top(k) && toks[k].t === "word" && toks[k].v === "limit") { li = k; break; }
  const splice = (t: Tok, v: string) => text.slice(0, t.s) + v + text.slice(t.e);
  if (li >= 0) {
    const a = toks[li + 1], comma = toks[li + 2], b = toks[li + 3];
    // MySQL LIMIT offset, count
    const count = a?.t === "num" && comma?.t === "op" && comma.v === "," && b?.t === "num" ? b : a;
    if (count?.t === "num") return Number(count.v) > cap ? splice(count, String(cap)).trim() : text.trim();
    if (count?.t === "word" && count.v === "all") return splice(count, String(cap)).trim();
  }
  // FETCH FIRST n ROWS ONLY
  for (let k = toks.length - 1; k >= 0; k--) {
    if (top(k) && toks[k].t === "word" && toks[k].v === "fetch") {
      const n = toks.slice(k + 1, k + 4).find((t) => t.t === "num");
      if (n) return Number(n.v) > cap ? splice(n, String(cap)).trim() : text.trim();
    }
  }
  return text.trim() + " LIMIT " + cap;
}

/* ---------- MongoDB ---------- */
export type MongoPlan = { collection: string; pipeline: Record<string, unknown>[] };
const STAGES = new Set(["$match", "$project", "$group", "$sort", "$limit", "$skip", "$unwind", "$count", "$addFields", "$set", "$unset", "$lookup", "$facet",
  "$bucket", "$bucketAuto", "$sortByCount", "$replaceRoot", "$replaceWith", "$sample", "$unionWith", "$graphLookup", "$densify", "$fill", "$setWindowFields"]);
const MONGO_DENY = new Set(["$out", "$merge", "$function", "$where", "$accumulator", "$currentOp", "$listSessions", "$listLocalSessions", "$planCacheStats", "$collStats", "$indexStats", "$documents", "$changeStream", "$listSearchIndexes", "$queryStats"]);
export const COLL_RE = /^[A-Za-z_][\w.-]{0,119}$/;

/** the pipeline as JSON text ({"collection": …, "pipeline": [...]}) checked stage by stage; nested pipelines too */
export function checkMongo(text: string): ({ ok: true } & MongoPlan) | Bad {
  if (text.length > DBQ_LIMITS.queryChars) return bad("کوئری بیش از حد طولانی است.");
  let v: unknown;
  try { v = JSON.parse(text); } catch { return bad("کوئری MongoDB باید JSON معتبر باشد: {\"collection\": \"…\", \"pipeline\": [ … ]}"); }
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad("کوئری MongoDB باید یک شیء با collection و pipeline باشد.");
  const { collection, pipeline } = v as { collection?: unknown; pipeline?: unknown };
  if (typeof collection !== "string" || !COLL_RE.test(collection) || collection.startsWith("system.")) return bad("نام مجموعه (collection) معتبر نیست.");
  const err = checkPipeline(pipeline, 0);
  if (err) return bad(err);
  return { ok: true, collection, pipeline: pipeline as Record<string, unknown>[] };
}
function checkPipeline(p: unknown, depth: number): string | null {
  if (!Array.isArray(p)) return "pipeline باید آرایه‌ای از مرحله‌ها باشد.";
  if (p.length > 20) return "حداکثر ۲۰ مرحله در pipeline.";
  if (depth > 3) return "pipelineهای تودرتو بیش از حد عمیق‌اند.";
  for (const st of p) {
    if (!st || typeof st !== "object" || Array.isArray(st) || Object.keys(st).length !== 1) return "هر مرحله باید یک شیء با یک کلید باشد، مثل {\"$match\": {…}}.";
    const [k, body] = Object.entries(st)[0];
    if (MONGO_DENY.has(k)) return "مرحله «" + k + "» مجاز نیست؛ فقط خواندن داده ممکن است.";
    if (!STAGES.has(k)) return "مرحله «" + k + "» پشتیبانی نمی‌شود.";
    const deep = denyKey(body, 0);
    if (deep) return "«" + deep + "» مجاز نیست.";
    // pipelines inside $lookup, $facet and $unionWith follow the same rules
    if ((k === "$lookup" || k === "$unionWith") && body && typeof body === "object" && "pipeline" in body) { const e = checkPipeline((body as { pipeline: unknown }).pipeline, depth + 1); if (e) return e; }
    if (k === "$facet" && body && typeof body === "object") for (const sub of Object.values(body)) { const e = checkPipeline(sub, depth + 1); if (e) return e; }
  }
  return null;
}
/** the first forbidden operator anywhere inside a value */
function denyKey(v: unknown, depth: number): string | null {
  if (depth > 40) return "تودرتویی بیش از حد";
  if (Array.isArray(v)) { for (const x of v) { const r = denyKey(x, depth + 1); if (r) return r; } return null; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (MONGO_DENY.has(k)) return k;
      const r = denyKey(x, depth + 1);
      if (r) return r;
    }
  }
  return null;
}
/** the pipeline with a final $limit of at most `cap` */
export const mongoLimited = (p: MongoPlan, cap: number): MongoPlan => ({ collection: p.collection, pipeline: [...p.pipeline, { $limit: cap }] });

/* ---------- Redis ---------- */
type RedisRule = { min: number; max: number; check?: (args: string[]) => string | null };
const int = (s: string | undefined) => s !== undefined && /^-?\d{1,12}$/.test(s);
const REDIS: Record<string, RedisRule> = {
  GET: { min: 1, max: 1 }, MGET: { min: 1, max: 50 }, HGET: { min: 2, max: 2 }, HGETALL: { min: 1, max: 1 }, SMEMBERS: { min: 1, max: 1 },
  TYPE: { min: 1, max: 1 }, TTL: { min: 1, max: 1 }, EXISTS: { min: 1, max: 20 }, STRLEN: { min: 1, max: 1 },
  LLEN: { min: 1, max: 1 }, SCARD: { min: 1, max: 1 }, ZCARD: { min: 1, max: 1 }, HLEN: { min: 1, max: 1 }, DBSIZE: { min: 0, max: 0 },
  INFO: { min: 0, max: 1, check: (a) => (a[0] && !/^[a-z]{2,20}$/i.test(a[0]) ? "بخش INFO معتبر نیست." : null) },
  LRANGE: { min: 3, max: 3, check: (a) => (int(a[1]) && int(a[2]) ? null : "LRANGE به دو عدد شروع و پایان نیاز دارد.") },
  ZRANGE: { min: 3, max: 4, check: (a) => (!int(a[1]) || !int(a[2]) ? "ZRANGE به دو عدد شروع و پایان نیاز دارد." : a[3] && a[3].toUpperCase() !== "WITHSCORES" ? "فقط WITHSCORES مجاز است." : null) },
  SCAN: { min: 1, max: 7, check: (a) => {
    if (!/^\d{1,20}$/.test(a[0])) return "SCAN با cursor عددی شروع می‌شود (مثلاً 0).";
    for (let i = 1; i < a.length; i += 2) {
      const opt = a[i].toUpperCase(), val = a[i + 1];
      if (val === undefined || !["MATCH", "COUNT", "TYPE"].includes(opt)) return "گزینه‌های SCAN: MATCH، COUNT و TYPE.";
      if (opt === "COUNT" && (!/^\d{1,4}$/.test(val) || Number(val) > 1000 || Number(val) < 1)) return "COUNT در SCAN باید بین ۱ و ۱۰۰۰ باشد.";
    }
    return null;
  } },
};
export const REDIS_ALLOWED = Object.keys(REDIS);
/** splits a line like a shell would, with "…" quoting (no escapes) */
function words(line: string): string[] | null {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
/** one command per line; each on the allowlist, ranges clamped to `cap` items and SCAN given a COUNT */
export function checkRedis(text: string, cap: number): { ok: true; commands: string[][] } | Bad {
  if (text.length > 4000) return bad("فرمان‌ها بیش از حد طولانی‌اند.");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return bad("فرمانی وارد نشده است.");
  if (lines.length > 10) return bad("حداکثر ۱۰ فرمان.");
  const commands: string[][] = [];
  for (const line of lines) {
    const w = words(line);
    if (!w?.length) return bad("فرمان معتبر نیست.");
    const name = w[0].toUpperCase(), args = w.slice(1);
    if (name === "KEYS") return bad("KEYS مجاز نیست (کل پایگاه داده را قفل می‌کند)؛ از SCAN 0 MATCH الگو COUNT 100 استفاده کنید.");
    const rule = REDIS[name];
    if (!rule) return bad("فرمان «" + name + "» مجاز نیست. فرمان‌های مجاز: " + REDIS_ALLOWED.join("، "));
    if (args.length < rule.min || args.length > rule.max) return bad("تعداد آرگومان‌های " + name + " درست نیست.");
    if (args.some((a) => a.length > 512 || /[\r\n\0]/.test(a))) return bad("آرگومان بیش از حد طولانی است.");
    const err = rule.check?.(args);
    if (err) return bad(err);
    if (name === "LRANGE" || name === "ZRANGE") {
      // a range of at most `cap` items from its start (negative ends become start + cap)
      const start = Number(args[1]), stop = Number(args[2]);
      if (start >= 0 && (stop < 0 || stop - start + 1 > cap)) args[2] = String(start + cap - 1);
      if (start < 0 && (stop >= 0 || stop - start + 1 > cap)) { args[1] = String(-cap); args[2] = "-1"; }
    }
    if (name === "SCAN" && !args.some((a) => a.toUpperCase() === "COUNT")) args.push("COUNT", "100");
    commands.push([name, ...args]);
  }
  return { ok: true, commands };
}
