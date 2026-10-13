/* Non-chat endpoints of the gateway: embeddings, images (generations, edits), audio (speech,
   transcriptions) and rerank. Each one resolves a model of the matching kind, reserves the most it can
   cost, forwards the request upstream with the public model id swapped for the upstream one, and
   settles the real cost from what came back (see AI_KIND_PRICE for the units). */
import "server-only";
import { estimateTokens, kindCost, type AiKind } from "@/lib/ai";
import type { DB } from "../db/client";
import { aiErr, openMeter, resolveModel, upstreamError, type AiError, type Caller, type Close, type Format, type ResolvedModel } from "./service";
import { aiUpstream, routeHeaders, type Upstream } from "./upstream";

type J = Record<string, unknown>;
export type Out = Response | AiError;
const bad = (message: string) => aiErr(400, "invalid_request", message);
const isErr = (x: unknown): x is AiError => !!x && typeof x === "object" && "http" in x && "code" in x;

type Up = Required<Pick<Upstream, "post" | "form">>;
function upstream(): Up | AiError {
  const u = aiUpstream();
  if (!u.post || !u.form) return aiErr(501, "not_supported", "سرویس‌دهنده فعلی این مسیر را پشتیبانی نمی‌کند.");
  return u as unknown as Up;
}

/** reserve → upstream → settle; `settle` turns the upstream answer into the customer's response and the bill */
async function metered(db: DB, o: {
  caller: Caller; model: ResolvedModel; format: Format; reserve: number;
  send: (up: Up, upstreamModel: string, headers: Record<string, string>, signal: AbortSignal) => Promise<Response>;
  settle: (res: Response) => Promise<{ out: Response; bill: Close }>;
}): Promise<Out> {
  const up = upstream();
  if (isErr(up)) return up;
  const meter = await openMeter(db, { caller: o.caller, model: o.model, format: o.format, reserve: o.reserve });
  if (isErr(meter)) return meter;
  let res: Response;
  try {
    res = await o.send(up, o.model.upstream || o.model.id, routeHeaders(o.caller.routing), AbortSignal.timeout(600_000));
  } catch (e) {
    await meter.close("error", { error: (e as Error).message });
    return aiErr(502, "upstream_unavailable", "سرویس‌دهنده مدل در دسترس نیست؛ مبلغی کسر نشد. چند لحظه بعد دوباره تلاش کنید.");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    await meter.close("error", { error: "upstream " + res.status + " " + detail });
    return upstreamError(res.status, detail);
  }
  let settled: { out: Response; bill: Close };
  try { settled = await o.settle(res); } catch (e) {
    await meter.close("error", { error: "bad upstream body: " + (e as Error).message });
    return aiErr(502, "upstream_error", "پاسخ نامعتبر از سرویس‌دهنده؛ مبلغی کسر نشد.");
  }
  const charged = await meter.close("success", settled.bill);
  const headers = new Headers(settled.out.headers);
  headers.set("x-gereh-request-id", meter.requestId);
  headers.set("x-gereh-charged-toman", String(charged));
  headers.set("cache-control", "no-store");
  return new Response(settled.out.body, { status: settled.out.status, headers });
}

async function modelOf(db: DB, id: unknown, allowed: string[], kind: AiKind) {
  if (typeof id !== "string" || !id) return bad("فیلد model لازم است.");
  return resolveModel(db, id, allowed, kind);
}

/* ---------- embeddings ---------- */
function embeddingInputs(input: unknown): (string | number[])[] | null {
  const list = typeof input === "string" ? [input] : Array.isArray(input) && input.length && input.every((x) => typeof x === "number") ? [input as number[]] : Array.isArray(input) ? input : null;
  if (!list || !list.length || list.length > 2048) return null;
  if (!list.every((x) => (typeof x === "string" && x.length > 0) || (Array.isArray(x) && x.length > 0 && x.every((n) => typeof n === "number")))) return null;
  return list as (string | number[])[];
}
const inputTokens = (list: (string | number[])[]) => list.reduce<number>((n, x) => n + (typeof x === "string" ? estimateTokens(x.length) : x.length), 0);

