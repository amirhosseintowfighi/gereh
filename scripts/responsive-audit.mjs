#!/usr/bin/env node
/* Responsive audit: visits every route (public, auth, panel, admin) at several widths and reports
   horizontal page overflow, elements that stick out of the viewport, overlapping text, clipped
   buttons, console/page errors and broken same-origin links. Screenshots go next to the report.

   Start a server with the demo seed first, e.g.
     E2E=1 SEED_DEMO=1 PAY_SIMULATOR=1 WORKER=0 npx next dev -p 3210
   then
     BASE_URL=http://localhost:3210 node scripts/responsive-audit.mjs

   Environment:
     BASE_URL      server to audit (default http://localhost:3210)
     BROWSER       chromium (default) | firefox | webkit
     CHROMIUM_PATH preinstalled Chromium (default: Playwright's own lookup)
     WIDTHS        comma separated (default 360,390,768,1024,1440)
     ONLY          regular expression; only routes matching it are visited
     TABS          0 = do not click through tab bars (default 1)
     SHOTS         0 = no screenshots, "tabs" = also one per tab (default 1)
     OUT           output folder (default test-results/responsive)
   Exit code 1 when anything is reported. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as pw from "playwright";

const BASE = (process.env.BASE_URL || "http://localhost:3210").replace(/\/$/, "");
const WIDTHS = (process.env.WIDTHS || "360,390,768,1024,1440").split(",").map(Number);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const OUT = process.env.OUT || "test-results/responsive";
const SHOTS = process.env.SHOTS ?? "1";
const TABS = process.env.TABS !== "0";
const browserName = process.env.BROWSER || "chromium";
const PASSWORD = "Demo1234!";

// ---------- routes ----------
const PUBLIC = [
  "/", "/about", "/ai-api", "/blog", "/blog/nvme-vs-ssd", "/blog/tag/" + encodeURIComponent("سرور ابری"), "/compare", "/contact",
  "/devops", "/devops/ci-cd", "/docs/ai-api", "/docs/api", "/docs/geo-dns", "/docs/inquiry", "/docs/mcp", "/docs/paas", "/docs/paas/ci-cd",
  "/domains", "/domains/ir", "/domains?q=novinbrand.ir", "/geo-dns", "/hosting", "/inquiry", "/kb", "/kb/connect-to-server-ssh", "/mail", "/mirror",
  "/paas", "/paas/nextjs", "/paas/databases", "/pricing/calculator", "/privacy", "/sla", "/status", "/storage", "/terms", "/vps", "/wordpress",
  "/en", "/en/about", "/en/devops", "/en/domains", "/en/hosting", "/en/paas", "/en/vps",
  "/auth", "/auth?mode=register", "/team/accept?token=demo", "/pay/sim", "/not-a-page",
];
const PANEL = (ids) => [
  "/panel", "/panel/account", "/panel/affiliate", "/panel/ai", "/panel/apps", "/panel/apps/new", "/panel/apps/stack", "/panel/apps/templates",
  "/panel/apps/" + ids.app, "/panel/billing", "/panel/billing/" + ids.invoice + "/print", "/panel/databases", "/panel/databases/" + ids.db,
  "/panel/devops", "/panel/domains", "/panel/domains/" + ids.domain, "/panel/geo", "/panel/geo/" + ids.geo, "/panel/hosting", "/panel/hosting/" + ids.hosting,
  "/panel/inquiry", "/panel/keys", "/panel/mail", "/panel/mail/" + ids.mail, "/panel/servers", "/panel/servers/" + ids.server,
  "/panel/servers/" + ids.server + "/console", "/panel/storage", "/panel/storage/" + ids.bucket, "/panel/tickets", "/panel/tickets/" + ids.ticket, "/panel/wordpress",
];
const ADMIN = (ids) => [
  "/admin", "/admin/ai", "/admin/announcements", "/admin/audit", "/admin/billing", "/admin/blog", "/admin/chats", "/admin/coupons", "/admin/devops",
  "/admin/domains", "/admin/geo", "/admin/infra", "/admin/inquiry", "/admin/mail", "/admin/orders", "/admin/paas", "/admin/products", "/admin/reports", "/admin/services",
  "/admin/settings", "/admin/status", "/admin/storage", "/admin/tickets", "/admin/tickets/" + ids.ticket, "/admin/users", "/admin/virtualizor", "/admin/vps-billing",
];

// ---------- in-page checks ----------
/* runs in the page; returns { overflow, offenders, overlaps, clipped } */
function inspect() {
  const vw = document.documentElement.clientWidth;
  const res = { scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth, offenders: [], overlaps: [], clipped: [] };
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = (typeof el.className === "string" ? el.className : el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
    if (cls.length) s += "." + cls.join(".");
    const t = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return t ? s + ` "${t}"` : s;
  };
  const visible = (el) => {
    for (let e = el, child = null; e && e !== document.documentElement; child = e, e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      if (e.tagName === "NEXTJS-PORTAL") return false;
      if (e.tagName === "DETAILS" && !e.open && child && child.tagName !== "SUMMARY") return false; // collapsed answer
      if (cs.overflow !== "visible" || cs.clip !== "auto" && cs.clip !== "") { const r = e.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false; } // sr-only
    }
    return true;
  };
  // an ancestor (other than html/body, whose overflow is propagated to the viewport) that clips or scrolls
  const clipper = (el, self = false) => {
    for (let e = self ? el : el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const ox = getComputedStyle(e).overflowX;
      if (ox !== "visible") return e;
    }
    return null;
  };
  const fixedAncestor = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") return e; }
    return null;
  };
  const isSrOnly = (r) => r.width <= 1 || r.height <= 1;

  // 1. elements sticking out of the viewport sideways (hidden by body's overflow-x, but cut off for the user)
  const all = document.body.querySelectorAll("*");
  const out = new Set();
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || isSrOnly(r)) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (clipper(el)) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" && (r.right <= 0 || r.left >= vw)) continue; // off-canvas drawer, fully hidden
    if (el.closest("[inert]")) continue;
    out.add(el);
  }
  for (const el of out) {
    if (el.parentElement && out.has(el.parentElement)) continue; // report the outermost one
    const r = el.getBoundingClientRect();
    res.offenders.push({ el: describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  }

  // 2. overlapping text: compare the boxes of text runs from different elements
  const runs = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const range = document.createRange();
  const visCache = new Map();
  const vis = (el) => { if (!visCache.has(el)) visCache.set(el, visible(el)); return visCache.get(el); };
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,svg,nextjs-portal,option,select,textarea,input,[aria-hidden='true']")) continue;
    if (!vis(el)) continue;
    if (fixedAncestor(el)) continue;
    range.selectNodeContents(n);
    const clip = clipper(el, true), c = clip?.getBoundingClientRect();
    for (const raw of range.getClientRects()) {
      // only the part a clipping/scrolling parent lets through is visible
      const r = c ? { left: Math.max(raw.left, c.left), right: Math.min(raw.right, c.right), top: Math.max(raw.top, c.top), bottom: Math.min(raw.bottom, c.bottom) } : { left: raw.left, right: raw.right, top: raw.top, bottom: raw.bottom };
      r.width = r.right - r.left; r.height = r.bottom - r.top;
      if (r.width < 4 || r.height < 4) continue;
      runs.push({ el, r });
    }
  }
  const seen = new Set();
  const cell = 64, grid = new Map();
  runs.forEach((x, i) => {
    for (let gx = Math.floor(x.r.left / cell); gx <= Math.floor(x.r.right / cell); gx++)
      for (let gy = Math.floor((x.r.top + scrollY) / cell); gy <= Math.floor((x.r.bottom + scrollY) / cell); gy++) {
        const k = gx + ":" + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
  });
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = runs[list[a]], B = runs[list[b]];
      if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const w = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left), h = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (w <= 2 || h <= 2) continue;
      const small = Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
      if ((w * h) / small < 0.25) continue;
      const key = describe(A.el) + " × " + describe(B.el);
      if (seen.has(key)) continue;
      seen.add(key);
      res.overlaps.push(key);
      if (res.overlaps.length > 30) break;
    }
  }

  // 3. clipped buttons / links / tabs: content wider than the control, or the control cut by a clipping parent
  for (const el of document.body.querySelectorAll("button, a, [role=tab], input[type=submit]")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || isSrOnly(r) || !vis(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.clip !== "auto" && cs.clip !== "" || el.matches(".sr-only, .sr-only-focusable:not(:focus)")) continue;
    if (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis") { res.clipped.push(describe(el) + " (content " + el.scrollWidth + " > " + el.clientWidth + ")"); continue; }
    const c = clipper(el);
    if (c) {
      const ccs = getComputedStyle(c);
      if (ccs.overflowX === "hidden" || ccs.overflowX === "clip") {
        const cr = c.getBoundingClientRect();
        if (r.right > cr.right + 2 || r.left < cr.left - 2) res.clipped.push(describe(el) + " (cut by " + describe(c).slice(0, 60) + ")");
      }
    }
  }
  return res;
}

