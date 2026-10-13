/* A tiny line-oriented terminal model for the web console: enough of VT100 for shells and readline
   (carriage return, backspace, erase line, cursor left/right, clear screen); colours and other
   escape sequences are dropped. Full-screen programs (vim, top) are not supported. */

export type Term = { lines: string[]; col: number; pending: string };
export const MAX_TERM_LINES = 2000;
export const newTerm = (): Term => ({ lines: [""], col: 0, pending: "" });

/** applies output to the terminal (returns a new state) */
export function feed(t: Term, chunk: string): Term {
  const s = t.pending + chunk;
  const lines = t.lines.slice();
  let col = t.col, i = 0, pending = "";
  const put = (ch: string) => {
    const cur = lines[lines.length - 1];
    lines[lines.length - 1] = (cur.length < col ? cur.padEnd(col) : cur.slice(0, col)) + ch + cur.slice(col + 1);
    col++;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\x1b") {
      if (i + 1 >= s.length) { pending = s.slice(i); break; }
      const nx = s[i + 1];
      if (nx === "[") {
        let j = i + 2;
        while (j < s.length && !/[@-~]/.test(s[j])) j++;
        if (j >= s.length) { pending = s.slice(i); break; }
        const params = s.slice(i + 2, j), fin = s[j], n = Number(params.replace(/[^\d;]/g, "").split(";")[0]) || 0;
        if (fin === "J" && (n === 2 || n === 3)) { lines.length = 0; lines.push(""); col = 0; }
        else if (fin === "K") { const cur = lines[lines.length - 1]; lines[lines.length - 1] = n === 0 ? cur.slice(0, col) : n === 1 ? " ".repeat(col) + cur.slice(col) : ""; }
        else if (fin === "C") col += Math.max(1, n);
        else if (fin === "D") col = Math.max(0, col - Math.max(1, n));
        else if (fin === "G") col = Math.max(0, n - 1);
        else if (fin === "P") { const cur = lines[lines.length - 1]; lines[lines.length - 1] = cur.slice(0, col) + cur.slice(col + Math.max(1, n)); }
        else if (fin === "@") { const cur = lines[lines.length - 1]; lines[lines.length - 1] = cur.slice(0, col) + " ".repeat(Math.max(1, n)) + cur.slice(col); }
        i = j + 1;
        continue;
      }
      if (nx === "]") {
        // OSC (window title): ends with BEL or ESC \
        const bel = s.indexOf("\x07", i), st = s.indexOf("\x1b\\", i);
        const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
        if (end < 0) { pending = s.slice(i); break; }
        i = end + (end === st ? 2 : 1);
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "\r") col = 0;
    else if (ch === "\n") { lines.push(""); col = 0; }
    else if (ch === "\b") col = Math.max(0, col - 1);
    else if (ch === "\t") { const to = (Math.floor(col / 8) + 1) * 8; while (col < to) put(" "); }
    else if (ch >= " " && ch !== "\x7f") put(ch);
    i++;
  }
  if (lines.length > MAX_TERM_LINES) lines.splice(0, lines.length - MAX_TERM_LINES);
  return { lines, col, pending };
}

/** the bytes a key press sends to the remote shell (null: not handled) */
export function keyInput(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  if (e.metaKey) return null;
  if (e.ctrlKey && !e.altKey && e.key.length === 1) {
    const c = e.key.toLowerCase().charCodeAt(0);
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96);
    if (e.key === "[") return "\x1b";
    return null;
  }
  const map: Record<string, string> = {
    Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b", Delete: "\x1b[3~",
    ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D", Home: "\x1b[H", End: "\x1b[F", PageUp: "\x1b[5~", PageDown: "\x1b[6~",
  };
  if (map[e.key]) return map[e.key];
  if (e.key.length === 1) return (e.altKey ? "\x1b" : "") + e.key;
  return null;
}
