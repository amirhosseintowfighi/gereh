/* Browser-side ZIP of a picked folder (<input webkitdirectory>), so a project can be uploaded without
   zipping it by hand. Stored (no compression): the files are small and the server unzips anyway. */

const SKIP = /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.output|\.svelte-kit|__pycache__|\.venv|venv|vendor|target|dist\/cache|\.idea|\.vscode|\.DS_Store)(\/|$)|(^|\/)\.env(\.[\w.-]+)?$/;
const MAX_BYTES = 200 * 1024 * 1024;

let table: Uint32Array | null = null;
function crc32(buf: Uint8Array) {
  table ??= new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type FolderZip = { file: File; count: number; skipped: number; name: string };

/** zips the folder's files (paths relative to the picked folder); throws a Persian message on problems */
export async function zipFolder(list: FileList): Promise<FolderZip> {
  const all = [...list];
  if (!all.length) throw new Error("پوشه خالی است.");
  const root = (all[0].webkitRelativePath || all[0].name).split("/")[0];
  const files = all.map((f) => ({ f, path: (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name })).filter((x) => !SKIP.test(x.path));
  const skipped = all.length - files.length;
  const total = files.reduce((s, x) => s + x.f.size, 0);
  if (!files.length) throw new Error("فایلی برای بارگذاری نماند (node_modules، .git و فایل‌های .env کنار گذاشته می‌شوند).");
  if (total > MAX_BYTES) throw new Error("حجم پوشه بیش از ۲۰۰ مگابایت است؛ پوشه‌های بیلد و رسانه‌های بزرگ را حذف کنید.");
  const enc = new TextEncoder();
  const parts: BlobPart[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const { f, path } of files) {
    const data = new Uint8Array(await f.arrayBuffer()), name = enc.encode(path), crc = crc32(data);
    const d = new Date(f.lastModified || Date.now());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const blob = new Blob([...parts, ...central as BlobPart[], end.buffer], { type: "application/zip" });
  return { file: new File([blob], root + ".zip", { type: "application/zip" }), count: files.length, skipped, name: root };
}
