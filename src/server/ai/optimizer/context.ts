/* Context compressor for conversation history. The latest user message and everything after it, and the
   last N turns before it, are kept verbatim. Older messages:
     - exact duplicates are replaced by a marker (message structure and tool-call pairing stay intact);
     - long tool results keep head, tail and key lines, with «[… N lines omitted from tool result X …]»;
     - with summarize on, whole older turns are replaced by one deterministic summary (no LLM call): verbatim
       sentences that carry decisions, facts with numbers/ids, open questions and active tasks, plus the
       references (URLs, paths, ids) — and an explicit marker of what was omitted.
   The verbatim window moves in blocks of TURN_BLOCK turns, so the summarized prefix stays byte-stable for
   several turns and prompt caching keeps hitting. */
import { invariants, NEGATIONS_EN, NEGATIONS_FA, protectedSpans, segments } from "./analyzer";

const NEGATION_WORDS = new Set([...NEGATIONS_EN, ...NEGATIONS_FA, "نمی"]);
import { estimateMessage } from "./estimator";
import type { ChatMessage, Policy } from "./types";
import { sentencesOf, unbullet } from "./validator";

export const TURN_BLOCK = 4;

export const toolName = (msgs: ChatMessage[], i: number) => {
  const m = msgs[i];
  if (m.name) return m.name;
  for (let j = i - 1; j >= 0; j--) {
    const c = msgs[j].tool_calls?.find((t) => t.id === m.tool_call_id);
    if (c) return c.function.name || m.tool_call_id || "tool";
  }
  return m.tool_call_id || "tool";
};
const safeLabel = (s: string) => s.replace(/[\]\n…]/g, " ").slice(0, 60);

/** index where the verbatim window starts: the start of the (recentTurns)-th last turn, block-aligned */
export function windowStart(msgs: ChatMessage[], recentTurns: number, first: number): number {
  const starts: number[] = [];
  for (let i = first; i < msgs.length; i++) if (msgs[i].role === "user") starts.push(i);
  if (!starts.length) return msgs.length;
  const older = Math.max(0, starts.length - 1 - recentTurns);
  const aligned = Math.floor(older / TURN_BLOCK) * TURN_BLOCK;
  return aligned > 0 ? starts[aligned] : first;
}

const KEY_LINE = /\b(?:error|errors|fail(?:ed|ure)?|fatal|panic|exception|traceback|warn(?:ing)?|denied|refused|timeout|timed out|not found|exit(?:ed)? (?:code|status)|status|total|summary|result|success(?:ful)?)\b|خطا|ناموفق|هشدار|موفق|وضعیت|مجموع/i;

/** head/tail/key lines of a long tool result, or head/tail characters of one long line; null when short */
export function shrinkToolResult(text: string, label: string, maxLines: number, maxChars: number): string | null {
  const lines = text.split("\n");
  const name = safeLabel(label);
  if (lines.length > maxLines) {
    const head = Math.max(1, Math.ceil(maxLines * 0.4)), tail = Math.max(1, Math.floor(maxLines * 0.3)), keyMax = Math.max(0, maxLines - head - tail);
    const keep = new Set<number>();
    for (let i = 0; i < head; i++) keep.add(i);
    for (let i = lines.length - tail; i < lines.length; i++) keep.add(i);
    let k = 0;
    for (let i = head; i < lines.length - tail && k < keyMax; i++) if (KEY_LINE.test(lines[i]) && lines[i].length <= 400) { keep.add(i); k++; }
    const out: string[] = [];
    let gap = 0;
    for (let i = 0; i < lines.length; i++) {
      if (keep.has(i)) { if (gap) { out.push("[… " + gap + " lines omitted from tool result " + name + " …]"); gap = 0; } out.push(lines[i]); }
      else gap++;
    }
    if (gap) out.push("[… " + gap + " lines omitted from tool result " + name + " …]");
    const r = out.join("\n");
    return r.length < text.length ? r : null;
  }
  if (text.length > maxChars && lines.length <= 3) {
    // cut one long line (typically compact JSON) at a value boundary near 60% head / 25% tail
    const cut = (s: string, at: number, back: boolean) => {
      const re = /[,\]}]\s*/g;
      let best = at;
      if (!back) { re.lastIndex = Math.max(0, at - 200); let m; while ((m = re.exec(s)) && m.index <= at) best = m.index + m[0].length; }
      else { re.lastIndex = at; const m = re.exec(s); if (m && m.index < at + 200) best = m.index + m[0].length; }
      return best;
    };
    const h = cut(text, Math.floor(maxChars * 0.6), false), t = cut(text, text.length - Math.floor(maxChars * 0.25), true);
    if (t <= h) return null;
    return text.slice(0, h) + "[… " + (t - h) + " characters omitted from tool result " + name + " …]" + text.slice(t);
  }
  return null;
}