export async function embeddings(db: DB, caller: Caller, allowed: string[], body: J): Promise<Out> {
  const list = embeddingInputs(body.input);
  if (!list) return bad("فیلد input باید متن یا آرایه‌ای از متن‌ها (حداکثر ۲۰۴۸ مورد) باشد.");
  const m = await modelOf(db, body.model, allowed, "embedding");
  if (isErr(m)) return m;
  const est = inputTokens(list);
  return metered(db, {
    caller, model: m, format: "embeddings", reserve: Math.max(1, kindCost("embedding", m, { tokens: Math.ceil(est * 1.5) })),
    send: (up, model, h, signal) => up.post("embeddings", { ...body, model }, signal, h),
    settle: async (res) => {
      const j = (await res.json()) as J & { usage?: { prompt_tokens?: number }; data?: unknown[] };
      if (!Array.isArray(j.data)) throw new Error("no data");
      const tokens = j.usage?.prompt_tokens ?? est;
      return { out: Response.json({ ...j, model: m.id }), bill: { inTokens: tokens, charged: kindCost("embedding", m, { tokens }), estimated: !j.usage, finish: "stop", request: body.input, response: "" } };
    },
  });
}

/** embeddings for internal callers (knowledge base, embedding playground): vectors in input order, or an error */
export async function embedTexts(db: DB, caller: Caller, model: ResolvedModel, texts: string[], format: Format = "embeddings"): Promise<{ vectors: number[][]; charged: number } | AiError> {
  const vectors: number[][] = [];
  let charged = 0;
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const r = await metered(db, {
      caller, model, format, reserve: Math.max(1, kindCost("embedding", model, { tokens: Math.ceil(inputTokens(batch) * 1.5) })),
      send: (up, upstreamModel, h, signal) => up.post("embeddings", { model: upstreamModel, input: batch }, signal, h),
      settle: async (res) => {
        const j = (await res.json()) as { data?: { index?: number; embedding?: unknown }[]; usage?: { prompt_tokens?: number } };
        const data = (j.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (data.length !== batch.length || !data.every((d) => Array.isArray(d.embedding))) throw new Error("embedding count mismatch");
        for (const d of data) vectors.push((d.embedding as number[]).map(Number));
        const tokens = j.usage?.prompt_tokens ?? inputTokens(batch);
        return { out: new Response(null, { status: 204 }), bill: { inTokens: tokens, charged: kindCost("embedding", model, { tokens }), estimated: !j.usage, finish: "stop" } };
      },
    });
    if (isErr(r)) return r;
    charged += Number(r.headers.get("x-gereh-charged-toman") || 0);
  }
  return { vectors, charged };
}

/* ---------- images ---------- */
const imageCount = (n: unknown) => { const v = n === undefined || n === null || n === "" ? 1 : Number(n); return Number.isInteger(v) && v >= 1 && v <= 10 ? v : 0; };

export async function imageGenerations(db: DB, caller: Caller, allowed: string[], body: J): Promise<Out> {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) return bad("فیلد prompt لازم است.");
  const n = imageCount(body.n);
  if (!n) return bad("n باید بین ۱ و ۱۰ باشد.");
  const m = await modelOf(db, body.model, allowed, "image");
  if (isErr(m)) return m;
  return metered(db, {
    caller, model: m, format: "images", reserve: kindCost("image", m, { images: n }),
    send: (up, model, h, signal) => up.post("images/generations", { ...body, model }, signal, h),
    settle: async (res) => {
      const j = (await res.json()) as J & { data?: unknown[] };
      if (!Array.isArray(j.data)) throw new Error("no data");
      const images = j.data.length;
      return { out: Response.json(j), bill: { units: images, charged: kindCost("image", m, { images }), finish: "stop", request: body.prompt, response: images + " image(s)" } };
    },
  });
}

export async function imageEdits(db: DB, caller: Caller, allowed: string[], form: FormData): Promise<Out> {
  const prompt = form.get("prompt");
  if (typeof prompt !== "string" || !prompt.trim()) return bad("فیلد prompt لازم است.");
  if (!(form.get("image") instanceof Blob) && !(form.get("image[]") instanceof Blob)) return bad("فایل image لازم است.");
  const n = imageCount(form.get("n"));
  if (!n) return bad("n باید بین ۱ و ۱۰ باشد.");
  const m = await modelOf(db, form.get("model"), allowed, "image");
  if (isErr(m)) return m;
  return metered(db, {
    caller, model: m, format: "images", reserve: kindCost("image", m, { images: n }),
    send: (up, model, h, signal) => { const f = new FormData(); for (const [k, v] of form) if (k !== "model") f.append(k, v); f.set("model", model); return up.form("images/edits", f, signal, h); },
    settle: async (res) => {
      const j = (await res.json()) as J & { data?: unknown[] };
      if (!Array.isArray(j.data)) throw new Error("no data");
      return { out: Response.json(j), bill: { units: j.data.length, charged: kindCost("image", m, { images: j.data.length }), finish: "stop", request: prompt, response: j.data.length + " image(s)" } };
    },
  });
}

