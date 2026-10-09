/* The upstream model provider (OpenAI-compatible, e.g. https://codecraftapi.com/v1).
   AI_UPSTREAM_URL + AI_UPSTREAM_KEY select the real provider; without a key a deterministic simulator
   answers (tests, demos, development), streaming included. */
import "server-only";
import type { ChatRequest } from "./translate";
import { contentText } from "./translate";

export type Upstream = {
  name: "http" | "sim";
  /** returns the raw fetch Response (JSON, or SSE when req.stream) */
  chat(req: ChatRequest, signal?: AbortSignal): Promise<Response>;
  models(): Promise<{ id: string }[]>;
};

const base = () => (process.env.AI_UPSTREAM_URL || "https://codecraftapi.com/v1").replace(/\/$/, "");

class HttpUpstream implements Upstream {
  readonly name = "http" as const;
  chat(req: ChatRequest, signal?: AbortSignal) {
    return fetch(base() + "/chat/completions", {
      method: "POST", signal,
      headers: { authorization: "Bearer " + process.env.AI_UPSTREAM_KEY, "content-type": "application/json", accept: req.stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(req),
    });
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
}

let cached: Upstream | null = null;
export const aiUpstream = (): Upstream => (cached ??= process.env.AI_UPSTREAM_KEY ? new HttpUpstream() : new SimUpstream());
/** tests swap the upstream (e.g. a failing or slow one) */
export const setAiUpstream = (u: Upstream | null) => { cached = u; };
