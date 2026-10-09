/* Format translation for the AI gateway. The upstream speaks only OpenAI Chat Completions, so every
   customer format is turned into a chat request, and the chat answer (or its stream) is turned back:
     Anthropic Messages  (/v1/messages)            — Claude Code, Anthropic SDKs
     OpenAI Responses    (/v1/responses)           — Codex CLI, newer OpenAI SDKs
     Gemini              (/v1beta/models/x:generateContent, :streamGenerateContent)
   OpenAI Chat itself passes through untouched apart from the model id.
   Pure functions only: no I/O, so every mapping is unit-tested. */

type J = Record<string, unknown>;
export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content?: unknown; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatRequest = J & { model: string; messages: ChatMessage[]; stream?: boolean; max_tokens?: number; tools?: J[]; tool_choice?: unknown };
export type ChatUsage = { prompt_tokens: number; completion_tokens: number };
/** a finished chat answer, reduced to what the other formats need */
export type ChatResult = { id: string; text: string; toolCalls: ToolCall[]; finish: string; usage: ChatUsage | null };

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const parseArgs = (s: string): unknown => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
let seq = 0;
export const genId = (prefix: string) => prefix + Date.now().toString(36) + (++seq).toString(36) + Math.random().toString(36).slice(2, 8);

/** text of an OpenAI-style content value (string or parts) */
export function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  return arr(c).map((p) => { const o = obj(p); return str(o.text) || str(o.content); }).join("");
}

/* ======================= Anthropic Messages ======================= */

function anthropicBlocksToContent(blocks: unknown[]) {
  const parts: J[] = [];
  for (const b of blocks.map(obj)) {
    if (b.type === "text") parts.push({ type: "text", text: str(b.text) });
    else if (b.type === "image") {
      const src = obj(b.source);
      const url = src.type === "base64" ? "data:" + str(src.media_type) + ";base64," + str(src.data) : str(src.url);
      if (url) parts.push({ type: "image_url", image_url: { url } });
    } else if (b.type === "document") {
      const src = obj(b.source);
      if (src.type === "text") parts.push({ type: "text", text: str(src.data) });
    }
  }
  if (parts.every((p) => p.type === "text")) return parts.map((p) => str(p.text)).join("\n");
  return parts;
}

export function anthropicToChat(body: J): ChatRequest {
  const messages: ChatMessage[] = [];
  const sys = typeof body.system === "string" ? body.system : arr(body.system).map((b) => str(obj(b).text)).join("\n");
  if (sys) messages.push({ role: "system", content: sys });
  for (const m of arr(body.messages).map(obj)) {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") { messages.push({ role, content: m.content }); continue; }
    const blocks = arr(m.content).map(obj);
    if (role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => str(b.text)).join("");
      const calls: ToolCall[] = blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: str(b.id), type: "function", function: { name: str(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // tool results must directly follow the assistant turn that asked for them
      for (const b of blocks.filter((x) => x.type === "tool_result")) {
        const c = typeof b.content === "string" ? b.content : arr(b.content).map((x) => str(obj(x).text)).join("\n");
        messages.push({ role: "tool", tool_call_id: str(b.tool_use_id), content: (b.is_error ? "[error] " : "") + c });
      }
      const rest = blocks.filter((x) => x.type !== "tool_result");
      if (rest.length) messages.push({ role: "user", content: anthropicBlocksToContent(rest) });
    }
  }
  const out: ChatRequest = { model: str(body.model), messages };
  if (typeof body.max_tokens === "number") out.max_tokens = body.max_tokens;
  for (const k of ["temperature", "top_p"] as const) if (typeof body[k] === "number") out[k] = body[k];
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences;
  const tools = arr(body.tools).map(obj).filter((t) => t.name && (t.input_schema || !t.type || t.type === "custom"));
  if (tools.length) out.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: str(t.description), parameters: t.input_schema ?? { type: "object", properties: {} } } }));
  const tc = obj(body.tool_choice);
  if (tc.type === "any") out.tool_choice = "required";
  else if (tc.type === "tool") out.tool_choice = { type: "function", function: { name: str(tc.name) } };
  else if (tc.type === "none") out.tool_choice = "none";
  else if (tc.type === "auto") out.tool_choice = "auto";
  if (body.stream === true) out.stream = true;
  return out;
}

const ANTHROPIC_STOP: Record<string, string> = { stop: "end_turn", length: "max_tokens", tool_calls: "tool_use", function_call: "tool_use", content_filter: "refusal" };

