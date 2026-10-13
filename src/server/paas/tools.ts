/* Operator tools for running apps: instances, the web console and one-off commands, the disk file
   manager, disk backups, SFTP ports and log collection. Two implementations, picked like paas():
   - KubeTools: k8s exec (./exec.ts) into the app's "app" container (files go through sh, stat, tar,
     head and cat, which every image with a shell has); disk backups are tar.gz streams the server
     uploads to the platform backup bucket (PAAS_BACKUP_S3_*, the MinIO behind the backup-s3 secret)
   - SimTools: an in-memory filesystem per disk and a fake shell (ls, cd, pwd, env, echo, cat…) */
import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { AppSpec } from "./driver";
import type { PodShell } from "./exec";

export type DiskRef = { name: string; mount: string };
export type FsEntry = { name: string; dir: boolean; size: number; mtime: number };
export type Instance = { name: string; ready: boolean; since: string };
export type LogLine = { at: Date; instance: string; line: string };
export type FileBody = Buffer | { stream: AsyncIterable<Buffer>; size: number };

export class ToolError extends Error {}

export interface ToolsDriver {
  readonly name: "kubernetes" | "simulator";
  instances(app: AppSpec): Promise<Instance[]>;
  /** a command in a running instance (sh -c); stdout and stderr together */
  exec(app: AppSpec, instance: string, command: string, timeoutMs: number): Promise<{ code: number; output: string }>;
  shell(app: AppSpec, instance: string, size: { cols: number; rows: number }): Promise<PodShell>;
  /* files: `rel` is already normalised and inside the disk ("" = its root) */
  list(app: AppSpec, disk: DiskRef, rel: string): Promise<FsEntry[]>;
  readFile(app: AppSpec, disk: DiskRef, rel: string, max: number): Promise<Buffer>;
  download(app: AppSpec, disk: DiskRef, rel: string, onChunk: (b: Buffer) => void): Promise<void>;
  writeFile(app: AppSpec, disk: DiskRef, rel: string, body: FileBody): Promise<void>;
  mkdir(app: AppSpec, disk: DiskRef, rel: string): Promise<void>;
  rename(app: AppSpec, disk: DiskRef, from: string, to: string): Promise<void>;
  remove(app: AppSpec, disk: DiskRef, rels: string[]): Promise<void>;
  search(app: AppSpec, disk: DiskRef, rel: string, q: string, limit: number): Promise<{ path: string; dir: boolean }[]>;
  /** unpacks a tar stream into a folder of the disk */
  untar(app: AppSpec, disk: DiskRef, rel: string, chunks: Iterable<Buffer>, size: number): Promise<void>;
  usage(app: AppSpec, disk: DiskRef): Promise<number>;
  /* disks */
  backupDisk(app: AppSpec, disk: DiskRef, backupId: string): Promise<{ sizeMb: number; location: string }>;
  restoreDisk(app: AppSpec, disk: DiskRef, location: string): Promise<void>;
  backupLink(location: string, fileName: string): Promise<string>;
  deleteBackup(location: string): Promise<void>;
  /** releases the disk's volume (after the app no longer mounts it) */
  removeDisk(app: AppSpec, disk: string): Promise<void>;
  /** NodePort of the app's SFTP service, null when there is none yet */
  sftpPort(app: AppSpec): Promise<number | null>;
  /** log lines of every instance since a moment, oldest first */
  logsSince(app: AppSpec, since: Date, max: number): Promise<LogLine[]>;
}

const seed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const hex = (s: string) => seed(s).toString(16).padStart(7, "0").slice(0, 5);
const abs = (disk: DiskRef, rel: string) => disk.mount + (rel ? "/" + rel : "");

/* ---------- simulator ---------- */
type Node = { dir: boolean; data: Buffer; mtime: number };
type Vol = Map<string, Node>;
const g = globalThis as unknown as { __gerehSimFs?: Map<string, Vol>; __gerehSimBackups?: Map<string, Vol> };
const volumes: Map<string, Vol> = (g.__gerehSimFs ??= new Map());
const snapshots: Map<string, Vol> = (g.__gerehSimBackups ??= new Map());
export const resetSimTools = () => { volumes.clear(); snapshots.clear(); };

