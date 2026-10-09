import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateway } from "@/server/ai/gateway";
import { createKey, settleAi, tehranStarts } from "@/server/ai/service";
import { setAiUpstream } from "@/server/ai/upstream";
import { aiKeys, aiModels, aiUsage, transactions, users } from "@/server/db/schema";
import { db, fresh } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => setAiUpstream(null));

const balance = async () => (await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance;
const newKey = async (over: Partial<{ models: string[]; dailyCap: number; monthlyCap: number; rpm: number }> = {}) =>
  (await createKey(await db(), "u1", { name: "test", models: [], dailyCap: 0, monthlyCap: 0, rpm: 120, expiresDays: 0, ...over })).key;
const call = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  gateway(await db(), new Request("https://api.gereh.dev/" + path, { method: init.method ?? "POST", headers: { "content-type": "application/json", ...init.headers }, body: init.body ? JSON.stringify(init.body) : undefined }), path.split("?")[0]);
const sseEvents = (t: string) => t.split("\n\n").filter((b) => b.includes("data: ") && !b.includes("[DONE]")).map((b) => JSON.parse(/^data: (.+)$/m.exec(b)![1]));

describe("AI gateway", () => {
  it("OpenAI chat: authenticates, answers, charges the real cost and settles into one transaction", async () => {
    const key = await newKey();
    const before = await balance();
    const r = await call("v1/chat/completions", { headers: { authorization: "Bearer " + key }, body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "سلام" }], max_tokens: 100 } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ object: "chat.completion", model: "gpt-4o-mini", choices: [{ message: { content: "پاسخ آزمایشی گره: سلام" } }] });
    const charged = Number(r.headers.get("x-gereh-charged-toman"));
    expect(charged).toBeGreaterThan(0);
    expect(await balance()).toBe(before - charged); // reserve refunded down to the real cost
    const d = await db();
    const [u] = await d.select().from(aiUsage).where(eq(aiUsage.id, r.headers.get("x-gereh-request-id")!));
    expect(u).toMatchObject({ status: "success", format: "openai", charged, estimated: false, billed: false });
    await settleAi(d);
    expect((await d.select().from(transactions).where(eq(transactions.userId, "u1"))).some((t) => t.type === "usage" && t.amount === -charged)).toBe(true);
  });

  it("rejects bad keys, unknown or disallowed models, and lists models in each format", async () => {
    expect((await call("v1/chat/completions", { headers: { authorization: "Bearer gk-nope" }, body: { model: "x", messages: [] } })).status).toBe(401);
    const key = await newKey({ models: ["gpt-4o-mini"] });
    const a = await call("v1/messages", { headers: { "x-api-key": key }, body: { model: "claude-opus-5.5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } });
    expect(a.status).toBe(403);
    expect(await a.json()).toMatchObject({ type: "error", error: { type: "permission_error" } });
    const g = await call("v1beta/models/nope:generateContent", { headers: { "x-goog-api-key": key }, body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } });
    expect(g.status).toBe(404);
    expect(await g.json()).toMatchObject({ error: { code: 404, status: "NOT_FOUND" } });
    const list = await (await call("v1/models", { method: "GET", headers: { authorization: "Bearer " + key } })).json();
    expect(list.data.map((m: { id: string }) => m.id)).toEqual(["gpt-4o-mini"]);
    const anth = await (await call("v1/models", { method: "GET", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } })).json();
    expect(anth.data[0]).toMatchObject({ type: "model", id: "gpt-4o-mini" });
    const gem = await (await call("v1beta/models", { method: "GET", headers: { "x-goog-api-key": key } })).json();
    expect(gem.models[0].name).toBe("models/gpt-4o-mini");
  });

  it("Anthropic Messages (Claude Code): JSON, tool use and the streamed event sequence", async () => {
    const key = await newKey();
    const tools = [{ name: "read_file", description: "read", input_schema: { type: "object", properties: { q: { type: "string" } } } }];
    const j = await (await call("v1/messages", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, body: { model: "claude-opus-5.5", max_tokens: 200, tools, messages: [{ role: "user", content: "use the tool please" }] } })).json();
    expect(j).toMatchObject({ type: "message", model: "claude-opus-5.5", stop_reason: "tool_use", content: [{ type: "tool_use", name: "read_file", input: { q: "use the tool please" } }] });
    const r = await call("v1/messages", { headers: { "x-api-key": key }, body: { model: "claude-opus-5.5", max_tokens: 200, stream: true, messages: [{ role: "user", content: "hello there" }] } });
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const ev = sseEvents(await r.text());
    expect(ev[0].type).toBe("message_start");
    expect(ev.filter((e) => e.type === "content_block_delta").map((e) => e.delta.text).join("")).toBe("پاسخ آزمایشی گره: hello there");
    expect(ev.at(-2)).toMatchObject({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    expect(ev.at(-1).type).toBe("message_stop");
    const d = await db();
    const rows = await d.select().from(aiUsage).where(eq(aiUsage.userId, "u1"));
    expect(rows.filter((x) => x.format === "anthropic" && x.status === "success")).toHaveLength(2);
    const tokens = await (await call("v1/messages/count_tokens", { headers: { "x-api-key": key }, body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "hello" }] } })).json();
    expect(tokens.input_tokens).toBeGreaterThan(0);
  });

  it("OpenAI Responses (Codex) and Gemini, streamed and not", async () => {
    const key = await newKey();
    const resp = await (await call("v1/responses", { headers: { authorization: "Bearer " + key }, body: { model: "gpt-5.5", input: "hi codex", store: false } })).json();
    expect(resp).toMatchObject({ object: "response", status: "completed", output_text: "پاسخ آزمایشی گره: hi codex" });
    const rs = sseEvents(await (await call("v1/responses", { headers: { authorization: "Bearer " + key }, body: { model: "gpt-5.5", input: "x", stream: true } })).text());
    expect(rs.at(-1)).toMatchObject({ type: "response.completed", response: { output_text: "پاسخ آزمایشی گره: x" } });
    expect((await call("v1/responses", { headers: { authorization: "Bearer " + key }, body: { model: "gpt-5.5", input: "x", previous_response_id: "r1" } })).status).toBe(400);

    const g = await (await call("v1beta/models/gemini-3.8-flash:generateContent?key=" + key, { body: { contents: [{ role: "user", parts: [{ text: "salam" }] }] } })).json();
    expect(g.candidates[0].content.parts[0].text).toBe("پاسخ آزمایشی گره: salam");
    const gs = await call("v1beta/models/gemini-3.8-flash:streamGenerateContent", { headers: { "x-goog-api-key": key }, body: { contents: [{ role: "user", parts: [{ text: "s" }] }] } });
    expect(Array.isArray(await gs.json())).toBe(true); // no alt=sse → one JSON array
  });

  it("OpenAI chat streaming passes chunks through with the public model id", async () => {
    const key = await newKey();
    const r = await call("v1/chat/completions", { headers: { authorization: "Bearer " + key }, body: { model: "deepseek-v3.2", stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "abc" }] } });
    const text = await r.text();
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
    const chunks = sseEvents(text);
    expect(chunks.every((c) => c.model === "deepseek-v3.2")).toBe(true);
    expect(chunks.at(-1).usage.prompt_tokens).toBeGreaterThan(0); // customer asked for usage
  });

  it("refunds everything when the upstream fails, and enforces wallet and key budgets", async () => {
    const key = await newKey({ dailyCap: 3 });
    const d = await db();
    setAiUpstream({ name: "http", chat: async () => new Response("boom", { status: 500 }), models: async () => [] });
    const before = await balance();
    const r = await call("v1/chat/completions", { headers: { authorization: "Bearer " + key }, body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }], max_tokens: 5 } });
    expect(r.status).toBe(502);
    expect(await balance()).toBe(before);
    setAiUpstream(null);
    // a big max_tokens reserve does not fit the 3-Toman daily cap
    const capped = await call("v1/chat/completions", { headers: { authorization: "Bearer " + key }, body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "x" }], max_tokens: 4000 } });
    expect(capped.status).toBe(402);
    expect((await capped.json()).error.code).toBe("key_budget_exceeded");
    await d.update(users).set({ balance: 1 }).where(eq(users.id, "u1"));
    const poor = await call("v1/chat/completions", { headers: { authorization: "Bearer " + (await newKey()) }, body: { model: "claude-opus-5.5", messages: [{ role: "user", content: "x" }], max_tokens: 4000 } });
    expect(poor.status).toBe(402);
    expect((await poor.json()).error.code).toBe("insufficient_balance");
    await d.update(aiKeys).set({ status: "revoked" }).where(eq(aiKeys.userId, "u1"));
    expect((await call("v1/chat/completions", { headers: { authorization: "Bearer " + key }, body: { model: "gpt-4o-mini", messages: [{ role: "user", content: "x" }] } })).status).toBe(403);
  });

  it("seeds a priced catalog and computes Tehran day boundaries", async () => {
    const m = await (await db()).select().from(aiModels).where(eq(aiModels.id, "claude-opus-5.5"));
    expect(m[0].inPrice).toBeLessThan(m[0].refIn);
    const { day, month } = tehranStarts(Date.UTC(2026, 9, 9, 22, 0)); // 01:30 Tehran on the 10th
    expect(day.toISOString()).toBe("2026-10-09T20:30:00.000Z");
    expect(month.toISOString()).toBe("2026-09-30T20:30:00.000Z");
  });
});
