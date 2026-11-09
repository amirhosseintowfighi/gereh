/* System-prompt optimizer: whitespace and format normalization outside protected blocks, and exact /
   near-duplicate instruction dedupe. "Near" means the same text up to formatting only (case, spacing,
   punctuation, Arabic/Persian letter forms, digit forms, Markdown emphasis): two rules whose words differ
   ("Answer in Persian." / "Always answer in Persian.") are never merged, so rules with different purposes
   stay apart. Tool definitions are never touched (they are not messages). */
import { normDigits, segments } from "./analyzer";

/** whitespace normalization of prose: CRLF → LF, no trailing spaces, at most one blank line, inner runs of
    spaces collapsed. Leading indentation, table rows, ZWNJ and every protected block stay as they are. */
export function normalizeWhitespace(text: string): string {
  const unix = text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
  return segments(unix).map((s) => {
    if (s.kind !== "prose") return s.text;
    const lines = s.text.split("\n").map((l) => {
      if (/^\s*\|/.test(l)) return l.replace(/[ \t]+$/, "");
      const lead = /^[ \t]*/.exec(l)![0];
      return lead + l.slice(lead.length).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n");
  }).join("");
}

/** a rule line's identity up to formatting */
export function formatKey(line: string): string {
  return normDigits(line).toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[*_`~]+/g, "").replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
    .replace(/[\s‌]+/g, " ").replace(/[.!؟?،,;:]+\s*$/, "").trim();
}

const RULE_MIN = 12;
const isRule = (line: string) => {
  const t = line.trim();
  return t.length >= RULE_MIN && !/^#{1,6}\s/.test(t) && !/^\|/.test(t) && !/^[-=*_]{3,}$/.test(t) && /[\p{L}]/u.test(t);
};

/** a line repeated under different headings can mean something different there («- Price: 100» under two
    plans), so short and «key: value» lines are deduped only within their section; long self-contained
    rules are deduped anywhere */
let textSeq = 0;
const SECTION_SCOPED = (line: string) => line.trim().length < 40 || /^\s*(?:[-*+]\s+)?[^:：]{1,30}[:：]\s/.test(line);

/** removes the second and later copies of a rule line (exact, or up to formatting when `near`), within one
    text and across texts sharing `seen`. Returns the text and how many lines went. */
export function dedupeInstructions(text: string, near: boolean, seen = new Set<string>()): { text: string; removed: number } {
  let removed = 0, section = 0;
  const text_ = ++textSeq;
  const out = segments(text).map((s) => {
    if (s.kind !== "prose") return s.text;
    const kept: string[] = [];
    for (const line of s.text.split("\n")) {
      if (/^\s{0,3}#{1,6}\s/.test(line)) section++;
      if (!isRule(line)) { kept.push(line); continue; }
      const base = near ? formatKey(line) : line.trim();
      const key = SECTION_SCOPED(line) ? "§" + text_ + "." + section + "\u0000" + base : base;
      if (seen.has(key)) { removed++; continue; }
      seen.add(key);
      kept.push(line);
    }
    return kept.join("\n");
  }).join("");
  return { text: out, removed };
}

/** the system prompt pass: normalize, then dedupe */
export function optimizeSystemText(text: string, o: { near: boolean; seen?: Set<string> }): { text: string; whitespace: boolean; deduped: number } {
  const ws = normalizeWhitespace(text);
  const d = dedupeInstructions(ws, o.near, o.seen);
  return { text: d.text, whitespace: ws !== text, deduped: d.removed };
}