export function chatToAnthropic(r: ChatResult, model: string): J {
  const content: J[] = [];
  if (r.text) content.push({ type: "text", text: r.text });
  for (const c of r.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) });
  return {
    id: "msg_" + r.id.replace(/^chatcmpl-?/, ""), type: "message", role: "assistant", model, content,
    stop_reason: r.toolCalls.length ? "tool_use" : ANTHROPIC_STOP[r.finish] ?? "end_turn", stop_sequence: null,
    usage: { input_tokens: r.usage?.prompt_tokens ?? 0, output_tokens: r.usage?.completion_tokens ?? 0 },
  };
}

/* ======================= OpenAI Responses ======================= */

function responsesPartsToContent(content: unknown) {
  if (typeof content === "string") return content;
  const parts: J[] = [];
  for (const p of arr(content).map(obj)) {
    if (p.type === "input_text" || p.type === "output_text" || p.type === "text") parts.push({ type: "text", text: str(p.text) });
    else if (p.type === "input_image") { const url = str(p.image_url) || str(obj(p.image_url).url); if (url) parts.push({ type: "image_url", image_url: { url } }); }
  }
  return parts.every((p) => p.type === "text") ? parts.map((p) => str(p.text)).join("\n") : parts;
}

export function responsesToChat(body: J): ChatRequest {
  const messages: ChatMessage[] = [];
  if (str(body.instructions)) messages.push({ role: "system", content: str(body.instructions) });
  if (typeof body.input === "string") messages.push({ role: "user", content: body.input });
  for (const it of arr(body.input).map(obj)) {
    const type = str(it.type) || "message";
    if (type === "message") {
      const role = it.role === "assistant" ? "assistant" : it.role === "system" || it.role === "developer" ? "system" : "user";
      messages.push({ role, content: responsesPartsToContent(it.content) });
    } else if (type === "function_call") {
      const call: ToolCall = { id: str(it.call_id) || str(it.id), type: "function", function: { name: str(it.name), arguments: str(it.arguments) || "{}" } };
      const last = messages.at(-1);
      if (last?.role === "assistant" && last.tool_calls) last.tool_calls.push(call);
      else messages.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: str(it.call_id), content: typeof it.output === "string" ? it.output : JSON.stringify(it.output ?? "") });
    }
    // reasoning and hosted-tool items have no chat equivalent and are dropped
  }
  const out: ChatRequest = { model: str(body.model), messages };
  if (typeof body.max_output_tokens === "number") out.max_tokens = body.max_output_tokens;
  for (const k of ["temperature", "top_p"] as const) if (typeof body[k] === "number") out[k] = body[k];
  const tools = arr(body.tools).map(obj).filter((t) => t.type === "function" && t.name);
  if (tools.length) out.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: str(t.description), parameters: t.parameters ?? { type: "object", properties: {} } } }));
  const tc = body.tool_choice;
  if (tc === "auto" || tc === "required" || tc === "none") out.tool_choice = tc;
  else if (obj(tc).type === "function") out.tool_choice = { type: "function", function: { name: str(obj(tc).name) } };
  const fmt = obj(obj(body.text).format);
  if (fmt.type === "json_schema") out.response_format = { type: "json_schema", json_schema: { name: str(fmt.name) || "output", schema: fmt.schema, strict: fmt.strict === true } };
  else if (fmt.type === "json_object") out.response_format = { type: "json_object" };
  if (body.stream === true) out.stream = true;
  return out;
}