/* ---------- deterministic summary ---------- */

const DECISION = /\b(?:decided|decision|we will|we'll|going with|chose|chosen|agreed|confirmed|done|completed|created|deployed|fixed|resolved|switched|enabled|disabled)\b|تصمیم|قرار شد|انتخاب شد|انجام شد|ساخته شد|ایجاد شد|تأیید شد|تایید شد|حل شد|فعال شد|غیرفعال شد|نصب شد/i;
const TASK = /\b(?:todo|to do|need to|needs to|should|must|please|next step|pending|remaining|make sure|remember)\b|لطفا|لطفاً|باید|می‌خواهم|میخواهم|بساز|درست کن|اضافه کن|کار بعدی|یادت باشد/i;
const QUESTION = /[?؟]\s*$/;
const SENT_MAX = 300;

export type SummaryLimits = { decisions: number; facts: number; questions: number; tasks: number; refs: number };
export const SUMMARY_LIMITS: Record<number, SummaryLimits> = {
  2: { decisions: 12, facts: 20, questions: 5, tasks: 8, refs: 30 },
  3: { decisions: 8, facts: 12, questions: 3, tasks: 6, refs: 20 },
};

const textOf = (m: ChatMessage) => (typeof m.content === "string" ? m.content : Array.isArray(m.content) ? (m.content as { text?: string }[]).map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n") : "");

/** a summary of `msgs` built only from their own sentences and references */
export function summarizeTurns(msgs: ChatMessage[], limits: SummaryLimits): string {
  const decisions: string[] = [], facts: string[] = [], questions: string[] = [], tasks: string[] = [];
  const refs = new Set<string>();
  const seen = new Set<string>();
  for (const m of msgs) {
    const text = textOf(m);
    if (m.role === "tool") {
      // tool output is data, not talk: only its references survive
      for (const s of protectedSpans(text.slice(0, 20_000))) if (refs.size < limits.refs * 2 && /[/@:._-]/.test(s) && s.length >= 4) refs.add(s);
      continue;
    }
    for (const seg of segments(text)) {
      if (seg.kind !== "prose") continue;
      for (const line of seg.text.split("\n")) {
        for (const raw of sentencesOf(line.trim())) {
          const s = unbullet(raw);
          if (s.length < 8 || s.length > SENT_MAX || seen.has(s) || /\[… /.test(s) || /^#{1,6}\s/.test(s) || /^\|/.test(s)) continue;
          seen.add(s);
          const inv = invariants(s);
          for (const x of inv.spans) if (/[/@:._-]/.test(x) && x.length >= 4) refs.add(x);
          if (m.role === "user" && QUESTION.test(s)) questions.push(s);
          else if (DECISION.test(s)) decisions.push(s);
          else if (TASK.test(s) && m.role === "user") tasks.push(s);
          // facts: sentences with numbers / ids, and constraints (a negation is never summarized away)
          else if (inv.spans.length || inv.words.some((w) => NEGATION_WORDS.has(w))) facts.push(s);
        }
      }
    }
  }
  const tail = (a: string[], n: number) => a.slice(Math.max(0, a.length - n));
  const block = (title: string, items: string[]) => (items.length ? [title, ...items.map((x) => "- " + x)] : []);
  const refList = [...refs].filter((r) => !/^\d+$/.test(r)).slice(0, limits.refs);
  const lines = [
    ...block("Decisions:", tail(decisions, limits.decisions)), ...block("Facts:", tail(facts, limits.facts)),
    ...block("Open questions:", tail(questions, limits.questions)), ...block("Active tasks:", tail(tasks, limits.tasks)),
    ...block("References:", refList),
  ];
  return [
    "[… summary of " + msgs.length + " earlier messages: sentences extracted verbatim by Gereh, the rest omitted …]",
    ...lines,
  ].join("\n");
}

const leading = (msgs: ChatMessage[]) => { let f = 0; while (f < msgs.length && msgs[f].role === "system") f++; return f; };

/** duplicates and long tool results before the verbatim window. Index-aligned with `msgs`; new objects only for what changed. */
export function shrinkOlder(msgs: ChatMessage[], policy: Policy): { messages: ChatMessage[]; steps: Record<string, number> } {
  const steps: Record<string, number> = {};
  const bump = (k: string) => { steps[k] = (steps[k] ?? 0) + 1; };
  const out = msgs.slice();
  const first = leading(out);
  const latest = out.map((m) => m.role).lastIndexOf("user");
  if (latest < 0 || policy.level === 0) return { messages: out, steps };
  const win = Math.min(windowStart(out, policy.recentTurns, first), latest);
  const seenTool = new Map<string, string>(), seenTalk = new Set<string>();
  for (let i = first; i < win; i++) {
    const m = out[i];
    if (typeof m.content !== "string" || !m.content) continue;
    if (m.role === "tool") {
      const name = toolName(out, i);
      const prev = seenTool.get(m.content);
      if (prev && m.content.length > 120) { out[i] = { ...m, content: "[… duplicate of an earlier tool result (" + safeLabel(prev) + ") omitted …]" }; bump("duplicate"); continue; }
      seenTool.set(m.content, name);
      const s = shrinkToolResult(m.content, name, policy.maxToolLines, policy.maxToolChars);
      if (s) { out[i] = { ...m, content: s }; bump("toolShrink"); }
    } else if (m.content.length >= 200) {
      if (seenTalk.has(m.content)) { out[i] = { ...m, content: "[… duplicate of an earlier message omitted …]" }; bump("duplicate"); }
      else seenTalk.add(m.content);
    }
  }
  return { messages: out, steps };
}

export type SummaryResult = { messages: ChatMessage[]; summarized: number; summaryIndex: number; source: string; summary: string };

/** whole turns before the verbatim window → one summary system message (after the leading system messages).
    `original` gives the sentences (the request before any shrinking), `msgs` the current state. */
export function summarizeOlder(msgs: ChatMessage[], original: ChatMessage[], policy: Policy, overBudget: boolean): SummaryResult | null {
  if (!policy.summarize || policy.level < 2 || msgs.length !== original.length) return null;
  const first = leading(msgs);
  const latest = msgs.map((m) => m.role).lastIndexOf("user");
  if (latest < 0) return null;
  const win = Math.min(windowStart(msgs, policy.recentTurns, first), latest);
  if (win <= first) return null;
  const olderTokens = msgs.slice(first, win).reduce((n, m) => n + estimateMessage(m), 0);
  if (olderTokens <= policy.summarizeOverTokens && !overBudget) return null;
  const src = original.slice(first, win);
  const summary = summarizeTurns(src, SUMMARY_LIMITS[policy.level] ?? SUMMARY_LIMITS[2]);
  const msg: ChatMessage = { role: "system", content: summary };
  if (estimateMessage(msg) >= olderTokens) return null;
  const out = msgs.slice();
  out.splice(first, win - first, msg);
  return { messages: out, summarized: win - first, summaryIndex: first, source: src.map(textOf).join("\n"), summary };
}

export type CompressResult = { messages: ChatMessage[]; steps: Record<string, number>; summarized: number; summaryIndex: number };

/** both passes, without validation (optimize.ts validates each step) */
export function compressContext(msgs: ChatMessage[], policy: Policy, o: { overBudget: boolean }): CompressResult {
  const a = shrinkOlder(msgs, policy);
  const b = summarizeOlder(a.messages, msgs, policy, o.overBudget);
  if (!b) return { messages: a.messages, steps: a.steps, summarized: 0, summaryIndex: -1 };
  return { messages: b.messages, steps: { ...a.steps, summary: 1 }, summarized: b.summarized, summaryIndex: b.summaryIndex };
}

export const messageText = textOf;
