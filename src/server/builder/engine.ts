/* The builder's agent loop: one model call per run (generate, edit, fix, maintain), streamed and
   billed through the AI gateway's meter (wallet reserve → real cost), parsed, validated and saved as a
   new version of the project's files. The run gets the skills that fit it (./skills), the result goes
   through the static quality gate (./quality.ts) and, for a new project, a second, metered self-review
   call that fixes what it finds before the version is saved. Without an upstream key the simulator
   answers (./sim.ts). */
import "server-only";

/** the longest one model call of the builder may take */
const AGENT_TIMEOUT_MS = Number(process.env.BUILDER_AGENT_TIMEOUT_MS || 10 * 60_000);
import { and, asc, desc, eq, gt, gte, sql } from "drizzle-orm";
import { costOf, estimateTokens } from "@/lib/ai";
import { BUILDER_DEFAULT_MODEL, filesError, pathError, type BuilderEvent, type QualityReport } from "@/lib/builder";
import { FAILURES, type FailureKind } from "@/lib/paas-runtime";
import { baseLang, dirOf, resolveSiteLanguage, textLanguage } from "@/lib/site-language";
import type { DB } from "../db/client";
import { aiModels, builderMessages, builderProjects, builderRuns, builderVersions } from "../db/schema";
import { isAiError } from "../ai/endpoints";
import { openMeter, panelCaller, resolveModel, upstreamError, type ResolvedModel } from "../ai/service";
import { readSSE, type ChatMessage, type ChatUsage } from "../ai/translate";
import { aiUpstream } from "../ai/upstream";
import { rid } from "../util";
import { parseOutput, streamedPaths, streamedPlan } from "./format";
import { reviewMessages, skillsFor, taskMessages, type Langs, type TaskInput } from "./prompt";
import { checkFiles, errorsOf, qualityLog } from "./quality";
import { simulate, simulateReview } from "./sim";
import type { Skill } from "./skills";

export type Project = typeof builderProjects.$inferSelect;
export type Run = typeof builderRuns.$inferSelect;
export type RunKind = Run["kind"];
export const MAX_OUT = 32_000;
/** the self-review answers only the files it fixes */
export const REVIEW_OUT = 16_000;
const REVIEW_TIMEOUT_MS = Math.min(AGENT_TIMEOUT_MS, Number(process.env.BUILDER_REVIEW_TIMEOUT_MS || 5 * 60_000));
const BUSY_MS = 10 * 60_000;

export async function ownProject(db: DB, userId: string, id: string) {
  const [p] = await db.select().from(builderProjects).where(and(eq(builderProjects.id, id), eq(builderProjects.userId, userId)));
  return p ?? null;
}

export async function filesAt(db: DB, projectId: string, version: number): Promise<Record<string, string>> {
  if (!version) return {};
  const [v] = await db.select({ files: builderVersions.files }).from(builderVersions).where(and(eq(builderVersions.projectId, projectId), eq(builderVersions.version, version)));
  return v?.files ?? {};
}

/** stores a snapshot as the next version and makes it current */
export async function saveVersion(db: DB, projectId: string, files: Record<string, string>, message: string, runId: string | null = null) {
  return db.transaction(async (tx) => {
    const [p] = await tx.update(builderProjects).set({ version: sqlInc(), updatedAt: new Date() }).where(eq(builderProjects.id, projectId)).returning({ version: builderProjects.version });
    await tx.insert(builderVersions).values({ projectId, version: p.version, files, message: message.slice(0, 200), runId });
    return p.version;
  });
}
const sqlInc = () => sql`${builderProjects.version} + 1`;

export function diffOf(before: Record<string, string>, after: Record<string, string>) {
  const added = Object.keys(after).filter((p) => !(p in before)).sort();
  const changed = Object.keys(after).filter((p) => p in before && before[p] !== after[p]).sort();
  const deleted = Object.keys(before).filter((p) => !(p in after)).sort();
  return { added, changed, deleted };
}