export function chatToResponses(r: ChatResult, model: string, respId = "resp_" + r.id.replace(/^chatcmpl-?/, "")): J {
  const output: J[] = [];
  if (r.text) output.push({ type: "message", id: "msg_" + respId.slice(5), status: "completed", role: "assistant", content: [{ type: "output_text", text: r.text, annotations: [] }] });
  for (const c of r.toolCalls) output.push({ type: "function_call", id: "fc_" + c.id, call_id: c.id, name: c.function.name, arguments: c.function.arguments, status: "completed" });
  const inT = r.usage?.prompt_tokens ?? 0, outT = r.usage?.completion_tokens ?? 0;
  return {
    id: respId, object: "response", created_at: Math.floor(Date.now() / 1000), status: r.finish === "length" ? "incomplete" : "completed",
    ...(r.finish === "length" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
    model, output, output_text: r.text, parallel_tool_calls: true, tool_choice: "auto", tools: [],
    usage: { input_tokens: inT, output_tokens: outT, total_tokens: inT + outT, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
}

/* ======================= Gemini ======================= */

export function geminiToChat(body: J, model: string): ChatRequest {
  const messages: ChatMessage[] = [];
  const sys = arr(obj(body.systemInstruction ?? body.system_instruction).parts).map((p) => str(obj(p).text)).join("\n");
  if (sys) messages.push({ role: "system", content: sys });
  const pending: string[] = []; // call ids waiting for a functionResponse, matched in order
  let n = 0;
  for (const c of arr(body.contents).map(obj)) {
    const parts = arr(c.parts).map(obj);
    if (c.role === "model") {
      const text = parts.map((p) => str(p.text)).join("");
      const calls: ToolCall[] = parts.filter((p) => p.functionCall).map((p) => {
        const fc = obj(p.functionCall), id = str(fc.id) || "call_" + ++n;
        pending.push(id);
        return { id, type: "function", function: { name: str(fc.name), arguments: JSON.stringify(fc.args ?? {}) } };
      });
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const p of parts.filter((x) => x.functionResponse)) {
      const fr = obj(p.functionResponse);
      messages.push({ role: "tool", tool_call_id: str(fr.id) || pending.shift() || "call_" + ++n, content: JSON.stringify(fr.response ?? {}) });
    }
    const rest = parts.filter((p) => !p.functionResponse);
    if (!rest.length) continue;
    const content: J[] = rest.map((p) => {
      const inline = obj(p.inlineData ?? p.inline_data);
      if (inline.data) return { type: "image_url", image_url: { url: "data:" + str(inline.mimeType ?? inline.mime_type) + ";base64," + str(inline.data) } };
      return { type: "text", text: str(p.text) };
    });
    messages.push({ role: "user", content: content.every((x) => x.type === "text") ? content.map((x) => str(x.text)).join("\n") : content });
  }
  const out: ChatRequest = { model, messages };
  const g = obj(body.generationConfig ?? body.generation_config);
  if (typeof g.maxOutputTokens === "number") out.max_tokens = g.maxOutputTokens;
  if (typeof g.temperature === "number") out.temperature = g.temperature;
  if (typeof g.topP === "number") out.top_p = g.topP;
  if (arr(g.stopSequences).length) out.stop = g.stopSequences;
  if (g.responseMimeType === "application/json") out.response_format = g.responseSchema ? { type: "json_schema", json_schema: { name: "output", schema: g.responseSchema } } : { type: "json_object" };
  const decls = arr(body.tools).flatMap((t) => arr(obj(t).functionDeclarations ?? obj(t).function_declarations)).map(obj);
  if (decls.length) out.tools = decls.map((d) => ({ type: "function", function: { name: d.name, description: str(d.description), parameters: d.parameters ?? d.parametersJsonSchema ?? { type: "object", properties: {} } } }));
  const mode = str(obj(obj(body.toolConfig).functionCallingConfig).mode);
  if (mode === "ANY") out.tool_choice = "required"; else if (mode === "NONE") out.tool_choice = "none";
  return out;
}

const GEMINI_FINISH: Record<string, string> = { stop: "STOP", length: "MAX_TOKENS", tool_calls: "STOP", content_filter: "SAFETY" };
export function chatToGemini(r: ChatResult, model: string): J {
  const parts: J[] = [];
  if (r.text) parts.push({ text: r.text });
  for (const c of r.toolCalls) parts.push({ functionCall: { id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) } });
  const inT = r.usage?.prompt_tokens ?? 0, outT = r.usage?.completion_tokens ?? 0;
  return {
    candidates: [{ content: { role: "model", parts }, finishReason: GEMINI_FINISH[r.finish] ?? "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: inT, candidatesTokenCount: outT, totalTokenCount: inT + outT }, modelVersion: model,
  };
}

/* ======================= chat answers and streams ======================= */

/** a non-streamed OpenAI chat completion → ChatResult */
export function readChat(resp: J): ChatResult {
  const ch = obj(arr(resp.choices)[0]), msg = obj(ch.message), u = obj(resp.usage);
  return {
    id: str(resp.id) || genId("chatcmpl-"), text: contentText(msg.content),
    toolCalls: arr(msg.tool_calls).map(obj).map((c) => ({ id: str(c.id) || genId("call_"), type: "function", function: { name: str(obj(c.function).name), arguments: str(obj(c.function).arguments) || "{}" } })),
    finish: str(ch.finish_reason) || "stop",
    usage: typeof u.prompt_tokens === "number" ? { prompt_tokens: u.prompt_tokens, completion_tokens: Number(u.completion_tokens) || 0 } : null,
  };
}

/** folds chat stream chunks into a ChatResult (for billing and for formats that need whole tool calls) */
export class ChatAccumulator {
  id = ""; text = ""; finish = ""; usage: ChatUsage | null = null;
  calls: { id: string; name: string; args: string }[] = [];
  add(chunk: J) {
    if (!this.id && str(chunk.id)) this.id = str(chunk.id);
    const u = obj(chunk.usage);
    if (typeof u.prompt_tokens === "number") this.usage = { prompt_tokens: u.prompt_tokens, completion_tokens: Number(u.completion_tokens) || 0 };
    const ch = obj(arr(chunk.choices)[0]), d = obj(ch.delta);
    const text = contentText(d.content);
    const calls: { index: number; id?: string; name?: string; args?: string }[] = [];
    for (const tc of arr(d.tool_calls).map(obj)) {
      const i = typeof tc.index === "number" ? tc.index : this.calls.length;
      const f = obj(tc.function);
      if (!this.calls[i]) this.calls[i] = { id: str(tc.id) || genId("call_"), name: "", args: "" };
      if (str(tc.id)) this.calls[i].id = str(tc.id);
      if (str(f.name)) this.calls[i].name += str(f.name);
      if (str(f.arguments)) this.calls[i].args += str(f.arguments);
      calls.push({ index: i, id: str(tc.id) || undefined, name: str(f.name) || undefined, args: str(f.arguments) || undefined });
    }
    this.text += text;
    if (str(ch.finish_reason)) this.finish = str(ch.finish_reason);
    return { text, calls, finish: str(ch.finish_reason) };
  }
  result(): ChatResult {
    return { id: this.id || genId("chatcmpl-"), text: this.text, finish: this.finish || "stop", usage: this.usage, toolCalls: this.calls.filter(Boolean).map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })) };
  }
}

const sse = (event: string | null, data: unknown) => (event ? "event: " + event + "\n" : "") + "data: " + JSON.stringify(data) + "\n\n";

/** chat stream chunks → Anthropic SSE events */
export class AnthropicStream {
  private acc = new ChatAccumulator();
  private block = -1; private open: "text" | "tool" | null = null;
  private toolBlock = new Map<number, number>();
  private started = false;
  constructor(private model: string, private id = genId("msg_")) {}
  private start() {
    this.started = true;
    return sse("message_start", { type: "message_start", message: { id: this.id, type: "message", role: "assistant", model: this.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  }
  private close() { if (this.open === null) return ""; this.open = null; return sse("content_block_stop", { type: "content_block_stop", index: this.block }); }
  push(chunk: J): string {
    let out = this.started ? "" : this.start();
    const d = this.acc.add(chunk);
    if (d.text) {
      if (this.open !== "text") { out += this.close(); this.block++; this.open = "text"; out += sse("content_block_start", { type: "content_block_start", index: this.block, content_block: { type: "text", text: "" } }); }
      out += sse("content_block_delta", { type: "content_block_delta", index: this.block, delta: { type: "text_delta", text: d.text } });
    }
    for (const c of d.calls) {
      if (!this.toolBlock.has(c.index)) {
        out += this.close(); this.block++; this.open = "tool"; this.toolBlock.set(c.index, this.block);
        const call = this.acc.calls[c.index];
        out += sse("content_block_start", { type: "content_block_start", index: this.block, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } });
      }
      if (c.args) out += sse("content_block_delta", { type: "content_block_delta", index: this.toolBlock.get(c.index), delta: { type: "input_json_delta", partial_json: c.args } });
    }
    return out;
  }
  end(): string {
    const r = this.acc.result();
    let out = this.started ? "" : this.start();
    out += this.close();
    out += sse("message_delta", { type: "message_delta", delta: { stop_reason: r.toolCalls.length ? "tool_use" : ANTHROPIC_STOP[r.finish] ?? "end_turn", stop_sequence: null }, usage: { input_tokens: r.usage?.prompt_tokens ?? 0, output_tokens: r.usage?.completion_tokens ?? 0 } });
    return out + sse("message_stop", { type: "message_stop" });
  }
  result() { return this.acc.result(); }
}

/** chat stream chunks → OpenAI Responses SSE events */
export class ResponsesStream {
  private acc = new ChatAccumulator();
  private n = 0; private outIndex = -1; private started = false;
  private msg: { id: string; index: number } | null = null;
  private tools = new Map<number, { id: string; index: number }>();
  constructor(private model: string, private respId = genId("resp_")) {}
  private ev(type: string, data: J) { return sse(type, { type, sequence_number: this.n++, ...data }); }
  private shell(status: string) { return { id: this.respId, object: "response", created_at: Math.floor(Date.now() / 1000), status, model: this.model, output: [] as J[] }; }
  private start() { this.started = true; return this.ev("response.created", { response: this.shell("in_progress") }) + this.ev("response.in_progress", { response: this.shell("in_progress") }); }
  push(chunk: J): string {
    let out = this.started ? "" : this.start();
    const d = this.acc.add(chunk);
    if (d.text) {
      if (!this.msg) {
        this.msg = { id: "msg_" + this.respId.slice(5), index: ++this.outIndex };
        out += this.ev("response.output_item.added", { output_index: this.msg.index, item: { type: "message", id: this.msg.id, status: "in_progress", role: "assistant", content: [] } });
        out += this.ev("response.content_part.added", { item_id: this.msg.id, output_index: this.msg.index, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
      }
      out += this.ev("response.output_text.delta", { item_id: this.msg.id, output_index: this.msg.index, content_index: 0, delta: d.text });
    }
    for (const c of d.calls) {
      if (!this.tools.has(c.index)) {
        const call = this.acc.calls[c.index], t = { id: "fc_" + call.id, index: ++this.outIndex };
        this.tools.set(c.index, t);
        out += this.ev("response.output_item.added", { output_index: t.index, item: { type: "function_call", id: t.id, call_id: call.id, name: call.name, arguments: "", status: "in_progress" } });
      }
      const t = this.tools.get(c.index)!;
      if (c.args) out += this.ev("response.function_call_arguments.delta", { item_id: t.id, output_index: t.index, delta: c.args });
    }
    return out;
  }
  end(): string {
    let out = this.started ? "" : this.start();
    const r = this.acc.result();
    if (this.msg) {
      const item = { type: "message", id: this.msg.id, status: "completed", role: "assistant", content: [{ type: "output_text", text: r.text, annotations: [] }] };
      out += this.ev("response.output_text.done", { item_id: this.msg.id, output_index: this.msg.index, content_index: 0, text: r.text });
      out += this.ev("response.content_part.done", { item_id: this.msg.id, output_index: this.msg.index, content_index: 0, part: item.content[0] });
      out += this.ev("response.output_item.done", { output_index: this.msg.index, item });
    }
    for (const [i, t] of this.tools) {
      const call = r.toolCalls[i] ?? r.toolCalls.find((c) => "fc_" + c.id === t.id)!;
      out += this.ev("response.function_call_arguments.done", { item_id: t.id, output_index: t.index, arguments: call.function.arguments });
      out += this.ev("response.output_item.done", { output_index: t.index, item: { type: "function_call", id: t.id, call_id: call.id, name: call.function.name, arguments: call.function.arguments, status: "completed" } });
    }
    return out + this.ev("response.completed", { response: chatToResponses(r, this.model, this.respId) });
  }
  result() { return this.acc.result(); }
}

/** chat stream chunks → Gemini SSE (alt=sse); function calls are sent whole when the stream ends */
export class GeminiStream {
  private acc = new ChatAccumulator();
  constructor(private model: string) {}
  push(chunk: J): string {
    const d = this.acc.add(chunk);
    return d.text ? sse(null, { candidates: [{ content: { role: "model", parts: [{ text: d.text }] }, index: 0 }], modelVersion: this.model }) : "";
  }
  end(): string {
    const r = this.acc.result(), g = chatToGemini({ ...r, text: "" }, this.model);
    return sse(null, g);
  }
  result() { return this.acc.result(); }
}

/** OpenAI chat chunks pass through; only the model id is rewritten to the public one */
export class ChatStream {
  private acc = new ChatAccumulator();
  constructor(private model: string, private keepUsage: boolean) {}
  push(chunk: J): string {
    this.acc.add(chunk);
    const hasChoices = arr(chunk.choices).length > 0;
    // the usage-only chunk we asked for is forwarded only when the customer asked for it too
    if (!hasChoices && !this.keepUsage) return "";
    return sse(null, { ...chunk, model: this.model });
  }
  end(): string { return "data: [DONE]\n\n"; }
  result() { return this.acc.result(); }
}

/** parses an upstream SSE body into JSON chunks */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<J> {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try { yield JSON.parse(data) as J; } catch { /* keep-alive or partial noise */ }
      }
    }
  } finally { reader.releaseLock(); }
}
