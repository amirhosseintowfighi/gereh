import { deflateSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkText, cosine, kindCost } from "@/lib/ai";
import { chatCode, toCsv } from "@/lib/ai-code";
import { chatSend } from "@/server/ai/chat";
import { htmlText, pdfText } from "@/server/ai/extract";
import { gateway } from "@/server/ai/gateway";
import { lowBalanceAlerts, purgeAiLogs } from "@/server/ai/reports";
import { createKey, settleAi } from "@/server/ai/service";
import { aiUpstream, setAiUpstream } from "@/server/ai/upstream";
import { context } from "@/server/ctx";
import { aiBodies, aiChatMessages, aiKeys, aiModels, aiSettings, aiUsage, notifications, users } from "@/server/db/schema";
import { callRoute } from "@/server/mcp";
import { buildState } from "@/server/state";
import { asUser, call as rpc, db, fails, fresh } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => setAiUpstream(null));

const CHAT = "test-chat", VISION = "test-vision", EMBED = "test-embed", IMAGE = "test-image", TTS = "test-tts", STT = "test-stt", RERANK = "test-rerank";
async function seedModels() {
  const d = await db();
  await d.insert(aiModels).values([
    { id: CHAT, name: "Chat", vendor: "other", kind: "chat", inPrice: 100_000, outPrice: 400_000 },
    { id: VISION, name: "Vision", vendor: "other", kind: "chat", inPrice: 100_000, outPrice: 400_000, vision: true },
    { id: EMBED, name: "Embed", vendor: "other", kind: "embedding", inPrice: 20_000, outPrice: 0 },
    { id: IMAGE, name: "Image", vendor: "other", kind: "image", inPrice: 0, outPrice: 0, unitPrice: 3_000 },
    { id: TTS, name: "TTS", vendor: "other", kind: "tts", inPrice: 1_500_000, outPrice: 0 },
    { id: STT, name: "STT", vendor: "other", kind: "stt", inPrice: 0, outPrice: 0, unitPrice: 600 },
    { id: RERANK, name: "Rerank", vendor: "other", kind: "rerank", inPrice: 0, outPrice: 0, unitPrice: 2_000 },
  ]).onConflictDoNothing();
}
const balance = async (uid = "u1") => (await (await db()).select().from(users).where(eq(users.id, uid)))[0].balance;
type KeyOver = Partial<{ models: string[]; dailyCap: number; monthlyCap: number; ips: string[]; routing: string; projectId: string | null }>;
const newKey = async (over: KeyOver = {}, uid = "u1") => (await createKey(await db(), uid, { name: "t", models: [], dailyCap: 0, monthlyCap: 0, rpm: 120, expiresDays: 0, ...over })).key;
const call = async (path: string, key: string, body?: unknown, headers: Record<string, string> = {}) =>
  gateway(await db(), new Request("https://api.gereh.dev/" + path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), path);
const callForm = async (path: string, key: string, form: FormData) =>
  gateway(await db(), new Request("https://api.gereh.dev/" + path, { method: "POST", headers: { authorization: "Bearer " + key }, body: form }), path);
const usageRow = async (id: string) => (await (await db()).select().from(aiUsage).where(eq(aiUsage.id, id)))[0];
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function readStream(res: Response) {
  const text = await res.text();
  const ev = text.split("\n\n").filter((b) => b.startsWith("data: ") && !b.includes("[DONE]")).map((b) => JSON.parse(b.slice(6)));
  return { text: ev.filter((e) => e.choices).map((e) => e.choices[0]?.delta?.content ?? "").join(""), meta: ev.filter((e) => e.gereh).map((e) => e.gereh) };
}