/** the project's model, else the default, else the first active, priced chat model */
export async function pickModel(db: DB, wanted: string): Promise<ResolvedModel | null> {
  for (const id of [wanted, BUILDER_DEFAULT_MODEL]) {
    if (!id) continue;
    const m = await resolveModel(db, id, [], "chat");
    if (!isAiError(m) && m.outPrice > 0) return m;
  }
  const [m] = await db.select().from(aiModels).where(and(eq(aiModels.active, true), eq(aiModels.kind, "chat"), gt(aiModels.outPrice, 0))).orderBy(asc(aiModels.position)).limit(1);
  return m ?? null;
}

/** the site's language for a run and the customer's (for plan and summary) */
export function languagesOf(p: Project, kind: RunKind, prompt: string): Required<Langs> {
  const asked = kind === "generate" || kind === "edit";
  const lang = asked ? resolveSiteLanguage({ prompt, setting: p.languageSetting, current: p.siteLanguage }) : p.siteLanguage || resolveSiteLanguage({ prompt: p.description, setting: p.languageSetting });
  return { lang, reply: textLanguage(asked && prompt ? prompt : p.description) };
}

/** the self-review pass is on unless BUILDER_SELF_REVIEW turns it off */
export const reviewEnabled = () => !/^(0|off|false|no)$/i.test(process.env.BUILDER_SELF_REVIEW ?? "");

class Stopped extends Error {}
const NET_RETRIES = 2;
/** a connection-level failure (worth retrying), not an answer from the model service */
const isNetError = (e: unknown) => /terminated|fetch failed|other side closed|socket|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR/i.test(((e as Error)?.message ?? "") + " " + String((e as { cause?: { code?: string; message?: string } })?.cause?.code ?? (e as { cause?: { message?: string } })?.cause?.message ?? ""));
const simDelay = () => Number(process.env.BUILDER_SIM_DELAY_MS ?? (process.env.NODE_ENV === "test" ? 0 : 70));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** text deltas of one answer (upstream SSE, or the simulator) and the usage when reported */
async function* answer(model: ResolvedModel, messages: ChatMessage[], sim: () => string, maxOut: number, signal: AbortSignal): AsyncGenerator<{ delta?: string; usage?: ChatUsage }> {
  const up = aiUpstream();
  if (up.name === "sim") {
    const text = sim(), step = 480, wait = simDelay();
    for (let i = 0; i < text.length; i += step) {
      if (signal.aborted) throw new Stopped();
      if (wait) await sleep(wait);
      yield { delta: text.slice(i, i + step) };
    }
    return;
  }
  const res = await up.chat({ model: model.upstream || model.id, messages, stream: true, max_tokens: maxOut, temperature: 0.4, stream_options: { include_usage: true } }, signal);
  if (!res.ok) throw new Error(upstreamError(res.status, (await res.text().catch(() => "")).slice(0, 300)).message);
  for await (const c of readSSE(res.body!)) {
    if (signal.aborted) throw new Stopped();
    const delta = (c.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content;
    const usage = c.usage as ChatUsage | undefined;
    if (delta || usage) yield { delta: delta || undefined, usage: usage || undefined };
  }
}

/** one whole answer; a dropped upstream connection ("terminated", "fetch failed", a reset socket)
    restarts it, up to NET_RETRIES times: long international streams from the server are cut now and then */
async function streamAnswer(o: { model: ResolvedModel; messages: ChatMessage[]; sim: () => string; maxOut: number; signal: AbortSignal; emit: (e: BuilderEvent) => void; onText?: (text: string) => void }) {
  let text = "", usage: ChatUsage | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      for await (const c of answer(o.model, o.messages, o.sim, o.maxOut, o.signal)) {
        if (c.usage) usage = c.usage;
        if (!c.delta) continue;
        text += c.delta;
        o.onText?.(text);
      }
      return { text, usage };
    } catch (e) {
      if (e instanceof Stopped || o.signal.aborted || attempt >= NET_RETRIES || !isNetError(e)) { (e as { partial?: string }).partial = text; throw e; }
      console.warn("[builder] upstream dropped (" + (e as Error).message + "); retry " + (attempt + 1));
      text = ""; usage = null;
      o.emit({ type: "status", text: "اتصال به سرویس مدل قطع شد؛ دوباره تلاش می‌شود…" });
    }
  }
}

