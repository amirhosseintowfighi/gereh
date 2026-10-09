import { describe, expect, it } from "vitest";
import { costOf, rulePrice } from "@/lib/ai";
import {
  AnthropicStream, anthropicToChat, ChatAccumulator, chatToAnthropic, chatToGemini, chatToResponses, geminiToChat, GeminiStream, readChat, ResponsesStream, responsesToChat,
} from "@/server/ai/translate";

const events = (s: string) => s.split("\n\n").filter(Boolean).map((b) => {
  const ev = /^event: (.+)$/m.exec(b)?.[1] ?? null, data = /^data: (.+)$/m.exec(b)?.[1] ?? "null";
  return { ev, data: JSON.parse(data) };
});
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({ id: "chatcmpl-1", choices: [{ index: 0, delta, finish_reason: finish }] });

describe("pricing", () => {
  it("rule: market average capped at the reference, then the discount", () => {
    expect(rulePrice(1_000_000)).toBe(950_000);
    expect(rulePrice(1_000_000, 800_000)).toBe(760_000);
    expect(rulePrice(1_000_000, 1_400_000)).toBe(950_000); // never above the competitor
    expect(costOf(1000, 500, { inPrice: 1_000_000, outPrice: 2_000_000 })).toBe(2000);
    expect(costOf(1, 0, { inPrice: 10, outPrice: 10 })).toBe(1);
    expect(costOf(0, 0, { inPrice: 10, outPrice: 10 })).toBe(0);
  });
});

describe("Anthropic Messages ↔ chat", () => {
  it("maps system, images, tool use and tool results in order", () => {
    const c = anthropicToChat({
      model: "claude-opus-5.5", max_tokens: 1000, system: [{ type: "text", text: "be brief" }], stop_sequences: ["END"],
      tools: [{ name: "get_weather", description: "weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      tool_choice: { type: "any" },
      messages: [
        { role: "user", content: [{ type: "text", text: "weather?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "checking" }, { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Tehran" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "sunny" }] }, { type: "text", text: "thanks" }] },
      ],
    });
    expect(c.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(c.messages[1].content).toEqual([{ type: "text", text: "weather?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]);
    expect(c.messages[2]).toEqual({ role: "assistant", content: "checking", tool_calls: [{ id: "tu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Tehran"}' } }] });
    expect(c.messages[3]).toEqual({ role: "tool", tool_call_id: "tu_1", content: "sunny" });
    expect(c.messages[4]).toEqual({ role: "user", content: "thanks" });
    expect(c).toMatchObject({ max_tokens: 1000, stop: ["END"], tool_choice: "required" });
    expect(c.tools?.[0]).toEqual({ type: "function", function: { name: "get_weather", description: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } } });
  });

  it("renders a chat answer as an Anthropic message", () => {
    const r = readChat({ id: "chatcmpl-9", choices: [{ message: { content: "hi", tool_calls: [{ id: "c1", function: { name: "f", arguments: '{"a":1}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
    expect(chatToAnthropic(r, "claude-opus-5.5")).toMatchObject({
      type: "message", role: "assistant", model: "claude-opus-5.5", stop_reason: "tool_use",
      content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "c1", name: "f", input: { a: 1 } }],
      usage: { input_tokens: 10, output_tokens: 4 },
    });
  });

  it("streams text and tool calls as Anthropic events", () => {
    const s = new AnthropicStream("claude-opus-5.5");
    let out = s.push(chunk({ role: "assistant", content: "" }));
    out += s.push(chunk({ content: "Hel" })) + s.push(chunk({ content: "lo" }));
    out += s.push(chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "" } }] }));
    out += s.push(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] })) + s.push(chunk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }));
    out += s.push(chunk({}, "tool_calls")) + s.push({ id: "chatcmpl-1", choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    out += s.end();
    const ev = events(out);
    expect(ev.map((e) => e.ev)).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
    expect(ev[1].data.content_block).toEqual({ type: "text", text: "" });
    expect(ev[5].data).toMatchObject({ index: 1, content_block: { type: "tool_use", id: "c1", name: "f" } });
    expect(ev[6].data.delta).toEqual({ type: "input_json_delta", partial_json: '{"a":' });
    expect(ev[9].data).toMatchObject({ delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } });
    expect(s.result().toolCalls[0].function.arguments).toBe('{"a":1}');
  });
});

describe("OpenAI Responses ↔ chat", () => {
  it("maps instructions, items, function calls and outputs", () => {
    const c = responsesToChat({
      model: "gpt-5.5", instructions: "sys", max_output_tokens: 300, text: { format: { type: "json_schema", name: "out", schema: { type: "object" } } },
      tools: [{ type: "function", name: "ls", parameters: { type: "object" } }, { type: "web_search" }],
      input: [
        { role: "user", content: [{ type: "input_text", text: "list files" }] },
        { type: "reasoning", summary: [] },
        { type: "function_call", call_id: "c1", name: "ls", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "ls", arguments: '{"d":1}' },
        { type: "function_call_output", call_id: "c1", output: "a.txt" },
        { type: "function_call_output", call_id: "c2", output: "b.txt" },
      ],
    });
    expect(c.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(c.messages[2].tool_calls?.map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(c.tools).toHaveLength(1);
    expect(c).toMatchObject({ max_tokens: 300, response_format: { type: "json_schema", json_schema: { name: "out", schema: { type: "object" } } } });
  });

  it("renders and streams Responses output", () => {
    const r = readChat({ id: "chatcmpl-5", choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
    expect(chatToResponses(r, "gpt-5.5")).toMatchObject({ object: "response", status: "completed", output_text: "done", output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }], usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } });
    const s = new ResponsesStream("gpt-5.5");
    const out = s.push(chunk({ content: "do" })) + s.push(chunk({ content: "ne" })) + s.push(chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "ls", arguments: "{}" } }] })) + s.push(chunk({}, "tool_calls")) + s.end();
    const ev = events(out);
    expect(ev.map((e) => e.ev)).toEqual([
      "response.created", "response.in_progress", "response.output_item.added", "response.content_part.added", "response.output_text.delta", "response.output_text.delta",
      "response.output_item.added", "response.function_call_arguments.delta", "response.output_text.done", "response.content_part.done", "response.output_item.done",
      "response.function_call_arguments.done", "response.output_item.done", "response.completed",
    ]);
    expect(ev.map((e) => e.data.sequence_number)).toEqual(ev.map((_, i) => i));
    expect(ev.at(-1)!.data.response.output).toHaveLength(2);
  });
});