describe("AI plus: pure helpers", () => {
  it("prices every kind in its own unit", () => {
    const m = { inPrice: 1_500_000, outPrice: 0, unitPrice: 600 };
    expect(kindCost("embedding", { ...m, inPrice: 20_000 }, { tokens: 1000 })).toBe(20);
    expect(kindCost("image", { ...m, unitPrice: 3000 }, { images: 2 })).toBe(6000);
    expect(kindCost("tts", m, { chars: 1000 })).toBe(1500);
    expect(kindCost("stt", m, { seconds: 90 })).toBe(900);
    expect(kindCost("rerank", { ...m, unitPrice: 2000 }, { searches: 1 })).toBe(2);
    expect(kindCost("stt", m, { seconds: 0 })).toBe(0);
  });

  it("cosine, chunking, code snippets and CSV", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    const long = Array.from({ length: 40 }, (_, i) => "جمله شماره " + i + " درباره سرور ابری است.").join(" ");
    const chunks = chunkText("عنوان\n\n" + long + "\n\nپاراگراف آخر", 300, 50);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.length <= 360)).toBe(true);
    expect(chunks.join(" ")).toContain("پاراگراف آخر");
    expect(chunkText("   ")).toEqual([]);
    const req = { model: CHAT, temperature: 0.3, stream: true, messages: [{ role: "system" as const, content: "be brief" }, { role: "user" as const, content: "it's \"ok\"" }] };
    const curl = chatCode("curl", "https://api.gereh.dev", req);
    expect(curl).toContain("https://api.gereh.dev/v1/chat/completions");
    expect(curl).toContain("it'\\''s"); // shell-quoted
    expect(chatCode("js", "https://x", req)).toContain('baseURL: "https://x/v1"');
    const py = chatCode("python", "https://x", req);
    expect(py).toContain("temperature=0.3");
    expect(py).toContain('"content": "it\'s \\"ok\\""');
    expect(chatCode("python", "https://x", { ...req, stream: false })).not.toContain("stream=True");
    expect(toCsv([["a", "b,c"], [1, 'q"x']])).toBe('﻿a,"b,c"\r\n1,"q""x"\r\n');
  });

  it("extracts text from HTML and simple PDFs", () => {
    expect(htmlText("<html><style>x{}</style><h1>Title</h1><p>a &amp; b&nbsp;c</p><script>bad()</script></html>")).toBe("Title\na & b c");
    const content = deflateSync(Buffer.from("BT /F1 12 Tf 72 712 Td (Hello PDF world) Tj T* [(Second) -250 ( line \\(ok\\))] TJ ET", "latin1"));
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n4 0 obj\n<< /Length " + content.length + " /Filter /FlateDecode >>\nstream\n", "latin1"), content, Buffer.from("\nendstream\nendobj\n%%EOF", "latin1")]);
    expect(pdfText(pdf)).toBe("Hello PDF world\nSecond line (ok)");
  });
});