export type AgentInput = {
  userId: string; projectId: string; kind: RunKind; prompt?: string;
  /** fix: the failed build; maintain: the incident */
  context?: { log?: string; failure?: string; incident?: string; events?: string; logs?: string };
  attempt?: number; signal?: AbortSignal; emit?: (e: BuilderEvent) => void;
};
export type AgentResult = { ok: true; run: Run; version: number | null; patch: Record<string, string | null> | null } | { ok: false; error: string; run?: Run; status?: number };

const KIND_DONE: Record<RunKind, [string, string]> = {
  generate: ["پروژه ساخته شد.", "Your project is ready."], edit: ["تغییرات اعمال شد.", "The changes are in."],
  fix: ["خطا رفع شد.", "The error is fixed."], maintain: ["بررسی انجام شد.", "The check is done."],
};

type Review = { status: "done" | "skipped" | "failed"; note: string; patch: Record<string, string>; charged: number; inTokens: number; outTokens: number };

/** the second pass: the files, the skills' checklists and the static findings in, a patch out. Metered and
    charged like any run; a short wallet or budget skips it, a failure or a stop keeps the first answer. */
async function selfReview(db: DB, o: { p: Project; userId: string; files: Record<string, string>; skills: Skill[]; report: QualityReport; langs: Langs; signal?: AbortSignal; emit: (e: BuilderEvent) => void }): Promise<Review> {
  const none = { patch: {}, charged: 0, inTokens: 0, outTokens: 0 };
  const model = await pickModel(db, process.env.BUILDER_REVIEW_MODEL || o.p.model);
  if (!model) return { ...none, status: "skipped", note: "مدلی برای بازبینی در دسترس نبود." };
  const messages = reviewMessages(o.p.stack, o.files, o.skills, o.report.findings, o.langs);
  const inEst = estimateTokens(JSON.stringify(messages).length);
  const meter = await openMeter(db, { caller: await panelCaller(db, o.userId), model, format: "panel", stream: true, reserve: costOf(inEst, REVIEW_OUT, model) });
  if (isAiError(meter)) return { ...none, status: "skipped", note: meter.http === 402 ? "بازبینی کیفیت انجام نشد: موجودی کیف پول یا بودجه برای آن کافی نبود." : "بازبینی کیفیت انجام نشد: " + meter.message };
  o.emit({ type: "status", text: "در حال بازبینی کیفیت و امنیت…" });
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  o.signal?.addEventListener("abort", onAbort);
  const stall = setTimeout(() => abort.abort(), REVIEW_TIMEOUT_MS);
  try {
    const { text, usage } = await streamAnswer({ model, messages, sim: () => simulateReview(o.p.stack, o.files, o.report.findings, o.langs), maxOut: REVIEW_OUT, signal: abort.signal, emit: o.emit });
    const inT = usage?.prompt_tokens ?? inEst, outT = usage?.completion_tokens ?? estimateTokens(text.length);
    const charged = await meter.close("success", { inTokens: inT, outTokens: outT, charged: costOf(inT, outT, model), estimated: !usage, finish: "stop", request: messages.slice(-1), response: text });
    const parsed = parseOutput(text);
    const patch: Record<string, string> = {};
    for (const [path, content] of Object.entries(parsed.files)) if (!pathError(path) && content.trim() && content !== o.files[path]) patch[path] = content;
    return { status: "done", note: parsed.summary.slice(0, 600), patch, charged, inTokens: inT, outTokens: outT };
  } catch (e) {
    const partial = (e as { partial?: string }).partial ?? "";
    const stopped = e instanceof Stopped || abort.signal.aborted || (e as Error).name === "AbortError";
    const outT = estimateTokens(partial.length);
    const charged = stopped && partial ? await meter.close("cancelled", { inTokens: inEst, outTokens: outT, charged: costOf(inEst, outT, model), estimated: true, error: o.signal?.aborted ? "stopped by the customer" : "review timed out" })
      : await meter.close("error", { error: (e as Error).message });
    return { ...none, charged, inTokens: stopped ? inEst : 0, outTokens: stopped ? outT : 0, status: "failed", note: stopped ? (o.signal?.aborted ? "بازبینی کیفیت متوقف شد." : "بازبینی کیفیت بیش از حد طول کشید و کنار گذاشته شد.") : "بازبینی کیفیت انجام نشد؛ نسخه اصلی ذخیره شد." };
  } finally {
    clearTimeout(stall);
    o.signal?.removeEventListener("abort", onAbort);
  }
}

