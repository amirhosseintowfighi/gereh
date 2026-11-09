/* Markdown processor: repeated paragraphs, heading chunks and query-relevant section selection.
   Whitespace normalization is prompt.ts's normalizeWhitespace (outside code blocks only).
   Nothing is truncated silently: a repeated paragraph leaves a marker, and omitted sections leave one
   marker per run that lists their titles. Kept sections are copied verbatim and cited as
   [section: heading path]. */
import { normDigits, segments } from "./analyzer";
import { estimateText } from "./estimator";

const PARA_MIN = 80;
const paraKey = (p: string) => normDigits(p).replace(/\s+/g, " ").trim();
export const REPEATED_MARKER = "[… repeated paragraph omitted: identical to an earlier one …]";

/** replaces the second and later copies of a long prose paragraph with a marker; `seen` spans messages */
export function dedupeParagraphs(text: string, seen = new Set<string>()): { text: string; removed: number } {
  let removed = 0;
  const out = segments(text).map((s) => {
    if (s.kind !== "prose") return s.text;
    return s.text.split(/(\n[ \t]*\n)/).map((p, i) => {
      if (i % 2) return p; // separators
      const key = paraKey(p);
      if (key.length < PARA_MIN || /^#{1,6}\s/.test(p.trim())) return p;
      if (seen.has(key)) { removed++; return REPEATED_MARKER; }
      seen.add(key);
      return p;
    }).join("");
  }).join("");
  return { text: out, removed };
}

export type Section = { level: number; heading: string; path: string[]; text: string };

/** splits a Markdown text at its headings (outside code fences); the part before the first heading is the
    preamble (level 0). Joining the sections' texts gives the input back. */
export function chunkByHeading(text: string): Section[] {
  const out: Section[] = [{ level: 0, heading: "", path: [], text: "" }];
  const stack: { level: number; heading: string }[] = [];
  for (const seg of segments(text)) {
    if (seg.kind !== "prose") { out[out.length - 1].text += seg.text; continue; }
    for (const line of seg.text.split(/(?<=\n)/)) {
      const h = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.replace(/\n$/, ""));
      if (h) {
        const level = h[1].length, heading = h[2].trim();
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, heading });
        out.push({ level, heading, path: stack.map((x) => x.heading), text: line });
      } else out[out.length - 1].text += line;
    }
  }
  return out[0].text ? out : out.slice(1);
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "it", "this", "that", "with", "as", "by", "at", "from", "را", "و", "در", "به", "از", "که", "این", "آن", "با", "برای", "یک", "است", "می", "هم", "تا", "یا"]);
export function terms(text: string): string[] {
  return normDigits(text).toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length > 1 && !STOP.has(w));
}

/** BM25 scores of each document for the query */
export function bm25(docs: string[], query: string, k1 = 1.2, b = 0.75): number[] {
  const q = [...new Set(terms(query))];
  const toks = docs.map(terms);
  const avg = toks.reduce((n, t) => n + t.length, 0) / (toks.length || 1) || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  return toks.map((t) => {
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    let s = 0;
    for (const w of q) {
      const f = tf.get(w) ?? 0;
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avg));
    }
    return s;
  });
}

/** a section that carries security or hard rules is never omitted */
const MUST_KEEP = /\b(?:security|secret|password|credential|api key|never|must not|forbidden|do not|don't|warning)\b|امنیت|رمز عبور|گذرواژه|محرمانه|نباید|هرگز|ممنوع|هشدار/i;

export const omittedMarker = (titles: string[]) => "[… " + titles.length + " section" + (titles.length > 1 ? "s" : "") + " omitted as not relevant to the latest request: " + titles.map((t) => "«" + t.replace(/[\]\n…]/g, " ").slice(0, 80) + "»").join(", ") + " …]";
export const citation = (path: string[]) => "[section: " + path.join(" > ").replace(/[\]\n]/g, " ") + "]";

/** keeps the preamble, every must-keep section and the best BM25 sections for `query` within `budget`
    estimated tokens; order is kept. Unchanged when the text is under `minTokens` or has fewer than 3 sections. */
export function selectSections(text: string, query: string, o: { minTokens: number; budget: number }): { text: string; omitted: string[] } {
  const total = estimateText(text);
  if (total < o.minTokens) return { text, omitted: [] };
  const secs = chunkByHeading(text);
  if (secs.filter((s) => s.level > 0).length < 3) return { text, omitted: [] };
  const cost = secs.map((s) => estimateText(s.text));
  const scores = bm25(secs.map((s) => s.path.join(" ") + "\n" + s.text), query);
  const keep = new Set<number>();
  let used = 0;
  secs.forEach((s, i) => { if (s.level === 0 || MUST_KEEP.test(s.text)) { keep.add(i); used += cost[i]; } });
  const order = secs.map((_, i) => i).filter((i) => !keep.has(i) && scores[i] > 0).sort((a, b) => scores[b] - scores[a]);
  for (const i of order) { if (used + cost[i] > o.budget && keep.size > 0) continue; keep.add(i); used += cost[i]; }
  if (keep.size === secs.length) return { text, omitted: [] };
  const out: string[] = [], omitted: string[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length) { out.push(omittedMarker(run) + "\n\n"); omitted.push(...run); run = []; } };
  secs.forEach((s, i) => {
    if (keep.has(i)) { flush(); out.push(s.level ? citation(s.path) + "\n" + s.text : s.text); }
    else run.push(s.path.join(" > ") || s.heading);
  });
  flush();
  const joined = out.join("");
  return estimateText(joined) < total ? { text: joined, omitted } : { text, omitted: [] };
}
