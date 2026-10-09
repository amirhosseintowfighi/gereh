/* AI API core: model catalog, keys, budgets and the metered request path.
   Billing per request: a reserve (estimated input + max output) is taken from the wallet before the
   upstream call; when the answer is complete the real cost (from the upstream's usage, or an estimate
   when it reports none) is settled and the rest refunded. Failed upstream calls cost nothing.
   Every few minutes charged requests are summed into one "usage" transaction per customer. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { AI_MODELS, costOf, estimateTokens, rulePrice } from "@/lib/ai";
import { fa } from "@/lib/format";
import type { DB, Tx } from "../db/client";
import { aiKeys, aiModels, aiUsage, transactions, users } from "../db/schema";
import { rid, sha256 } from "../util";
import { genId, readChat, readSSE, type ChatRequest, type ChatResult } from "./translate";
import { aiUpstream } from "./upstream";

export const seedAiModels = (db: DB | Tx) =>
  db.insert(aiModels).values(AI_MODELS.map((m, i) => ({
    id: m.id, name: m.name, vendor: m.vendor, context: m.context, vision: !!m.vision,
    inPrice: rulePrice(m.ref[0]), outPrice: rulePrice(m.ref[1]), refIn: m.ref[0], refOut: m.ref[1], position: i,
  }))).onConflictDoNothing();

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const token = (n: number) => [...randomBytes(n)].map((b) => ALNUM[b % ALNUM.length]).join("");

export type KeyInput = { name: string; models: string[]; dailyCap: number; monthlyCap: number; rpm: number; expiresDays: number };
/** creates a key; the full key is returned once and only its hash is stored */
export async function createKey(db: DB | Tx, userId: string, k: KeyInput) {
  const key = "gk-" + token(40), id = rid("AK");
  await db.insert(aiKeys).values({
    id, userId, name: k.name, hash: sha256(key), prefix: key.slice(0, 7) + "…" + key.slice(-4), models: k.models,
    dailyCap: k.dailyCap, monthlyCap: k.monthlyCap, rpm: k.rpm, expiresAt: k.expiresDays ? new Date(Date.now() + k.expiresDays * 86400_000) : null,
  });
  return { id, key };
}

export async function authenticateKey(db: DB, raw: string) {
  if (!/^gk-[A-Za-z0-9]{40}$/.test(raw)) return null;
  const [row] = await db.select({ k: aiKeys, userStatus: users.status }).from(aiKeys).innerJoin(users, eq(users.id, aiKeys.userId)).where(eq(aiKeys.hash, sha256(raw)));
  return row ? { ...row.k, userStatus: row.userStatus } : null;
}

