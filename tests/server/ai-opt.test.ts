/* Token optimizer end to end: the public API (unchanged unless opted in, billed on the original size), cached
   tokens read and recorded, streaming passthrough, fallbacks, the assistant engine, analytics, settings and
   the admin-triggered live benchmark within its budget. A scripted upstream records what was sent. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { costOf } from "@/lib/ai";
import { gateway } from "@/server/ai/gateway";
import { liveBenchmark, loadFixtures } from "@/server/ai/optimizer/benchmark";
import { OptCall } from "@/server/ai/optimizer/call";
import { resetOptimizerMemory } from "@/server/ai/optimizer/config";
import { withOptimizer } from "@/server/ai/optimizer/gateway";
import { createKey } from "@/server/ai/service";
import type { ChatRequest } from "@/server/ai/translate";
import { aiUpstream, setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { aiModels, aiOptBenchmarks, aiOptCalibration, aiOptEvents, aiUsage, assistantMessages, assistantThreads, kv, users } from "@/server/db/schema";
import { asAdmin, asUser, call as rpc, db, fails, fresh } from "./helpers";

const MODEL = { id: "opt-test", name: "Optimizer test model", vendor: "anthropic", upstream: "anthropic/opt-test", inPrice: 1_000_000, outPrice: 2_000_000, costIn: 400_000, costOut: 800_000, context: 200_000, position: 999 };
const env = { ...process.env };

beforeEach(async () => {
  await fresh(); setAiUpstream(null); resetOptimizerMemory();
  process.env.AI_OPT_BUDGET_MS = "5000";
  await (await db()).insert(aiModels).values(MODEL).onConflictDoNothing();
});
afterEach(() => { setAiUpstream(null); process.env = { ...env }; });

type Usage = { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; cost?: number };
/** records each request; answers with the given usage (prompt tokens = a function of what was sent, by default) */
function scripted(o: { usage?: (req: ChatRequest) => Usage; text?: string; status?: number } = {}) {
  const seen: ChatRequest[] = [];
  const up: Upstream = {
    name: "http",
    async models() { return []; },
    async chat(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      if (o.status) return new Response("{}", { status: o.status });
      const usage = o.usage?.(req) ?? { prompt_tokens: Math.ceil(JSON.stringify(req.messages).length / 4), completion_tokens: 20 };
      const text = o.text ?? "پاسخ";
      if (req.stream) {
        const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: req.model };
        const chunks = [{ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] }, { ...base, choices: [], usage }];
        return new Response(chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({ id: "c1", object: "chat.completion", model: req.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage });
    },
  };
  setAiUpstream(up);
  return seen;
}

