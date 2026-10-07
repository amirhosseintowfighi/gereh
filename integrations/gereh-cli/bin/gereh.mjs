#!/usr/bin/env node
/* Gereh Apps CLI: zero dependencies, Node 20+.
   Token: GEREH_TOKEN or `gereh login`. API origin: GEREH_API (default https://gereh.net). */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { deflateRawSync } from "node:zlib";

const VERSION = "1.0.0";
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gereh", "config.json");
const ORIGIN = (process.env.GEREH_API || readConfig().api || "https://gereh.net").replace(/\/$/, "");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), green = c(32), red = c(31), cyan = c(36), bold = c(1);

function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG, "utf8")); } catch { return {}; }
}
function token() {
  const t = process.env.GEREH_TOKEN || readConfig().token;
  if (!t) die("No token. Run `gereh login` or set GEREH_TOKEN (Panel › SSH و API › new read-write token).");
  return t;
}
function die(msg, code = 1) { console.error(red("✗ ") + msg); process.exit(code); }

async function api(method, path, body) {
  const res = await fetch(ORIGIN + "/api/v1/" + path, {
    method, headers: { authorization: "Bearer " + token(), "user-agent": "gereh-cli/" + VERSION, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => die("Cannot reach " + ORIGIN + ": " + e.message));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) die((j.error?.message || res.statusText) + dim(" (HTTP " + res.status + ")"));
  return j;
}

/* ---------- args ---------- */
function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : true); }
    else if (a === "-f") flags.follow = true;
    else if (a === "-a") flags.app = argv[++i];
    else if (a === "-m") flags.message = argv[++i];
    else pos.push(a);
  }
  return { pos, flags };
}
const projectFile = (dir) => join(dir, "gereh.json");
function appName(flags, dir = ".") {
  if (flags.app) return flags.app;
  try { return JSON.parse(readFileSync(projectFile(dir), "utf8")).app; } catch { /* none */ }
  die("Which app? Pass --app <name> or run `gereh link <name>` in the project folder.");
}

