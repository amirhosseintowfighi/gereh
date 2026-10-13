#!/usr/bin/env node
/* Gereh Apps CLI: zero dependencies, Node 20+.
   Token: GEREH_TOKEN or `gereh login`. API origin: GEREH_API (default https://gereh.net).
   Several accounts: profiles (`gereh profile add work`, `--profile work` or GEREH_PROFILE). */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { deflateRawSync } from "node:zlib";

const VERSION = "1.2.0";
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "gereh", "config.json");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), green = c(32), red = c(31), cyan = c(36), bold = c(1), yellow = c(33);
function die(msg, code = 1) { console.error(red("✗ ") + msg); process.exit(code); }

/* ---------- args ---------- */
const BOOL = new Set(["follow", "detach", "preview", "secret", "no-cache", "wait", "public", "yes", "help", "version", "verbose", "json", "download"]);
const SHORT = { "-f": "follow", "-a": "app", "-m": "message", "-p": "profile", "-y": "yes", "-h": "help", "-v": "version" };
function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { flags["--"] = argv.slice(i + 1); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("="), k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[k] = a.slice(eq + 1);
      else if (BOOL.has(k)) flags[k] = true;
      else flags[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("-") ? argv[++i] : true;
    } else if (SHORT[a]) { const k = SHORT[a]; flags[k] = BOOL.has(k) ? true : argv[++i]; }
    else pos.push(a);
  }
  return { pos, flags };
}
const { pos: POS, flags: FLAGS } = parse(process.argv.slice(2));
const str = (v) => (typeof v === "string" ? v : undefined);