describe("AI plus: new gateway endpoints", () => {
  it("embeddings: kind check, metering and the public model id", async () => {
    await seedModels();
    const key = await newKey();
    const wrong = await call("v1/embeddings", key, { model: CHAT, input: "x" });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("wrong_model_kind");
    expect((await call("v1/chat/completions", key, { model: EMBED, messages: [{ role: "user", content: "x" }] })).status).toBe(400);
    expect((await call("v1/embeddings", key, { model: EMBED, input: [] })).status).toBe(400);
    const before = await balance();
    const r = await call("v1/embeddings", key, { model: EMBED, input: ["سلام دنیا", "hello world"] });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.model).toBe(EMBED);
    expect(j.data).toHaveLength(2);
    expect(j.data[0].embedding).toHaveLength(64);
    const charged = Number(r.headers.get("x-gereh-charged-toman"));
    expect(charged).toBe(1);
    expect(await balance()).toBe(before - charged);
    expect(await usageRow(r.headers.get("x-gereh-request-id")!)).toMatchObject({ format: "embeddings", status: "success", inTokens: j.usage.prompt_tokens, charged, finish: "stop" });
    // the models list carries the kind and its price unit
    const list = await (await gateway(await db(), new Request("https://api.gereh.dev/v1/models", { headers: { authorization: "Bearer " + key } }), "v1/models")).json();
    expect(list.data.find((m: { id: string }) => m.id === IMAGE)).toMatchObject({ kind: "image", pricing: { toman_per_image: 3000 } });
  });

  it("images (JSON and multipart), speech, transcription and rerank are billed in their units", async () => {
    await seedModels();
    const key = await newKey();
    const g = await call("v1/images/generations", key, { model: IMAGE, prompt: "a cat", n: 2 });
    expect(g.status).toBe(200);
    expect((await g.json()).data).toHaveLength(2);
    expect(Number(g.headers.get("x-gereh-charged-toman"))).toBe(6000);
    expect(await usageRow(g.headers.get("x-gereh-request-id")!)).toMatchObject({ format: "images", units: 2 });
    expect((await call("v1/images/generations", key, { model: IMAGE, prompt: "x", n: 11 })).status).toBe(400);

    const ef = new FormData();
    ef.set("model", IMAGE); ef.set("prompt", "add a hat"); ef.set("image", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), "cat.png");
    const e = await callForm("v1/images/edits", key, ef);
    expect(e.status).toBe(200);
    expect(Number(e.headers.get("x-gereh-charged-toman"))).toBe(3000);

    const s = await call("v1/audio/speech", key, { model: TTS, input: "سلام".repeat(250), voice: "alloy" });
    expect(s.status).toBe(200);
    expect(s.headers.get("content-type")).toBe("audio/wav");
    expect((await s.arrayBuffer()).byteLength).toBeGreaterThan(44);
    expect(Number(s.headers.get("x-gereh-charged-toman"))).toBe(1500); // 1000 chars × 1.5M / 1M

    const tf = new FormData();
    tf.set("model", STT); tf.set("response_format", "verbose_json"); tf.set("file", new Blob([new Uint8Array(16000 * 90)], { type: "audio/mpeg" }), "a.mp3");
    const t = await callForm("v1/audio/transcriptions", key, tf);
    expect(t.status).toBe(200);
    expect(await t.json()).toMatchObject({ text: "متن آزمایشی گره", duration: 90 });
    expect(Number(t.headers.get("x-gereh-charged-toman"))).toBe(900);
    const bad = new FormData(); bad.set("model", STT);
    expect((await callForm("v1/audio/transcriptions", key, bad)).status).toBe(400);

    const rr = await call("v1/rerank", key, { model: RERANK, query: "cloud server price", documents: ["recipe for cake", "cloud server price list", "football"], top_n: 2 });
    const rj = await rr.json();
    expect(rj.results).toHaveLength(2);
    expect(rj.results[0].index).toBe(1);
    expect(Number(rr.headers.get("x-gereh-charged-toman"))).toBe(2);
  });

  it("refunds a failed non-chat call and reports a missing upstream path", async () => {
    await seedModels();
    const key = await newKey();
    const sim = aiUpstream();
    setAiUpstream({ ...sim, name: "http", chat: sim.chat.bind(sim), models: sim.models.bind(sim), post: async () => new Response("down", { status: 503 }), form: sim.form!.bind(sim) });
    const before = await balance();
    const r = await call("v1/embeddings", key, { model: EMBED, input: "x" });
    expect(r.status).toBe(502);
    expect(await balance()).toBe(before);
    setAiUpstream({ name: "http", chat: sim.chat.bind(sim), models: sim.models.bind(sim) });
    expect((await call("v1/embeddings", key, { model: EMBED, input: "x" })).status).toBe(501);
  });
});

