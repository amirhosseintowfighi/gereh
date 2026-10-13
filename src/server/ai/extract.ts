/* Plain text from uploaded knowledge-base files: txt/md/csv/json as UTF-8, HTML without markup, and
   text-based PDFs through a small reader (Flate streams, Tj/TJ operators). Scanned PDFs and PDFs whose
   fonts only carry glyph ids yield nothing; the caller reports that. No third-party parser. */
import "server-only";
import { inflateSync } from "node:zlib";

export type KbFileKind = "text" | "html" | "pdf";
export function fileKind(name: string, mime: string): KbFileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "text/html" || ext === "html" || ext === "htm") return "html";
  if (mime.startsWith("text/") || ["txt", "md", "markdown", "csv", "json"].includes(ext)) return "text";
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", zwnj: "‌" };
export function htmlText(html: string) {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** text operators of one decoded content stream */
function contentText(c: string) {
  let out = "", i = 0;
  const pending: string[] = [];
  while (i < c.length) {
    const ch = c[i];
    if (ch === "(") {
      let depth = 1, s = "";
      i++;
      while (i < c.length && depth > 0) {
        const x = c[i];
        if (x === "\\") {
          const n = c[i + 1];
          if (n === "n") s += "\n"; else if (n === "r") s += "\r"; else if (n === "t") s += "\t"; else if (n === "b" || n === "f") s += "";
          else if (/[0-7]/.test(n)) { const oct = /^[0-7]{1,3}/.exec(c.slice(i + 1))![0]; s += String.fromCharCode(parseInt(oct, 8)); i += oct.length - 1; }
          else if (n === "\r" || n === "\n") { /* line continuation */ } else s += n;
          i += 2; continue;
        }
        if (x === "(") depth++;
        if (x === ")" && --depth === 0) { i++; break; }
        s += x; i++;
      }
      pending.push(s);
      continue;
    }
    if (ch === "<" && c[i + 1] === "<") { i += 2; continue; }
    const op = /^(TJ|Tj|T\*|Td|TD|ET|'|")/.exec(c.slice(i, i + 2));
    if (op && !/[A-Za-z]/.test(c[i - 1] ?? " ")) {
      if (op[1] === "Tj" || op[1] === "TJ" || op[1] === "'" || op[1] === '"') { if (op[1] !== "Tj" && op[1] !== "TJ") out += "\n"; out += pending.join(""); pending.length = 0; }
      else if (op[1] === "Td" || op[1] === "TD") out += " ";
      else out += "\n";
      i += op[1].length; continue;
    }
    i++;
  }
  return out;
}

export function pdfText(buf: Buffer): string {
  const s = buf.toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    const dict = s.slice(Math.max(0, s.lastIndexOf("<<", m.index)), m.index);
    re.lastIndex = end + 9;
    if (/\/Subtype\s*\/(Image|XML)|\/Type\s*\/(XRef|ObjStm|Metadata)/.test(dict)) continue;
    let data: Buffer = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) { try { data = inflateSync(data); } catch { continue; } }
    else if (/\/Filter/.test(dict)) continue;
    const c = data.toString("latin1");
    if (!/T[Jj]/.test(c)) continue;
    parts.push(contentText(c));
  }
  return parts.join("\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractText(kind: KbFileKind, buf: Buffer) {
  if (kind === "pdf") return pdfText(buf);
  const t = buf.toString("utf8").replace(/^﻿/, "");
  return kind === "html" ? htmlText(t) : t;
}