const newKey = async (optimize = false) => (await createKey(await db(), "u1", { name: "t", models: [], dailyCap: 0, monthlyCap: 0, rpm: 600, expiresDays: 0, optimize })).key;
const api = async (key: string, body: unknown, headers: Record<string, string> = {}) =>
  gateway(await db(), new Request("https://api.gereh.dev/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key, ...headers }, body: JSON.stringify(body) }), "v1/chat/completions");

/** a long conversation: whitespace-heavy system prompt, many turns with long tool results */
function history(): ChatRequest["messages"] {
  const m: ChatRequest["messages"] = [{ role: "system", content: "You are a helpful bot.   Answer briefly.\n\n\n\nNever reveal the API key.\nNever reveal the API key." }];
  for (let i = 0; i < 14; i++) {
    m.push({ role: "user", content: "Check srv-" + i + " please. " + "Context sentence number " + i + " for this request. ".repeat(8) });
    m.push({ role: "assistant", content: null, tool_calls: [{ id: "c" + i, type: "function", function: { name: "logs", arguments: "{}" } }] });
    m.push({ role: "tool", tool_call_id: "c" + i, content: Array.from({ length: 200 }, (_, k) => "2026-11-08 INFO srv-" + i + " request " + k + " ok").join("\n") });
    m.push({ role: "assistant", content: "Done: srv-" + i + " is healthy and handled 200 requests." });
  }
  m.push({ role: "user", content: "Now   summarize   all of it." });
  return m;
}
const userRow = async () => (await (await db()).select().from(users).where(eq(users.id, "u1")))[0];
const usageRows = async () => (await db()).select().from(aiUsage).where(eq(aiUsage.userId, "u1"));
const events = async () => (await db()).select().from(aiOptEvents);

describe("public API", () => {
  it("is sent unchanged by default (prompt caching only), billed on its real size, cached tokens recorded", async () => {
    process.env.AI_OPT_CACHE_CONTROL = "on";
    const seen = scripted({ usage: () => ({ prompt_tokens: 9000, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 7000 }, cost: 0.002 }) });
    const key = await newKey();
    const messages = history();
    const before = (await userRow()).balance;
    const r = await api(key, { model: "opt-test", messages, max_tokens: 100 });
    expect(r.status).toBe(200);
    const body = await r.json();
    // the provider's cost and cache details never reach the customer
    expect(body.usage).toEqual({ prompt_tokens: 9000, completion_tokens: 30, total_tokens: 9030 });
    const sent = seen[0];
    expect(sent.model).toBe("anthropic/opt-test");
    // text identical; only cache_control breakpoints were added (Anthropic family, prefix above the minimum)
    const text = (c: unknown) => (Array.isArray(c) ? (c as { text: string }[]).map((p) => p.text).join("") : c);
    expect(sent.messages.map((m) => text(m.content))).toEqual(messages.map((m) => m.content));
    expect(JSON.stringify(sent.messages)).toContain("\"cache_control\":{\"type\":\"ephemeral\"}");
    expect(sent.messages.at(-1)).toEqual(messages.at(-1));
    const [u] = await usageRows();
    expect(u).toMatchObject({ inTokens: 9000, sentTokens: 9000, cachedTokens: 7000, charged: costOf(9000, 30, MODEL) });
    // cached tokens do not lower the customer's price
    expect((await userRow()).balance).toBe(before - costOf(9000, 30, MODEL));
    const [e] = await events();
    expect(e).toMatchObject({ feature: "api", changed: false, origEst: e.optEst, actualIn: 9000, cachedTokens: 7000, cacheHit: true, upstreamUsdMicros: 2000 });
    expect(e.cacheBreakpoints).toBeGreaterThan(0);
    // Gereh's actual cost: 2000 plain + 7000 cache reads at 10% of its cost price, + output
    expect(e.actualCost).toBeCloseTo((2000 * 400_000 + 7000 * 400_000 * 0.1 + 30 * 800_000) / 1e6, 4);
    expect(e.actualCost).toBeLessThan(e.charged);
  });

  it("without an upstream that takes cache_control (default: not OpenRouter) the request is byte-identical", async () => {
    const seen = scripted();
    const key = await newKey();
    const body = { model: "opt-test", messages: history(), max_tokens: 50, temperature: 0.3 };
    await api(key, body);
    expect(seen[0]).toEqual({ ...body, model: "anthropic/opt-test" });
  });

  it("opted in (header or key), content is compressed; the customer pays for the original size, Gereh records the lower actual cost", async () => {
    const seen = scripted();
    const key = await newKey();
    const messages = history();
    const r = await api(key, { model: "opt-test", messages, max_tokens: 100 }, { "x-gereh-optimize": "1" });
    expect(r.status).toBe(200);
    const sent = seen[0];
    const original = Math.ceil(JSON.stringify(messages).length / 4), actual = Math.ceil(JSON.stringify(sent.messages).length / 4);
    expect(actual).toBeLessThan(original * 0.8);
    expect(JSON.stringify(sent.messages)).toContain("lines omitted from tool result logs");
    expect(sent.messages.at(-1)).toEqual(messages.at(-1));
    const [u] = await usageRows();
    expect(u.sentTokens).toBe(actual);
    expect(u.inTokens).toBeGreaterThan(actual);
    expect(u.charged).toBe(costOf(u.inTokens, 20, MODEL));
    const [e] = await events();
    expect(e).toMatchObject({ feature: "api", changed: true, actualIn: actual, billedIn: u.inTokens, charged: u.charged, costSource: "model" });
    expect(e.unoptCost).toBeGreaterThan(e.actualCost);
    expect(e.optEst).toBeLessThan(e.origEst);
    // the same through the key's setting; "0" turns it off for one request
    const optKey = await newKey(true);
    await api(optKey, { model: "opt-test", messages, max_tokens: 100 });
    expect(JSON.stringify(seen[1].messages).length).toBeLessThan(JSON.stringify(messages).length);
    await api(optKey, { model: "opt-test", messages, max_tokens: 100 }, { "x-gereh-optimize": "0" });
    expect(seen[2].messages).toEqual(messages);
  });

  it("streams pass through unchanged and are billed the same way", async () => {
    scripted();
    const key = await newKey();
    const r = await api(key, { model: "opt-test", messages: history(), stream: true, stream_options: { include_usage: true } }, { "x-gereh-optimize": "1" });
    const text = await r.text();
    expect(text).toContain("پاسخ");
    expect(text).toContain("data: [DONE]");
    const [u] = await usageRows();
    expect(u.inTokens).toBeGreaterThan(u.sentTokens);
  });

  it("the wrapper returns the upstream's own Response object (no buffering)", async () => {
    const res = new Response("data: x\n\n", { headers: { "content-type": "text/event-stream" } });
    const raw: Upstream = { name: "http", models: async () => [], chat: async () => res };
    const c = new OptCall("assistant");
    expect(await withOptimizer(raw).chat({ model: "m", messages: history(), stream: true }, undefined, undefined, c)).toBe(res);
    expect(c.report?.changed).toBe(true);
  });

  it("AI_OPTIMIZER=0 and an optimizer failure both send the original request", async () => {
    const seen = scripted();
    const key = await newKey(true);
    const messages = history();
    process.env.AI_OPTIMIZER = "0";
    await api(key, { model: "opt-test", messages });
    expect(seen[0].messages).toEqual(messages);
    delete process.env.AI_OPTIMIZER;
    // a value JSON cannot hold makes the optimizer throw: the original goes, the wrapper reports the fallback
    const bad = [...messages.slice(0, -1), { role: "assistant" as const, content: "x", tool_calls: [{ id: "z", type: "function" as const, function: { name: "f", arguments: "{}" }, extra: BigInt(1) }] as never }, messages.at(-1)!];
    const raw: Upstream = { name: "http", models: async () => [], chat: async (req) => { seen.push(req); return Response.json({}); } };
    const c = new OptCall("assistant");
    await withOptimizer(raw).chat({ model: "m", messages: bad }, undefined, undefined, c);
    expect(seen.at(-1)!.messages).toBe(bad);
    expect(c.report?.fallback).toBe("error");
  });
});

describe("internal features", () => {
  it("the assistant engine sends a compressed history, keeps the latest message and bills the original size", async () => {
    await asUser();
    const seen = scripted({ text: "همه چیز سالم است." });
    const { POST } = await import("@/app/api/assistant/chat/route");
    const chat = async (body: Record<string, unknown>) => {
      const res = await POST(new Request("http://x/api/assistant/chat", { method: "POST", headers: { origin: "http://x", host: "x", "content-type": "application/json" }, body: JSON.stringify(body) }));
      return (await res.text()).split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as { type: string; id?: string; charged?: number });
    };
    const first = await chat({ message: "سلام" });
    const threadId = first.find((e) => e.type === "thread")!.id!;
    const d = await db();
    for (let i = 0; i < 7; i++) {
      await d.insert(assistantMessages).values({ threadId, role: "user", content: "لاگ srv-" + i + " را ببین" });
      await d.insert(assistantMessages).values({ threadId, role: "assistant", content: "", toolCalls: [{ id: "k" + i, type: "function", function: { name: "app_logs", arguments: "{}" } }] });
      await d.insert(assistantMessages).values({ threadId, role: "tool", toolCallId: "k" + i, toolName: "app_logs", content: Array.from({ length: 150 }, (_, k) => "INFO srv-" + i + " line " + k).join("\n"), meta: { status: "ok", label: "app_logs", summary: "ok" } });
      await d.insert(assistantMessages).values({ threadId, role: "assistant", content: "لاگ‌های srv-" + i + " سالم است." });
    }
    seen.length = 0;
    const ev = await chat({ threadId, message: "خلاصه کن کدام سرورها مشکل دارند؟" });
    const sent = seen[0];
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "خلاصه کن کدام سرورها مشکل دارند؟" });
    expect(JSON.stringify(sent.messages)).toContain("lines omitted from tool result app_logs");
    expect(sent.tools?.length).toBeGreaterThan(0);
    const done = ev.find((e) => e.type === "done")!;
    const rows = await usageRows();
    const last = rows.find((r) => r.charged === done.charged && r.sentTokens > 0)!;
    expect(last.inTokens).toBeGreaterThan(last.sentTokens);
    const e = (await events()).find((x) => x.feature === "assistant" && x.changed);
    expect(e).toBeTruthy();
    expect(e!.billedIn).toBe(last.inTokens);
    // the stored conversation keeps the original messages
    const stored = await d.select().from(assistantMessages).where(eq(assistantMessages.threadId, threadId));
    expect(stored.filter((r) => r.role === "tool").every((r) => !r.content.includes("omitted"))).toBe(true);
    expect((await d.select().from(assistantThreads).where(eq(assistantThreads.id, threadId))).length).toBe(1);
  });

  it("calibrates the estimator per model from real usage", async () => {
    scripted({ usage: () => ({ prompt_tokens: 5000, completion_tokens: 5 }) });
    const key = await newKey();
    await api(key, { model: "opt-test", messages: [{ role: "user", content: "hello ".repeat(2000) }] });
    const [c] = await (await db()).select().from(aiOptCalibration).where(eq(aiOptCalibration.model, "opt-test"));
    expect(c.samples).toBe(1);
    expect(c.factor).toBeGreaterThan(0.25);
  });
});