/* ---------- config & profiles ---------- */
function readConfig() {
  let cfg;
  try { cfg = JSON.parse(readFileSync(CONFIG, "utf8")); } catch { cfg = {}; }
  // 1.1 kept one token at the top level: that becomes the "default" profile
  if (!cfg.profiles) cfg = { current: "default", profiles: cfg.token || cfg.api ? { default: { token: cfg.token, api: cfg.api } } : {} };
  return cfg;
}
function writeConfig(cfg) {
  mkdirSync(join(CONFIG, ".."), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}
const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
const profileName = () => str(FLAGS.profile) || process.env.GEREH_PROFILE || readConfig().current || "default";
const profile = () => readConfig().profiles[profileName()] || {};
const ORIGIN = (str(FLAGS.api) || process.env.GEREH_API || profile().api || "https://gereh.net").replace(/\/$/, "");
function token() {
  const t = process.env.GEREH_TOKEN || profile().token;
  if (!t) die("No token for profile " + bold(profileName()) + ". Run `gereh login` or set GEREH_TOKEN (Panel › SSH و API › new read-write token).");
  return t;
}

async function api(method, path, body) {
  const res = await fetch(ORIGIN + "/api/v1/" + path, {
    method, headers: { authorization: "Bearer " + token(), "user-agent": "gereh-cli/" + VERSION, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch((e) => die("Cannot reach " + ORIGIN + ": " + e.message));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) die((j.error?.message || res.statusText) + dim(" (HTTP " + res.status + ")"));
  return j;
}
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")); const s = p.toString(); return s ? "?" + s : ""; };
const enc = encodeURIComponent;

const projectFile = (dir) => join(dir, "gereh.json");
const readProject = (dir = ".") => { try { return JSON.parse(readFileSync(projectFile(dir), "utf8")); } catch { return null; } };
function appName(flags, dir = ".") {
  if (flags.app) return flags.app;
  const p = readProject(dir);
  if (p?.app) return p.app;
  die("Which app? Pass --app <name> or run `gereh init` / `gereh link <name>` in the project folder.");
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

/* ---------- dotenv ---------- */
/** KEY=value lines; quotes ("…" with \n escapes, '…' literal), `export ` and comments allowed */
function parseDotenv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) die("Not a KEY=value line in the .env file: " + line.slice(0, 60));
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"') && v.length > 1) v = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    else if (v.startsWith("'") && v.endsWith("'") && v.length > 1) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/* ---------- local stack guess for `gereh init` ---------- */
function guessProject(dir) {
  const has = (f) => existsSync(join(dir, f));
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { /* none */ }
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (has("Dockerfile")) return { stack: "Dockerfile", port: 8080 };
  if (deps.next) return { stack: "Next.js", port: 3000, start: "npm start" };
  if (deps.nuxt) return { stack: "Nuxt", port: 3000, start: "node .output/server/index.mjs" };
  if (pkg) return { stack: "Node.js", port: 3000, start: pkg.scripts?.start ? "npm start" : undefined };
  const py = ["requirements.txt", "pyproject.toml"].filter(has).map((f) => readFileSync(join(dir, f), "utf8")).join("\n").toLowerCase();
  if (has("manage.py") || /django/.test(py)) return { stack: "Django", port: 8000, start: "gunicorn config.wsgi", release: "python manage.py migrate --noinput" };
  if (/fastapi/.test(py)) return { stack: "FastAPI", port: 8000, start: "uvicorn main:app --host 0.0.0.0 --port $PORT" };
  if (py) return { stack: "Python", port: 8000 };
  if (has("artisan")) return { stack: "Laravel", port: 80, release: "php artisan migrate --force" };
  if (has("composer.json")) return { stack: "PHP", port: 80 };
  if (has("go.mod")) return { stack: "Go", port: 8080 };
  if (has("Gemfile")) return { stack: "Ruby", port: 3000, release: has("bin/rails") ? "bundle exec rails db:migrate" : undefined };
  return { stack: "?", port: 3000 };
}

/* ---------- commands ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ask(rl, q, def) {
  if (!rl) return def ?? "";
  const a = (await rl.question(q + (def !== undefined && def !== "" ? dim(" (" + def + ")") : "") + ": ")).trim();
  return a || (def ?? "");
}

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
async function exec(name, command, instance) {
  const r = await api("POST", `apps/${name}/exec`, { command, ...(instance ? { instance } : {}) });
  if (r.output) process.stdout.write(r.output.endsWith("\n") ? r.output : r.output + "\n");
  return r.exit_code;
}

const commands = {
  async login({ flags }) {
    let t = str(flags.token);
    if (!t) {
      console.log("Create a read-write token in " + cyan(ORIGIN + "/panel/keys") + " and paste it here.");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      t = (await rl.question("Token: ")).trim(); rl.close();
    }
    if (!/^grh_[A-Za-z0-9]{40}$/.test(t)) die("That does not look like a Gereh token (grh_…).");
    process.env.GEREH_TOKEN = t;
    const me = await api("GET", "account");
    const cfg = readConfig(), name = profileName();
    if (!PROFILE_RE.test(name)) die("Profile names: letters, digits, - and _");
    cfg.profiles[name] = { ...cfg.profiles[name], token: t, ...(str(flags.api) ? { api: ORIGIN } : {}) };
    cfg.current ||= name;
    writeConfig(cfg);
    console.log(green("✓ ") + "Logged in as " + bold(me.name) + " <" + me.email + ">" + dim("  profile " + name));
  },
  async logout() {
    const cfg = readConfig(), name = profileName();
    if (cfg.profiles[name]) { delete cfg.profiles[name].token; writeConfig(cfg); }
    console.log(green("✓ ") + "Token removed from profile " + name + ".");
  },
  /** gereh profile list | use <name> | add <name> [--api URL] [--token grh_…] | remove <name> */
  async profile({ pos, flags }) {
    const [sub = "list", name] = pos, cfg = readConfig();
    if (sub === "list" || sub === "ls") {
      const names = Object.keys(cfg.profiles);
      if (!names.length) return console.log("No profiles yet. Run `gereh login` (or `gereh profile add <name>`).");
      for (const n of names) console.log((n === (cfg.current || "default") ? green("● ") : "  ") + bold(n.padEnd(16)) + " " + dim((cfg.profiles[n].api || "https://gereh.net") + (cfg.profiles[n].token ? "" : "  (no token)")));
      return;
    }
    if (!name || !PROFILE_RE.test(name)) die("Usage: gereh profile " + sub + " <name>   (letters, digits, - and _)");
    if (sub === "use") {
      if (!cfg.profiles[name]) die("No profile " + name + ". Create it with `gereh profile add " + name + "`.");
      cfg.current = name; writeConfig(cfg);
      return console.log(green("✓ ") + "Now using profile " + bold(name));
    }
    if (sub === "add") {
      cfg.profiles[name] = { ...cfg.profiles[name], ...(str(flags.api) ? { api: str(flags.api).replace(/\/$/, "") } : {}) };
      writeConfig(cfg);
      console.log(green("✓ ") + "Profile " + bold(name) + " added." + dim(" Log in with: gereh login --profile " + name));
      if (str(flags.token)) { FLAGS.profile = name; await commands.login({ flags: { token: flags.token } }); }
      return;
    }
    if (sub === "remove" || sub === "rm") {
      if (!cfg.profiles[name]) die("No profile " + name);
      delete cfg.profiles[name];
      if (cfg.current === name) cfg.current = Object.keys(cfg.profiles)[0] || "default";
      writeConfig(cfg);
      return console.log(green("✓ ") + "Profile " + name + " removed.");
    }
    die("Usage: gereh profile list|use|add|remove <name>");
  },
  async apps() {
    const { data } = await api("GET", "apps");
    if (!data.length) return console.log("No apps yet. Create one in " + cyan(ORIGIN + "/panel/apps/new"));
    for (const a of data) console.log(bold(a.name.padEnd(24)) + " " + (a.status === "running" ? green(a.status) : a.status === "failed" ? red(a.status) : a.status).padEnd(color ? 19 : 10) + " " + dim(a.stack.padEnd(9)) + " " + a.url);
  },
  async link({ pos }) {
    const name = pos[0] || die("Usage: gereh link <app-name>");
    const a = await api("GET", "apps/" + name);
    writeFileSync(projectFile("."), JSON.stringify({ ...readProject(), app: a.name }, null, 2) + "\n");
    console.log(green("✓ ") + "Linked this folder to " + bold(a.name) + dim(" (gereh.json)"));
  },
  /** writes gereh.json: app, start, port, health and release (other keys you add by hand are kept) */
  async init({ flags }) {
    const dir = str(flags.dir) || ".";
    const cur = readProject(dir) || {};
    const guess = guessProject(dir);
    const rl = flags.yes || !process.stdin.isTTY ? null : createInterface({ input: process.stdin, output: process.stdout });
    console.log(cyan("==> ") + "Detected " + bold(guess.stack) + dim(" — press Enter to accept a suggestion, - to leave a field out"));
    const val = async (k, q, def) => { const v = str(flags[k]) ?? await ask(rl, q, cur[k] ?? def); return v === "-" ? undefined : v || undefined; };
    const app = await val("app", "App name on Gereh", basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+|-+$/g, "").slice(0, 30));
    const start = await val("start", "Start command", guess.start);
    const port = await val("port", "Port", String(guess.port));
    const health = await val("health", "Health check path", "/");
    const release = await val("release", "Release command (migrations)", guess.release);
    rl?.close();
    if (app && !/^[a-z](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(app)) die("App names: 3–30 lowercase letters, digits and -, starting with a letter.");
    if (port && !(Number(port) >= 1 && Number(port) <= 65535)) die("Port must be 1–65535.");
    if (health && !/^\/[\w./?=&%-]*$/.test(health)) die("Health path must look like /healthz");
    const out = { ...cur, app, start, port: port ? Number(port) : undefined, health, release };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    writeFileSync(projectFile(dir), JSON.stringify(out, null, 2) + "\n");
    console.log(green("✓ ") + "Wrote " + projectFile(dir) + dim(" — deploy with: gereh deploy"));
    if (app && (process.env.GEREH_TOKEN || profile().token)) {
      const res = await fetch(ORIGIN + "/api/v1/apps/" + enc(app), { headers: { authorization: "Bearer " + token() } }).catch(() => null);
      if (res?.status === 404) console.log(yellow("! ") + "No app named " + app + " yet: create it in " + cyan(ORIGIN + "/panel/apps/new"));
    }
  },
  async status({ flags }) {
    const a = await api("GET", "apps/" + appName(flags));
    console.log(bold(a.name) + "  " + a.status + "\n" + a.url);
    for (const d of a.domains) console.log("  " + d.host + dim(" (" + d.status + ")"));
    console.log(dim(`${a.instances} instance(s), plan ${a.plan}${a.autoscale ? ", autoscale to " + a.max_instances : ""}, ${a.hourly_price_toman ?? "?"} Toman/hour`));
    if (a.latest_deployment) console.log(dim(`latest deployment ${a.latest_deployment.id}: ${a.latest_deployment.status}`));
  },
  /** gereh deploy [-m msg] [--no-cache] [--image ref | --git url [--branch b]] [--preview] [--detach] */
  async deploy({ flags }) {
    const dir = str(flags.dir) || ".";
    const name = appName(flags, dir);
    const app = await api("GET", "apps/" + name);
    const preview = !!flags.preview, noCache = !!flags["no-cache"];
    let uploadId, depId;
    if (str(flags.image) || str(flags.git)) {
      if (preview) die("--image/--git change the production source; deploy a preview without them.");
      if (str(flags.image) && app.source !== "image") die(app.name + " is built from " + app.source + ", not an image.");
      if (str(flags.git) && app.source !== "git") die(app.name + " is built from " + app.source + ", not Git.");
      const r = await api("PUT", `apps/${app.name}/source`, str(flags.image) ? { image: flags.image } : { git_url: flags.git, ...(str(flags.branch) ? { git_branch: flags.branch } : {}) });
      console.log(cyan("==> ") + "Source set to " + (str(flags.image) || flags.git + (str(flags.branch) ? " (" + flags.branch + ")" : "")));
      depId = r.deployment || undefined; // a new image deploys by itself
    } else if (app.source === "zip" || app.source === "compose") {
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
    if (!depId) {
      const dep = await api("POST", `apps/${app.name}/deployments`, { upload_id: uploadId, message: str(flags.message), via: "cli", preview, branch: preview ? str(flags.branch) : undefined, no_cache: noCache || undefined });
      depId = dep.id;
    }
    console.log(cyan("==> ") + (preview ? "Preview deployment " : "Deployment ") + depId + (noCache ? dim(" (no build cache)") : ""));
    if (flags.detach) return;
    const ok = await follow(app.name, depId);
    if (!ok) die(preview ? "Preview failed." : "Deployment failed. The previous version is still serving traffic.");
    if (preview) {
      const a = await api("GET", "apps/" + app.name);
      console.log(green("✓ ") + "Preview at " + cyan(a.preview_url) + dim("  — promote with: gereh promote " + depId));
    } else console.log(green("✓ ") + "Live at " + cyan(app.url));
  },
  async promote({ pos, flags }) {
    const name = appName(flags);
    const depId = pos[0] || (await api("GET", "apps/" + name)).preview_deployment || die("No preview to promote. Usage: gereh promote [deployment-id]");
    const dep = await api("POST", `apps/${name}/deployments/${depId}/promote`, {});
    console.log(cyan("==> ") + "Promoting " + depId + " → production (" + dep.id + ")");
    if (!(await follow(name, dep.id))) die("Promotion failed. The previous version is still serving traffic.");
    console.log(green("✓ ") + "Production now runs the preview build");
  },
  /** gereh logs [-f|--follow] — the last lines, then (with --follow) new lines from every instance */
  async logs({ flags, pos }) {
    const name = pos[0] || appName(flags);
    const { lines } = await api("GET", `apps/${name}/logs`);
    const tail = Number(flags.tail) || 100;
    for (const l of lines.slice(-tail)) console.log(l);
    if (!flags.follow) return;
    let since = new Date().toISOString();
    process.on("SIGINT", () => process.exit(0));
    for (;;) {
      await sleep(2000);
      const r = await api("GET", `apps/${name}/logs/since${qs({ since })}`);
      for (const l of r.lines) console.log(dim("[" + l.instance + "] ") + l.line);
      if (r.lines.length) since = new Date(new Date(r.next).getTime() + 1).toISOString();
    }
  },
  /** gereh shell — run commands in a running instance (each line is its own command; cd does not persist).
      gereh shell -- <command> runs one command and exits with its code. */
  async shell({ flags }) {
    const name = appName(flags), inst = str(flags.instance);
    if (flags["--"]?.length) process.exit(await exec(name, flags["--"].join(" "), inst) || 0);
    console.log(dim("Connected to " + name + ". Each line runs as a separate command in the app's working directory; exit with Ctrl-D or `exit`."));
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    rl.setPrompt(cyan(name + "$ "));
    rl.prompt();
    for await (const line of rl) {
      const cmd = line.trim();
      if (cmd === "exit" || cmd === "quit") break;
      if (cmd) { const code = await exec(name, cmd, inst); if (code) console.log(red("exit " + code)); }
      rl.prompt();
    }
    rl.close();
  },
  /** env set | unset | export [--file .env] | import <file> [--secret] */
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
    } else if (sub === "export") {
      const { dotenv } = await api("GET", `apps/${name}/env`);
      if (str(flags.file)) { writeFileSync(flags.file, dotenv, { mode: 0o600 }); console.error(green("✓ ") + "Wrote " + flags.file); }
      else process.stdout.write(dotenv);
    } else if (sub === "import") {
      const file = rest[0] || str(flags.file) || ".env";
      if (!existsSync(file)) die("No such file: " + file);
      const vars = parseDotenv(readFileSync(file, "utf8"));
      const keys = Object.keys(vars);
      if (!keys.length) die(file + " has no variables.");
      if (keys.length > 100) die("At most 100 variables per import.");
      await api("PUT", `apps/${name}/env`, { vars, secret: flags.secret ? keys : [] });
      console.log(green("✓ ") + "Imported " + keys.length + " variable(s) from " + file + (flags.secret ? " as secrets" : "") + dim(" — restarting with the new values"));
    } else die("Usage: gereh env set|unset|export|import …");
  },
  /** gereh run -- python manage.py migrate */
  async run({ pos, flags }) {
    const command = [...pos, ...(flags["--"] || [])].join(" ").trim() || die("Usage: gereh run <command>   e.g. gereh run python manage.py migrate");
    const name = appName(flags);
    const job = await api("POST", `apps/${name}/jobs`, { command });
    console.log(cyan("==> ") + "Job " + job.id + dim(" (" + command + ")"));
    let printed = 0;
    for (;;) {
      const j = await api("GET", `apps/${name}/jobs/${job.id}`);
      const out = j.output || "";
      if (out.length > printed) { process.stdout.write(out.slice(printed) + (j.status === "running" ? "" : "\n")); printed = out.length; }
      if (j.status === "succeeded") return console.log(green("✓ ") + "Done");
      if (j.status === "failed") die("Command failed");
      await sleep(2000);
    }
  },
  async start({ flags }) { await api("POST", `apps/${appName(flags)}/actions`, { action: "start" }); console.log(green("✓ ") + "Started"); },
  async stop({ flags }) { await api("POST", `apps/${appName(flags)}/actions`, { action: "stop" }); console.log(green("✓ ") + "Stopped"); },
  async restart({ flags }) { await api("POST", `apps/${appName(flags)}/actions`, { action: "restart" }); console.log(green("✓ ") + "Restarting"); },
  /** gereh db list | backups <db> | backup <db> [--wait] [--download [file]] */
  async db({ pos, flags }) {
    const [sub = "list", db] = pos;
    if (sub === "list" || sub === "ls") {
      const { data } = await api("GET", "databases");
      if (!data.length) return console.log("No databases yet.");
      for (const d of data) console.log(bold(d.name.padEnd(24)) + " " + (d.status === "running" ? green(d.status) : d.status).padEnd(color ? 18 : 9) + " " + dim(d.engine + " " + d.version));
      return;
    }
    if (!db) die("Usage: gereh db " + sub + " <database>");
    if (sub === "backups") {
      const { data } = await api("GET", `databases/${enc(db)}/backups`);
      for (const b of data) console.log(b.id.padEnd(20) + " " + b.kind.padEnd(7) + " " + b.status.padEnd(8) + " " + dim(b.size_mb + " MB  " + b.created_at));
      return;
    }
    if (sub !== "backup") die("Usage: gereh db list | backups <db> | backup <db> [--wait] [--download [file]]");
    const { id } = await api("POST", `databases/${enc(db)}/backups`, {});
    console.log(cyan("==> ") + "Backup " + id + " started");
    if (!flags.wait && !flags.download) return;
    let b;
    for (;;) { b = await api("GET", `databases/${enc(db)}/backups/${id}`); if (b.status !== "running") break; await sleep(3000); }
    if (b.status !== "done") die("Backup failed.");
    console.log(green("✓ ") + "Backup done (" + b.size_mb + " MB)");
    if (flags.download) {
      const { url } = await api("POST", `databases/${enc(db)}/backups/${id}/download`, {});
      const file = str(flags.file) || pos[2] || `${db}-${id}.dump`;
      const res = await fetch(url);
      if (!res.ok) die("Download failed (HTTP " + res.status + ")");
      writeFileSync(file, Buffer.from(await res.arrayBuffer()), { mode: 0o600 });
      console.log(green("✓ ") + "Saved " + file);
    }
  },
  /** gereh bucket list | create <name> | ls <bucket> [prefix] | put <bucket> <file> [key] | get <bucket> <key> [file] | rm <bucket> <key…> */
  async bucket({ pos, flags }) {
    const [sub = "list", bucket, ...rest] = pos;
    if (sub === "list" || (sub === "ls" && !bucket)) {
      const { data } = await api("GET", "storage/buckets");
      if (!data.length) return console.log("No buckets yet.");
      for (const b of data) console.log(bold(b.name.padEnd(28)) + " " + b.access.padEnd(8) + " " + dim((b.used_bytes / 1024 / 1024).toFixed(1) + " MB / " + (b.size_gb ?? "?") + " GB  " + b.endpoint));
      return;
    }
    if (!bucket) die("Usage: gereh bucket " + sub + " <bucket> …");
    if (sub === "create") {
      const b = await api("POST", "storage/buckets", { name: bucket, plan: str(flags.plan), access: flags.public ? "public" : "private" });
      return console.log(green("✓ ") + "Bucket " + bold(b.name) + " created" + dim(" (" + b.endpoint + ")"));
    }
    if (sub === "ls") {
      let cursor;
      do {
        const r = await api("GET", `storage/buckets/${enc(bucket)}/objects${qs({ prefix: rest[0] || "", cursor })}`);
        for (const f of r.folders) console.log(cyan(f));
        for (const o of r.objects) console.log(String(o.size).padStart(12) + "  " + dim(o.modified) + "  " + o.key);
        cursor = r.next;
      } while (cursor);
      return;
    }
    if (sub === "put") {
      const file = rest[0] || die("Usage: gereh bucket put <bucket> <file> [key]");
      const data = readFileSync(file), key = rest[1] || basename(file);
      const { url } = await api("POST", `storage/buckets/${enc(bucket)}/upload-url`, { key, size: data.length, content_type: str(flags.type) || "application/octet-stream" });
      const res = await fetch(url, { method: "PUT", body: data, headers: { "content-type": str(flags.type) || "application/octet-stream" } });
      if (!res.ok) die("Upload failed (HTTP " + res.status + ")");
      return console.log(green("✓ ") + "Uploaded " + key + dim(" (" + data.length + " bytes)"));
    }
    if (sub === "get") {
      const key = rest[0] || die("Usage: gereh bucket get <bucket> <key> [file]");
      const { url } = await api("POST", `storage/buckets/${enc(bucket)}/download-url`, { key });
      const res = await fetch(url);
      if (!res.ok) die("Download failed (HTTP " + res.status + ")");
      const out = rest[1] || basename(key);
      writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      return console.log(green("✓ ") + "Saved " + out);
    }
    if (sub === "rm") {
      if (!rest.length) die("Usage: gereh bucket rm <bucket> <key> [key2…]   (a key ending in / removes the folder)");
      await api("DELETE", `storage/buckets/${enc(bucket)}/objects${qs({ key: rest.join(",") })}`);
      return console.log(green("✓ ") + "Removed " + rest.join(", "));
    }
    die("Usage: gereh bucket list|create|ls|put|get|rm …");
  },
  /** gereh mail domains | send --domain d --from a --to b --subject s [--text t | --html-file f] */
  async mail({ pos, flags }) {
    const [sub = "domains"] = pos;
    if (sub === "domains") {
      const { data } = await api("GET", "mail/domains");
      if (!data.length) return console.log("No mail domains yet. Add one in " + cyan(ORIGIN + "/panel/mail"));
      for (const d of data) console.log(bold(d.domain.padEnd(32)) + " " + (d.status === "active" ? green(d.status) : d.status) + dim("  " + d.mode));
      return;
    }
    if (sub !== "send") die("Usage: gereh mail domains | send …");
    const from = str(flags.from) || die("--from is required (an address on the domain)");
    const domain = str(flags.domain) || from.split("@")[1];
    const to = str(flags.to) || die("--to is required (comma-separated for several)");
    let text = str(flags.text), html = str(flags["html-file"]) ? readFileSync(flags["html-file"], "utf8") : undefined;
    if (!text && !html && !process.stdin.isTTY) text = readFileSync(0, "utf8");
    if (!text && !html) die("Pass --text, --html-file or pipe the body on stdin");
    const r = await api("POST", `mail/domains/${enc(domain)}/send`, { from, to: to.split(",").map((s) => s.trim()), subject: str(flags.subject) || "", text, html });
    console.log(green("✓ ") + "Queued" + (r.id ? dim(" " + r.id) : ""));
  },
  /** connects coding agents (Claude Code, Cursor, VS Code, Codex) to the Gereh MCP server */
  async setup({ pos, flags }) {
    if (pos[0] !== "agent") die("Usage: gereh setup agent [claude|cursor|vscode|codex]");
    const t = token();
    const me = await api("GET", "account");
    const url = ORIGIN + "/api/mcp";
    const want = pos[1] ? [pos[1]] : ["claude", "cursor", "vscode", "codex"];
    const has = (bin) => { try { execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };
    const mergeJson = (file, key, name, value) => {
      let j = {};
      try { j = JSON.parse(readFileSync(file, "utf8")); } catch { /* new file */ }
      j[key] = { ...(j[key] || {}), [name]: value };
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(j, null, 2) + "\n", { mode: 0o600 });
    };
    const done = [];
    for (const a of want) {
      if (a === "claude") {
        if (!has("claude")) { if (pos[1]) console.log(dim("  Claude Code not found (npm i -g @anthropic-ai/claude-code)")); continue; }
        try { execFileSync("claude", ["mcp", "remove", "--scope", "user", "gereh"], { stdio: "ignore" }); } catch { /* not added yet */ }
        execFileSync("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "gereh", url, "--header", "Authorization: Bearer " + t], { stdio: "inherit" });
        done.push("Claude Code");
      } else if (a === "cursor") {
        const dir = join(homedir(), ".cursor");
        if (!existsSync(dir) && !pos[1]) continue;
        mergeJson(join(dir, "mcp.json"), "mcpServers", "gereh", { url, headers: { Authorization: "Bearer " + t } });
        done.push("Cursor (~/.cursor/mcp.json)");
      } else if (a === "vscode") {
        if (!existsSync(".vscode") && !pos[1]) continue;
        const file = join(".vscode", "mcp.json");
        let j = {};
        try { j = JSON.parse(readFileSync(file, "utf8")); } catch { /* new file */ }
        j.inputs = [...(j.inputs || []).filter((i) => i.id !== "gereh-token"), { type: "promptString", id: "gereh-token", description: "Gereh API token (grh_…)", password: true }];
        j.servers = { ...(j.servers || {}), gereh: { type: "http", url, headers: { Authorization: "Bearer ${input:gereh-token}" } } };
        mkdirSync(".vscode", { recursive: true });
        writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
        done.push("VS Code (.vscode/mcp.json — asks for the token on first use)");
      } else if (a === "codex") {
        const file = join(homedir(), ".codex", "config.toml");
        if (!existsSync(join(homedir(), ".codex")) && !pos[1]) continue;
        const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
        if (!/^\[mcp_servers\.gereh\]/m.test(cur)) {
          mkdirSync(join(file, ".."), { recursive: true });
          writeFileSync(file, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + `\n[mcp_servers.gereh]\nurl = "${url}"\nbearer_token_env_var = "GEREH_TOKEN"\n`);
        }
        done.push("Codex (~/.codex/config.toml; export GEREH_TOKEN before starting codex)");
      } else die("Unknown agent " + a + " (claude, cursor, vscode, codex)");
    }
    if (!done.length) die("No supported agent found. Run `gereh setup agent claude|cursor|vscode|codex`, or see " + ORIGIN + "/docs/mcp");
    for (const d of done) console.log(green("✓ ") + d);
    console.log(dim("Connected as " + me.name + ". Ask your agent e.g. “list my Gereh apps and check the last deployment”."));
    if (flags.verbose) console.log(dim("MCP endpoint: " + url));
  },
  help() {
    console.log(`${bold("gereh")} ${VERSION} — Gereh Apps from your terminal

  gereh login [--token grh_…] [--api URL]   save a read-write API token (in the current profile)
  gereh profile list | use <name> | add <name> [--api URL] [--token grh_…] | remove <name>
  gereh init [--app name] [--yes]           write gereh.json (app, start, port, health, release)
  gereh link <app>                          link this folder to an existing app
  gereh apps                                list your apps
  gereh deploy [-m msg] [--no-cache] [--detach] [--dir path]
               [--image ref | --git url [--branch b]] [--preview [--branch b]]
                                            ZIP apps: pack and upload this folder; Git/image apps: rebuild
  gereh promote [deployment]                release the preview build to production (no rebuild)
  gereh status                              app URL, domains, size and price
  gereh logs [-f|--follow] [--tail n]       runtime logs; --follow streams new lines
  gereh shell [--instance i] [-- command]   run commands in a running instance
  gereh run <command>                       one-off job from the live image (migrations…)
  gereh env set K=V… [--secret] | unset K… | export [--file .env] | import [.env] [--secret]
  gereh db list | backups <db> | backup <db> [--wait] [--download [--file f]]
  gereh bucket list | create <name> [--public] | ls <bucket> [prefix] | put <bucket> <file> [key]
               | get <bucket> <key> [file] | rm <bucket> <key…>
  gereh mail domains | send --from a@dom --to b@x [--subject s] [--text t | --html-file f]
  gereh start | stop | restart
  gereh setup agent [claude|cursor|vscode|codex]   connect coding agents to Gereh (MCP)
  gereh logout

  -a, --app <name>       act on an app other than the linked one
  -p, --profile <name>   use another account (or GEREH_PROFILE)
  Env: GEREH_TOKEN, GEREH_API (default https://gereh.net), GEREH_PROFILE. Ignored on upload: .gerehignore (or .gitignore), node_modules, .git, .env…`);
  },
};

const cmd = POS.shift() || "help";
if (FLAGS.version || cmd === "version" || cmd === "-v") console.log(VERSION);
else if (FLAGS.help || !commands[cmd]) commands.help();
else await commands[cmd]({ pos: POS, flags: FLAGS });
