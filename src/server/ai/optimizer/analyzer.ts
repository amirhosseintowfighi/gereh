/* Analyzer: what a request is made of (roles, content types, multimodal parts, tools) and which parts of a
   text are protected. Protected blocks (code fences, JSON, YAML, XML, shell lines) are never rewritten;
   protected spans (inline code, URLs, paths, IPs, emails, identifiers, numbers, dates) and negation and
   condition words must survive every rewrite (validator.ts). */
import type { ChatMessage, ChatRequest } from "./types";

export type SegKind = "prose" | "code" | "json" | "yaml" | "xml" | "shell";
export type Seg = { kind: SegKind; text: string };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SHELL = /^\s*(?:\$ |# (?=sudo|apt|cd|ls|cat|systemctl|docker)|sudo |apt(?:-get)? |npm |npx |pnpm |yarn |git |docker |docker-compose |kubectl |curl |wget |ssh |scp |systemctl |journalctl |chmod |chown |mkdir |rm |mv |cp |cd |export |pip3? |python3? |node |gereh )/;
const YAML_LINE = /^\s*(?:-\s+\S|[A-Za-z_][\w.-]*:(?:\s|$))/;
const XML_OPEN = /^\s*<([A-Za-z][\w:.-]*)(?:\s[^>]*)?>/;

/** splits a text into prose and protected blocks; joining the texts gives the input back exactly */
export function segments(text: string): Seg[] {
  const lines = text.split(/(?<=\n)/);
  const out: Seg[] = [];
  const push = (kind: SegKind, t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind === "prose") last.text += t;
    else out.push({ kind, text: t });
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      const mark = f[1][0], len = f[1].length;
      let j = i + 1;
      while (j < lines.length && !new RegExp("^ {0,3}\\" + mark + "{" + len + ",}\\s*$").test(lines[j])) j++;
      push("code", lines.slice(i, Math.min(j + 1, lines.length)).join(""));
      i = j + 1;
      continue;
    }
    const t = line.trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      const end = jsonEnd(lines, i);
      if (end > i) { push("json", lines.slice(i, end).join("")); i = end; continue; }
    }
    const x = XML_OPEN.exec(line);
    if (x) {
      const close = new RegExp("</" + x[1].replace(/[.]/g, "\\.") + ">");
      let j = i;
      while (j < lines.length && j - i < 400 && !close.test(lines[j])) j++;
      if (j < lines.length && close.test(lines[j]) && (j > i || /\/>|<\//.test(line))) { push("xml", lines.slice(i, j + 1).join("")); i = j + 1; continue; }
    }
    if (SHELL.test(line)) { push("shell", line); i++; continue; }
    if (YAML_LINE.test(line)) {
      let j = i;
      while (j < lines.length && (YAML_LINE.test(lines[j]) || /^\s{2,}\S/.test(lines[j])) && !FENCE.test(lines[j])) j++;
      // three or more lines, mostly short «key: value» pairs with a value (a Markdown list under «Rules:», or
      // with a «Note: …» line, is prose)
      const block = lines.slice(i, j);
      const keys = block.filter((l) => { const m = /^\s*(?:-\s+)?[A-Za-z_][\w.-]*:(.*)$/.exec(l.replace(/\r?\n$/, "")); return !!m && !!m[1].trim() && m[1].trim().split(/\s+/).length <= 4; }).length;
      if (block.length >= 3 && keys >= 2 && keys * 2 >= block.length) { push("yaml", block.join("")); i = j; continue; }
    }
    push("prose", line);
    i++;
  }
  return out;
}

/** end line (exclusive) of a JSON value starting at line i, or i when the lines there are not JSON */
function jsonEnd(lines: string[], i: number): number {
  let depth = 0, inStr = false, esc = false, buf = "";
  for (let j = i; j < lines.length && j - i < 2000; j++) {
    const l = lines[j];
    buf += l;
    for (const ch of l) {
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") inStr = false; continue; }
      if (ch === "\"") inStr = true;
      else if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") depth--;
    }
    if (depth <= 0) {
      try { JSON.parse(buf); return j + 1; } catch { return i; }
    }
  }
  return i;
}