describe("Gemini ↔ chat", () => {
  it("maps contents, function calls and responses", () => {
    const c = geminiToChat({
      systemInstruction: { parts: [{ text: "sys" }] }, generationConfig: { maxOutputTokens: 50, temperature: 0.2 },
      tools: [{ functionDeclarations: [{ name: "f", parameters: { type: "object" } }] }],
      contents: [
        { role: "user", parts: [{ text: "hi" }, { inlineData: { mimeType: "image/jpeg", data: "BBB" } }] },
        { role: "model", parts: [{ functionCall: { name: "f", args: { x: 1 } } }] },
        { role: "user", parts: [{ functionResponse: { name: "f", response: { ok: true } } }] },
      ],
    }, "gemini-3.8-flash");
    expect(c.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(c.messages[3].tool_call_id).toBe(c.messages[2].tool_calls?.[0].id);
    expect(c).toMatchObject({ model: "gemini-3.8-flash", max_tokens: 50, temperature: 0.2 });
    const g = chatToGemini(readChat({ choices: [{ message: { content: "ok" }, finish_reason: "length" }], usage: { prompt_tokens: 2, completion_tokens: 1 } }), "gemini-3.8-flash");
    expect(g).toMatchObject({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { totalTokenCount: 3 } });
    const s = new GeminiStream("gemini-3.8-flash");
    const ev = events(s.push(chunk({ content: "a" })) + s.end());
    expect(ev[0].data.candidates[0].content.parts[0].text).toBe("a");
    expect(ev[1].data.candidates[0].finishReason).toBe("STOP");
  });
});

describe("stream accumulator", () => {
  it("joins text, tool call fragments and late usage", () => {
    const a = new ChatAccumulator();
    a.add(chunk({ content: "x" })); a.add(chunk({ tool_calls: [{ index: 0, id: "c", function: { name: "f", arguments: '{"' } }] }));
    a.add(chunk({ tool_calls: [{ index: 0, function: { arguments: 'k":2}' } }] }, "tool_calls"));
    a.add({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 6 } });
    expect(a.result()).toMatchObject({ text: "x", finish: "tool_calls", usage: { prompt_tokens: 5, completion_tokens: 6 }, toolCalls: [{ id: "c", function: { name: "f", arguments: '{"k":2}' } }] });
  });
});
