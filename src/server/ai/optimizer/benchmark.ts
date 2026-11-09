/* Benchmark of the optimizer on the dataset in tests/fixtures/ai-opt (scripts/ai-opt-fixtures.mjs).
     offline  deterministic: estimated reduction per workload and whether every integrity check passed
              (validator, latest user message, tools and image parts byte-identical). No network.
     live     admin-triggered only, never automatic: each fixture goes to the same model twice — original
              and optimized, same parameters — within a USD budget (default 5, capped by the settings);
              records the provider's usage and compares the answers (tool call, JSON, code, expected
              strings; an optional LLM judge inside the budget). The report is saved in ai_opt_benchmarks. */
import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { aiOptBenchmarks } from "../../db/schema";
import { rid } from "../../util";
import { readChat, type ChatRequest, type ChatResult, type ChatUsage } from "../translate";
import { rawUpstream } from "../upstream";
import { OptCall } from "./call";
import { optimizerSettings } from "./config";
import { prepare, transport } from "./gateway";
import { normDigits } from "./analyzer";
import { offlineOne, type Fixture, type OfflineResult } from "./offline";
import { terms } from "./markdown";

export type { Fixture, OfflineResult };

export const FIXTURE_DIR = () => path.join(/* turbopackIgnore: true */ process.cwd(), "tests/fixtures/ai-opt");

export function loadFixtures(dir = FIXTURE_DIR()): Fixture[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Fixture);
}

export const offlineBenchmark = (fixtures = loadFixtures()) => Promise.all(fixtures.map(offlineOne));

/* ---------- live ---------- */

export type LiveModel = { id: string; upstream?: string; inPrice: number; outPrice: number; costIn?: number; costOut?: number };
type Side = { promptTokens: number; cachedTokens: number; outTokens: number; usd: number; usdReported: boolean; ok: boolean; error: string };
export type LiveResult = {
  id: string; workload: string; estReductionPct: number; actualReductionPct: number;
  original: Side; optimized: Side; check: { kind: string; pass: boolean; detail: string }; judge: boolean | null;
};
export type LiveReport = { model: string; budgetUsd: number; spentUsd: number; stoppedForBudget: boolean; priceBasis: string; results: LiveResult[]; passRate: number; meanActualReductionPct: number };

const MAX_OUT = 400;
/** used for the pre-check when no price is known: deliberately high, so the cap holds */
const CONSERVATIVE = { in: 15 / 1e6, out: 75 / 1e6 };

function usdPrices(m: LiveModel, usdToman: number) {
  if (usdToman > 0) {
    const pin = (m.costIn || m.inPrice) / usdToman / 1e6, pout = (m.costOut || m.outPrice) / usdToman / 1e6;
    if (pin > 0 || pout > 0) return { p: { in: pin, out: pout }, basis: m.costIn || m.costOut ? "cost ÷ USD rate" : "sale price ÷ USD rate" };
  }
  return { p: CONSERVATIVE, basis: "conservative default (15 / 75 USD per 1M)" };
}

async function send(req: ChatRequest, p: { in: number; out: number }): Promise<{ r: ChatResult | null; side: Side }> {
  const side: Side = { promptTokens: 0, cachedTokens: 0, outTokens: 0, usd: 0, usdReported: false, ok: false, error: "" };
  try {
    const res = await rawUpstream().chat(transport(req), AbortSignal.timeout(90_000));
    if (!res.ok) { side.error = "HTTP " + res.status; return { r: null, side }; }
    const r = readChat((await res.json()) as Record<string, unknown>);
    const u: ChatUsage | null = r.usage;
    side.ok = true;
    side.promptTokens = u?.prompt_tokens ?? 0; side.cachedTokens = u?.cached_tokens ?? 0; side.outTokens = u?.completion_tokens ?? 0;
    side.usdReported = u?.cost !== undefined;
    side.usd = u?.cost ?? ((side.promptTokens * p.in) + (side.outTokens * p.out));
    return { r, side };
  } catch (e) { side.error = (e as Error).message.slice(0, 120); return { r: null, side }; }
}