export const isProtected = (s: Seg) => s.kind !== "prose";
/** inline code is protected inside prose */
const INLINE_CODE = /`[^`\n]+`/g;
const URL_RE = /\b(?:https?|ftp|wss?):\/\/[^\s<>"'`)\]»]+|\bwww\.[\w-]+\.[\w.-]+[^\s<>"'`)\]»]*/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?(?::\d{1,5})?\b/g;
const IPV6_RE = /(?<![\w:])(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}(?![\w:])|(?<![\w:])(?:[0-9a-f]{1,4}:)*:(?::[0-9a-f]{1,4})+(?![\w:])/gi;
const PATH_RE = /(?:~|\.{1,2})?\/[\w.@%+-]+(?:\/[\w.@%+-]*)+|\b[A-Za-z]:\\[\w\\.-]+|\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|py|go|rs|ya?ml|toml|sql|sh|conf|env|txt|php|css|html|lock|xml|ini|log|service|dockerfile)\b/gi;
const IDENT_RE = /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\b[A-Za-z]+-[A-Za-z0-9-]*\d[A-Za-z0-9-]*\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b|\bgk-[A-Za-z0-9…]+/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|ir|io|dev|app|co|info|me|ai|xyz|cloud|de|uk|eu|tech|site|online|shop|store|local|internal)\b/gi;
const DATE_RE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const NUM_RE = /\d+(?:[.,]\d+)*%?/g;

export const NEGATIONS_EN = ["not", "no", "never", "without", "except", "unless", "cannot", "can't", "don't", "doesn't", "didn't", "won't", "isn't", "aren't", "wasn't", "weren't", "shouldn't", "mustn't", "nor", "none", "neither", "nothing", "nobody", "avoid", "forbidden", "prohibited", "disallow"];
export const NEGATIONS_FA = ["مگر", "نه", "نباید", "بدون", "هرگز", "جز", "بجز", "به‌جز", "غیر از", "هیچ", "نیست", "نیستند", "ندارد", "ندارند", "نکنید", "نکن", "نشود", "نشده", "نخواهد", "نکنند", "نده", "ندهید", "نزنید", "ممنوع"];
export const CONDITIONS_EN = ["if", "unless", "only", "when", "whenever", "until", "before", "after", "must", "always", "should", "required", "otherwise", "else", "provided"];
export const CONDITIONS_FA = ["اگر", "مگر", "فقط", "تنها", "باید", "همیشه", "وقتی", "زمانی", "درصورتی", "در صورتی", "الزامی", "حتما", "حتماً", "قبل از", "بعد از"];

/** Persian and Arabic-Indic digits → ASCII, Arabic letter forms → Persian, for comparisons only */
export function normDigits(s: string) {
  return s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[٫]/g, ".").replace(/[٬]/g, ",");
}
const normLetters = (s: string) => s.replace(/ي/g, "ی").replace(/ك/g, "ک");