/** start of today / this month in Tehran time (UTC+3:30, no DST) */
export function tehranStarts(now = Date.now()) {
  const off = 3.5 * 3600_000, t = new Date(now + off);
  const day = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - off;
  const month = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1) - off;
  return { day: new Date(day), month: new Date(month) };
}
async function spent(db: DB, keyId: string, since: Date) {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${aiUsage.charged}), 0)::bigint` }).from(aiUsage).where(and(eq(aiUsage.keyId, keyId), gte(aiUsage.createdAt, since)));
  return Number(r?.s ?? 0);
}

export type AiError = { http: number; code: string; message: string };
export const aiErr = (http: number, code: string, message: string): AiError => ({ http, code, message });

export type ResolvedModel = typeof aiModels.$inferSelect;
export async function resolveModel(db: DB, id: string, allowed: string[]): Promise<ResolvedModel | AiError> {
  const [m] = await db.select().from(aiModels).where(eq(aiModels.id, id));
  if (!m || !m.active) return aiErr(404, "model_not_found", "مدل «" + id + "» وجود ندارد یا غیرفعال است. فهرست مدل‌ها: GET /v1/models");
  if (allowed.length && !allowed.includes(m.id)) return aiErr(403, "model_not_allowed", "این کلید اجازه استفاده از مدل «" + id + "» را ندارد.");
  return m;
}

type Caller = { userId: string; keyId: string | null; dailyCap: number; monthlyCap: number };
export type Format = "openai" | "responses" | "anthropic" | "gemini" | "panel";

/** what a format needs to render the answer (JSON or a stream transformer) */
export type Renderer = {
  json(r: ChatResult, model: string): unknown;
  stream(): { push(chunk: Record<string, unknown>): string; end(): string; result(): ChatResult };
};

type Ctx = { db: DB; caller: Caller; model: ResolvedModel; format: Format; chat: ChatRequest; render: Renderer };
export type RunResult = { kind: "json"; body: unknown; requestId: string; charged: number } | { kind: "stream"; stream: ReadableStream<Uint8Array>; requestId: string } | { kind: "error"; error: AiError };

const inputChars = (chat: ChatRequest) => JSON.stringify(chat.messages).length + (chat.tools ? JSON.stringify(chat.tools).length : 0);

/** one model request, end to end */
export async function runChat(c: Ctx): Promise<RunResult> {
  const { db, caller, model } = c;
  const requestId = genId("req_");
  const inEst = estimateTokens(inputChars(c.chat));
  const outMax = Math.min(typeof c.chat.max_tokens === "number" && c.chat.max_tokens > 0 ? c.chat.max_tokens : 8192, 64_000);
  const reserve = costOf(inEst, outMax, model);
  const t0 = Date.now();
  const log = (status: typeof aiUsage.$inferInsert.status, r: { inTokens?: number; outTokens?: number; charged?: number; estimated?: boolean; error?: string }) =>
    db.insert(aiUsage).values({ id: requestId, userId: caller.userId, keyId: caller.keyId, model: model.id, format: c.format, stream: !!c.chat.stream, status, inTokens: r.inTokens ?? 0, outTokens: r.outTokens ?? 0, estimated: !!r.estimated, charged: r.charged ?? 0, billed: !r.charged, latencyMs: Date.now() - t0, error: (r.error ?? "").slice(0, 300) });

  if (caller.keyId && (caller.dailyCap || caller.monthlyCap)) {
    const { day, month } = tehranStarts();
    if (caller.dailyCap && (await spent(db, caller.keyId, day)) + reserve > caller.dailyCap) return { kind: "error", error: aiErr(402, "key_budget_exceeded", "سقف هزینه روزانه این کلید پر شده است.") };
    if (caller.monthlyCap && (await spent(db, caller.keyId, month)) + reserve > caller.monthlyCap) return { kind: "error", error: aiErr(402, "key_budget_exceeded", "سقف هزینه ماهانه این کلید پر شده است.") };
  }
  const [held] = await db.update(users).set({ balance: sql`${users.balance} - ${reserve}` }).where(and(eq(users.id, caller.userId), sql`${users.balance} >= ${reserve}`)).returning({ balance: users.balance });
  if (!held) {
    await log("denied", { error: "insufficient_balance" });
    return { kind: "error", error: aiErr(402, "insufficient_balance", "موجودی کیف پول کافی نیست. برای این درخواست حدود " + fa(reserve) + " تومان لازم است (کاهش max_tokens هزینه رزرو را کم می‌کند).") };
  }
  /** settles the request once: real cost, refund of the rest */
  let settled = false;
  const settle = async (status: "success" | "error" | "cancelled", r: ChatResult | null, outChars: number, error = "") => {
    if (settled) return 0; settled = true;
    if (status === "error") {
      await db.update(users).set({ balance: sql`${users.balance} + ${reserve}` }).where(eq(users.id, caller.userId));
      await log("error", { error });
      return 0;
    }
    const estimated = !r?.usage;
    const inT = r?.usage?.prompt_tokens ?? inEst, outT = r?.usage?.completion_tokens ?? estimateTokens(outChars);
    let charged = costOf(inT, outT, model);
    if (charged <= reserve) await db.update(users).set({ balance: sql`${users.balance} + ${reserve - charged}` }).where(eq(users.id, caller.userId));
    else {
      const extra = charged - reserve;
      const [ok] = await db.update(users).set({ balance: sql`${users.balance} - ${extra}` }).where(and(eq(users.id, caller.userId), sql`${users.balance} >= ${extra}`)).returning({ b: users.balance });
      if (!ok) charged = reserve; // the gateway absorbs the overrun rather than overdrawing the wallet
    }
    await log(status, { inTokens: inT, outTokens: outT, charged, estimated });
    if (caller.keyId) await db.update(aiKeys).set({ lastUsedAt: new Date() }).where(eq(aiKeys.id, caller.keyId));
    return charged;
  };

  const upstreamReq: ChatRequest = { ...c.chat, model: model.upstream || model.id, ...(c.chat.stream ? { stream_options: { include_usage: true } } : {}) };
  const abort = new AbortController();
  let res: Response;
  try {
    res = await aiUpstream().chat(upstreamReq, abort.signal);
  } catch (e) {
    await settle("error", null, 0, (e as Error).message);
    return { kind: "error", error: aiErr(502, "upstream_unavailable", "سرویس‌دهنده مدل در دسترس نیست؛ مبلغی کسر نشد. چند لحظه بعد دوباره تلاش کنید.") };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    await settle("error", null, 0, "upstream " + res.status + " " + detail);
    if (res.status === 400) return { kind: "error", error: aiErr(400, "invalid_request", "درخواست توسط مدل پذیرفته نشد: " + (extractMessage(detail) || "پارامترها را بررسی کنید.")) };
    if (res.status === 429) return { kind: "error", error: aiErr(429, "upstream_rate_limited", "ظرفیت مدل لحظه‌ای پر است؛ چند ثانیه بعد دوباره تلاش کنید. مبلغی کسر نشد.") };
    return { kind: "error", error: aiErr(502, "upstream_error", "سرویس‌دهنده مدل خطا داد (" + res.status + ")؛ مبلغی کسر نشد.") };
  }

  if (!c.chat.stream) {
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!j || !Array.isArray(j.choices)) { await settle("error", null, 0, "bad upstream body"); return { kind: "error", error: aiErr(502, "upstream_error", "پاسخ نامعتبر از سرویس‌دهنده؛ مبلغی کسر نشد.") }; }
    const r = readChat(j);
    const charged = await settle("success", r, r.text.length + r.toolCalls.reduce((n, t) => n + t.function.arguments.length, 0));
    return { kind: "json", body: c.render.json(r, model.id), requestId, charged };
  }

  const tx = c.render.stream(), enc = new TextEncoder();
  const outChars = () => { const r = tx.result(); return r.text.length + r.toolCalls.reduce((n, t) => n + t.function.arguments.length, 0); };
  const body = res.body!;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        for await (const chunk of readSSE(body)) { const s = tx.push(chunk); if (s) ctrl.enqueue(enc.encode(s)); }
        ctrl.enqueue(enc.encode(tx.end()));
        await settle("success", tx.result(), outChars());
        ctrl.close();
      } catch (e) {
        // the customer went away, or the upstream broke mid-answer: bill what was produced
        const r = tx.result();
        await settle(r.text || r.toolCalls.length ? "cancelled" : "error", r, outChars(), (e as Error).message);
        try { ctrl.close(); } catch { /* already closed */ }
      }
    },
    async cancel() { abort.abort(); const r = tx.result(); await settle(r.text || r.toolCalls.length ? "cancelled" : "error", r, outChars(), "client cancelled"); },
  });
  return { kind: "stream", stream, requestId };
}

function extractMessage(s: string) {
  try { const j = JSON.parse(s) as { error?: { message?: string } | string; message?: string }; return typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? ""; } catch { return ""; }
}

/** usage rows → one wallet transaction per customer (balances were already debited per request) */
export async function settleAi(db: DB) {
  const rows = await db.select({ userId: aiUsage.userId, total: sql<number>`sum(${aiUsage.charged})::bigint`, n: sql<number>`count(*)::int`, ids: sql<string[]>`array_agg(${aiUsage.id})` })
    .from(aiUsage).where(eq(aiUsage.billed, false)).groupBy(aiUsage.userId);
  for (const r of rows) {
    await db.transaction(async (tx) => {
      await tx.update(aiUsage).set({ billed: true }).where(inArray(aiUsage.id, r.ids));
      if (Number(r.total) > 0) await tx.insert(transactions).values({ id: rid("TX"), userId: r.userId, type: "usage", amount: -Number(r.total), method: "کیف پول", desc: "API هوش مصنوعی: " + fa(r.n) + " درخواست" });
    });
  }
}

/** adds models the upstream offers that the catalog lacks (inactive until an admin prices them) */
export async function syncUpstreamModels(db: DB) {
  const list = await aiUpstream().models();
  const have = new Set((await db.select({ id: aiModels.id, up: aiModels.upstream }).from(aiModels)).flatMap((m) => [m.id, m.up]));
  const fresh = list.filter((m) => !have.has(m.id));
  if (fresh.length) await db.insert(aiModels).values(fresh.map((m, i) => ({ id: m.id, name: m.id, vendor: guessVendor(m.id), inPrice: 0, outPrice: 0, active: false, position: 1000 + i }))).onConflictDoNothing();
  return { total: list.length, added: fresh.length };
}
const guessVendor = (id: string) => /claude/i.test(id) ? "anthropic" : /gpt|^o\d|openai/i.test(id) ? "openai" : /gemini|gemma/i.test(id) ? "google" : /deepseek/i.test(id) ? "deepseek" : /qwen/i.test(id) ? "qwen" : /glm/i.test(id) ? "zai" : /grok/i.test(id) ? "xai" : /kimi|moonshot/i.test(id) ? "moonshot" : "other";