function vol(app: Pick<AppSpec, "id">, disk: string): Vol {
  const k = app.id + "/" + disk;
  let v = volumes.get(k);
  if (!v) {
    v = new Map([["", { dir: true, data: Buffer.alloc(0), mtime: Date.now() }]]);
    if (disk === "data") {
      v.set("uploads", { dir: true, data: Buffer.alloc(0), mtime: Date.now() });
      v.set("README.txt", { dir: false, data: Buffer.from("Files on this disk survive deploys and restarts.\n"), mtime: Date.now() });
    }
    volumes.set(k, v);
  }
  return v;
}
const parent = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
const base = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
function need(v: Vol, rel: string, dir?: boolean) {
  const n = v.get(rel);
  if (!n) throw new ToolError("No such file or directory: " + (rel || "/"));
  if (dir !== undefined && n.dir !== dir) throw new ToolError(dir ? "Not a directory: " + rel : "Is a directory: " + rel);
  return n;
}
function mkdirp(v: Vol, rel: string) {
  if (!rel) return;
  const n = v.get(rel);
  if (n && !n.dir) throw new ToolError("File exists: " + rel);
  if (!n) { mkdirp(v, parent(rel)); v.set(rel, { dir: true, data: Buffer.alloc(0), mtime: Date.now() }); }
}
const under = (v: Vol, rel: string) => [...v.keys()].filter((k) => k !== rel && (rel === "" || k.startsWith(rel + "/")));
const volBytes = (v: Vol) => [...v.values()].reduce((s, n) => s + n.data.length, 0);

/* the fake shell's view: a few image files, the disks at their mount paths */
const STATIC: Record<string, string | null> = {
  "/": null, "/app": null, "/bin": null, "/etc": null, "/tmp": null, "/usr": null, "/var": null,
  "/app/README.md": "# app\n\nDeployed with Gereh.\n", "/app/package.json": '{\n  "name": "app",\n  "scripts": { "start": "node server.js" }\n}\n',
  "/app/server.js": "require('http').createServer((q, s) => s.end('ok')).listen(process.env.PORT);\n",
  "/etc/os-release": 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\n', "/etc/hostname": "",
};
type Resolved = { disk?: DiskRef; rel?: string; staticPath?: string; virtualDir?: boolean };
function resolveAbs(cwd: string, p: string) {
  const parts: string[] = [];
  for (const s of (p.startsWith("/") ? p : cwd + "/" + p).split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") parts.pop(); else parts.push(s);
  }
  return "/" + parts.join("/");
}
function lookup(disks: DiskRef[], p: string): Resolved | null {
  const d = [...disks].sort((a, b) => b.mount.length - a.mount.length).find((x) => p === x.mount || p.startsWith(x.mount + "/"));
  if (d) return { disk: d, rel: p === d.mount ? "" : p.slice(d.mount.length + 1) };
  if (p in STATIC) return { staticPath: p };
  if (disks.some((x) => x.mount.startsWith(p === "/" ? "/" : p + "/"))) return { virtualDir: true };
  return null;
}
function children(app: AppSpec, disks: DiskRef[], p: string): string[] | null {
  const r = lookup(disks, p);
  if (!r) return null;
  if (r.disk) {
    const v = vol(app, r.disk.name), n = v.get(r.rel!);
    if (!n?.dir) return null;
    return under(v, r.rel!).filter((k) => parent(k) === r.rel).map(base).sort();
  }
  if (r.staticPath && STATIC[r.staticPath] !== null) return null;
  const prefix = p === "/" ? "/" : p + "/";
  const out = new Set<string>();
  for (const k of [...Object.keys(STATIC), ...disks.map((x) => x.mount)]) if (k.startsWith(prefix) && k.length > prefix.length) out.add(k.slice(prefix.length).split("/")[0]);
  return [...out].sort();
}
function readAbs(app: AppSpec, disks: DiskRef[], p: string): string {
  const r = lookup(disks, p);
  if (!r) throw new ToolError(p + ": No such file or directory");
  if (r.disk) { const n = vol(app, r.disk.name).get(r.rel!); if (!n) throw new ToolError(p + ": No such file or directory"); if (n.dir) throw new ToolError(p + ": Is a directory"); return n.data.toString("utf8"); }
  if (r.virtualDir || STATIC[r.staticPath!] === null) throw new ToolError(p + ": Is a directory");
  return r.staticPath === "/etc/hostname" ? hostName(app) + "\n" : STATIC[r.staticPath!]!;
}
const hostName = (app: AppSpec) => app.name + "-" + hex(app.id) + "-0";
const words = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