describe("AI plus: keys, routing, projects", () => {
  it("IP allowlist, enable/disable, expiry edits, routing header and the :online suffix", async () => {
    await seedModels();
    await asUser();
    const key = await rpc<string>("ai.createKey", { name: "ip", models: [], dailyCap: 0, monthlyCap: 0, rpm: 60, expiresDays: 0, ips: ["10.0.0.0/24", "2001:db8::1"], routing: "price", projectId: null });
    const body = { model: CHAT, messages: [{ role: "user", content: "hi" }], max_tokens: 50 };
    expect((await call("v1/chat/completions", key, body, { "x-real-ip": "10.0.1.5" })).status).toBe(403);
    let seen: { headers: Record<string, string>; model: string } | null = null;
    const sim = aiUpstream();
    setAiUpstream({ name: "http", models: async () => [], chat: async (req, signal, headers = {}) => { seen = { headers, model: req.model }; return sim.chat(req, signal); } });
    const ok = await call("v1/chat/completions", key, body, { "x-real-ip": "10.0.0.7" });
    expect(ok.status).toBe(200);
    expect(seen).toMatchObject({ headers: { "x-route-preference": "price" }, model: CHAT });
    const online = await call("v1/chat/completions", key, { ...body, model: CHAT + ":online" }, { "x-real-ip": "2001:db8::1" });
    expect(online.status).toBe(200);
    expect(seen!.model).toBe(CHAT + ":online");
    expect((await online.json()).model).toBe(CHAT + ":online");

    const id = (await (await db()).select().from(aiKeys).where(eq(aiKeys.userId, "u1")))[0].id;
    await rpc("ai.setKeyEnabled", id, false);
    const off = await call("v1/chat/completions", key, body, { "x-real-ip": "10.0.0.7" });
    expect(off.status).toBe(403);
    expect((await off.json()).error.code).toBe("key_disabled");
    await rpc("ai.updateKey", id, { ips: [], expiresDays: 7, routing: "latency" });
    await rpc("ai.setKeyEnabled", id, true);
    const st = (await buildState((await context()).db, (await context()).auth, "customer")).db.ai;
    expect(st.keys[0]).toMatchObject({ status: "active", ips: [], routing: "latency", expiresIn: 7 });
    expect((await call("v1/chat/completions", key, body)).status).toBe(200);
    expect(await fails("ai.updateKey", id, { ips: ["not-an-ip"] })).toBeTruthy();
  });

  it("projects group keys and cap their monthly spend", async () => {
    await seedModels();
    await asUser();
    const pid = await rpc<string>("ai.projectSave", { name: "ربات پشتیبانی", monthlyLimit: 5 });
    const key = await rpc<string>("ai.createKey", { name: "bot", models: [], dailyCap: 0, monthlyCap: 0, rpm: 60, expiresDays: 0, ips: [], routing: "", projectId: pid });
    const r = await call("v1/chat/completions", key, { model: CHAT, messages: [{ role: "user", content: "x" }], max_tokens: 10 });
    expect(r.status).toBe(200);
    expect((await usageRow(r.headers.get("x-gereh-request-id")!)).projectId).toBe(pid);
    const capped = await call("v1/chat/completions", key, { model: CHAT, messages: [{ role: "user", content: "x" }], max_tokens: 4000 });
    expect(capped.status).toBe(402);
    expect((await capped.json()).error.code).toBe("project_budget_exceeded");
    const st = (await buildState((await context()).db, (await context()).auth, "customer")).db.ai;
    expect(st.projects[0]).toMatchObject({ id: pid, keys: 1, monthlyLimit: 5 });
    expect(st.projects[0].spentMonth).toBeGreaterThan(0);
    await fails("ai.createKey", { name: "x", models: [], dailyCap: 0, monthlyCap: 0, rpm: 60, expiresDays: 0, ips: [], routing: "", projectId: "pj-nope" });
    await rpc("ai.projectDelete", pid);
    expect((await (await db()).select().from(aiKeys).where(eq(aiKeys.userId, "u1")))[0].projectId).toBeNull();
  });
});

describe("AI plus: logs, reports, retention, alerts", () => {
  it("logs finish reasons, filters, keeps bodies only when opted in, and reports per day/model/key", async () => {
    await seedModels();
    await asUser();
    const key = await newKey();
    const body = { model: CHAT, messages: [{ role: "user", content: "secret prompt" }], max_tokens: 50 };
    await call("v1/chat/completions", key, body);
    expect(await (await db()).select().from(aiBodies)).toHaveLength(0); // off by default
    await rpc("ai.saveSettings", { retentionDays: 60, logBodies: true, lowBalance: 0 });
    const r2 = await call("v1/chat/completions", key, body);
    const reqId = r2.headers.get("x-gereh-request-id")!;
    await call("v1/embeddings", key, { model: "nope", input: "x" }); // 404, not logged
    const logs = await rpc<{ total: number; rows: { id: string; finish: string; hasBody: boolean; keyName: string }[] }>("ai.logs", { days: 7 });
    expect(logs.total).toBe(2);
    expect(logs.rows[0]).toMatchObject({ id: reqId, finish: "stop", hasBody: true, keyName: "t" });
    expect((await rpc<{ total: number }>("ai.logs", { days: 7, status: "error" })).total).toBe(0);
    expect((await rpc<{ total: number }>("ai.logs", { days: 7, keyId: "panel" })).total).toBe(0);
    expect((await rpc<{ total: number }>("ai.logs", { days: 7, q: reqId })).total).toBe(1);
    const b = await rpc<{ request: string; response: string }>("ai.logBody", reqId);
    expect(b.request).toContain("secret prompt");
    expect(b.response).toContain("پاسخ آزمایشی گره");
    const rep = await rpc<{ daily: { count: number }[]; byModel: { model: string; count: number }[]; byKey: { keyName: string; count: number }[] }>("ai.report", 7);
    expect(rep.daily.at(-1)!.count).toBe(2);
    expect(rep.byModel[0]).toMatchObject({ model: CHAT, count: 2 });
    expect(rep.byKey[0]).toMatchObject({ keyName: "t", count: 2 });
    const st = (await buildState((await context()).db, (await context()).auth, "customer")).db.ai;
    expect(st.settings).toEqual({ retentionDays: 60, logBodies: true, lowBalance: 0 });
    expect(st.usage[0].finish).toBe("stop");
  });

  it("purges billed logs past retention and alerts once on low balance", async () => {
    await seedModels();
    const key = await newKey();
    const d = await db();
    for (let i = 0; i < 2; i++) await call("v1/chat/completions", key, { model: CHAT, messages: [{ role: "user", content: "x" }], max_tokens: 10 });
    await settleAi(d);
    const [a, b] = await d.select().from(aiUsage);
    await d.update(aiUsage).set({ createdAt: new Date(Date.now() - 45 * 86400_000) }).where(eq(aiUsage.id, a.id));
    await d.update(aiUsage).set({ createdAt: new Date(Date.now() - 70 * 86400_000) }).where(eq(aiUsage.id, b.id));
    await d.insert(aiSettings).values({ userId: "u1", retentionDays: 60 });
    await purgeAiLogs(d);
    expect((await d.select().from(aiUsage)).map((x) => x.id)).toEqual([a.id]);
    await d.update(aiSettings).set({ retentionDays: 30 }).where(eq(aiSettings.userId, "u1"));
    await purgeAiLogs(d);
    expect(await d.select().from(aiUsage)).toHaveLength(0);

    await d.update(aiSettings).set({ lowBalance: (await balance()) + 1 }).where(eq(aiSettings.userId, "u1"));
    await lowBalanceAlerts(d);
    await lowBalanceAlerts(d);
    const alerts = async () => (await d.select().from(notifications).where(and(eq(notifications.userId, "u1"), eq(notifications.icon, "wallet")))).filter((n) => n.text.includes("حد هشدار"));
    expect(await alerts()).toHaveLength(1);
    await d.update(users).set({ balance: 999_999_999 }).where(eq(users.id, "u1"));
    await lowBalanceAlerts(d);
    expect((await d.select().from(aiSettings))[0].lowAlertedAt).toBeNull();
  });
});

