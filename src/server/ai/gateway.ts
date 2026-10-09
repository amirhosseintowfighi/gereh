/* HTTP surface of the AI API. Served at https://api.gereh.dev (Nginx maps / → /api/ai/) and at
   https://<site>/api/ai. Paths, after that prefix:
     GET  v1/models                                  OpenAI (or Anthropic shape with anthropic-version)
     POST v1/chat/completions                        OpenAI Chat
     POST v1/responses                               OpenAI Responses (stateless)
     POST v1/messages, v1/messages/count_tokens      Anthropic Messages
     GET  v1beta/models                              Gemini model list
     POST v1beta/models/<model>:generateContent      Gemini (and :streamGenerateContent?alt=sse)
   Auth: Authorization: Bearer gk-…, x-api-key (Anthropic SDKs), x-goog-api-key or ?key= (Gemini). */
import "server-only";
import { asc, eq } from "drizzle-orm";
import { estimateTokens } from "@/lib/ai";
import { rateLimit } from "../auth";
import type { DB } from "../db/client";
import { aiModels } from "../db/schema";
import { AppError } from "../util";
import { aiErr, authenticateKey, resolveModel, runChat, type AiError, type Format, type Renderer } from "./service";
import {
  AnthropicStream, anthropicToChat, ChatStream, chatToAnthropic, chatToGemini, chatToResponses, geminiToChat, GeminiStream, ResponsesStream, responsesToChat, type ChatRequest,
} from "./translate";

const MAX_BODY = 16 * 1024 * 1024;
const H = { "cache-control": "no-store" };

function errorBody(format: Format, e: AiError) {
  if (format === "anthropic") {
    const type = e.http === 401 ? "authentication_error" : e.http === 403 ? "permission_error" : e.http === 404 ? "not_found_error" : e.http === 429 ? "rate_limit_error" : e.http === 402 ? "billing_error" : e.http >= 500 ? "api_error" : "invalid_request_error";
    return { type: "error", error: { type, message: e.message } };
  }
  if (format === "gemini") {
    const status = e.http === 401 ? "UNAUTHENTICATED" : e.http === 403 ? "PERMISSION_DENIED" : e.http === 404 ? "NOT_FOUND" : e.http === 429 ? "RESOURCE_EXHAUSTED" : e.http >= 500 ? "UNAVAILABLE" : "INVALID_ARGUMENT";
    return { error: { code: e.http, message: e.message, status } };
  }
  return { error: { message: e.message, type: e.http >= 500 ? "server_error" : "invalid_request_error", code: e.code } };
}
const fail = (format: Format, e: AiError) => Response.json(errorBody(format, e), { status: e.http, headers: H });

const RENDER: Record<Exclude<Format, "panel">, (model: string, keepUsage: boolean) => Renderer> = {
  openai: (model, keepUsage) => ({
    json: (r) => ({
      id: r.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: "assistant", content: r.text || null, ...(r.toolCalls.length ? { tool_calls: r.toolCalls } : {}) }, finish_reason: r.toolCalls.length ? "tool_calls" : r.finish }],
      usage: { prompt_tokens: r.usage?.prompt_tokens ?? 0, completion_tokens: r.usage?.completion_tokens ?? 0, total_tokens: (r.usage?.prompt_tokens ?? 0) + (r.usage?.completion_tokens ?? 0) },
    }),
    stream: () => new ChatStream(model, keepUsage),
  }),
  responses: (model) => ({ json: (r) => chatToResponses(r, model), stream: () => new ResponsesStream(model) }),
  anthropic: (model) => ({ json: (r) => chatToAnthropic(r, model), stream: () => new AnthropicStream(model) }),
  gemini: (model) => ({ json: (r) => chatToGemini(r, model), stream: () => new GeminiStream(model) }),
};

function credential(req: Request, url: URL) {
  const auth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  return (bearer || req.headers.get("x-api-key") || req.headers.get("x-goog-api-key") || url.searchParams.get("key") || "").trim();
}

function formatOf(path: string): Format {
  if (path.startsWith("v1beta/")) return "gemini";
  if (path.startsWith("v1/messages")) return "anthropic";
  if (path === "v1/responses") return "responses";
  return "openai";
}

