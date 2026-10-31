/* Schema introspection for «پرسش از دیتابیس»: read-only, cached for a few minutes per database, cut down to the tables
   that matter for a question when the schema is large, and rendered for the model as untrusted data (table and column
   names and sample values are written by whoever filled the database). Also the suggested questions. */
import "server-only";
import { DBQ_LIMITS } from "@/lib/dbquery";
import { redact } from "../ai/explain";
import type { DbSpec } from "../paas/driver";
import type { DbqRunner, SchemaTable } from "./runner";

const cache = new Map<string, { at: number; tables: SchemaTable[] }>();
export const clearSchemaCache = (dbId?: string) => { for (const k of [...cache.keys()]) if (!dbId || k.startsWith(dbId + "/")) cache.delete(k); };

/** the database's tables; with `samples`, a few values per column of the largest tables (sent to the model only then) */
export async function schemaOf(runner: DbqRunner, d: DbSpec, database: string, samples: boolean): Promise<SchemaTable[]> {
  const key = d.id + "/" + database + "/" + (samples ? 1 : 0);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DBQ_LIMITS.schemaTtlMs) return hit.tables;
  let tables = await runner.introspect(d, database, { samples: null });
  if (samples && tables.length) tables = await runner.introspect(d, database, { samples: [...tables].sort((a, b) => b.rows - a.rows).slice(0, 10).map((t) => t.name) });
  cache.set(key, { at: Date.now(), tables });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return tables;
}

/* ---------- relevance ---------- */
const HINTS: [RegExp, string[]][] = [
  [/مشتری|customer|client|خریدار/, ["customer", "client", "user", "buyer", "member"]],
  [/سفارش|order|خرید|فروش|sales|revenue|درآمد/, ["order", "sale", "invoice", "payment", "transaction", "purchase", "item"]],
  [/محصول|کالا|product|item|جنس/, ["product", "item", "sku", "goods", "catalog"]],
  [/کاربر|user|عضو|ثبت.?نام|signup/, ["user", "member", "account", "profile", "signup"]],
  [/پرداخت|payment|تراکنش|transaction|صورتحساب|invoice/, ["payment", "transaction", "invoice", "bill"]],
  [/مقاله|post|blog|نوشته/, ["post", "article", "blog", "comment"]],
  [/تیکت|ticket|پشتیبانی|support/, ["ticket", "support", "message"]],
  [/شهر|city|آدرس|address/, ["address", "city", "location"]],
];
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter((w) => w.length > 1);
/** table score for a question: name and column matches, Persian/English hints, then foreign-key neighbours */
export function relevantTables(tables: SchemaTable[], question: string, budget = DBQ_LIMITS.schemaChars): SchemaTable[] {
  if (render(tables).length <= budget) return tables;
  const q = question.toLowerCase(), qw = new Set(words(question));
  const hints = HINTS.filter(([re]) => re.test(q)).flatMap(([, h]) => h);
  const score = new Map<SchemaTable, number>();
  for (const t of tables) {
    const name = t.name.toLowerCase().split(".").pop()!;
    let s = 0;
    for (const w of words(name.replace(/_/g, " "))) { if (qw.has(w) || qw.has(w.replace(/s$/, ""))) s += 6; if (hints.some((h) => w.startsWith(h))) s += 4; }
    for (const c of t.columns) for (const w of words(c.name.replace(/_/g, " "))) if (qw.has(w)) s += 1;
    score.set(t, s);
  }
  // tables linked to a relevant one by a foreign key come along
  for (const t of tables) if ((score.get(t) ?? 0) > 3) for (const c of t.columns) if (c.ref) { const o = tables.find((x) => x.name === c.ref!.split(".").slice(0, -1).join(".")); if (o) score.set(o, (score.get(o) ?? 0) + 2); }
  const ranked = [...tables].sort((a, b) => (score.get(b)! - score.get(a)!) || b.rows - a.rows);
  const out: SchemaTable[] = [];
  let size = 0;
  for (const t of ranked) { const n = render([t]).length; if (size + n > budget) continue; out.push(t); size += n; }
  return out;
}

