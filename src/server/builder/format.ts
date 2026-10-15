/* The builder's output format: <plan>, <file path="…">full content</file>, <delete path="…"/>, <summary>.
   Parsing is forgiving (code fences inside a file, attribute quoting, a JSON answer instead of tags,
   a truncated last file) but never guesses a path: anything unclear is dropped and reported. */

export type Parsed = {
  plan: string;
  files: Record<string, string>;
  deletes: string[];
  summary: string;
  /** files whose block never closed (the answer was cut off); not written */
  truncated: string[];
};

const OPEN = /<file\b([^>]*)>/gi;
const attr = (s: string, name: string) => new RegExp("\\b" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>/]+))", "i").exec(s);
const pathAttr = (s: string) => { const m = attr(s, "path") ?? attr(s, "name"); return (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim(); };
const normPath = (p: string) => p.replace(/^\.\//, "").trim();

/** removes one wrapping markdown fence (```lang … ```) the model sometimes adds inside a file */
export function unfence(s: string) {
  const t = s.replace(/^\n+/, "").replace(/\s+$/, "");
  const m = /^```[\w.+-]*[^\n]*\n([\s\S]*?)\n?```$/.exec(t);
  return m ? m[1] : s.replace(/^\n/, "").replace(/\n$/, "");
}

const section = (text: string, tag: string) => {
  const m = new RegExp("<" + tag + ">([\\s\\S]*?)(</" + tag + ">|$)", "i").exec(text);
  return m ? m[1].trim() : "";
};

export function parseOutput(raw: string): Parsed {
  const text = raw.replace(/\r\n?/g, "\n");
  const out: Parsed = { plan: section(text, "plan"), files: {}, deletes: [], summary: section(text, "summary"), truncated: [] };
  let m: RegExpExecArray | null;
  OPEN.lastIndex = 0;
  let found = false;
  while ((m = OPEN.exec(text))) {
    found = true;
    const p = normPath(pathAttr(m[1]));
    const start = m.index + m[0].length;
    const end = text.indexOf("</file>", start);
    if (end < 0) { if (p) out.truncated.push(p); break; }
    if (p) out.files[p] = unfence(text.slice(start, end));
    OPEN.lastIndex = end + 7;
  }
  for (const d of text.matchAll(/<delete\b([^>]*?)\/?>/gi)) { const p = normPath(pathAttr(d[1])); if (p && !out.deletes.includes(p)) out.deletes.push(p); }
  if (!found && !out.deletes.length) Object.assign(out, fromJson(text, out));
  // the summary is for people: strip any tags the model left in it
  out.summary = out.summary.replace(/<\/?[a-z][^>]*>/gi, "").trim();
  return out;
}

/** fallback: {"files":[{"path","content"}] | {path: content}, "delete":[…], "summary", "plan"} */
function fromJson(text: string, base: Parsed): Partial<Parsed> {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/i.exec(text)?.[1];
  const candidates = [fenced, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter(Boolean) as string[];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c) as Record<string, unknown>;
      const files: Record<string, string> = {};
      if (Array.isArray(j.files)) for (const f of j.files as { path?: unknown; content?: unknown }[]) { if (typeof f?.path === "string" && typeof f.content === "string") files[normPath(f.path)] = f.content; }
      else if (j.files && typeof j.files === "object") for (const [k, v] of Object.entries(j.files)) if (typeof v === "string") files[normPath(k)] = v;
      const del = (j.delete ?? j.deletes) as unknown;
      return {
        files, deletes: Array.isArray(del) ? del.filter((x): x is string => typeof x === "string").map(normPath) : [],
        summary: typeof j.summary === "string" ? j.summary : base.summary, plan: typeof j.plan === "string" ? j.plan : base.plan,
      };
    } catch { /* not JSON */ }
  }
  return {};
}

/** paths of the file blocks opened so far (for live progress while streaming) */
export function streamedPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<file\b([^>]*)>/gi)) { const p = normPath(pathAttr(m[1])); if (p && !out.includes(p)) out.push(p); }
  return out;
}
/** the plan written so far */
export const streamedPlan = (text: string) => section(text.replace(/\r\n?/g, "\n"), "plan");

/** the format, for prompts and the simulator */
export function render(o: { plan: string; files?: Record<string, string>; deletes?: string[]; summary: string }) {
  return [
    "<plan>\n" + o.plan.trim() + "\n</plan>",
    ...Object.entries(o.files ?? {}).map(([p, c]) => '<file path="' + p + '">\n' + c.replace(/\n$/, "") + "\n</file>"),
    ...(o.deletes ?? []).map((p) => '<delete path="' + p + '" />'),
    "<summary>\n" + o.summary.trim() + "\n</summary>",
  ].join("\n");
}