export async function gateway(d: DB, req: Request, path: string): Promise<Response> {
  const url = new URL(req.url);
  path = path.replace(/^\/+|\/+$/g, "");
  let format = formatOf(path);
  try {
    const key = await authenticateKey(d, credential(req, url));
    if (!key) return fail(format, aiErr(401, "invalid_api_key", "کلید API نامعتبر است. کلید را از پنل گره › API هوش مصنوعی بسازید (با gk- شروع می‌شود)."));
    if (key.status !== "active" || key.userStatus === "suspended") return fail(format, aiErr(403, "key_disabled", "این کلید باطل شده یا حساب معلق است."));
    if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return fail(format, aiErr(401, "key_expired", "این کلید منقضی شده است؛ کلید جدید بسازید."));
    try { await rateLimit(d, "ai:" + key.id, key.rpm, 60); } catch (e) {
      if (e instanceof AppError) return fail(format, aiErr(429, "rate_limit_exceeded", "سقف درخواست در دقیقه این کلید (" + key.rpm + ") پر شده است."));
      throw e;
    }

    if (req.method === "GET" && (path === "v1/models" || path === "v1beta/models")) {
      const list = (await d.select().from(aiModels).where(eq(aiModels.active, true)).orderBy(asc(aiModels.position))).filter((m) => !key.models.length || key.models.includes(m.id));
      if (format === "gemini") return Response.json({ models: list.map((m) => ({ name: "models/" + m.id, displayName: m.name, inputTokenLimit: m.context, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "streamGenerateContent"] })) }, { headers: H });
      if (req.headers.get("anthropic-version")) return Response.json({ data: list.map((m) => ({ type: "model", id: m.id, display_name: m.name, created_at: "2025-01-01T00:00:00Z" })), has_more: false, first_id: list[0]?.id ?? null, last_id: list.at(-1)?.id ?? null }, { headers: H });
      return Response.json({ object: "list", data: list.map((m) => ({ id: m.id, object: "model", created: 1735689600, owned_by: m.vendor, context_length: m.context, pricing: { input_toman_per_million: m.inPrice, output_toman_per_million: m.outPrice } })) }, { headers: H });
    }
    if (req.method !== "POST") return fail(format, aiErr(404, "not_found", "مسیر پشتیبانی نمی‌شود. مستندات: https://gereh.net/docs/ai-api"));
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return fail(format, aiErr(413, "request_too_large", "حجم درخواست بیش از ۱۶ مگابایت است."));
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(format, aiErr(400, "invalid_json", "بدنه درخواست JSON معتبر نیست."));

    let chat: ChatRequest, model: string, keepUsage = false;
    if (path === "v1/chat/completions") {
      if (!Array.isArray(body.messages)) return fail(format, aiErr(400, "invalid_request", "فیلد messages لازم است."));
      chat = { ...(body as ChatRequest) };
      model = String(body.model ?? "");
      keepUsage = (body.stream_options as { include_usage?: boolean } | undefined)?.include_usage === true;
      delete chat.stream_options;
    } else if (path === "v1/responses") {
      if (body.background || body.previous_response_id || body.conversation) return fail(format, aiErr(400, "unsupported", "previous_response_id، background و conversation پشتیبانی نمی‌شوند؛ تاریخچه را در input بفرستید (store: false)."));
      chat = responsesToChat(body); model = chat.model;
    } else if (path === "v1/messages") {
      chat = anthropicToChat(body); model = chat.model;
    } else if (path === "v1/messages/count_tokens") {
      const c = anthropicToChat(body);
      return Response.json({ input_tokens: estimateTokens(JSON.stringify(c.messages).length + (c.tools ? JSON.stringify(c.tools).length : 0)) }, { headers: H });
    } else {
      const m = /^v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(path);
      if (!m) return fail(format, aiErr(404, "not_found", "مسیر پشتیبانی نمی‌شود. مستندات: https://gereh.net/docs/ai-api"));
      format = "gemini"; model = decodeURIComponent(m[1]);
      chat = geminiToChat(body, model);
      if (m[2] === "streamGenerateContent") chat.stream = true;
    }
    if (!model) return fail(format, aiErr(400, "invalid_request", "فیلد model لازم است."));
    if (!chat.messages.length) return fail(format, aiErr(400, "invalid_request", "پیامی برای ارسال وجود ندارد."));

    const resolved = await resolveModel(d, model, key.models);
    if ("http" in resolved) return fail(format, resolved);
    const render = RENDER[format as Exclude<Format, "panel">](resolved.id, keepUsage);
    const r = await runChat({ db: d, caller: { userId: key.userId, keyId: key.id, dailyCap: key.dailyCap, monthlyCap: key.monthlyCap }, model: resolved, format, chat, render });
    if (r.kind === "error") return fail(format, r.error);
    const head = { ...H, "x-gereh-request-id": r.requestId };
    if (r.kind === "json") return Response.json(r.body, { headers: { ...head, "x-gereh-charged-toman": String(r.charged) } });
    // Gemini without alt=sse expects one JSON array; streaming clients send alt=sse
    if (format === "gemini" && url.searchParams.get("alt") !== "sse") {
      const text = await new Response(r.stream).text();
      const items = text.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
      return Response.json(items, { headers: head });
    }
    return new Response(r.stream, { headers: { ...head, "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive", "x-accel-buffering": "no" } });
  } catch (e) {
    console.error("[ai]", e);
    return fail(format, aiErr(500, "internal", "خطای داخلی رخ داد؛ اگر مبلغی رزرو شده باشد برگشت داده می‌شود."));
  }
}
