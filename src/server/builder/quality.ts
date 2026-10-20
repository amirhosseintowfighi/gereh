/* The deterministic quality gate on a project's files: cheap static checks per category (UI, a11y,
   security, backend, performance). Findings go to the run log, the self-review pass and the panel. The
   checks are heuristics: they flag what is almost always a defect and stay quiet otherwise. */
import "server-only";
import type { BuilderStack, QualityCategory, QualityFinding, QualityReport } from "@/lib/builder";
import { baseLang } from "@/lib/site-language";

type Site = { lang: string; dir: "rtl" | "ltr" };
type Add = (rule: string, category: QualityCategory, severity: "error" | "warn", file: string, message: string, hint: string) => void;

const isHtml = (p: string) => /\.html?$/i.test(p);
const isJs = (p: string) => /\.(c|m)?js$/i.test(p);
const isCss = (p: string) => /\.css$/i.test(p);
const attrOf = (tag: string, name: string) => new RegExp("\\s" + name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
const val = (m: RegExpExecArray | null) => (m ? (m[2] ?? m[3] ?? m[4] ?? "") : null);
/** <script> and <style> bodies and HTML comments blanked out, so markup checks do not read code */
const markup = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_m, open: string, _t: string, body: string, close: string) => open + body.replace(/[^\n]/g, " ") + close);
const inlineCode = (html: string) => [...html.matchAll(/<script\b(?![^>]*\bsrc=)(?![^>]*type=["']?(?:application\/ld\+json|text\/tailwindcss))[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
const inlineCss = (html: string) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");

const SECRET_RES: RegExp[] = [
  /\b(?:api[_-]?key|apikey|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|pwd)\b["']?\s*[:=]\s*["'`](?!\s*["'`])(?![^"'`]*\$\{)[^"'`\s]{8,}["'`]/i,
  /\bsk-(?:live|proj|test)?[-_A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{36}\b/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bAIza[0-9A-Za-z_-]{35}\b/, /postgres(?:ql)?:\/\/[^:\s"'/]+:[^@\s"']+@/i,
];

function checkHtml(path: string, html: string, site: Site, add: Add) {
  const m = markup(html);
  const tagHtml = /<html\b[^>]*>/i.exec(m)?.[0];
  if (/<!doctype html|<html\b/i.test(m)) {
    const lang = tagHtml ? val(attrOf(tagHtml, "lang")) : null, dir = tagHtml ? val(attrOf(tagHtml, "dir")) : null;
    if (!lang) add("html-lang", "a11y", "error", path, "زبان صفحه (lang) روی تگ html تعیین نشده است", `Set <html lang="${site.lang}" dir="${site.dir}">.`);
    else if (baseLang(lang) !== baseLang(site.lang)) add("html-lang", "a11y", "error", path, "زبان صفحه (" + lang + ") با زبان سایت (" + site.lang + ") یکی نیست", `The site language is ${site.lang}: use <html lang="${site.lang}"> and write the copy in that language.`);
    if ((dir || "ltr").toLowerCase() !== site.dir) add("html-dir", "ui", "error", path, "جهت صفحه (dir) با زبان سایت سازگار نیست؛ باید " + site.dir + " باشد", `Set dir="${site.dir}" on <html> for ${site.lang}.`);
    if (!/<meta\s[^>]*charset\s*=\s*["']?utf-8/i.test(m)) add("charset", "ui", "error", path, "تگ meta charset=utf-8 وجود ندارد", 'Add <meta charset="utf-8"> as the first element of <head>.');
    const vp = /<meta\s[^>]*name\s*=\s*["']?viewport[^>]*>/i.exec(m)?.[0];
    if (!vp) add("viewport", "ui", "error", path, "تگ viewport برای نمایش درست در موبایل وجود ندارد", 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
    else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(vp)) add("zoom-disabled", "a11y", "error", path, "بزرگ‌نمایی صفحه در موبایل غیرفعال شده است", "Remove user-scalable=no / maximum-scale=1 from the viewport meta.");
    if (!/<title>[^<]{2,}<\/title>/i.test(m)) add("title", "performance", "warn", path, "صفحه عنوان (title) ندارد", "Add a unique, descriptive <title>.");
    if (!/<meta\s[^>]*name\s*=\s*["']?description/i.test(m)) add("meta-description", "performance", "warn", path, "توضیح متا (description) برای موتورهای جستجو ندارد", 'Add <meta name="description" content="…"> in the site language.');
  }
  for (const img of m.matchAll(/<img\b[^>]*>/gi)) {
    if (!attrOf(img[0], "alt")) add("img-alt", "a11y", "error", path, "تصویری بدون متن جایگزین (alt) وجود دارد", 'Give every <img> an alt (alt="" when decorative).');
    if (!attrOf(img[0], "width") && !attrOf(img[0], "height") && !/aspect-|style=["'][^"']*aspect-ratio/i.test(img[0])) add("img-size", "performance", "warn", path, "ابعاد تصویر مشخص نیست و صفحه هنگام بارگذاری جابه‌جا می‌شود", "Set width and height (or aspect-ratio) on images to avoid layout shift.");
  }
  // labels: <label for>, a wrapping <label>, aria-label(ledby) or a title
  const fors = new Set([...m.matchAll(/<label\b[^>]*\sfor\s*=\s*["']?([^"'\s>]+)/gi)].map((x) => x[1]));
  for (const f of m.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = f[0];
    const type = (val(attrOf(tag, "type")) ?? "text").toLowerCase();
    if (f[1].toLowerCase() === "input" && ["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    if (attrOf(tag, "aria-label") || attrOf(tag, "aria-labelledby") || attrOf(tag, "title")) continue;
    const id = val(attrOf(tag, "id"));
    if (id && fors.has(id)) continue;
    const before = m.slice(0, f.index);
    const open = before.lastIndexOf("<label"), close = before.lastIndexOf("</label");
    if (open > close) continue;
    add("input-label", "a11y", "error", path, "فیلد فرمی بدون برچسب (label) وجود دارد", "Every input, select and textarea needs a visible <label for=id> (or a wrapping <label>).");
  }
  for (const a of m.matchAll(/<a\b[^>]*target\s*=\s*["']?_blank[^>]*>/gi)) {
    const rel = (val(attrOf(a[0], "rel")) ?? "").toLowerCase();
    if (!/noopener|noreferrer/.test(rel)) add("blank-noopener", "security", "error", path, "پیوند target=_blank بدون rel=noopener است", 'Add rel="noopener noreferrer" to links with target="_blank".');
  }
  if (/\son[a-z]+\s*=\s*["'][^"']+["']/i.test(m)) add("inline-handler", "security", "warn", path, "کد جاوااسکریپت درون‌خطی (onclick=…) مانع سیاست امنیت محتوا (CSP) می‌شود", "Move inline on* handlers into a .js file with addEventListener (keeps CSP free of unsafe-inline).");
  const httpAssets = (m.match(/<(?:script|img|iframe|audio|video|source|embed)\b[^>]*\ssrc\s*=\s*["']?http:\/\//gi) ?? []).length
    + [...m.matchAll(/<link\b[^>]*\shref\s*=\s*["']?http:\/\/[^>]*>/gi)].filter((l) => /stylesheet|icon|preload|manifest/i.test(l[0])).length;
  for (let i = 0; i < httpAssets; i++) add("http-asset", "security", "error", path, "منبعی با http ناامن بارگذاری می‌شود", "Load every asset over https (or relatively); no http:// URLs.");
  for (const w of m.matchAll(/\b(?:min-)?w-\[(\d{3,})px\]/g)) if (Number(w[1]) > 400) { add("fixed-width", "ui", "warn", path, "عرض ثابت بزرگ (" + w[1] + "px) در موبایل باعث اسکرول افقی می‌شود", "Replace fixed pixel widths with w-full plus max-w-*."); break; }
  checkCode(path, inlineCode(html), add);
  checkCss(path, inlineCss(html), add);
}

function checkCode(path: string, code: string, add: Add) {
  if (!code.trim()) return;
  const src = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  if (/(^|[^.\w$])eval\s*\(|new\s+Function\s*\(|set(?:Timeout|Interval)\s*\(\s*["'`]/.test(src)) add("eval", "security", "error", path, "استفاده از eval یا new Function (اجرای کد از رشته)", "Remove eval / new Function / string timers; call functions directly.");
  // innerHTML with interpolated data (a template with ${…} or string concatenation)
  if (/\.(?:inner|outer)HTML\s*\+?=\s*(?:`[^`]*\$\{|[^;\n]*["'`]\s*\+\s*[\w$(]|[^;\n]*[\w$)\]]\s*\+\s*["'`]|\s*[\w$.]+\s*;)/.test(src) || /insertAdjacentHTML\s*\([^)]*(?:\$\{|\+)/.test(src) || /document\.write(?:ln)?\s*\(/.test(src))
    add("innerhtml", "security", "error", path, "داده با innerHTML در صفحه درج می‌شود (خطر XSS)", "Build DOM nodes and set textContent instead of innerHTML/insertAdjacentHTML/document.write with data.");
}

function checkCss(path: string, css: string, add: Add) {
  if (!css.trim()) return;
  for (const w of css.matchAll(/(?:^|[;{\s])(?:min-)?width\s*:\s*(\d{3,})px/g)) {
    if (Number(w[1]) > 400) { add("fixed-width", "ui", "warn", path, "عرض ثابت بزرگ (" + w[1] + "px) در موبایل باعث اسکرول افقی می‌شود", "Use max-width with width: 100% instead of fixed pixel widths."); break; }
  }
  if (/url\(\s*["']?http:\/\//i.test(css)) add("http-asset", "security", "error", path, "منبعی با http ناامن بارگذاری می‌شود", "Load every asset over https (or relatively); no http:// URLs.");
  if (/outline\s*:\s*(none|0)\b/.test(css) && !/:focus-visible/.test(css)) add("focus-outline", "a11y", "warn", path, "حاشیه فوکوس حذف شده و جایگزینی ندارد", "Do not remove focus outlines without a visible :focus-visible style.");
}

/** the server's entry file (from the start script, else server.js) */
const entryOf = (files: Record<string, string>) => {
  try { const s = /node\s+([\w./-]+\.(?:c|m)?js)/.exec(JSON.parse(files["package.json"] ?? "{}")?.scripts?.start ?? "")?.[1]?.replace(/^\.\//, ""); if (s && files[s]) return s; } catch { /* checked below */ }
  return files["server.js"] !== undefined ? "server.js" : null;
};

function checkServer(files: Record<string, string>, add: Add) {
  const entry = entryOf(files);
  const server = Object.entries(files).filter(([p]) => isJs(p) && !p.startsWith("public/")).map(([, c]) => c).join("\n");
  const at = entry ?? "server.js";
  if (!entry) { add("server-entry", "backend", "error", at, "فایل سرور (server.js) پیدا نشد", "Add server.js and a start script that runs it."); return; }
  if (!/helmet\s*\(|x-content-type-options/i.test(server)) add("security-headers", "security", "error", at, "سرور هدرهای امنیتی (مثل X-Content-Type-Options و CSP) را تنظیم نمی‌کند", "Set security headers in a middleware: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy and a Content-Security-Policy; disable x-powered-by.");
  if (!/process\.env\.PORT/.test(server)) add("port-env", "backend", "error", at, "پورت از متغیر PORT خوانده نمی‌شود", "Listen on Number(process.env.PORT) || 8080 and host 0.0.0.0.");
  if (!/SIGTERM/.test(server)) add("sigterm", "backend", "warn", at, "خاموش شدن تمیز (SIGTERM) مدیریت نمی‌شود", 'Handle process.on("SIGTERM"): server.close(), end the DB pool, then exit.');
  if (!/["'`]\/healthz["'`]/.test(server)) add("health", "backend", "warn", at, "مسیر بررسی سلامت /healthz تعریف نشده است", 'Add app.get("/healthz", (req, res) => res.json({ ok: true })) before other routes.');
  const writes = /\.(post|put|patch)\s*\(/.test(server);
  if (writes && /req\.body/.test(server) && !/\.trim\(\)|\.length\s*[<>]|\.test\(|typeof\s|\.slice\(\s*0|validate|zod|joi|safeParse|Number\.isFinite|Array\.isArray/.test(server))
    add("validation", "backend", "error", at, "ورودی درخواست‌ها روی سرور اعتبارسنجی نمی‌شود", "Validate req.body at the edge: types, required fields, length limits, formats; answer 400 with a JSON error.");
  if (writes && !/express\.json\(\s*\{[^}]*limit/.test(server) && /express\.json\(/.test(server)) add("body-limit", "security", "warn", at, "حجم بدنه درخواست محدود نشده است", 'Use express.json({ limit: "100kb" }).');
  if (/console\.\w+\([^)\n]*process\.env(?!\.(?:PORT|NODE_ENV)\b)|console\.\w+\([^)\n]*\b(?:DATABASE_URL|req\.headers|password)\b(?!["'`])/.test(server.replace(/["'`][^"'`\n]*["'`]/g, '""')))
    add("log-secrets", "security", "error", at, "متغیرهای محیطی یا داده حساس در لاگ چاپ می‌شود", "Never log process.env, connection strings, headers or passwords.");
  if (/(?:query|execute)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/.test(server)) add("sql-concat", "security", "error", at, "پرس‌وجوی SQL با چسباندن رشته ساخته می‌شود (خطر تزریق SQL)", "Use parameterized queries ($1, $2) instead of building SQL strings with data.");
  if (/res\.(?:send|json)\([^)\n]*(?:err|e|error)\.stack/.test(server)) add("error-leak", "security", "error", at, "جزئیات خطا (stack) به کاربر برگردانده می‌شود", "Answer a generic error message; keep details in server logs.");
}

function checkPackage(files: Record<string, string>, add: Add) {
  const raw = files["package.json"];
  if (raw === undefined) return;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };
  try { pkg = JSON.parse(raw); } catch { add("package-json", "backend", "error", "package.json", "فایل package.json معتبر نیست", "Fix package.json: it must be valid JSON."); return; }
  const deps = pkg.dependencies ?? {};
  const loose = Object.entries(deps).filter(([, v]) => !/^[\^~]?\d+(\.\d+){0,2}(-[\w.]+)?$/.test(String(v).trim()));
  if (loose.length) add("deps-pinned", "security", "error", "package.json", "نسخه بسته‌ها مشخص نیست: " + loose.map(([k]) => k).join("، "), "Pin every dependency to a version range like ^4.21.2; no *, latest, git or URL versions.");
  if (Object.keys(deps).length > 12) add("deps-minimal", "security", "warn", "package.json", "تعداد بسته‌ها زیاد است (" + Object.keys(deps).length + ")", "Keep dependencies minimal; remove what Node or the browser already provides.");
  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length) add("dev-deps", "backend", "warn", "package.json", "devDependencies در اپ بدون مرحله بیلد لازم نیست", "Remove devDependencies (there is no build step).");
  if (pkg.scripts && Object.keys(pkg.scripts).some((k) => /^(pre|post)?install$/.test(k))) add("install-script", "security", "error", "package.json", "اسکریپت نصب (install) در package.json اجرا می‌شود", "Remove install/postinstall scripts.");
}

const WEIGHT = { error: 25, warn: 8 };
export function scoreOf(findings: QualityFinding[], stack: BuilderStack) {
  const cats: QualityCategory[] = ["ui", "a11y", "security", "backend", "performance"];
  const scores = Object.fromEntries(cats.map((c) => [c, c === "backend" && stack === "static" ? null : Math.max(0, 100 - findings.filter((f) => f.category === c).reduce((s, f) => s + WEIGHT[f.severity] * Math.min(f.count, 2), 0))])) as Record<QualityCategory, number | null>;
  const vals = Object.values(scores).filter((v): v is number => v !== null);
  return { scores, score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) };
}

/** every check on a snapshot; site = the language the pages must declare */
export function checkFiles(files: Record<string, string>, stack: BuilderStack, site: Site): QualityReport {
  const found = new Map<string, QualityFinding>();
  const add: Add = (rule, category, severity, file, message, hint) => {
    const key = rule + "|" + file;
    const f = found.get(key);
    if (f) f.count++;
    else found.set(key, { rule, category, severity, file, message, hint, count: 1 });
  };
  for (const [path, content] of Object.entries(files)) {
    if (isHtml(path)) checkHtml(path, content, site, add);
    else if (isJs(path)) checkCode(path, content, add);
    else if (isCss(path)) checkCss(path, content, add);
    if (!/\.(md|txt)$/i.test(path) && SECRET_RES.some((re) => re.test(content))) add("secret", "security", "error", path, "یک کلید، توکن یا رمز به‌صورت مستقیم در کد نوشته شده است", "Remove the hard-coded secret; read it from process.env on the server only.");
  }
  if (stack === "node") { checkServer(files, add); checkPackage(files, add); }
  const findings = [...found.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)).slice(0, 40);
  return { ...scoreOf(findings, stack), findings, before: null, review: null };
}

export const errorsOf = (r: QualityReport) => r.findings.filter((f) => f.severity === "error").length;

/** one line per finding for the run log */
export const qualityLog = (r: QualityReport) =>
  "بررسی کیفیت: امتیاز " + r.score.toLocaleString("fa-IR") + " از ۱۰۰" + (r.findings.length ? "\n" + r.findings.map((f) => "- " + (f.severity === "error" ? "خطا" : "هشدار") + " (" + f.file + "): " + f.message + (f.count > 1 ? " ×" + f.count.toLocaleString("fa-IR") : "")).join("\n") : "؛ مشکلی پیدا نشد.");