/* ---------- zip (store/deflate, no dependencies) ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const SKIP = new Set([".git", "node_modules", ".next", ".nuxt", ".output", "__pycache__", ".venv", "venv", ".pytest_cache", ".DS_Store", ".idea", ".vscode", "vendor", "target", "bin/Debug", "obj", ".terraform", ".env", ".env.local"]);

function ignoreRules(dir) {
  const rules = [];
  for (const f of [".gerehignore", ".gitignore"]) {
    if (!existsSync(join(dir, f))) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split(/\r?\n/)) {
      const l = line.trim();
      if (!l || l.startsWith("#") || l.startsWith("!")) continue;
      const anchored = l.startsWith("/");
      const pat = l.replace(/^\//, "").replace(/\/$/, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
      rules.push(new RegExp((anchored ? "^" : "(^|/)") + pat + "(/|$)"));
    }
    break; // .gerehignore replaces .gitignore
  }
  return rules;
}

function collect(dir) {
  const rules = ignoreRules(dir), out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name), rel = relative(dir, full).split(sep).join("/");
      if (SKIP.has(name) || SKIP.has(rel) || rules.some((r) => r.test(rel))) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push({ rel, full, mtime: st.mtime });
    }
  };
  walk(dir);
  return out;
}

function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = readFileSync(f.full), name = Buffer.from(f.rel, "utf8");
    const packed = deflateRawSync(data, { level: 6 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data, crc = crc32(data);
    const d = f.mtime, dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDeflate ? 8 : 0, 8);
    h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    local.push(h, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

/* ---------- commands ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function follow(app, depId) {
  let printed = 0, last = "";
  for (;;) {
    const d = await api("GET", `apps/${app}/deployments/${depId}`);
    const lines = (d.log || "").split("\n");
    for (const l of lines.slice(printed)) if (l) console.log(dim("  │ ") + l);
    printed = lines.length;
    if (d.status !== last) { last = d.status; if (["deploying"].includes(d.status)) console.log(cyan("==> Rolling out…")); }
    if (d.status === "live") return true;
    if (["failed", "cancelled", "superseded"].includes(d.status)) return false;
    await sleep(2000);
  }
}

const commands = {
  async login({ flags }) {
    let t = flags.token;
    if (!t) {
      console.log("Create a read-write token in " + cyan(ORIGIN + "/panel/keys") + " and paste it here.");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      t = (await rl.question("Token: ")).trim(); rl.close();
    }
    if (!/^grh_[A-Za-z0-9]{40}$/.test(t)) die("That does not look like a Gereh token (grh_…).");
    process.env.GEREH_TOKEN = t;
    const me = await api("GET", "account");
    mkdirSync(join(CONFIG, ".."), { recursive: true });
    writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), token: t }, null, 2), { mode: 0o600 });
    console.log(green("✓ ") + "Logged in as " + bold(me.name) + " <" + me.email + ">");
  },
  async logout() {
    const cfg = readConfig(); delete cfg.token;
    if (existsSync(CONFIG)) writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    console.log(green("✓ ") + "Token removed.");
  },
  async apps() {
    const { data } = await api("GET", "apps");
    if (!data.length) return console.log("No apps yet. Create one in " + cyan(ORIGIN + "/panel/apps/new"));
    for (const a of data) console.log(bold(a.name.padEnd(24)) + " " + (a.status === "running" ? green(a.status) : a.status === "failed" ? red(a.status) : a.status).padEnd(color ? 19 : 10) + " " + dim(a.stack.padEnd(9)) + " " + a.url);
  },
  async link({ pos }) {
    const name = pos[0] || die("Usage: gereh link <app-name>");
    const a = await api("GET", "apps/" + name);
    writeFileSync(projectFile("."), JSON.stringify({ app: a.name }, null, 2) + "\n");
    console.log(green("✓ ") + "Linked this folder to " + bold(a.name) + dim(" (gereh.json)"));
  },
  async status({ flags }) {
    const a = await api("GET", "apps/" + appName(flags));
    console.log(bold(a.name) + "  " + a.status + "\n" + a.url);
    for (const d of a.domains) console.log("  " + d.host + dim(" (" + d.status + ")"));
    console.log(dim(`${a.instances} instance(s), plan ${a.plan}${a.autoscale ? ", autoscale to " + a.max_instances : ""}, ${a.hourly_price_toman ?? "?"} Toman/hour`));
    if (a.latest_deployment) console.log(dim(`latest deployment ${a.latest_deployment.id}: ${a.latest_deployment.status}`));
  },
  async deploy({ flags }) {
    const dir = typeof flags.dir === "string" ? flags.dir : ".";
    const name = appName(flags, dir);
    const app = await api("GET", "apps/" + name);
    let uploadId;
    if (app.source === "zip" || app.source === "compose") {
      const files = collect(dir);
      if (!files.length) die("Nothing to upload in " + dir);
      const buf = zip(files);
      if (buf.length > 200 * 1024 * 1024) die("Archive is larger than 200 MB; add big folders to .gerehignore.");
      console.log(cyan("==> ") + `Packing ${files.length} files (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
      const form = new FormData();
      form.set("file", new Blob([buf], { type: "application/zip" }), "project.zip");
      const res = await fetch(ORIGIN + "/api/paas/upload", { method: "POST", headers: { authorization: "Bearer " + token() }, body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) die((j.error || res.statusText) + dim(" (HTTP " + res.status + ")"));
      uploadId = j.result.uploadId;
      if (j.result.stack) console.log(cyan("==> ") + "Detected " + j.result.stack);
    } else console.log(cyan("==> ") + (app.source === "git" ? "Building from the app's Git repository" : "Pulling the app's image"));
    const dep = await api("POST", `apps/${app.name}/deployments`, { upload_id: uploadId, message: typeof flags.message === "string" ? flags.message : undefined, via: "cli" });
    console.log(cyan("==> ") + "Deployment " + dep.id);
    if (flags.detach) return;
    const ok = await follow(app.name, dep.id);
    if (!ok) die("Deployment failed. The previous version is still serving traffic.");
    console.log(green("✓ ") + "Live at " + cyan(app.url));
  },
  async logs({ flags, pos }) {
    const name = pos[0] || appName(flags);
    const seen = new Set();
    for (;;) {
      const { lines } = await api("GET", `apps/${name}/logs`);
      for (const l of lines) if (!seen.has(l)) { seen.add(l); console.log(l); }
      if (!flags.follow) return;
      await sleep(4000);
    }
  },
  async env({ pos, flags }) {
    const [sub, ...rest] = pos;
    const name = appName(flags);
    if (sub === "set") {
      if (!rest.length) die("Usage: gereh env set KEY=value [KEY2=value] [--secret]");
      const vars = Object.fromEntries(rest.map((kv) => { const i = kv.indexOf("="); if (i < 1) die("Expected KEY=value, got " + kv); return [kv.slice(0, i), kv.slice(i + 1)]; }));
      await api("PUT", `apps/${name}/env`, { vars, secret: flags.secret ? Object.keys(vars) : [] });
      console.log(green("✓ ") + "Set " + Object.keys(vars).join(", ") + dim(" — restarting with the new values"));
    } else if (sub === "unset") {
      if (!rest.length) die("Usage: gereh env unset KEY [KEY2]");
      await api("PUT", `apps/${name}/env`, { vars: Object.fromEntries(rest.map((k) => [k, null])) });
      console.log(green("✓ ") + "Removed " + rest.join(", "));
    } else die("Usage: gereh env set|unset …");
  },
  async start({ flags }) { await api("POST", `apps/${appName(flags)}/actions`, { action: "start" }); console.log(green("✓ ") + "Started"); },
  async stop({ flags }) { await api("POST", `apps/${appName(flags)}/actions`, { action: "stop" }); console.log(green("✓ ") + "Stopped"); },
  async restart({ flags }) { await api("POST", `apps/${appName(flags)}/actions`, { action: "restart" }); console.log(green("✓ ") + "Restarting"); },
  help() {
    console.log(`${bold("gereh")} ${VERSION} — Gereh Apps from your terminal

  gereh login [--token grh_…]     save a read-write API token
  gereh apps                      list your apps
  gereh link <app>                link this folder to an app (writes gereh.json)
  gereh deploy [-m msg] [--detach] [--dir path]
                                  ZIP apps: pack and upload this folder; Git/image apps: rebuild
  gereh status                    app URL, domains, size and price
  gereh logs [-f]                 runtime logs (follow with -f)
  gereh env set K=V… [--secret]   set variables (restart, no rebuild)
  gereh env unset K…              remove variables
  gereh start | stop | restart
  gereh logout

  -a, --app <name>   act on an app other than the linked one
  Env: GEREH_TOKEN, GEREH_API (default https://gereh.net). Ignored on upload: .gerehignore (or .gitignore), node_modules, .git, .env…`);
  },
};

const { pos, flags } = parse(process.argv.slice(2));
const cmd = pos.shift() || "help";
if (flags.version || cmd === "version" || cmd === "-v") console.log(VERSION);
else if (flags.help || !commands[cmd]) commands.help();
else await commands[cmd]({ pos, flags });
