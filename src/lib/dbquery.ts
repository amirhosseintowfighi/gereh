/* «پرسش از دیتابیس»: natural-language questions over the customer's managed databases (src/server/dbquery). What the
   panel and the server share: limits, result shapes, the automatic chart choice and CSV export. */

export const DBQ = { name: "پرسش از دیتابیس", tab: "پرسش با هوش مصنوعی" } as const;

export const DBQ_ENGINES = ["postgres", "mysql", "mariadb", "mongodb", "redis"] as const;
export type DbqEngine = (typeof DBQ_ENGINES)[number];
export const dbqSupported = (engine: string): engine is DbqEngine => (DBQ_ENGINES as readonly string[]).includes(engine);
/** how the query is written for the engine */
export const dbqLang = (engine: string) => (engine === "mongodb" ? "mongo" : engine === "redis" ? "redis" : "sql");

export const DBQ_LIMITS = {
  /** rows a panel query returns (LIMIT injected or lowered to this) */
  rows: 500,
  /** rows the assistant's query_database returns */
  toolRows: 50,
  /** the result as JSON, beyond which rows are dropped */
  bytes: 1024 * 1024,
  /** statement timeout inside the database */
  timeoutMs: 10_000,
  /** longest cell kept */
  cell: 2000,
  queryChars: 10_000,
  questionChars: 500,
  /** schema text sent to the model */
  schemaChars: 12_000,
  schemaTtlMs: 5 * 60_000,
  /** rows of a result «تحلیل نتیجه» sends (truncated and redacted) */
  analyzeRows: 40,
  analyzeChars: 5000,
  history: 50,
} as const;

/** the smallest AI fee per question or analysis (Toman); the real cost is metered by tokens */
export const DBQ_MIN_FEE = 300;

export type ColType = "number" | "text" | "date" | "bool" | "json";
export type Cell = string | number | boolean | null;
export type DbqResult = {
  columns: { name: string; type: ColType }[];
  rows: Cell[][];
  /** more rows exist than the limit */
  hasMore: boolean;
  /** rows were dropped to stay under the size cap */
  sizeCapped: boolean;
  limit: number;
  durationMs: number;
  /** a note from the engine (e.g. the SCAN cursor) */
  note?: string;
};
export type ChartType = "bar" | "line" | "pie" | "table";
export type DbqChart = { type: ChartType; x: string; y: string };

export type DbqAnswer = {
  id: string; database: string; question: string; query: string; explanation: string; chart: DbqChart;
  /** the query failed validation (the person can still edit it) */
  error: string;
  charged: number; simulated: boolean;
};
export type DbqHistoryItem = {
  id: string; database: string; question: string; query: string; explanation: string; chart: DbqChart;
  saved: boolean; title: string; edited: boolean; runs: number; lastRowCount: number | null; at: string; lastRunAt: string;
};
export type DbqTable = { name: string; rows: number; columns: { name: string; type: string; pk?: boolean; ref?: string }[] };
export type DbqOverview = {
  engine: string; databases: string[]; database: string; samples: boolean;
  tables: DbqTable[]; suggestions: string[]; history: DbqHistoryItem[];
};
export type DbqAnalysis = { text: string; charged: number; simulated: boolean; rowsSent: number };

const NUM = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
const DATE = /^\d{4}-\d\d-\d\d([ T]\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d(:?\d\d)?)?)?$/;
/** a column's type from its values (the first non-null decides, numbers must all parse) */
export function inferType(values: Cell[]): ColType {
  const vs = values.filter((v) => v !== null && v !== "");
  if (!vs.length) return "text";
  if (vs.every((v) => typeof v === "number" || (typeof v === "string" && NUM.test(v)))) return "number";
  if (vs.every((v) => typeof v === "boolean" || v === "t" || v === "f" || v === "true" || v === "false")) return "bool";
  if (vs.every((v) => typeof v === "string" && DATE.test(v))) return "date";
  if (vs.every((v) => typeof v === "string" && /^[[{]/.test(v))) return "json";
  return "text";
}

/** the chart that fits a result: the model's choice when its columns exist and fit, else a guess */
export function pickChart(r: Pick<DbqResult, "columns" | "rows">, wanted?: Partial<DbqChart>): DbqChart {
  const cols = r.columns;
  const has = (n?: string) => !!n && cols.some((c) => c.name === n);
  const isNum = (n: string) => cols.find((c) => c.name === n)?.type === "number";
  if (wanted?.type === "table") return { type: "table", x: "", y: "" };
  if (wanted?.type && has(wanted.x) && has(wanted.y) && isNum(wanted.y!) && r.rows.length > 1) {
    if (wanted.type !== "pie" || (r.rows.length <= 12 && r.rows.every((row) => Number(row[cols.findIndex((c) => c.name === wanted.y)]) >= 0))) return { type: wanted.type, x: wanted.x!, y: wanted.y! };
  }
  if (cols.length < 2 || r.rows.length < 2 || r.rows.length > 120) return { type: "table", x: "", y: "" };
  const y = [...cols].reverse().find((c) => c.type === "number");
  const x = cols.find((c) => c !== y && (c.type === "date" || c.type === "text")) ?? cols.find((c) => c !== y);
  if (!x || !y) return { type: "table", x: "", y: "" };
  return { type: x.type === "date" ? "line" : r.rows.length <= 6 ? "pie" : "bar", x: x.name, y: y.name };
}

/** RFC 4180 CSV with a BOM, so spreadsheet apps read Persian text */
export function toCsv(r: Pick<DbqResult, "columns" | "rows">) {
  // a text cell starting like a formula is neutralised (CSV injection)
  const q = (v: Cell) => {
    let s = v === null ? "" : String(v);
    if (/^[=+\-@\t]/.test(s) && !NUM.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return "\uFEFF" + [r.columns.map((c) => q(c.name)).join(","), ...r.rows.map((row) => row.map(q).join(","))].join("\r\n");
}
