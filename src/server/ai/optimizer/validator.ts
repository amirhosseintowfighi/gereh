/* Validator: a deterministic integrity check of every optimized segment against its original.
   Two kinds of change exist:
     rewrite  (whitespace, instruction dedupe): the whole text is kept, so every protected block must be
              byte-identical and every span, number, date, URL, identifier, negation and condition word of
              the original must still be there;
     extract  (tool-result shrink, repeated paragraphs, section selection, the old-turn summary): parts are
              omitted behind an explicit marker, so every kept line must be a verbatim piece of the original
              (nothing invented), protected blocks that remain must be byte-identical, and a kept line keeps
              its negations and numbers because it is copied whole.
   On failure the caller reverts that message to the original and counts the failure. */
import { hasWord, invariants, normDigits, segments } from "./analyzer";

/** every omission marker the optimizer writes has this shape: [… text …] */
export const MARKER_RE = /\[… [^\]\n]* …\]/g;
export const SECTION_CITE_RE = /^\[section: [^\]\n]+\]$/;
/** fixed header lines of the old-turn summary (context.ts) */
export const SUMMARY_HEADERS = new Set(["Decisions:", "Facts:", "Open questions:", "Active tasks:", "References:"]);

const squash = (s: string) => normDigits(s).replace(/[ \t\u00a0]+/g, " ").trim();
/** the sentences of one line, as the summary (context.ts) and checkExtract split them */
export const unbullet = (s: string) => s.replace(/^(?:[-*+•]|\d+[.)])\s+/, "");
export const sentencesOf = (line: string) => line.split(/(?<=[.!?؟;:])\s+/).map((x) => x.trim()).filter(Boolean);

/** null when `opt` keeps everything `orig` has; otherwise the reason */
export function checkRewrite(orig: string, opt: string): string | null {
  if (orig === opt) return null;
  const inv = invariants(orig);
  for (const b of inv.blocks) if (!opt.includes(b)) return "protected block changed";
  const n = normDigits(opt);
  for (const s of inv.spans) if (!n.includes(s)) return "span lost: " + s.slice(0, 40);
  for (const w of inv.words) if (!hasWord(opt, w)) return "word lost: " + w;
  return null;
}

/** null when every kept piece of `opt` is a verbatim, whole piece of `source`; otherwise the reason.
    A piece without a marker beside it must be a whole line or sentence of the source (so a kept sentence
    keeps its negations and numbers); the piece before a marker must start a source line, the piece after
    one must end a source line, and a piece between two markers must lie inside one. */
export function checkExtract(source: string, opt: string): string | null {
  if (source === opt) return null;
  const lines = source.split("\n").map(squash).filter(Boolean);
  const joined = "\n" + lines.join("\n") + "\n";
  const units = new Set(lines);
  for (const l of lines) for (const x of sentencesOf(l)) { units.add(x); units.add(unbullet(x)); }
  let refs = false;
  for (const seg of segments(opt)) {
    if (seg.kind !== "prose") {
      if (!source.includes(seg.text.replace(/\n$/, ""))) return "protected block changed";
      continue;
    }
    for (const raw of seg.text.split("\n")) {
      let line = raw.trim();
      if (!line || SECTION_CITE_RE.test(line)) continue;
      if (SUMMARY_HEADERS.has(line)) { refs = line === "References:"; continue; }
      // the summary lists kept sentences as bullets
      if (line.startsWith("- ") && !units.has(squash(line))) line = line.slice(2);
      const parts = line.split(/(\[… [^\]\n]* …\])/);
      for (let i = 0; i < parts.length; i += 2) {
        const p = squash(parts[i]);
        if (!p) continue;
        const before = i > 0, after = i + 1 < parts.length;
        const ok = before && after ? joined.includes(p)
          : after ? joined.includes("\n" + p)
          : before ? joined.includes(p + "\n")
          : refs ? joined.includes(p) : units.has(p);
        if (!ok) return "invented or partial text: " + p.slice(0, 40);
      }
    }
  }
  return null;
}

export type Check = "rewrite" | "extract";
export const check = (kind: Check, orig: string, opt: string) => (kind === "rewrite" ? checkRewrite(orig, opt) : checkExtract(orig, opt));
