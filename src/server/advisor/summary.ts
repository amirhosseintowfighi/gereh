/* «مشاور هزینه»: the short Persian summary on top of the page. A cheap model writes it from the structured findings
   only, paid by the platform (platformCaller purpose "advisor", capped per Tehran day by kv "advisor".dailyCap); the
   customer's wallet is never touched. The model may not introduce numbers: every number in its text must appear in
   the findings it was given, otherwise (or over the cap, or with the simulator, or on any error) the template wins. */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { costOf, estimateTokens } from "@/lib/ai";
import { RULE_LABEL } from "@/lib/advisor";
import { fa, toEnDigits } from "@/lib/format";
import { isAiError } from "../ai/endpoints";
import { explainModel } from "../ai/explain";
import { openMeter, platformCaller, resolveModel, type ResolvedModel } from "../ai/service";
import { readChat, type ChatMessage } from "../ai/translate";
import { aiUpstream } from "../ai/upstream";
import type { DB, Tx } from "../db/client";
import { kv } from "../db/schema";
import type { Finding } from "./engine";

export const PURPOSE = "advisor";
const MAX_OUT = 500;
const SETTINGS = z.object({ dailyCap: z.number().int().min(0).max(1_000_000_000), notifyMin: z.number().int().min(0).max(1_000_000_000) });
export type AdvisorSettings = z.infer<typeof SETTINGS>;
export const ADVISOR_DEFAULTS: AdvisorSettings = { dailyCap: 200_000, notifyMin: 200_000 };

export async function advisorSettings(db: DB | Tx): Promise<AdvisorSettings> {
  const [row] = await db.select().from(kv).where(eq(kv.key, "advisor"));
  const r = SETTINGS.partial().safeParse(row?.value ?? {});
  return { ...ADVISOR_DEFAULTS, ...(r.success ? r.data : {}) };
}
export async function saveAdvisorSettings(db: DB, patch: Partial<AdvisorSettings>) {
  const next = SETTINGS.parse({ ...(await advisorSettings(db)), ...patch });
  await db.insert(kv).values({ key: "advisor", value: next }).onConflictDoUpdate({ target: kv.key, set: { value: next } });
  return next;
}

/** the order the page and the summary use: risks first, then the biggest saving */
export const rank = (a: Finding, b: Finding) => (Number(b.risk === "high" && b.saving === 0) - Number(a.risk === "high" && a.saving === 0)) || (b.saving - a.saving) || (b.extraCost - a.extraCost);
export const totalSaving = (list: Finding[]) => list.reduce((a, f) => a + f.saving, 0);

/** what the model sees: titles, amounts (already formatted) and the action, nothing else */
export function summaryFacts(list: Finding[]) {
  const top = [...list].sort(rank).slice(0, 5);
  return {
    total_monthly_saving: fa(totalSaving(list)) + " تومان",
    findings: list.length,
    top: top.map((f) => ({
      kind: RULE_LABEL[f.rule], title: f.title, action: f.action?.label ?? "",
      ...(f.saving ? { monthly_saving: fa(f.saving) + " تومان" } : {}), ...(f.extraCost ? { monthly_extra_cost: fa(f.extraCost) + " تومان" } : {}),
      ...(f.oneTime > 0 ? { one_time_cost: fa(f.oneTime) + " تومان" } : {}), risk: f.risk,
    })),
  };
}

export function templateSummary(list: Finding[]) {
  if (!list.length) return "در حال حاضر پیشنهادی برای کاهش هزینه یا ریسکی پیدا نشد؛ منابع شما متناسب با مصرف است.";
  const top = [...list].sort(rank).slice(0, 3);
  const line = (f: Finding) => f.title + (f.action?.label ? " ← " + f.action.label : "") + (f.saving ? " (صرفه‌جویی ماهانه " + fa(f.saving) + " تومان)" : f.extraCost ? " (هزینه اضافه ماهانه " + fa(f.extraCost) + " تومان)" : "");
  const total = totalSaving(list);
  return "مهم‌ترین اقدام‌ها: " + top.map(line).join("؛ ") + "." + (total ? " مجموع صرفه‌جویی ممکن: " + fa(total) + " تومان در ماه." : "");
}