describe("AI plus: knowledge base, web chat, embedding playground", () => {
  it("builds a knowledge base, queries it over the gateway and MCP route, and keeps it private", async () => {
    await seedModels();
    await asUser();
    expect(await fails("ai.kbCreate", "دانش", CHAT)).toContain("گفتگو");
    const kb = await rpc<string>("ai.kbCreate", "راهنمای محصول", EMBED);
    const doc = "# Servers\n\nCloud server pricing starts at 290000 toman per month.\n\n# Domains\n\nDomain registration for .ir costs 90000 toman a year.";
    const up = await rpc<{ chunks: number; charged: number }>("ai.kbUpload", kb, { name: "guide.md", mime: "text/markdown", data: b64(doc) });
    expect(up.chunks).toBeGreaterThan(0);
    expect(up.charged).toBeGreaterThan(0);
    await rpc("ai.kbUpload", kb, { name: "page.html", mime: "text/html", data: b64("<h1>Support</h1><p>Support tickets are answered within one hour by the team.</p>") });
    expect(await fails("ai.kbUpload", kb, { name: "x.exe", mime: "application/octet-stream", data: b64("MZ") })).toContain("pdf");
    const st = (await buildState((await context()).db, (await context()).auth, "customer")).db.ai;
    expect(st.kbs[0]).toMatchObject({ id: kb, model: EMBED });
    expect(st.kbs[0].docs).toHaveLength(2);

    const key = await newKey();
    const r = await call("v1/kb/" + kb + "/query", key, { query: "support tickets answered", top_k: 1 });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.data).toHaveLength(1);
    expect(j.data[0]).toMatchObject({ document: "page.html" });
    expect((await usageRow((await (await db()).select().from(aiUsage).where(eq(aiUsage.format, "kb")))[0].id)).model).toBe(EMBED);

    const ctx = await context();
    const viaMcp = await callRoute(ctx, "read-write", "POST", "ai/kb/" + kb + "/query", { query: "domain registration", top_k: 1 }) as { data: { document: string }[] };
    expect(viaMcp.data[0].document).toBe("guide.md");
    await expect(callRoute(ctx, "read", "POST", "ai/kb/" + kb + "/query", { query: "x" })).rejects.toThrow();

    const other = await newKey({}, "u2");
    expect((await call("v1/kb/" + kb + "/query", other, { query: "x" })).status).toBe(404);
    const s = await rpc<{ hits: { document: string }[] }>("ai.kbSearch", kb, "cloud server pricing", 1);
    expect(s.hits[0].document).toBe("guide.md");
    await rpc("ai.kbDocDelete", st.kbs[0].docs[0].id);
    await rpc("ai.kbDelete", kb);
    expect((await buildState((await context()).db, (await context()).auth, "customer")).db.ai.kbs).toHaveLength(0);
  });

  it("web chat: conversations, streaming with history, knowledge-base sources and attachments", async () => {
    await seedModels();
    await asUser();
    const kb = await rpc<string>("ai.kbCreate", "kb", EMBED);
    await rpc("ai.kbUpload", kb, { name: "faq.txt", mime: "text/plain", data: b64("Refunds are processed within three working days after the request.") });
    const id = await rpc<string>("ai.chatCreate", { model: CHAT, system: "کوتاه پاسخ بده", temperature: 0.2, kbId: null });
    const before = await balance();
    const res = await chatSend(await db(), "u1", id, "سلام گره", []);
    expect(res).toBeInstanceOf(Response);
    const first = await readStream(res as Response);
    expect(first.text).toBe("پاسخ آزمایشی گره: سلام گره");
    expect(first.meta.at(-1).charged).toBeGreaterThan(0);
    expect(await balance()).toBeLessThan(before);
    await rpc("ai.chatUpdate", id, { kbId: kb, title: "پشتیبانی" });
    const second = await readStream((await chatSend(await db(), "u1", id, "refunds processed when?", [{ name: "note.txt", type: "text", data: "extra context" }])) as Response);
    expect(second.meta[0].sources[0].document).toBe("faq.txt");
    const full = await rpc<{ title: string; kbId: string; messages: { role: string; content: string; attachments: { name: string }[] }[] }>("ai.chatGet", id);
    expect(full).toMatchObject({ title: "پشتیبانی", kbId: kb });
    expect(full.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(full.messages[2].attachments).toEqual([{ name: "note.txt", type: "text" }]);
    const list = await rpc<{ id: string }[]>("ai.chats");
    expect(list[0].id).toBe(id);

    const img = { name: "a.png", type: "image" as const, data: "data:image/png;base64,iVBORw0KGgo=" };
    expect(await chatSend(await db(), "u1", id, "what is this?", [img])).toMatchObject({ http: 400 });
    const vis = await rpc<string>("ai.chatCreate", { model: VISION, system: "", temperature: 1, kbId: null });
    expect(await chatSend(await db(), "u1", vis, "what is this?", [img])).toBeInstanceOf(Response);
    expect(await chatSend(await db(), "u2", id, "not mine", [])).toMatchObject({ http: 404 });
    await rpc("ai.chatDelete", id);
    expect(await (await db()).select().from(aiChatMessages).where(eq(aiChatMessages.chatId, id))).toHaveLength(0);
  });

  it("embedding playground ranks texts by cosine similarity", async () => {
    await seedModels();
    await asUser();
    const r = await rpc<{ ranked: { text: string; score: number }[]; dims: number; charged: number }>("ai.embedCompare", EMBED, ["how to bake bread", "cloud server monthly price", "football results"], "server price per month");
    expect(r.ranked[0].text).toBe("cloud server monthly price");
    expect(r.ranked[0].score).toBeGreaterThan(r.ranked[2].score);
    expect(r.dims).toBe(64);
    expect(r.charged).toBeGreaterThan(0);
    expect(await fails("ai.embedCompare", CHAT, ["a"], "b")).toBeTruthy();
  });

  it("admin prices non-chat models by kind", async () => {
    const { asAdmin } = await import("./helpers");
    await asAdmin();
    expect(await fails("ai.adminAddModel", { id: "img-x", name: "Img", vendor: "other", upstream: "", inPrice: 0, outPrice: 0, context: 8192, kind: "image", unitPrice: 0 })).toBeTruthy();
    await rpc("ai.adminAddModel", { id: "img-x", name: "Img", vendor: "other", upstream: "", inPrice: 0, outPrice: 0, context: 8192, kind: "image", unitPrice: 2500 });
    await rpc("ai.adminModel", "img-x", { active: true });
    expect((await (await db()).select().from(aiModels).where(eq(aiModels.id, "img-x")))[0]).toMatchObject({ kind: "image", unitPrice: 2500, active: true });
    await rpc("ai.adminModel", "img-x", { kind: "tts", active: false });
    expect(await fails("ai.adminModel", "img-x", { active: true })).toContain("قیمت");
  });
});

