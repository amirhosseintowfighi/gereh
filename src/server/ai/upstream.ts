/* The upstream model provider (OpenAI-compatible, e.g. https://codecraftapi.com/v1).
   AI_UPSTREAM_URL + AI_UPSTREAM_KEY select the real provider; without a key a deterministic simulator
   answers (tests, demos, development), streaming included. */
import "server-only";
import type { ChatRequest } from "./translate";
import { contentText } from "./translate";

export type Upstream = {
  name: "http" | "sim";
  /** returns the raw fetch Response (JSON, or SSE when req.stream) */
  chat(req: ChatRequest, signal?: AbortSignal, headers?: Record<string, string>): Promise<Response>;
  models(): Promise<{ id: string }[]>;
  /** JSON POST to another OpenAI-compatible path: embeddings, images/generations, audio/speech, rerank */
  post?(path: string, body: Record<string, unknown>, signal?: AbortSignal, headers?: Record<string, string>): Promise<Response>;
  /** multipart POST: images/edits, audio/transcriptions */
  form?(path: string, body: FormData, signal?: AbortSignal, headers?: Record<string, string>): Promise<Response>;
};

/** routing preference (price | throughput | latency) travels upstream in this header */
export const routeHeaders = (routing: string | null | undefined): Record<string, string> =>
  routing ? { [(process.env.AI_ROUTE_HEADER || "x-route-preference").toLowerCase()]: routing } : {};

const base = () => (process.env.AI_UPSTREAM_URL || "https://codecraftapi.com/v1").replace(/\/$/, "");

