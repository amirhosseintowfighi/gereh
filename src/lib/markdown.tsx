/* A small, safe Markdown subset rendered straight to React elements (never HTML strings), used by the
   knowledge base, API docs and staff-written blog posts. Supported: #/##/### headings, paragraphs,
   - and 1. lists, > quotes, ``` fenced code, | tables |, **bold**, `code` and [links](url).
   Links only accept http(s), mailto and site-relative URLs, so a post cannot inject javascript: URLs. */
import Link from "next/link";
import type { ReactNode } from "react";

export type Heading = { id: string; level: 2 | 3; text: string };
type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "code"; lang: string; code: string }
  | { t: "table"; head: string[]; rows: string[][] };

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let n = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push({ t: "code", lang: fence[1], code: body.join("\n") });
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { out.push({ t: "h", level: h[1].length as 1 | 2 | 3, text: h[2].trim(), id: "s" + ++n }); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line); const rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(cells(lines[i]));
      out.push({ t: "table", head, rows });
      continue;
    }
    const list = /^\s*(-|\*|\d+[.)])\s+/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[1]); const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) { items.push(lines[i].replace(/^\s*(-|\*|\d+[.)])\s+/, "")); i++; }
      out.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ t: "quote", text: q.join(" ") });
      continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|>|\s*(-|\*|\d+[.)])\s+|\s*\|)/.test(lines[i])) p.push(lines[i++].trim());
    if (!p.length) p.push(lines[i++].trim()); // a line that only looked like a block start
    out.push({ t: "p", text: p.join(" ") });
  }
  return out;
}

export const headings = (src: string): Heading[] =>
  parse(src).flatMap((b) => (b.t === "h" && b.level > 1 ? [{ id: b.id, level: b.level as 2 | 3, text: plain(b.text) }] : []));

/** strip inline markup (for meta descriptions, TOC entries and search) */
export const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

export function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^\/(?!\/)/.test(u) || /^#[\w-]*$/.test(u)) return u;
  if (/^(https?:|mailto:)/i.test(u)) { try { new URL(u); return u; } catch { return null; } }
  return null;
}

export function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0]; const id = key + "-" + k++;
    if (m[1]) out.push(<code key={id} dir="ltr" className="px-1.5 py-0.5 rounded-md bg-white/[0.08] text-[0.9em] font-mono">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={id} className="font-extrabold text-white">{inline(tok.slice(2, -2), id)}</strong>);
    else {
      const [, label, url] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = safeHref(url);
      if (!href) out.push(label);
      else if (href.startsWith("/")) out.push(<Link key={id} href={href as never} className="acc underline underline-offset-4">{label}</Link>);
      else out.push(<a key={id} href={href} rel="noopener nofollow" target={href.startsWith("http") ? "_blank" : undefined} className="acc underline underline-offset-4">{label}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ src, className = "" }: { src: string; className?: string }) {
  return (
    <div className={"md space-y-5 leading-8 text-white/75 " + className}>
      {parse(src).map((b, i) => {
        const k = "b" + i;
        switch (b.t) {
          case "h": {
            const cls = b.level === 1 ? "text-2xl" : b.level === 2 ? "text-xl pt-4" : "text-lg pt-2";
            const H = (b.level === 1 ? "h2" : b.level === 2 ? "h2" : "h3") as "h2" | "h3";
            return <H key={k} id={b.id} className={cls + " font-black text-white scroll-mt-28"}>{inline(b.text, k)}</H>;
          }
          case "p": return <p key={k}>{inline(b.text, k)}</p>;
          case "ul": return <ul key={k} className="list-disc pr-6 space-y-1.5 marker:text-white/40">{b.items.map((it, j) => <li key={j}>{inline(it, k + j)}</li>)}</ul>;
          case "ol": return <ol key={k} className="list-decimal pr-6 space-y-1.5 marker:text-white/50">{b.items.map((it, j) => <li key={j}>{inline(it, k + j)}</li>)}</ol>;
          case "quote": return <blockquote key={k} className="border-r-2 border-[var(--ice)] pr-4 text-white/70">{inline(b.text, k)}</blockquote>;
          case "code": return <pre key={k} dir="ltr" tabIndex={0} className="text-left text-[13px] leading-6 rounded-xl bg-black/40 border border-white/[0.08] p-4 overflow-x-auto"><code className="font-mono" data-lang={b.lang || undefined}>{b.code}</code></pre>;
          case "table": return (
            <div key={k} tabIndex={0} role="region" aria-label="جدول" className="overflow-x-auto rounded-xl border border-white/[0.08]">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04]"><tr>{b.head.map((c, j) => <th key={j} scope="col" className="text-right font-bold text-white p-3">{inline(c, k + "h" + j)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j} className="border-t border-white/[0.06]">{r.map((c, x) => <td key={x} className="p-3 align-top">{inline(c, k + "r" + j + x)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
      })}
    </div>
  );
}