/* ---------- audio ---------- */
export async function speech(db: DB, caller: Caller, allowed: string[], body: J): Promise<Out> {
  const input = body.input;
  if (typeof input !== "string" || !input.trim()) return bad("فیلد input لازم است.");
  if (input.length > 10_000) return bad("حداکثر ۱۰٬۰۰۰ نویسه در هر درخواست.");
  const m = await modelOf(db, body.model, allowed, "tts");
  if (isErr(m)) return m;
  const cost = kindCost("tts", m, { chars: input.length });
  return metered(db, {
    caller, model: m, format: "speech", reserve: cost,
    send: (up, model, h, signal) => up.post("audio/speech", { ...body, model }, signal, h),
    // the price is known up front, so the audio streams straight through
    settle: async (res) => ({ out: new Response(res.body, { headers: { "content-type": res.headers.get("content-type") || "audio/mpeg" } }), bill: { units: input.length, charged: cost, finish: "stop", request: input, response: "" } }),
  });
}

/** seconds of audio assumed per byte: reserve pessimistically (64 kbps), bill an unknown duration at 128 kbps */
const RESERVE_BPS = 8000, BILL_BPS = 16000;

export async function transcriptions(db: DB, caller: Caller, allowed: string[], form: FormData): Promise<Out> {
  const file = form.get("file");
  if (!(file instanceof Blob) || !file.size) return bad("فایل صوتی (file) لازم است.");
  const m = await modelOf(db, form.get("model"), allowed, "stt");
  if (isErr(m)) return m;
  const reserveSec = Math.min(4 * 3600, Math.max(60, Math.ceil(file.size / RESERVE_BPS)));
  return metered(db, {
    caller, model: m, format: "transcription", reserve: kindCost("stt", m, { seconds: reserveSec }),
    send: (up, model, h, signal) => { const f = new FormData(); for (const [k, v] of form) if (k !== "model") f.append(k, v); f.set("model", model); return up.form("audio/transcriptions", f, signal, h); },
    settle: async (res) => {
      const type = res.headers.get("content-type") || "application/json";
      const text = await res.text();
      let duration = 0;
      if (type.includes("json")) { const j = JSON.parse(text) as { duration?: number }; duration = typeof j.duration === "number" ? j.duration : 0; }
      const seconds = Math.max(1, Math.ceil(duration || file.size / BILL_BPS));
      return { out: new Response(text, { headers: { "content-type": type } }), bill: { units: seconds, charged: kindCost("stt", m, { seconds }), estimated: !duration, finish: "stop", request: "", response: text } };
    },
  });
}

/* ---------- rerank ---------- */
export async function rerank(db: DB, caller: Caller, allowed: string[], body: J): Promise<Out> {
  if (typeof body.query !== "string" || !body.query.trim()) return bad("فیلد query لازم است.");
  const docs = body.documents;
  if (!Array.isArray(docs) || !docs.length || docs.length > 1000) return bad("documents باید آرایه‌ای از ۱ تا ۱۰۰۰ سند باشد.");
  const m = await modelOf(db, body.model, allowed, "rerank");
  if (isErr(m)) return m;
  const searches = Math.ceil(docs.length / 100);
  return metered(db, {
    caller, model: m, format: "rerank", reserve: kindCost("rerank", m, { searches }),
    send: (up, model, h, signal) => up.post("rerank", { ...body, model }, signal, h),
    settle: async (res) => {
      const j = (await res.json()) as J & { results?: unknown[] };
      if (!Array.isArray(j.results)) throw new Error("no results");
      return { out: Response.json({ ...j, model: m.id }), bill: { units: searches, charged: kindCost("rerank", m, { searches }), finish: "stop", request: body.query, response: "" } };
    },
  });
}

export const isAiError = isErr;