class HttpUpstream implements Upstream {
  readonly name = "http" as const;
  chat(req: ChatRequest, signal?: AbortSignal, headers: Record<string, string> = {}) {
    return fetch(base() + "/chat/completions", {
      method: "POST", signal,
      headers: { ...headers, authorization: "Bearer " + process.env.AI_UPSTREAM_KEY, "content-type": "application/json", accept: req.stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(req),
    });
  }
  post(path: string, body: Record<string, unknown>, signal?: AbortSignal, headers: Record<string, string> = {}) {
    return fetch(base() + "/" + path, { method: "POST", signal, headers: { ...headers, authorization: "Bearer " + process.env.AI_UPSTREAM_KEY, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  form(path: string, body: FormData, signal?: AbortSignal, headers: Record<string, string> = {}) {
    return fetch(base() + "/" + path, { method: "POST", signal, headers: { ...headers, authorization: "Bearer " + process.env.AI_UPSTREAM_KEY }, body });
  }
  async models() {
    const res = await fetch(base() + "/models", { headers: { authorization: "Bearer " + process.env.AI_UPSTREAM_KEY }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error("upstream /models " + res.status);
    const j = (await res.json()) as { data?: { id: string }[] };
    return (j.data ?? []).filter((m) => typeof m.id === "string");
  }
}

/** simulator: echoes the last user message; calls the first tool when the message asks for a tool */
class SimUpstream implements Upstream {
  readonly name = "sim" as const;
  async chat(req: ChatRequest) {
    const last = [...req.messages].reverse().find((m) => m.role === "user" || m.role === "tool");
    const said = contentText(last?.content).slice(0, 200);
    const promptTokens = Math.ceil(req.messages.map((m) => contentText(m.content)).join(" ").length / 3.5) + 3;
    const tools = Array.isArray(req.tools) ? req.tools : [];
    const wantsTool = last?.role === "user" && tools.length > 0 && /\btool\b|ابزار/i.test(said);
    const fn = wantsTool ? ((tools[0] as { function?: { name?: string } }).function?.name ?? "tool") : "";
    const text = wantsTool ? "" : last?.role === "tool" ? "نتیجه ابزار دریافت شد: " + said : "پاسخ آزمایشی گره: " + said;
    const usage = { prompt_tokens: promptTokens, completion_tokens: Math.ceil(text.length / 3.5) + (wantsTool ? 8 : 1) };
    const id = "chatcmpl-sim" + Date.now().toString(36);
    const call = wantsTool ? [{ id: "call_sim1", type: "function", function: { name: fn, arguments: JSON.stringify({ q: said }) } }] : undefined;
    if (!req.stream) {
      return Response.json({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: req.model, choices: [{ index: 0, message: { role: "assistant", content: text || null, ...(call ? { tool_calls: call } : {}) }, finish_reason: call ? "tool_calls" : "stop" }], usage });
    }
    const chunks: unknown[] = [];
    const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: req.model };
    chunks.push({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] });
    if (call) {
      const args = call[0].function.arguments;
      chunks.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: call[0].id, type: "function", function: { name: fn, arguments: "" } }] }, finish_reason: null }] });
      chunks.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(0, 5) } }] }, finish_reason: null }] });
      chunks.push({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }, finish_reason: null }] });
    } else {
      for (let i = 0; i < text.length; i += 12) chunks.push({ ...base, choices: [{ index: 0, delta: { content: text.slice(i, i + 12) }, finish_reason: null }] });
    }
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] });
    if ((req.stream_options as { include_usage?: boolean } | undefined)?.include_usage) chunks.push({ ...base, choices: [], usage });
    const body = chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n";
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }
  async models() { return [{ id: "sim-model" }]; }

  async post(path: string, body: Record<string, unknown>) {
    if (path === "embeddings") {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      const texts = input.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
      const tokens = texts.reduce((n, t) => n + Math.ceil(t.length / 3.5), 0);
      return Response.json({ object: "list", model: body.model, data: texts.map((t, index) => ({ object: "embedding", index, embedding: simEmbed(t) })), usage: { prompt_tokens: tokens, total_tokens: tokens } });
    }
    if (path === "images/generations") return Response.json(simImages(Number(body.n) || 1));
    if (path === "audio/speech") return new Response(simWav(String(body.input ?? "").length), { headers: { "content-type": "audio/wav" } });
    if (path === "rerank") {
      const q = simEmbed(String(body.query ?? ""));
      const docs = (Array.isArray(body.documents) ? body.documents : []).map((d) => (typeof d === "string" ? d : String((d as { text?: string }).text ?? "")));
      const results = docs.map((d, index) => ({ index, relevance_score: Math.round(dot(q, simEmbed(d)) * 1e4) / 1e4, ...(body.return_documents ? { document: { text: d } } : {}) }))
        .sort((a, b) => b.relevance_score - a.relevance_score).slice(0, Number(body.top_n) || docs.length);
      return Response.json({ id: "rerank-sim", results, usage: { search_units: 1 } });
    }
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  }

  async form(path: string, body: FormData) {
    if (path === "images/edits") return Response.json(simImages(Number(body.get("n")) || 1));
    if (path === "audio/transcriptions") {
      const f = body.get("file");
      const seconds = Math.max(1, Math.round((f instanceof Blob ? f.size : 0) / 16000));
      const text = "متن آزمایشی گره";
      if (body.get("response_format") === "verbose_json") return Response.json({ task: "transcribe", language: "fa", duration: seconds, text, segments: [] });
      if (body.get("response_format") === "text") return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
      return Response.json({ text });
    }
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  }
}

/* deterministic 64-dimensional "embedding": hashed character trigrams, L2-normalized, so similar texts score close */
function simEmbed(text: string) {
  const v = new Array<number>(64).fill(0);
  const t = " " + text.toLowerCase().replace(/\s+/g, " ").trim() + " ";
  for (let i = 0; i + 3 <= t.length; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) h = Math.imul(h ^ t.charCodeAt(j), 16777619);
    v[(h >>> 0) % 64] += 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / n) * 1e6) / 1e6);
}
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
// 1×1 transparent PNG
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const simImages = (n: number) => ({ created: Math.floor(Date.now() / 1000), data: Array.from({ length: Math.min(10, Math.max(1, n)) }, () => ({ b64_json: PNG_1PX })) });
/** a silent 8 kHz mono WAV, ~60 ms per character */
function simWav(chars: number) {
  const samples = Math.min(8000 * 60, Math.max(800, chars * 480));
  const b = new Uint8Array(44 + samples);
  const dv = new DataView(b.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + samples, true); w(8, "WAVEfmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, "data"); dv.setUint32(40, samples, true);
  b.fill(128, 44);
  return b;
}

let cached: Upstream | null = null;
export const aiUpstream = (): Upstream => (cached ??= process.env.AI_UPSTREAM_KEY ? new HttpUpstream() : new SimUpstream());
/** tests swap the upstream (e.g. a failing or slow one) */
export const setAiUpstream = (u: Upstream | null) => { cached = u; };