/** runs one command line of the fake shell */
export function simCommand(app: AppSpec, disks: DiskRef[], cwd: string, line: string): { out: string; code: number; cwd: string; exit?: boolean } {
  const env = { HOME: "/root", PWD: cwd, ...app.env } as Record<string, string>;
  const argv = words(line.trim()).map((w) => w.replace(/\$\{?(\w+)\}?/g, (_, k: string) => env[k] ?? ""));
  const [cmd, ...args] = argv;
  if (!cmd) return { out: "", code: 0, cwd };
  const flags = args.filter((a) => a.startsWith("-")).join(""), files = args.filter((a) => !a.startsWith("-"));
  try {
    switch (cmd) {
      case "pwd": return { out: cwd + "\n", code: 0, cwd };
      case "cd": {
        const to = resolveAbs(cwd, files[0] ?? "/root");
        if (to === "/root") return { out: "", code: 0, cwd: to };
        if (!children(app, disks, to)) return { out: "sh: cd: " + (files[0] ?? to) + ": No such directory\n", code: 1, cwd };
        return { out: "", code: 0, cwd: to };
      }
      case "ls": {
        const targets = files.length ? files : ["."];
        const outs: string[] = [];
        for (const t of targets) {
          const p = resolveAbs(cwd, t);
          const list = children(app, disks, p);
          if (list === null) { readAbs(app, disks, p); outs.push(t); continue; }
          const shown = flags.includes("a") ? [".", "..", ...list] : list.filter((x) => !x.startsWith("."));
          if (!flags.includes("l")) { outs.push(shown.join("  ")); continue; }
          outs.push(shown.map((n) => {
            const full = resolveAbs(p, n), isDir = n === "." || n === ".." || children(app, disks, full) !== null;
            const r = lookup(disks, full), size = r?.disk ? vol(app, r.disk.name).get(r.rel!)?.data.length ?? 0 : r?.staticPath && STATIC[r.staticPath] ? STATIC[r.staticPath]!.length : 4096;
            return (isDir ? "drwxr-xr-x" : "-rw-r--r--") + " 1 root root " + String(isDir ? 4096 : size).padStart(8) + " " + n;
          }).join("\n"));
        }
        return { out: outs.filter(Boolean).join("\n") + (outs.some(Boolean) ? "\n" : ""), code: 0, cwd };
      }
      case "cat": return { out: files.map((f) => readAbs(app, disks, resolveAbs(cwd, f))).join(""), code: 0, cwd };
      case "echo": return { out: (args[0] === "-n" ? args.slice(1).join(" ") : args.join(" ") + "\n"), code: 0, cwd };
      case "env": case "printenv": return { out: Object.entries(env).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n") + "\n", code: 0, cwd };
      case "whoami": return { out: "root\n", code: 0, cwd };
      case "hostname": return { out: hostName(app) + "\n", code: 0, cwd };
      case "uname": return { out: flags.includes("a") ? "Linux " + hostName(app) + " 6.8.0 #1 SMP x86_64 GNU/Linux\n" : "Linux\n", code: 0, cwd };
      case "date": return { out: new Date().toString() + "\n", code: 0, cwd };
      case "true": return { out: "", code: 0, cwd };
      case "false": return { out: "", code: 1, cwd };
      case "exit": case "logout": return { out: "", code: 0, cwd, exit: true };
      case "help": return { out: "Simulated shell: ls, cd, pwd, cat, echo, env, whoami, hostname, uname, date, clear, exit\n", code: 0, cwd };
      default: return { out: "sh: " + cmd + ": not found\n", code: 127, cwd };
    }
  } catch (e) { return { out: cmd + ": " + (e as Error).message + "\n", code: 1, cwd }; }
}

class SimShell implements PodShell {
  private data: ((b: Buffer) => void)[] = [];
  private exits: ((code: number, msg: string) => void)[] = [];
  private buf = "";
  private cwd = "/app";
  private done = false;
  private early: Buffer[] = [];
  constructor(private app: AppSpec, private disks: DiskRef[]) { this.emit("Gereh simulated shell (type help)\r\n" + this.prompt()); }
  private prompt() { return "root@" + hostName(this.app) + ":" + this.cwd + "# "; }
  private emit(s: string) {
    const b = Buffer.from(s, "utf8");
    if (this.data.length) setTimeout(() => { for (const cb of this.data) cb(b); }, 0); else this.early.push(b);
  }
  write(d: string | Buffer) {
    if (this.done) return;
    const s = d.toString().replace(/\x1b\[[0-9;]*[A-Za-z~]/g, "");
    let echo = "";
    for (const ch of s) {
      if (ch === "\r" || ch === "\n") {
        const line = this.buf;
        this.buf = "";
        if (line.trim() === "clear") { echo += "\r\n\x1b[2J\x1b[H"; echo += this.prompt(); continue; }
        const r = simCommand(this.app, this.disks, this.cwd, line);
        this.cwd = r.cwd;
        echo += "\r\n" + r.out.replace(/\n/g, "\r\n");
        if (r.exit) { this.emit(echo); this.close(); return; }
        echo += this.prompt();
      } else if (ch === "\x7f" || ch === "\b") { if (this.buf) { this.buf = this.buf.slice(0, -1); echo += "\b \b"; } }
      else if (ch === "\x03") { this.buf = ""; echo += "^C\r\n" + this.prompt(); }
      else if (ch === "\x04") { if (!this.buf) { this.emit(echo + "\r\nlogout\r\n"); this.close(); return; } }
      else if (ch === "\x0c") echo += "\x1b[2J\x1b[H" + this.prompt() + this.buf;
      else if (ch >= " ") { this.buf += ch; echo += ch; }
    }
    if (echo) this.emit(echo);
  }
  resize() {}
  close() {
    if (this.done) return;
    this.done = true;
    setTimeout(() => { for (const cb of this.exits) cb(0, ""); }, 0);
  }
  onData(cb: (b: Buffer) => void) { this.data.push(cb); for (const b of this.early.splice(0)) setTimeout(() => cb(b), 0); }
  onExit(cb: (code: number, msg: string) => void) { if (this.done) setTimeout(() => cb(0, ""), 0); else this.exits.push(cb); }
}

const simDisks = (app: AppSpec): DiskRef[] => (app.disks ?? (app.diskGb > 0 ? [{ name: "data", mount: app.diskMount || "/data", sizeGb: app.diskGb }] : [])).map((d) => ({ name: d.name, mount: d.mount }));

export class SimTools implements ToolsDriver {
  readonly name = "simulator" as const;
  async instances(app: AppSpec) {
    return Array.from({ length: Math.max(1, app.instances) }, (_, i) => ({ name: app.name + "-" + hex(app.id) + "-" + i, ready: true, since: new Date(Date.now() - 3600_000 * (i + 1)).toISOString() }));
  }
  private async check(app: AppSpec, instance: string) {
    if (!(await this.instances(app)).some((x) => x.name === instance)) throw new ToolError("instance " + instance + " not found");
  }
  async exec(app: AppSpec, instance: string, command: string) {
    await this.check(app, instance);
    if (/\bsleep\s+\d{3,}/.test(command)) throw new ToolError("command timed out");
    let cwd = "/app", out = "", code = 0;
    for (const part of command.split(/\s*(?:&&|;)\s*/)) {
      const r = simCommand(app, simDisks(app), cwd, part);
      out += r.out; code = r.code; cwd = r.cwd;
      if (code !== 0 && command.includes("&&")) break;
    }
    return { code, output: out };
  }
  async shell(app: AppSpec, instance: string) { await this.check(app, instance); return new SimShell(app, simDisks(app)); }
  async list(app: AppSpec, disk: DiskRef, rel: string) {
    const v = vol(app, disk.name);
    need(v, rel, true);
    return under(v, rel).filter((k) => parent(k) === rel).map((k) => { const n = v.get(k)!; return { name: base(k), dir: n.dir, size: n.dir ? 0 : n.data.length, mtime: n.mtime }; });
  }
  async readFile(app: AppSpec, disk: DiskRef, rel: string, max: number) { return need(vol(app, disk.name), rel, false).data.subarray(0, max); }
  async download(app: AppSpec, disk: DiskRef, rel: string, onChunk: (b: Buffer) => void) { onChunk(need(vol(app, disk.name), rel, false).data); }
  async writeFile(app: AppSpec, disk: DiskRef, rel: string, body: FileBody) {
    const v = vol(app, disk.name);
    if (v.get(rel)?.dir) throw new ToolError("Is a directory: " + rel);
    let data: Buffer;
    if (Buffer.isBuffer(body)) data = body; else { const parts: Buffer[] = []; for await (const c of body.stream) parts.push(Buffer.from(c)); data = Buffer.concat(parts); }
    mkdirp(v, parent(rel));
    v.set(rel, { dir: false, data, mtime: Date.now() });
  }
  async mkdir(app: AppSpec, disk: DiskRef, rel: string) { mkdirp(vol(app, disk.name), rel); }
  async rename(app: AppSpec, disk: DiskRef, from: string, to: string) {
    const v = vol(app, disk.name);
    need(v, from);
    if (v.has(to)) throw new ToolError("File exists: " + to);
    if (to.startsWith(from + "/")) throw new ToolError("cannot move a folder into itself");
    mkdirp(v, parent(to));
    for (const k of [from, ...under(v, from)]) { const n = v.get(k)!; v.delete(k); v.set(to + k.slice(from.length), n); }
  }
  async remove(app: AppSpec, disk: DiskRef, rels: string[]) {
    const v = vol(app, disk.name);
    for (const r of rels) { if (!v.has(r)) continue; for (const k of under(v, r)) v.delete(k); v.delete(r); }
  }
  async search(app: AppSpec, disk: DiskRef, rel: string, q: string, limit: number) {
    const v = vol(app, disk.name), lq = q.toLowerCase();
    return under(v, rel).filter((k) => base(k).toLowerCase().includes(lq)).slice(0, limit).map((k) => ({ path: k, dir: v.get(k)!.dir }));
  }
  async untar(app: AppSpec, disk: DiskRef, rel: string, chunks: Iterable<Buffer>) {
    const v = vol(app, disk.name), tar = Buffer.concat([...chunks]);
    for (let off = 0; off + 512 <= tar.length;) {
      const h = tar.subarray(off, off + 512);
      if (h.every((b) => b === 0)) break;
      const name = h.subarray(0, 100).toString("utf8").replace(/\0[^]*$/, ""), prefix = h.subarray(345, 500).toString("utf8").replace(/\0[^]*$/, "");
      const full = (prefix ? prefix + "/" : "") + name, size = parseInt(h.subarray(124, 136).toString("ascii").replace(/\0[^]*$/, "").trim() || "0", 8);
      const target = [rel, full.replace(/\/$/, "")].filter(Boolean).join("/");
      if (h[156] === 0x35) mkdirp(v, target);
      else { mkdirp(v, parent(target)); v.set(target, { dir: false, data: Buffer.from(tar.subarray(off + 512, off + 512 + size)), mtime: Date.now() }); }
      off += 512 + Math.ceil(size / 512) * 512;
    }
  }
  async usage(app: AppSpec, disk: DiskRef) { return volBytes(vol(app, disk.name)); }
  async backupDisk(app: AppSpec, disk: DiskRef, backupId: string) {
    const v = vol(app, disk.name);
    const location = "s3://gereh-backups/" + app.userId + "/" + app.id + "/disk-" + disk.name + "/" + backupId + ".tar.gz";
    snapshots.set(location, new Map([...v].map(([k, n]) => [k, { ...n, data: Buffer.from(n.data) }])));
    return { sizeMb: Math.max(0.1, Math.round((volBytes(v) / 1024 / 1024) * 10) / 10), location };
  }
  async restoreDisk(app: AppSpec, disk: DiskRef, location: string) {
    const s = snapshots.get(location);
    if (!s) throw new ToolError("backup not found (the simulator forgets backups on restart)");
    volumes.set(app.id + "/" + disk.name, new Map([...s].map(([k, n]) => [k, { ...n, data: Buffer.from(n.data) }])));
  }
  async backupLink(location: string) { return "https://s3.gereh.dev/" + location.replace(/^s3:\/\//, "") + "?X-Amz-Expires=1800&simulator=1"; }
  async deleteBackup(location: string) { snapshots.delete(location); }
  async removeDisk(app: AppSpec, disk: string) { volumes.delete(app.id + "/" + disk); }
  async sftpPort(app: AppSpec) { return 30000 + (seed(app.id) % 2000); }
  async logsSince(app: AppSpec, since: Date, max: number) {
    const now = Date.now(), step = 17_000, out: LogLine[] = [];
    const paths = ["/", "/api/health", "/login", "/api/items", "/static/app.js", "/favicon.ico"];
    const inst = app.name + "-" + hex(app.id) + "-0";
    for (let t = Math.ceil((since.getTime() + 1) / step) * step; t <= now && out.length < max; t += step) {
      const k = Math.floor(t / step) % 29;
      const line = k === 0 ? "listening on 0.0.0.0:" + app.port
        : k === 7 ? "WARN slow query took 1532ms"
        : k === 13 ? "ERROR Unhandled rejection: connect ECONNREFUSED 10.43.0.12:6379"
        : ["GET", "GET", "POST", "GET"][k % 4] + " " + paths[k % paths.length] + " " + (k % 11 === 0 ? 404 : k % 17 === 0 ? 500 : 200) + " " + (8 + (k * 13) % 120) + "ms";
      out.push({ at: new Date(t), instance: inst, line });
    }
    return out;
  }
}

/* ---------- Kubernetes ---------- */
const s3cfg = () => ({ origin: (process.env.PAAS_BACKUP_S3_ENDPOINT || "").replace(/\/$/, ""), accessKey: process.env.PAAS_BACKUP_S3_ACCESS_KEY || "", secretKey: process.env.PAAS_BACKUP_S3_SECRET_KEY || "", region: process.env.PAAS_BACKUP_S3_REGION || "us-east-1" });
const sh = (script: string, ...args: string[]) => ["/bin/sh", "-c", script, "sh", ...args];
type PodItem = { metadata: { name: string; labels?: Record<string, string>; creationTimestamp?: string }; status?: { phase?: string; conditions?: { type: string; status: string }[] } };

/** PUT a local file to a presigned URL (streamed, with its length) */
function putFile(url: string, file: string, size: number) {
  const u = new URL(url), lib = u.protocol === "http:" ? http : https;
  return new Promise<void>((resolve, reject) => {
    const req = lib.request(u, { method: "PUT", headers: { "content-length": size, "content-type": "application/gzip" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => (res.statusCode && res.statusCode < 300 ? resolve() : reject(new Error("backup upload: " + res.statusCode + " " + Buffer.concat(chunks).toString("utf8").slice(0, 200)))));
    });
    req.on("error", reject);
    createReadStream(file).on("error", reject).pipe(req);
  });
}

export class KubeTools implements ToolsDriver {
  readonly name = "kubernetes" as const;
  private k() { return import("./kubernetes"); }
  private x() { return import("./exec"); }
  private async pods(app: AppSpec, all = false) {
    const { k8s, nsOf } = await this.k();
    const sel = "gereh.net/app=" + app.id + (all ? "" : ",gereh.net/service=app");
    const r = await k8s("GET", "/api/v1/namespaces/" + nsOf(app.userId) + "/pods?labelSelector=" + encodeURIComponent(sel));
    return ((r.items as PodItem[]) ?? []).filter((p) => p.status?.phase === "Running");
  }
  async instances(app: AppSpec) {
    return (await this.pods(app)).map((p) => ({ name: p.metadata.name, ready: !!p.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True"), since: p.metadata.creationTimestamp ?? "" }));
  }
  private async pod(app: AppSpec, instance?: string) {
    const pods = await this.pods(app);
    const p = instance ? pods.find((x) => x.metadata.name === instance) : pods[0];
    if (!p) throw new ToolError(instance ? "instance " + instance + " is not running" : "the app has no running instance");
    return { ns: (await this.k()).nsOf(app.userId), pod: p.metadata.name };
  }
  private async run(app: AppSpec, cmd: string[], o: { stdin?: AsyncIterable<Buffer> | Buffer; timeoutMs?: number; onStdout?: (b: Buffer) => void; maxOut?: number } = {}, instance?: string) {
    const [{ ns, pod }, { podExec }] = await Promise.all([this.pod(app, instance), this.x()]);
    const r = await podExec(ns, pod, "app", cmd, { timeoutMs: 120_000, ...o });
    if (r.code !== 0) throw new ToolError((r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n").slice(0, 500) || "exit code " + r.code);
    return r.stdout;
  }
  async exec(app: AppSpec, instance: string, command: string, timeoutMs: number) {
    const [{ ns, pod }, { podExec }] = await Promise.all([this.pod(app, instance), this.x()]);
    const r = await podExec(ns, pod, "app", sh(command), { timeoutMs, maxOut: 1024 * 1024 });
    return { code: r.code, output: r.stdout + r.stderr };
  }
  async shell(app: AppSpec, instance: string, size: { cols: number; rows: number }) {
    const [{ ns, pod }, { podShell }] = await Promise.all([this.pod(app, instance), this.x()]);
    return podShell(ns, pod, "app", sh("export TERM=xterm; cd \"${HOME:-/}\" 2>/dev/null; if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi"), size);
  }
  async list(app: AppSpec, disk: DiskRef, rel: string) {
    const out = await this.run(app, sh('cd -- "$1" || exit 2; for f in * .[!.]* ..?*; do { [ -e "$f" ] || [ -L "$f" ]; } || continue; if [ -d "$f" ] && [ ! -L "$f" ]; then t=d; else t=f; fi; printf "%s\\t%s\\t%s\\n" "$t" "$(stat -c "%s %Y" -- "$f")" "$f"; done | head -n 5000', abs(disk, rel)));
    return out.split("\n").filter(Boolean).map((l) => {
      const [t, sm, ...name] = l.split("\t"), [size, mtime] = sm.split(" ");
      return { name: name.join("\t"), dir: t === "d", size: Number(size) || 0, mtime: (Number(mtime) || 0) * 1000 };
    });
  }
  async readFile(app: AppSpec, disk: DiskRef, rel: string, max: number) {
    const parts: Buffer[] = [];
    await this.run(app, sh('[ -f "$1" ] || { echo "not a file" >&2; exit 2; }; head -c "$2" -- "$1"', abs(disk, rel), String(max)), { onStdout: (b) => parts.push(b), maxOut: max + 1024 });
    return Buffer.concat(parts);
  }
  async download(app: AppSpec, disk: DiskRef, rel: string, onChunk: (b: Buffer) => void) {
    await this.run(app, sh('[ -f "$1" ] || { echo "not a file" >&2; exit 2; }; cat -- "$1"', abs(disk, rel)), { onStdout: onChunk, maxOut: 4 * 1024 * 1024 * 1024, timeoutMs: 3600_000 });
  }
  async writeFile(app: AppSpec, disk: DiskRef, rel: string, body: FileBody) {
    const size = Buffer.isBuffer(body) ? body.length : body.size;
    // v4 exec has no stdin EOF: read exactly `size` bytes, then move into place
    await this.run(app, sh('mkdir -p -- "$(dirname -- "$1")" && head -c "$2" > "$1.gereh-part" && mv -f -- "$1.gereh-part" "$1"', abs(disk, rel), String(size)),
      { stdin: Buffer.isBuffer(body) ? (size ? body : undefined) : body.stream, timeoutMs: 3600_000 });
  }
  async mkdir(app: AppSpec, disk: DiskRef, rel: string) { await this.run(app, sh('mkdir -p -- "$1"', abs(disk, rel))); }
  async rename(app: AppSpec, disk: DiskRef, from: string, to: string) {
    await this.run(app, sh('[ ! -e "$2" ] || { echo "File exists" >&2; exit 3; }; mkdir -p -- "$(dirname -- "$2")" && mv -- "$1" "$2"', abs(disk, from), abs(disk, to)));
  }
  async remove(app: AppSpec, disk: DiskRef, rels: string[]) {
    if (rels.some((r) => !r)) throw new ToolError("refusing to remove the disk root");
    await this.run(app, sh('rm -rf -- "$@"', ...rels.map((r) => abs(disk, r))));
  }
  async search(app: AppSpec, disk: DiskRef, rel: string, q: string, limit: number) {
    const out = await this.run(app, sh('cd -- "$1" || exit 2; find . -maxdepth 8 -iname "*$2*" 2>/dev/null | head -n "$3" | while IFS= read -r f; do if [ -d "$f" ]; then echo "d $f"; else echo "f $f"; fi; done', abs(disk, rel), q, String(limit)));
    return out.split("\n").filter(Boolean).map((l) => ({ dir: l[0] === "d", path: [rel, l.slice(4)].filter(Boolean).join("/") }));
  }
  async untar(app: AppSpec, disk: DiskRef, rel: string, chunks: Iterable<Buffer>, size: number) {
    async function* stream() { for (const c of chunks) yield c; }
    await this.run(app, sh('mkdir -p -- "$1" && head -c "$2" | tar -xf - -C "$1"', abs(disk, rel), String(size)), { stdin: stream(), timeoutMs: 3600_000 });
  }
  async usage(app: AppSpec, disk: DiskRef) {
    return (Number((await this.run(app, sh('du -sk -- "$1" | cut -f1', disk.mount))).trim()) || 0) * 1024;
  }
  private s3() {
    const c = s3cfg();
    if (!c.origin || !c.accessKey) throw new ToolError("disk backups are not configured (PAAS_BACKUP_S3_ENDPOINT)");
    return c;
  }
  private async presign(method: string, location: string, expires: number, query?: Record<string, string>) {
    const c = this.s3(), { presign } = await import("../storage/sigv4");
    return presign({ accessKey: c.accessKey, secretKey: c.secretKey, region: c.region }, { method, origin: c.origin, path: "/" + location.replace(/^s3:\/\//, ""), expires, query });
  }
  async backupDisk(app: AppSpec, disk: DiskRef, backupId: string) {
    const { cfg } = await this.k();
    const key = cfg().bucket + "/" + app.userId.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "/" + app.id + "/disk-" + disk.name + "/" + backupId + ".tar.gz";
    this.s3();
    const { uploadRoot } = await import("./service");
    const dir = path.join(uploadRoot(), "disk-backups");
    await mkdir(dir, { recursive: true });
    const tmp = path.join(dir, backupId + ".tar.gz");
    try {
      const file = createWriteStream(tmp, { mode: 0o600 });
      await this.run(app, sh('cd -- "$1" && tar -czf - .', disk.mount), { onStdout: (b) => { file.write(b); }, maxOut: 1024 ** 4, timeoutMs: 3 * 3600_000 });
      await new Promise<void>((r, j) => file.end((e?: Error | null) => (e ? j(e) : r())));
      const size = (await stat(tmp)).size;
      await putFile(await this.presign("PUT", key, 3600), tmp, size);
      return { sizeMb: Math.round((size / 1024 / 1024) * 10) / 10, location: "s3://" + key };
    } finally { await rm(tmp, { force: true }); }
  }
  async restoreDisk(app: AppSpec, disk: DiskRef, location: string) {
    const res = await fetch(await this.presign("GET", location, 3600), { cache: "no-store" });
    if (!res.ok || !res.body) throw new ToolError("backup download: " + res.status);
    const size = Number(res.headers.get("content-length") || 0);
    const body = res.body;
    async function* stream() { for await (const c of body as unknown as AsyncIterable<Uint8Array>) yield Buffer.from(c); }
    // unpack beside the current files first; swap only when the archive is complete
    await this.run(app, sh('set -e; cd -- "$1"; rm -rf .gereh-restore; mkdir .gereh-restore; head -c "$2" | tar -xzf - -C .gereh-restore; find . -mindepth 1 -maxdepth 1 ! -name .gereh-restore -exec rm -rf {} +; cd .gereh-restore; for f in * .[!.]* ..?*; do { [ -e "$f" ] || [ -L "$f" ]; } && mv -- "$f" ..; done; cd ..; rmdir .gereh-restore', disk.mount, String(size)), { stdin: stream(), timeoutMs: 3 * 3600_000 });
  }
  async backupLink(location: string, fileName: string) { return this.presign("GET", location, 1800, { "response-content-disposition": 'attachment; filename="' + fileName.replace(/[^\w.-]/g, "_") + '"' }); }
  async deleteBackup(location: string) {
    const res = await fetch(await this.presign("DELETE", location, 300), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new ToolError("backup delete: " + res.status);
  }
  async removeDisk(app: AppSpec, disk: string) {
    const { del, nsOf } = await this.k();
    const { diskClaim } = await import("@/lib/paas-tools");
    await del("v1", "PersistentVolumeClaim", nsOf(app.userId), diskClaim(app.name, disk));
  }
  async sftpPort(app: AppSpec) {
    const { get, nsOf } = await this.k();
    try {
      const s = await get("v1", "Service", nsOf(app.userId), app.name + "-sftp") as { spec?: { ports?: { nodePort?: number }[] } };
      return s.spec?.ports?.[0]?.nodePort ?? null;
    } catch { return null; }
  }
  async logsSince(app: AppSpec, since: Date, max: number) {
    const { k8s, nsOf } = await this.k();
    const ns = nsOf(app.userId), out: LogLine[] = [];
    for (const p of (await this.pods(app, true)).slice(0, 12)) {
      const r = await k8s("GET", `/api/v1/namespaces/${ns}/pods/${p.metadata.name}/log?container=app&timestamps=true&sinceTime=${encodeURIComponent(new Date(since.getTime() + 1).toISOString().replace(/\.\d+Z$/, "Z"))}&limitBytes=4194304`).catch(() => ({ text: "" }));
      for (const l of String(r.text || "").split("\n")) {
        const sp = l.indexOf(" ");
        if (sp < 0) continue;
        const at = new Date(l.slice(0, sp));
        if (Number.isNaN(at.getTime()) || at <= since) continue;
        out.push({ at, instance: p.metadata.name, line: l.slice(sp + 1) });
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-max);
  }
}

let cached: ToolsDriver | null = null;
/** Kubernetes when PAAS_K8S_API + PAAS_K8S_TOKEN are set, else the simulator */
export function paasTools(): ToolsDriver {
  return (cached ??= process.env.PAAS_K8S_API && process.env.PAAS_K8S_TOKEN ? new KubeTools() : new SimTools());
}
export const resetToolsDriver = () => { cached = null; };