/* ---------- rendering for the model ---------- */
/** names may hold anything; keep them short, on one line, without markup that could close our wrapper */
const clean = (s: string, max = 64) => s.replace(/[\u0000-\u001f\u007f<>`]/g, " ").slice(0, max);
export function render(tables: SchemaTable[]): string {
  return tables.map((t) => clean(t.name, 120) + " (~" + t.rows + " rows): " + t.columns.slice(0, 60).map((c) =>
    clean(c.name) + " " + clean(c.type, 40) + (c.pk ? " PK" : "") + (c.ref ? " -> " + clean(c.ref, 120) : "") +
    (c.samples?.length ? " e.g. " + c.samples.slice(0, 3).map((v) => JSON.stringify(redact(clean(v, 40)))).join(", ") : "")).join(", ")).join("\n");
}
/** the schema block of a prompt: quoted, labelled untrusted, closing tags defused */
export const wrapSchema = (tables: SchemaTable[]) => "<schema trust=\"untrusted-data\">\n" + render(tables).replace(/<\/?\s*schema/gi, "‹schema") + "\n</schema>";

/* ---------- suggested questions ---------- */
const FA_NOUN: Record<string, string> = { customers: "مشتری", customer: "مشتری", users: "کاربر", user: "کاربر", orders: "سفارش", order: "سفارش", products: "محصول", product: "محصول", payments: "پرداخت", invoices: "صورتحساب", posts: "مطلب", tickets: "تیکت", transactions: "تراکنش" };
const noun = (t: SchemaTable) => { const b = t.name.split(".").pop()!.toLowerCase(); return FA_NOUN[b] ?? "«" + t.name + "»"; };
const isNum = (t: string) => /int|numeric|decimal|real|double|float|money/.test(t.toLowerCase());
const isDate = (t: string) => /date|time/.test(t.toLowerCase());
/** up to five questions the schema can answer, without any model call */
export function suggestions(tables: SchemaTable[], engine: string): string[] {
  if (engine === "redis") return [...tables.slice(0, 3).map((t) => "کلیدهای " + t.name + " را نشان بده"), "مصرف حافظه Redis چقدر است؟"].slice(0, 5);
  const out: string[] = [];
  const amount = (t: SchemaTable) => t.columns.find((c) => /^(total|amount|price|sum|revenue|grand_total|total_price)$/i.test(c.name) && (isNum(c.type) || /double|int/.test(c.type)));
  const date = (t: SchemaTable) => t.columns.find((c) => /^(created_at|created|date|order_date|paid_at)$/i.test(c.name)) ?? t.columns.find((c) => isDate(c.type));
  const sales = tables.find((t) => amount(t) && date(t) && /order|sale|invoice|payment|transaction/i.test(t.name)) ?? tables.find((t) => amount(t) && date(t));
  if (sales) out.push(/order|sale/i.test(sales.name) ? "فروش هفته گذشته به تفکیک روز چقدر بود؟" : "مجموع " + amount(sales)!.name + " در «" + sales.name + "» طی هفته گذشته به تفکیک روز");
  for (const t of tables) {
    const fk = t.columns.find((c) => c.ref && tables.some((o) => o !== t && c.ref!.startsWith(o.name + ".")));
    if (fk) { const o = tables.find((x) => fk.ref!.startsWith(x.name + "."))!; if (/customer|user|client/i.test(o.name)) { out.push("۱۰ " + noun(o) + " با بیشترین " + noun(t)); break; } }
  }
  const items = tables.find((t) => t.columns.some((c) => /^(qty|quantity)$/i.test(c.name)) && t.columns.some((c) => c.ref && /product/i.test(c.ref)));
  if (items) out.push("۵ محصول پرفروش");
  for (const t of tables) { const g = t.columns.find((c) => /^(city|status|category|country)$/i.test(c.name)); if (g) { out.push("تعداد " + noun(t) + " به تفکیک " + ({ city: "شهر", status: "وضعیت", category: "دسته", country: "کشور" } as Record<string, string>)[g.name.toLowerCase()]); if (out.length >= 4) break; } }
  const biggest = [...tables].sort((a, b) => b.rows - a.rows)[0];
  if (biggest) out.push((engine === "mongodb" ? "تعداد اسناد " : "تعداد ") + noun(biggest) + (date(biggest) ? " در ماه گذشته" : ""));
  return [...new Set(out)].slice(0, 5);
}
