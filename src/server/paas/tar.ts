/* Minimal ustar writer: what `tar -x` in a container needs to receive extracted ZIP entries. Long
   names use the ustar prefix field (155 + 100 bytes); longer paths are rejected. */
import "server-only";

const block = (n: number) => Math.ceil(n / 512) * 512;
function octal(buf: Buffer, off: number, len: number, n: number) {
  buf.write(n.toString(8).padStart(len - 1, "0") + "\0", off, len, "ascii");
}

/** a header for a file (data length `size`) or a directory (`dir`) */
export function tarHeader(name: string, size: number, o: { dir?: boolean; mode?: number; mtime?: number } = {}) {
  const h = Buffer.alloc(512);
  let path = o.dir && !name.endsWith("/") ? name + "/" : name;
  let prefix = "";
  if (Buffer.byteLength(path) > 100) {
    // split at the first "/" that leaves a name of ≤100 bytes, with a prefix of ≤155
    let i = -1;
    for (let j = path.indexOf("/"); j > 0 && j < path.length - 1; j = path.indexOf("/", j + 1)) {
      if (Buffer.byteLength(path.slice(0, j)) > 155) break;
      if (Buffer.byteLength(path.slice(j + 1)) <= 100) { i = j; break; }
    }
    if (i < 0) throw new Error("path too long for tar: " + name);
    prefix = path.slice(0, i);
    path = path.slice(i + 1);
  }
  h.write(path, 0, 100, "utf8");
  octal(h, 100, 8, o.mode ?? (o.dir ? 0o755 : 0o644));
  octal(h, 108, 8, 0);
  octal(h, 116, 8, 0);
  octal(h, 124, 12, o.dir ? 0 : size);
  octal(h, 136, 12, Math.floor((o.mtime ?? Date.now()) / 1000));
  h.fill(" ", 148, 156);
  h.write(o.dir ? "5" : "0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

/** tar stream chunks of entries (directories and files) plus the end-of-archive marker */
export function* tarEntries(entries: Iterable<{ name: string; dir?: boolean; data?: () => Buffer }>) {
  for (const e of entries) {
    if (e.dir) { yield tarHeader(e.name, 0, { dir: true }); continue; }
    const data = e.data?.() ?? Buffer.alloc(0);
    yield tarHeader(e.name, data.length);
    yield data;
    const pad = block(data.length) - data.length;
    if (pad) yield Buffer.alloc(pad);
  }
  yield Buffer.alloc(1024);
}

/** total size of a tar of these entries (for `head -c` on the receiving side) */
export const tarSize = (entries: { dir?: boolean; size: number }[]) => entries.reduce((s, e) => s + 512 + (e.dir ? 0 : block(e.size)), 0) + 1024;