export async function runAgent(db: DB, o: AgentInput): Promise<AgentResult> {
  const emit = o.emit ?? (() => {});
  const p = await ownProject(db, o.userId, o.projectId);
  if (!p) return { ok: false, error: "پروژه پیدا نشد.", status: 404 };
  const interactive = o.kind === "generate" || o.kind === "edit";
  if (interactive) {
    const [busy] = await db.select({ id: builderRuns.id }).from(builderRuns)
      .where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.status, "running"), gte(builderRuns.createdAt, new Date(Date.now() - BUSY_MS))));
    if (busy) return { ok: false, error: "AI در حال کار روی همین پروژه است؛ تا پایان آن صبر کنید یا آن را متوقف کنید.", status: 409 };
  }
  const model = await pickModel(db, p.model);
  if (!model) return { ok: false, error: "در حال حاضر مدل فعالی برای ساخت در دسترس نیست.", status: 503 };
  const files = await filesAt(db, p.id, p.version);
  const prompt = (o.prompt ?? "").trim();
  const langs = languagesOf(p, o.kind, prompt);
  if (interactive && (langs.lang !== p.siteLanguage || dirOf(langs.lang) !== p.siteDir)) {
    await db.update(builderProjects).set({ siteLanguage: langs.lang, siteDir: dirOf(langs.lang) }).where(eq(builderProjects.id, p.id));
  }
  let task: TaskInput;
  if (o.kind === "generate" || (o.kind === "edit" && !Object.keys(files).length)) task = { kind: "generate", prompt, ...langs };
  else if (o.kind === "edit") {
    const hist = await db.select({ content: builderMessages.content }).from(builderMessages).where(and(eq(builderMessages.projectId, p.id), eq(builderMessages.role, "user"))).orderBy(desc(builderMessages.id)).limit(6);
    task = { kind: "edit", prompt, files, history: hist.map((h) => h.content.slice(0, 400)).reverse(), ...langs };
  } else if (o.kind === "fix") {
    const f = (o.context?.failure ?? "") as FailureKind | "";
    task = { kind: "fix", files, log: o.context?.log ?? "", failure: f, explain: f && FAILURES[f] ? FAILURES[f].title + ": " + FAILURES[f].explain : "", ...langs };
  } else task = { kind: "maintain", files, incident: o.context?.incident ?? "manual", events: o.context?.events ?? "", logs: o.context?.logs ?? "", ...langs };
  const skills = skillsFor(p.stack, task);

  const runId = rid("brun");
  await db.insert(builderRuns).values({ id: runId, projectId: p.id, userId: o.userId, kind: o.kind, model: model.id, prompt: prompt.slice(0, 4000), attempt: o.attempt ?? 0, incident: o.context?.incident ?? "", skills: skills.map((s) => s.id) });
  if (interactive) {
    await db.insert(builderMessages).values({ projectId: p.id, role: "user", content: prompt.slice(0, 4000), runId });
    await db.update(builderProjects).set({ status: "generating", updatedAt: new Date() }).where(eq(builderProjects.id, p.id));
  }
  const restore = interactive ? p.status === "generating" ? (p.version ? "ready" : "draft") : p.status : p.status;
  const finish = async (status: Run["status"], patch: Partial<Run>, message?: string) => {
    const [r] = await db.update(builderRuns).set({ status, finishedAt: new Date(), ...patch }).where(eq(builderRuns.id, runId)).returning();
    if (message) await db.insert(builderMessages).values({ projectId: p.id, role: "assistant", content: message, runId });
    return r;
  };

  const messages = taskMessages(p.stack, task, skills);
  const inEst = estimateTokens(JSON.stringify(messages).length);
  const meter = await openMeter(db, { caller: await panelCaller(db, o.userId), model, format: "panel", stream: true, reserve: costOf(inEst, MAX_OUT, model) });
  if (isAiError(meter)) {
    const run = await finish("failed", { log: meter.message }, interactive ? meter.message : undefined);
    if (interactive) await db.update(builderProjects).set({ status: restore }).where(eq(builderProjects.id, p.id));
    return { ok: false, error: meter.message, run, status: meter.http };
  }

  emit({ type: "run", runId, kind: o.kind, model: model.id, skills: skills.map((s) => s.id) });
  emit({ type: "status", text: o.kind === "fix" ? "در حال بررسی لاگ بیلد…" : o.kind === "maintain" ? "در حال بررسی لاگ‌ها و رخدادها…" : "در حال برنامه‌ریزی…" });
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  o.signal?.addEventListener("abort", onAbort);
  // a stalled upstream must not hold a worker job (or the panel stream) forever
  const stall = setTimeout(() => abort.abort(), AGENT_TIMEOUT_MS);
  let text = "", usage: ChatUsage | null = null, plan = "";
  const seen = new Set<string>();
  try {
    const r = await streamAnswer({
      model, messages, sim: () => simulate(p.stack, task), maxOut: MAX_OUT, signal: abort.signal, emit,
      onText: (t) => {
        if (t.length < text.length) { plan = ""; } // a retry started over
        text = t;
        const pl = streamedPlan(t);
        if (pl && pl !== plan && (pl.length - plan.length > 24 || /<\/plan>/i.test(t))) { plan = pl; emit({ type: "plan", text: pl }); }
        for (const path of streamedPaths(t)) if (!seen.has(path)) { seen.add(path); emit({ type: "file", path }); }
      },
    });
    text = r.text; usage = r.usage;
    if (o.signal?.aborted) throw new Stopped();
    clearTimeout(stall);
  } catch (e) {
    clearTimeout(stall);
    o.signal?.removeEventListener("abort", onAbort);
    const stopped = e instanceof Stopped || abort.signal.aborted || (e as Error).name === "AbortError";
    text = (e as { partial?: string }).partial ?? text;
    const outT = estimateTokens(text.length);
    if (stopped && text) await meter.close("cancelled", { inTokens: inEst, outTokens: outT, charged: costOf(inEst, outT, model), estimated: true, error: "stopped by the customer" });
    else await meter.close("error", { error: (e as Error).message });
    const cost = stopped && text ? costOf(inEst, outT, model) : 0;
    const msg = stopped ? (o.signal?.aborted ? "ساخت متوقف شد؛ تغییری ذخیره نشد." : "پاسخ مدل بیش از حد طول کشید و متوقف شد؛ تغییری ذخیره نشد. درخواست را کوتاه‌تر یا در چند مرحله بدهید.")
      : isNetError(e) ? "اتصال به سرویس مدل چند بار قطع شد؛ تغییری ذخیره نشد. چند لحظه دیگر دوباره تلاش کنید." : (e as Error).message || "سرویس مدل در دسترس نبود؛ مبلغی کسر نشد.";
    const run = await finish(stopped ? "cancelled" : "failed", { log: msg, cost, outTokens: outT, inTokens: inEst }, interactive ? msg : undefined);
    await db.update(builderProjects).set({ status: restore, spent: sql`${builderProjects.spent} + ${cost}` }).where(eq(builderProjects.id, p.id));
    if (!stopped) emit({ type: "error", message: msg });
    return { ok: false, error: msg, run, status: stopped ? 499 : 502 };
  }
  o.signal?.removeEventListener("abort", onAbort);

  const inT = usage?.prompt_tokens ?? inEst, outT = usage?.completion_tokens ?? estimateTokens(text.length);
  const charged = await meter.close("success", { inTokens: inT, outTokens: outT, charged: costOf(inT, outT, model), estimated: !usage, finish: "stop", request: messages.slice(-1), response: text });
  await db.update(builderProjects).set({ spent: sql`${builderProjects.spent} + ${charged}` }).where(eq(builderProjects.id, p.id));
  if (o.kind === "maintain") await db.update(builderProjects).set({ maintainSpent: sql`${builderProjects.maintainSpent} + ${charged}` }).where(eq(builderProjects.id, p.id));

  const parsed = parseOutput(text);
  const log: string[] = [];
  const next = { ...files };
  const patch: Record<string, string | null> = {};
  for (const [path, content] of Object.entries(parsed.files)) {
    const bad = pathError(path);
    if (bad) { log.push("رد شد: " + bad); continue; }
    patch[path] = content;
    next[path] = content;
  }
  for (const path of parsed.deletes) if (path in next) { patch[path] = null; delete next[path]; }
  if (parsed.truncated.length) log.push("پاسخ مدل ناقص بود؛ این فایل‌ها نوشته نشد: " + parsed.truncated.join("، "));
  const base = { inTokens: inT, outTokens: outT, cost: charged, model: model.id };
  const fail = async (msg: string) => {
    const run = await finish("failed", { ...base, log: [...log, msg].join("\n"), summary: parsed.summary.slice(0, 4000) }, msg);
    await db.update(builderProjects).set({ status: restore }).where(eq(builderProjects.id, p.id));
    emit({ type: "error", message: msg });
    return { ok: false as const, error: msg, run, status: 422 };
  };
  const tooBig = filesError(next);
  if (tooBig) return fail("خروجی مدل پذیرفته نشد: " + tooBig + ". دوباره تلاش کنید یا درخواست را ساده‌تر کنید.");
  if (!Object.keys(next).length) return fail("پاسخ مدل فایل قابل استفاده‌ای نداشت؛ دوباره تلاش کنید یا مدل دیگری انتخاب کنید.");

  // the quality gate: static checks, then (for a new project, or an edit that left errors) the self-review
  let quality: QualityReport | null = null, reviewCost = 0;
  if (o.kind !== "maintain") {
    const site = { lang: langs.lang, dir: dirOf(langs.lang) };
    quality = checkFiles(next, p.stack, site);
    if (reviewEnabled() && p.selfReview && (task.kind === "generate" || (task.kind === "edit" && errorsOf(quality) > 0))) {
      const before = { score: quality.score, errors: errorsOf(quality), warnings: quality.findings.length - errorsOf(quality) };
      const rv = await selfReview(db, { p, userId: o.userId, files: next, skills, report: quality, langs, signal: o.signal, emit });
      reviewCost = rv.charged;
      if (reviewCost) await db.update(builderProjects).set({ spent: sql`${builderProjects.spent} + ${reviewCost}` }).where(eq(builderProjects.id, p.id));
      const fixed = { ...next, ...rv.patch };
      const usable = Object.keys(rv.patch).length > 0 && !filesError(fixed);
      if (usable) { Object.assign(next, rv.patch); for (const [k, v] of Object.entries(rv.patch)) patch[k] = v; quality = checkFiles(next, p.stack, site); }
      quality = { ...quality, before, review: { status: rv.status, note: rv.note, files: usable ? Object.keys(rv.patch).sort() : [], cost: reviewCost } };
      base.inTokens += rv.inTokens; base.outTokens += rv.outTokens; base.cost += reviewCost;
      log.push(rv.status === "done" ? "بازبینی کیفیت: " + (usable ? "اصلاح شد: " + Object.keys(rv.patch).sort().join("، ") : "اصلاحی لازم نبود") : rv.note);
    }
    log.push(qualityLog(quality));
  }

  const diff = diffOf(files, next);
  const changed = diff.added.length + diff.changed.length + diff.deleted.length > 0;
  const en = baseLang(langs.reply) !== "fa";
  const summary = (parsed.summary || KIND_DONE[o.kind][en ? 1 : 0]) + (parsed.truncated.length ? "\n(بخشی از پاسخ ناقص بود: " + parsed.truncated.join("، ") + ")" : "");

  let version: number | null = null;
  if (o.kind !== "maintain" && changed) version = await saveVersion(db, p.id, next, (o.kind === "fix" ? "رفع خودکار: " : "") + (prompt || summary).replace(/\s+/g, " ").slice(0, 120), runId);
  const run = await finish("succeeded", { ...base, log: log.join("\n"), summary: summary.slice(0, 4000), diff, version, patch: o.kind === "maintain" && changed ? patch : null, quality, reviewCost }, summary);
  if (interactive) await db.update(builderProjects).set({ status: restore === "draft" || restore === "failed" ? "ready" : restore, updatedAt: new Date() }).where(eq(builderProjects.id, p.id));
  emit({ type: "done", version: version ?? p.version, summary, charged: base.cost, diff, score: quality?.score });
  return { ok: true, run, version, patch: o.kind === "maintain" && changed ? patch : null };
}
