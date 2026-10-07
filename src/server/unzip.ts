/* Minimal ZIP reader for uploaded app sources: lists entries from the central directory and
   inflates the few small manifest files used for stack detection. Defends against zip bombs
   (declared and actual sizes are capped) and unsafe paths (absolute, "..", backslashes). */
import "server-only";
import { inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; method: number; csize: number; usize: number; offset: number; dir: boolean };
export const ZIP_LIMITS = { files: 50_000, totalBytes: 1024 * 1024 * 1024, readBytes: 1024 * 1024 };

export class ZipError extends Error {}

export function listZip(buf: Buffer): ZipEntry[] {
  // end of central directory: last 22..65557 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError("فایل ZIP معتبر نیست.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new ZipError("ZIP64 پشتیبانی نمی‌شود؛ فایل را کوچک‌تر کنید.");
  if (count > ZIP_LIMITS.files) throw new ZipError("تعداد فایل‌ها بیش از حد مجاز است.");
  const out: ZipEntry[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("ساختار ZIP خراب است.");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new ZipError("مسیر ناامن در ZIP: " + name);
    total += usize;
    if (total > ZIP_LIMITS.totalBytes) throw new ZipError("حجم باز شده ZIP بیش از ۱ گیگابایت است.");
    out.push({ name, method, csize, usize, offset, dir: name.endsWith("/") });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function readEntry(buf: Buffer, e: ZipEntry): Buffer {
  if (e.usize > ZIP_LIMITS.readBytes) throw new ZipError("فایل " + e.name + " برای خواندن بزرگ است.");
  const h = e.offset;
  if (buf.readUInt32LE(h) !== 0x04034b50) throw new ZipError("ساختار ZIP خراب است.");
  const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: ZIP_LIMITS.readBytes });
  throw new ZipError("روش فشرده‌سازی " + e.method + " پشتیبانی نمی‌شود.");
}

/** "project/" when every entry sits in one top-level folder (zips of a folder), else "" */
export function commonRoot(entries: ZipEntry[]) {
  const first = entries.find((e) => !e.name.startsWith("__MACOSX/"))?.name.split("/")[0];
  if (!first) return "";
  const prefix = first + "/";
  return entries.every((e) => e.name.startsWith("__MACOSX/") || e.name === prefix || e.name.startsWith(prefix)) && entries.some((e) => e.name.length > prefix.length) ? prefix : "";
}

/** file listing for detectStack(): root-relative paths, contents only for `read` names */
export function projectFiles(buf: Buffer, read: Set<string>, rootDir = "") {
  const entries = listZip(buf);
  const root = commonRoot(entries) + (rootDir ? rootDir.replace(/^\/+|\/+$/g, "") + "/" : "");
  const files = new Map<string, string | null>();
  for (const e of entries) {
    if (e.dir || !e.name.startsWith(root) || e.name.startsWith("__MACOSX/")) continue;
    const rel = e.name.slice(root.length);
    files.set(rel, read.has(rel) ? readEntry(buf, e).toString("utf8") : null);
  }
  return { files, count: entries.filter((e) => !e.dir).length, bytes: entries.reduce((s, e) => s + e.usize, 0) };
}