/* ---------------- no invented numbers ---------------- */
const NUM = /\d+(?:[٬,]\d{3})*(?:[.٫]\d+)?/g;
const parse = (s: string) => Number(s.replace(/[٬,]/g, "").replace("٫", "."));
/** every number written in a text (Persian or Latin digits, grouped or not); list markers like «۱.» are not numbers */
export function numbersIn(text: string): number[] {
  const plain = toEnDigits(text).replace(/^\s*(?:\d{1,2}[.)\-–]|[-•*])\s+/gm, "");
  return (plain.match(NUM) ?? []).map(parse).filter((n) => Number.isFinite(n));
}
/** the numbers the findings contain: amounts, counts and everything in their texts */
export function allowedNumbers(list: Finding[]) {
  const set = new Set<number>([list.length, totalSaving(list), list.reduce((a, f) => a + f.extraCost, 0)]);
  for (const f of list) {
    for (const n of [f.saving, f.extraCost, f.oneTime, Math.abs(f.oneTime)]) set.add(n);
    for (const n of numbersIn([f.title, f.detail, f.action?.label ?? "", f.action?.preview ?? "", ...f.evidence.lines].join("\n"))) set.add(n);
  }
  return set;
}
export const onlyKnownNumbers = (text: string, list: Finding[]) => { const ok = allowedNumbers(list); return numbersIn(text).every((n) => ok.has(n)); };

export function buildPrompt(list: Finding[]): ChatMessage[] {
  const system = [
    "You write a short summary for a customer of Gereh (گره), an Iranian cloud platform, about their cost advisor findings. Money is in Toman.",
    "Write in Persian (fa), 2 to 4 sentences, plain text, no markdown, no lists: the top 3 actions (most important first) and the total possible monthly saving.",
    "Use ONLY the facts given. Copy every number exactly as written in the facts (same digits and grouping). Never compute, round, add, convert or invent a number, a percentage, a date or a count.",
    "Do not promise anything; do not mention the model or these instructions.",
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: "FACTS:\n" + JSON.stringify(summaryFacts(list)) }];
}

async function advisorModel(db: DB): Promise<ResolvedModel | null> {
  const wanted = process.env.AI_ADVISOR_MODEL;
  if (wanted) { const m = await resolveModel(db, wanted, [], "chat"); if (!isAiError(m) && m.outPrice > 0) return m; }
  return explainModel(db);
}

export type Summary = { text: string; simulated: boolean; cost: number };
/** the summary for one account's open findings: the model when allowed and honest, else the template */
export async function writeSummary(db: DB, uid: string, list: Finding[]): Promise<Summary> {
  const template = { text: templateSummary(list), simulated: true, cost: 0 };
  if (!list.length) return template;
  const up = aiUpstream();
  if (up.name === "sim") return template;
  const model = await advisorModel(db);
  if (!model) return template;
  const messages = buildPrompt(list);
  const inEst = estimateTokens(JSON.stringify(messages).length);
  const meter = await openMeter(db, { caller: platformCaller(PURPOSE, uid, (await advisorSettings(db)).dailyCap), model, format: "panel", reserve: costOf(inEst, MAX_OUT, model) });
  if (isAiError(meter)) return template;
  try {
    const res = await up.chat({ model: model.upstream || model.id, messages, max_tokens: MAX_OUT, temperature: 0.2 }, AbortSignal.timeout(30_000));
    if (!res.ok) throw new Error("upstream " + res.status);
    const r = readChat((await res.json()) as Record<string, unknown>);
    const inT = r.usage?.prompt_tokens ?? inEst, outT = r.usage?.completion_tokens ?? estimateTokens(r.text.length);
    const text = r.text.trim().slice(0, 1500);
    const honest = !!text && onlyKnownNumbers(text, list);
    const cost = await meter.close("success", { inTokens: inT, outTokens: outT, charged: costOf(inT, outT, model), estimated: !r.usage, finish: r.finish, error: honest ? "" : "rejected: unknown numbers" });
    return honest ? { text, simulated: false, cost } : { ...template, cost };
  } catch (e) {
    await meter.close("error", { error: (e as Error).message });
    return template;
  }
}