const firstJson = (s: string): unknown => { const m = /[{[][\s\S]*[}\]]/.exec(s); if (!m) return undefined; try { return JSON.parse(m[0]); } catch { return undefined; } };
const codeOf = (s: string) => [...s.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
const jaccard = (a: string, b: string) => { const x = new Set(terms(a)), y = new Set(terms(b)); const i = [...x].filter((w) => y.has(w)).length; return x.size + y.size ? i / (x.size + y.size - i) : 1; };

/** structural / exact comparison of the two answers for the fixture's task */
export function compareAnswers(kind: string, expect: string[], a: ChatResult, b: ChatResult): { pass: boolean; detail: string } {
  const has = (r: ChatResult, s: string) => normDigits(r.text + JSON.stringify(r.toolCalls)).includes(normDigits(s));
  switch (kind) {
    case "tool": {
      const na = a.toolCalls.map((t) => t.function.name).sort().join(","), nb = b.toolCalls.map((t) => t.function.name).sort().join(",");
      return { pass: na === nb && expect.every((e) => na.includes(e)), detail: "tools: " + (na || "—") + " / " + (nb || "—") };
    }
    case "json": {
      const ja = JSON.stringify(firstJson(a.text)), jb = JSON.stringify(firstJson(b.text));
      return { pass: ja !== undefined && ja === jb, detail: ja === jb ? "same JSON" : "JSON differs" };
    }
    case "exact": return { pass: a.text.trim() === b.text.trim(), detail: a.text.trim() === b.text.trim() ? "identical" : "differs" };
    case "code": {
      const ca = codeOf(a.text), cb = codeOf(b.text);
      const ok = !!ca && !!cb && expect.every((e) => ca.includes(e) && cb.includes(e));
      return { pass: ok, detail: ok ? "both answers have code using " + expect.join(", ") : "code missing or without " + expect.join(", ") };
    }
    case "contains": {
      const ok = expect.every((e) => has(a, e) && has(b, e));
      return { pass: ok, detail: ok ? "both mention " + expect.join(", ") : "expected " + expect.join(", ") };
    }
    default: {
      const j = Math.round(jaccard(a.text, b.text) * 100) / 100;
      return { pass: j >= 0.25, detail: "lexical similarity " + j };
    }
  }
}

export async function liveBenchmark(db: DB, o: { model: LiveModel; budgetUsd: number; judge?: boolean; fixtures?: Fixture[]; onProgress?: (r: LiveResult) => Promise<void> }): Promise<LiveReport> {
  const s = await optimizerSettings(db);
  const budget = Math.max(0, Math.min(o.budgetUsd, s.benchMaxUsd));
  const { p, basis } = usdPrices(o.model, s.usdToman);
  const fixtures = o.fixtures ?? loadFixtures();
  const upstreamModel = o.model.upstream || o.model.id;
  const out: LiveResult[] = [];
  let spent = 0, stopped = false;
  for (const fx of fixtures) {
    const base: ChatRequest = { ...fx.request, model: upstreamModel, max_tokens: MAX_OUT, temperature: 0, stream: false };
    const call = new OptCall(fx.feature);
    const prepared = await prepare(base, call);
    const est = call.report ?? prepared.report;
    // pre-check: both sides at full output, plus the judge, must fit what is left
    const need = (est.origTokens + est.optTokens) * 1.3 * p.in + 2 * MAX_OUT * p.out + (o.judge ? (est.optTokens * 0.2 + 2 * MAX_OUT + 300) * p.in + 20 * p.out : 0);
    if (spent + need > budget) { stopped = true; break; }
    const a = await send(base, p);
    const b = await send(prepared.req, p);
    spent += a.side.usd + b.side.usd;
    let check = { kind: fx.check.kind, pass: false, detail: a.side.error || b.side.error || "no answer" };
    let judge: boolean | null = null;
    if (a.r && b.r) {
      check = { kind: fx.check.kind, ...compareAnswers(fx.check.kind, fx.check.expect ?? [], a.r, b.r) };
      if (o.judge && spent < budget) {
        const q = fx.request.messages.filter((m) => m.role === "user").at(-1);
        const jr = await send({ model: upstreamModel, temperature: 0, max_tokens: 20, messages: [
          { role: "system", content: "You compare two answers to the same question. Reply with JSON only: {\"same\": true} when they give the same facts and the same recommendation, otherwise {\"same\": false}." },
          { role: "user", content: "Question:\n" + JSON.stringify(q?.content ?? "").slice(0, 2000) + "\n\nAnswer A:\n" + a.r.text.slice(0, 3000) + "\n\nAnswer B:\n" + b.r.text.slice(0, 3000) },
        ] }, p);
        spent += jr.side.usd;
        const v = jr.r ? (firstJson(jr.r.text) as { same?: boolean } | undefined) : undefined;
        judge = typeof v?.same === "boolean" ? v.same : null;
      }
    }
    const r: LiveResult = {
      id: fx.id, workload: fx.workload,
      estReductionPct: est.origTokens ? Math.round(((est.origTokens - est.optTokens) / est.origTokens) * 1000) / 10 : 0,
      actualReductionPct: a.side.promptTokens ? Math.round(((a.side.promptTokens - b.side.promptTokens) / a.side.promptTokens) * 1000) / 10 : 0,
      original: a.side, optimized: b.side, check, judge,
    };
    out.push(r);
    await o.onProgress?.(r);
    if (spent >= budget) { stopped = true; break; }
  }
  const passed = out.filter((r) => r.check.pass).length;
  return {
    model: o.model.id, budgetUsd: budget, spentUsd: Math.round(spent * 1e6) / 1e6, stoppedForBudget: stopped, priceBasis: basis, results: out,
    passRate: out.length ? Math.round((passed / out.length) * 1000) / 10 : 0,
    meanActualReductionPct: out.length ? Math.round((out.reduce((n, r) => n + r.actualReductionPct, 0) / out.length) * 10) / 10 : 0,
  };
}

/** admin: starts a run in the background (one at a time) and returns its id */
export async function startBenchmark(db: DB, o: { model: LiveModel; budgetUsd: number; judge: boolean; by: string }): Promise<string> {
  const running = await db.select({ id: aiOptBenchmarks.id }).from(aiOptBenchmarks).where(eq(aiOptBenchmarks.status, "running"));
  if (running.length) throw new Error("یک اجرای محک در جریان است؛ پس از پایان آن دوباره تلاش کنید.");
  const id = rid("bench");
  const s = await optimizerSettings(db);
  const budgetUsd = Math.max(0, Math.min(o.budgetUsd, s.benchMaxUsd));
  await db.insert(aiOptBenchmarks).values({ id, byUser: o.by, model: o.model.id, status: "running", budgetUsd });
  void (async () => {
    try {
      const report = await liveBenchmark(db, { model: o.model, budgetUsd, judge: o.judge });
      await db.update(aiOptBenchmarks).set({ status: report.stoppedForBudget ? "budget" : "done", spentUsd: report.spentUsd, report: report as unknown as Record<string, unknown>, finishedAt: new Date() }).where(eq(aiOptBenchmarks.id, id));
    } catch (e) {
      await db.update(aiOptBenchmarks).set({ status: "failed", error: (e as Error).message.slice(0, 300), finishedAt: new Date() }).where(eq(aiOptBenchmarks.id, id)).catch(() => {});
    }
  })();
  return id;
}