const all = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[0]);
const FA_WORD_BOUND = "(?<![\\u0600-\\u06FF\\u200c])";
const FA_WORD_END = "(?![\\u0600-\\u06FF])";
function words(list: string[], s: string, fa: boolean) {
  const hay = fa ? normLetters(s) : s.toLowerCase();
  return list.filter((w) => (fa ? new RegExp(FA_WORD_BOUND + w + FA_WORD_END) : new RegExp("(?<![\\w'])" + w.replace(/'/g, "'") + "(?![\\w'])", "i")).test(hay));
}
/** verbs negated with the «نمی» prefix (نمی‌دانم, نمی‌شود …) */
const FA_NEG_VERB = /(?<![؀-ۿ])نمی[‌ ]?[؀-ۿ]+/g;

export type Invariants = {
  /** protected blocks, verbatim */
  blocks: string[];
  /** spans that must appear verbatim (after digit normalization) */
  spans: string[];
  /** negation and condition words that must still appear */
  words: string[];
};

/** everything in a text that a rewrite must keep */
export function invariants(text: string): Invariants {
  const segs = segments(text);
  const blocks = segs.filter(isProtected).map((s) => s.text);
  const prose = segs.filter((s) => !isProtected(s)).map((s) => s.text).join("\n");
  const inline = all(INLINE_CODE, prose);
  const rest = prose.replace(INLINE_CODE, " ");
  const n = normDigits(rest);
  const spans = new Set<string>([...inline, ...all(URL_RE, rest), ...all(EMAIL_RE, rest), ...all(IPV4_RE, n), ...all(IPV6_RE, rest).filter((x) => /::|(?:[0-9a-f]{1,4}:){3}/i.test(x)), ...all(PATH_RE, rest), ...all(DOMAIN_RE, rest), ...all(IDENT_RE, rest), ...all(DATE_RE, n), ...all(NUM_RE, n)]
    .map((x) => normDigits(x).replace(/[.,;:!?؟]+$/, "")).filter((x) => x.length > 0));
  const w = new Set<string>([...words(NEGATIONS_EN, rest, false), ...words(CONDITIONS_EN, rest, false), ...words(NEGATIONS_FA, rest, true), ...words(CONDITIONS_FA, rest, true), ...all(FA_NEG_VERB, normLetters(rest)).map((x) => x.replace(/[‌ ].*$/, "").slice(0, 3))]);
  return { blocks, spans: [...spans], words: [...w] };
}

/** the words of a text that are protected spans (for the translator's masking) */
export function protectedSpans(text: string): string[] {
  const rest = text.replace(INLINE_CODE, " ");
  return [...new Set([...all(INLINE_CODE, text), ...all(URL_RE, rest), ...all(EMAIL_RE, rest), ...all(IPV4_RE, rest), ...all(PATH_RE, rest), ...all(DOMAIN_RE, rest), ...all(IDENT_RE, rest), ...all(DATE_RE, rest)])]
    .sort((a, b) => b.length - a.length);
}

/** does `opt` keep the word `w` (an invariants() word)? */
export function hasWord(opt: string, w: string): boolean {
  if (/^[؀-ۿ]/.test(w)) {
    const hay = normLetters(opt);
    if (w === "نمی") return /(?<![؀-ۿ])نمی/.test(hay);
    return new RegExp(FA_WORD_BOUND + w + FA_WORD_END).test(hay);
  }
  return new RegExp("(?<![\\w'])" + w + "(?![\\w'])", "i").test(opt);
}

/* ---------- request structure ---------- */

export type PartInfo = { text: number; image: number; audio: number; file: number; other: number };
export type MessageInfo = { index: number; role: ChatMessage["role"]; shape: "string" | "parts" | "empty"; chars: number; parts: PartInfo; toolCalls: number; toolResult: boolean };
export type RequestInfo = { messages: MessageInfo[]; latestUser: number; tools: number; toolChars: number; multimodal: boolean; stream: boolean };

export function partsOf(content: unknown): PartInfo {
  const p: PartInfo = { text: 0, image: 0, audio: 0, file: 0, other: 0 };
  if (!Array.isArray(content)) return p;
  for (const x of content as { type?: string }[]) {
    const t = x?.type ?? "";
    if (t === "text" || t === "input_text") p.text++;
    else if (t === "image_url" || t === "image" || t === "input_image") p.image++;
    else if (t === "input_audio" || t === "audio") p.audio++;
    else if (t === "file" || t === "input_file") p.file++;
    else p.other++;
  }
  return p;
}

export function analyzeRequest(req: ChatRequest): RequestInfo {
  const messages = req.messages.map((m, index): MessageInfo => {
    const parts = partsOf(m.content);
    const shape = typeof m.content === "string" ? "string" : Array.isArray(m.content) ? "parts" : "empty";
    const chars = typeof m.content === "string" ? m.content.length : Array.isArray(m.content) ? (m.content as { text?: string }[]).reduce((n, x) => n + (typeof x?.text === "string" ? x.text.length : 0), 0) : 0;
    return { index, role: m.role, shape, chars, parts, toolCalls: m.tool_calls?.length ?? 0, toolResult: m.role === "tool" };
  });
  const latestUser = req.messages.map((m) => m.role).lastIndexOf("user");
  const tools = Array.isArray(req.tools) ? req.tools.length : 0;
  return { messages, latestUser, tools, toolChars: tools ? JSON.stringify(req.tools).length : 0, multimodal: messages.some((m) => m.parts.image + m.parts.audio + m.parts.file + m.parts.other > 0), stream: !!req.stream };
}
