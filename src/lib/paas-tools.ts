/* Gereh Apps operator tools shared by the server and the panel: disk and mount rules, file paths,
   log levels and retention, metric ranges, .env files and links to a release's commit. */

/* ---------- disks ---------- */
export const DISK_NAME_RE = /^[a-z][a-z0-9-]{0,18}[a-z0-9]$/;
export const MAX_DISKS = 5;
export const MAX_DISK_GB = 500;
export const DISK_SIZES = [1, 5, 10, 20, 50, 100, 200, 500];
/** directories of the image a disk must never hide; their subdirectories are fine unless SYSTEM_TREES */
const SYSTEM_DIRS = new Set(["/app", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib32", "/lib64", "/libx32", "/media", "/mnt", "/opt", "/proc", "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var", "/workspace", "/var/lib", "/var/run", "/var/log", "/usr/local", "/etc/gereh"]);
/** whole trees that belong to the operating system */
const SYSTEM_TREES = ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/proc", "/run", "/sbin", "/sys", "/usr", "/var/run", "/var/lib/dpkg", "/var/lib/apt"];

/** why a mount path is not allowed (null when it is) */
export function mountError(p: string): string | null {
  if (!p.startsWith("/")) return "مسیر اتصال باید با / شروع شود؛ مثل /data یا /var/www/html/uploads";
  if (p.length > 200 || !/^(\/[A-Za-z0-9._-]+)+$/.test(p)) return "مسیر اتصال فقط حروف انگلیسی، عدد و . _ - با جداکننده / (بدون / پایانی).";
  if (p.split("/").some((s) => s === "." || s === "..")) return "مسیر اتصال نباید . یا .. داشته باشد.";
  if (SYSTEM_DIRS.has(p) || SYSTEM_TREES.some((t) => p === t || p.startsWith(t + "/"))) return "مسیر " + p + " از پوشه‌های سیستم است؛ زیرپوشه‌ای مثل /data یا /app/storage انتخاب کنید.";
  return null;
}
/** one mount inside the other (or the same) */
export const mountsOverlap = (a: string, b: string) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");

/** Kubernetes volume and PVC names; "data" keeps the original single-disk names */
export const diskVolume = (disk: string) => (disk === "data" ? "data" : "disk-" + disk);
export const diskClaim = (app: string, disk: string) => app + (disk === "data" ? "-data" : "-disk-" + disk);

/* ---------- file manager ---------- */
export const MAX_EDIT_BYTES = 1024 * 1024;
export const MAX_FILE_UPLOAD = 200 * 1024 * 1024;
/** a path inside a disk, normalised to "a/b/c" ("" is the disk's root); null when it leaves the disk */
export function relPath(p: string): string | null {
  if (p.length > 1024 || /[\0\n\r]/.test(p)) return null;
  const out: string[] = [];
  for (const s of p.replace(/\\/g, "/").split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") return null;
    out.push(s);
  }
  return out.join("/");
}
export const fileName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
export const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
/** a single file or folder name */
export const nameError = (n: string) => !n || n === "." || n === ".." || n.length > 255 || /[/\\\0\n\r]/.test(n) ? "نام معتبر نیست." : null;
const TEXT_EXT = /\.(txt|md|json|ya?ml|toml|ini|conf|cfg|env|js|mjs|cjs|ts|tsx|jsx|css|scss|html?|xml|svg|php|py|rb|go|rs|java|kt|cs|sh|sql|csv|log|htaccess|lock|gitignore|dockerignore)$/i;
export const editable = (name: string, size: number) => size <= MAX_EDIT_BYTES && (TEXT_EXT.test(name) || !name.includes("."));

/* ---------- SFTP ---------- */
export const SFTP_USER_RE = /^[a-z][a-z0-9_]{2,30}$/;
export const MAX_SFTP_USERS = 10;

/* ---------- logs ---------- */
export type LogLevel = "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: { id: LogLevel; label: string }[] = [
  { id: "error", label: "خطا" }, { id: "warn", label: "هشدار" }, { id: "info", label: "اطلاعات" }, { id: "debug", label: "اشکال‌زدایی" },
];
export const LOG_DAYS = [7, 30, 60];
/** default retention of the seeded app plans */
export const PLAN_LOG_DAYS: Record<string, number> = { "app-nano": 7, "app-micro": 7, "app-small": 30, "app-medium": 30, "app-large": 60, "app-xlarge": 60 };
/** level of a log line: explicit level words, JSON "level" fields, HTTP status codes */
export function logLevel(line: string): LogLevel {
  const j = /"(?:level|severity|lvl)"\s*:\s*"?(\w+)/i.exec(line)?.[1]?.toLowerCase();
  const w = j ?? /\b(fatal|panic|critical|crit|error|err|exception|traceback|warning|warn|debug|trace)\b/i.exec(line)?.[1]?.toLowerCase();
  if (w) {
    if (/^(fatal|panic|critical|crit|error|err|exception|traceback|50|60)$/.test(w)) return "error";
    if (/^(warning|warn|40)$/.test(w)) return "warn";
    if (/^(debug|trace|10|20)$/.test(w)) return "debug";
    if (/^(info|30|notice)$/.test(w)) return "info";
  }
  const http = /\s(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s\S+\s(\d{3})\b/.exec(line)?.[1];
  if (http) return http >= "500" ? "error" : http >= "400" ? "warn" : "info";
  return "info";
}
export const MAX_LOG_EXPORT = 100_000;

/* ---------- metrics ---------- */
export type MetricRange = "1h" | "24h" | "7d" | "30d";
/** span, bucket width and the table read: 5-minute samples (8 days) or hourly averages (31 days) */
export const METRIC_RANGES: Record<MetricRange, { label: string; ms: number; bucketSec: number; hourly: boolean }> = {
  "1h": { label: "۱ ساعت", ms: 3600_000, bucketSec: 300, hourly: false },
  "24h": { label: "۲۴ ساعت", ms: 86400_000, bucketSec: 900, hourly: false },
  "7d": { label: "۷ روز", ms: 7 * 86400_000, bucketSec: 7200, hourly: false },
  "30d": { label: "۳۰ روز", ms: 30 * 86400_000, bucketSec: 21600, hourly: true },
};

/* ---------- .env ---------- */
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?$/;
/** KEY=value lines: comments, blank lines and `export` are allowed; quoted values may hold \n escapes */
export function parseDotenv(text: string): { vars: { key: string; value: string }[]; errors: string[] } {
  const vars = new Map<string, string>(), errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const m = ENV_LINE.exec(raw);
    if (!m) { errors.push("خط " + (i + 1) + ": " + raw.trim().slice(0, 40)); continue; }
    let v = (m[2] ?? "").trim();
    if (v.startsWith('"')) {
      // a double-quoted value may continue on the next lines
      while (!/^"(?:[^"\\]|\\.)*"/.test(v) && i + 1 < lines.length) v += "\n" + lines[++i];
      const q = /^"((?:[^"\\]|\\.)*)"/.exec(v);
      v = q ? q[1].replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\(["\\$])/g, "$1") : v.slice(1);
    } else if (v.startsWith("'")) {
      const q = /^'([^']*)'/.exec(v);
      v = q ? q[1] : v.slice(1);
    } else v = v.replace(/\s+#.*$/, "");
    vars.set(m[1], v);
  }
  return { vars: [...vars].map(([key, value]) => ({ key, value })), errors };
}
/** one KEY=value per line, quoted when the value needs it */
export function toDotenv(rows: { key: string; value: string | null; secret?: boolean }[]) {
  return rows.map((r) => {
    if (r.value === null) return "# " + r.key + " is secret (not exported)\n" + r.key + "=";
    const v = r.value;
    return r.key + "=" + (/^[\w./:@%+,-]*$/.test(v) ? v : '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"');
  }).join("\n") + (rows.length ? "\n" : "");
}

/* ---------- releases ---------- */
/** web links of a commit and its source archive for GitHub, GitLab, Gitea and Bitbucket HTTPS remotes */
export function commitLinks(gitUrl: string, sha: string): { commit: string; archive: string } | null {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  const m = /^https:\/\/([\w.-]+(?::\d+)?)\/([\w./~-]+?)(?:\.git)?\/?$/.exec(gitUrl) ?? /^git@([\w.-]+):([\w./~-]+?)(?:\.git)?$/.exec(gitUrl);
  if (!m) return null;
  const base = "https://" + m[1] + "/" + m[2], repo = m[2].split("/").pop()!;
  if (/(^|\.)gitlab\./.test(m[1]) || m[1] === "gitlab.com") return { commit: base + "/-/commit/" + sha, archive: base + "/-/archive/" + sha + "/" + repo + "-" + sha + ".zip" };
  if (m[1] === "bitbucket.org") return { commit: base + "/commits/" + sha, archive: base + "/get/" + sha + ".zip" };
  // GitHub, Gitea and Forgejo share these paths
  return { commit: base + "/commit/" + sha, archive: base + "/archive/" + sha + ".zip" };
}