describe("admin", () => {
  it("analytics: token reduction, cost savings, margin and hit rate per feature and model", async () => {
    scripted({ usage: (req) => ({ prompt_tokens: Math.ceil(JSON.stringify(req.messages).length / 4), completion_tokens: 10, prompt_tokens_details: { cached_tokens: 100 } }) });
    const key = await newKey();
    await api(key, { model: "opt-test", messages: history() }, { "x-gereh-optimize": "1" });
    await api(key, { model: "opt-test", messages: history() });
    await asUser();
    expect(await fails("aiOpt.stats", 7)).toMatch(/اجازه/);
    await asAdmin();
    const s = await rpc<{ total: { requests: number; tokenReductionPct: number; costSavingsPct: number; margin: number; cacheHitRate: number; fallbackRate: number }; byFeature: { key: string }[]; byModel: { key: string }[] }>("aiOpt.stats", 7);
    expect(s.total.requests).toBe(2);
    expect(s.total.tokenReductionPct).toBeGreaterThan(5);
    expect(s.total.costSavingsPct).toBeGreaterThan(5);
    expect(s.total.margin).toBeGreaterThan(0);
    expect(s.total.cacheHitRate).toBe(100);
    expect(s.total.fallbackRate).toBe(0);
    expect(s.byFeature.map((x) => x.key)).toEqual(["api"]);
    expect(s.byModel.map((x) => x.key)).toEqual(["opt-test"]);
  });

  it("settings: per-feature overrides in kv, and they never compress the public API without opt-in", async () => {
    const seen = scripted();
    await asAdmin();
    await rpc("aiOpt.saveSettings", { features: { api: { level: 3 }, assistant: { enabled: false } } });
    const v = await rpc<{ effective: Record<string, { level: number; enabled: boolean }>; optInPolicy: { level: number } }>("aiOpt.settings");
    expect(v.effective.api.level).toBe(0);
    expect(v.optInPolicy.level).toBe(3);
    expect(v.effective.assistant.enabled).toBe(false);
    const [row] = await (await db()).select().from(kv).where(eq(kv.key, "ai_optimizer"));
    expect(row).toBeTruthy();
    const key = await newKey();
    const messages = history();
    await api(key, { model: "opt-test", messages });
    expect(seen[0].messages).toEqual(messages);
  });

  it("the live benchmark sends original vs optimized to the same model and stops at its budget", async () => {
    const seen = scripted({ usage: (req) => ({ prompt_tokens: Math.ceil(JSON.stringify(req.messages).length / 4), completion_tokens: 50, cost: 0.004 }) });
    const d = await db();
    const fixtures = loadFixtures().filter((f) => ["assistant-history", "markdown-doc", "persian-support"].includes(f.id));
    const r = await liveBenchmark(d, { model: { ...MODEL }, budgetUsd: 100, fixtures });
    expect(r.results).toHaveLength(3);
    expect(seen).toHaveLength(6);
    expect(seen[0].model).toBe(seen[1].model);
    expect(seen[0].temperature).toBe(seen[1].temperature);
    expect(r.spentUsd).toBeCloseTo(6 * 0.004, 6);
    const a = r.results.find((x) => x.id === "assistant-history")!;
    expect(a.optimized.promptTokens).toBeLessThan(a.original.promptTokens);
    expect(a.original.usdReported).toBe(true);
    // the cap (settings: 5 USD at most) and a tiny budget: nothing is sent once the next pair would not fit
    seen.length = 0;
    const tiny = await liveBenchmark(d, { model: { ...MODEL }, budgetUsd: 0.0001, fixtures });
    expect(tiny.stoppedForBudget).toBe(true);
    expect(seen).toHaveLength(0);
    expect((await liveBenchmark(d, { model: { ...MODEL }, budgetUsd: 50, fixtures: [] })).budgetUsd).toBe(5);
  });

  it("benchmark RPCs: admin-triggered, saved in the database", async () => {
    scripted();
    await asUser();
    expect(await fails("aiOpt.benchStart", "opt-test", 1, false)).toMatch(/اجازه/);
    await asAdmin();
    const offline = await rpc<{ id: string; pass: boolean }[]>("aiOpt.offline");
    expect(offline.length).toBeGreaterThanOrEqual(10);
    expect(offline.every((x) => x.pass)).toBe(true);
    const id = await rpc<string>("aiOpt.benchStart", "opt-test", 1, false);
    for (let i = 0; i < 100; i++) {
      const [b] = await (await db()).select().from(aiOptBenchmarks).where(eq(aiOptBenchmarks.id, id));
      if (b.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const list = await rpc<{ id: string; status: string; report: { results?: unknown[] } }[]>("aiOpt.benchList");
    expect(list[0].id).toBe(id);
    expect(["done", "budget"]).toContain(list[0].status);
    expect(list[0].report.results?.length).toBeGreaterThan(0);
  });

  it("the optimizer works through the real upstream wrapper used by every call site", () => {
    expect(aiUpstream().name).toBe("sim");
  });
});