// ---------- runner ----------
const launch = { chromium: pw.chromium, firefox: pw.firefox, webkit: pw.webkit }[browserName];
const browser = await launch.launch(browserName === "chromium" && process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
mkdirSync(OUT, { recursive: true });

async function rpc(ctx, name, ...args) {
  const r = await ctx.request.post(BASE + "/api/rpc/" + name, { data: { args }, headers: { origin: BASE } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok()) throw new Error(name + ": " + (j.error || r.status()));
  return j.result;
}
async function session(email) {
  const ctx = await browser.newContext({ locale: "fa-IR" });
  if (email) await rpc(ctx, "auth.login", email, PASSWORD);
  return ctx;
}

await (await fetch(BASE + "/api/test", { method: "POST" }).catch(() => null))?.text();
const user = await session("demo@gereh.net");
const admin = await session("admin@gereh.net");
const anon = await session(null);

// demo ids for dynamic routes
const st = await (await user.request.get(BASE + "/api/state?scope=customer")).json();
const d = st.db;
const ids = {
  app: d.paasApps?.[0]?.id, invoice: d.invoices?.[0]?.id, db: d.paasDbs?.[0]?.id, domain: d.domains?.[0]?.id, geo: d.geo?.zones?.[0]?.id,
  hosting: d.hosting?.[0]?.id, server: d.servers?.[0]?.id, ticket: d.tickets?.[0]?.id, mail: "none", bucket: "none",
};
try { const m = await rpc(user, "mail.overview"); ids.mail = m.domains[0]?.id || (await rpc(user, "mail.create", { domain: "mail.audit-demo.ir", planId: m.plans[0].id })).id; } catch (e) { console.warn("mail demo:", e.message); }
try { ids.bucket = d.storage.buckets[0]?.id || await rpc(user, "storage.create", { name: "audit-" + Date.now().toString(36), planId: d.storage.plans[0].id, access: "private" }); } catch (e) { console.warn("storage demo:", e.message); }

const jobs = [
  ...PUBLIC.map((p) => [anon, p]),
  ...PANEL(ids).map((p) => [user, p]),
  ...ADMIN(ids).map((p) => [admin, p]),
].filter(([, p]) => !ONLY || ONLY.test(p));

const report = [];
const links = new Map();
let total = { overflow: 0, offenders: 0, overlaps: 0, clipped: 0, errors: 0 };
const slug = (p) => (p.replace(/^\//, "").replace(/[/?=&%]+/g, "_") || "home").slice(0, 80);

for (const [ctx, path] of jobs) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !r.url().includes("/api/") && r.url() !== BASE + path) errors.push("http " + r.status() + ": " + r.url().slice(BASE.length)); });
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w < 768 ? 800 : 900 });
    let status = 0;
    try {
      const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90_000 });
      status = resp?.status() ?? 0;
    } catch (e) { errors.push("goto: " + e.message.split("\n")[0]); }
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(300);
    const states = [["", await page.evaluate(inspect)]];
    if (SHOTS !== "0") await page.screenshot({ path: join(OUT, `${slug(path)}@${w}.png`), fullPage: true }).catch(() => {});
    if (w === WIDTHS[0]) for (const a of await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")))) if (a.startsWith("/") && !a.startsWith("//")) links.set(a.split("#")[0], path);
    if (TABS) {
      // every tab of the page's tab bars (dialogs excluded)
      const tabs = page.locator("[role=tablist]:not([role=dialog] *) > [role=tab]");
      const n = await tabs.count();
      for (let i = 0; i < n && i < 24; i++) {
        const t = tabs.nth(i);
        if (!(await t.isVisible().catch(() => false)) || (await t.getAttribute("aria-selected")) === "true") continue;
        const name = ((await t.innerText().catch(() => "")) || String(i)).trim().replace(/\s+/g, " ").slice(0, 30);
        await t.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(250);
        states.push(["tab:" + name, await page.evaluate(inspect)]);
        if (SHOTS === "tabs") await page.screenshot({ path: join(OUT, `${slug(path)}@${w}~tab${i}.png`), fullPage: true }).catch(() => {});
      }
    }
    for (const [state, r] of states) {
      const overflow = r.scrollWidth > r.innerWidth + 1;
      const entry = { path, width: w, state, status, overflow, scrollWidth: r.scrollWidth, offenders: r.offenders, overlaps: r.overlaps, clipped: r.clipped };
      report.push(entry);
      total.overflow += +overflow; total.offenders += r.offenders.length; total.overlaps += r.overlaps.length; total.clipped += r.clipped.length;
      const bad = overflow || r.offenders.length || r.overlaps.length || r.clipped.length;
      if (bad) console.log(`✗ ${path} @${w}${state ? " [" + state + "]" : ""}: overflow=${overflow ? r.scrollWidth : "no"} offenders=${r.offenders.length} overlaps=${r.overlaps.length} clipped=${r.clipped.length}`);
    }
  }
  const uniq = [...new Set(errors)];
  if (uniq.length) { report.push({ path, errors: uniq }); total.errors += uniq.length; console.log(`! ${path}: ${uniq.length} error(s)\n   ` + uniq.slice(0, 5).join("\n   ")); }
  else console.log(`✓ ${path}`);
  await page.close();
}

// internal links that 404
const broken = [];
for (const [href, from] of links) {
  if (/^\/(api|_next)\//.test(href) || href.includes("[")) continue;
  const r = await anon.request.get(BASE + href, { maxRedirects: 5, failOnStatusCode: false }).catch(() => null);
  if (!r || r.status() === 404 || r.status() >= 500) broken.push({ href, from, status: r?.status() ?? 0 });
}
if (broken.length) console.log("broken links:\n  " + broken.map((b) => `${b.href} (${b.status}) from ${b.from}`).join("\n  "));

writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, browser: browserName, widths: WIDTHS, total, broken, report }, null, 1));
console.log(`\n${browserName}: ${jobs.length} routes × ${WIDTHS.length} widths — page overflow ${total.overflow}, elements out of viewport ${total.offenders}, text overlaps ${total.overlaps}, clipped controls ${total.clipped}, errors ${total.errors}, broken links ${broken.length}`);
await browser.close();
process.exit(total.overflow + total.offenders + total.overlaps + total.clipped + total.errors + broken.length ? 1 : 0);
