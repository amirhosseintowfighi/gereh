// Renders the static brand assets in /public from public/icon.svg using headless Chromium.
// Usage: npm run assets   (set CHROMIUM_PATH to use a specific browser binary)
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const pub = (f) => root + "public/" + f;
const font = (subset, w) => root + `node_modules/@fontsource/vazirmatn/files/vazirmatn-${subset}-${w}-normal.woff2`;

const svg = await readFile(pub("icon.svg"), "utf8");
const fontFaces = (await Promise.all(["arabic", "latin"].flatMap((subset) => [400, 800, 900].map(async (w) =>
  `@font-face{font-family:Vazirmatn;font-weight:${w};src:url(data:font/woff2;base64,${(await readFile(font(subset, w))).toString("base64")}) format("woff2")}`,
)))).join("");

const icon = (size, pad = 0, bg = "transparent") => `<!doctype html><html><body style="margin:0;background:${bg}">
  <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
    <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`;

// Maskable icons need the glyph inside the central 80% safe zone and a full-bleed background.
const glyph = svg.replace(/<rect width="48" height="48" rx="11"[^>]*\/>/, "");
const maskable = (size) => `<!doctype html><html><body style="margin:0">
  <div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:linear-gradient(135deg,#1e1b4b,#04050b)">
    <div style="width:${Math.round(size * 0.78)}px;height:${Math.round(size * 0.78)}px">${glyph.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
  </div></body></html>`;

const og = `<!doctype html><html lang="fa" dir="rtl"><head><style>${fontFaces}
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;font-family:Vazirmatn;color:#fff;overflow:hidden;position:relative;
    background:radial-gradient(900px 600px at 85% -10%,#4c1d95 0%,transparent 60%),radial-gradient(800px 600px at -5% 110%,#075985 0%,transparent 60%),#04050b}
  .grid{position:absolute;inset:0;opacity:.06;background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);background-size:56px 56px}
  .wrap{position:relative;height:100%;padding:72px 84px;display:flex;flex-direction:column;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:22px}
  .brand svg{width:96px;height:96px}
  .name{font-size:64px;font-weight:900;line-height:1}
  .domain{font-size:22px;letter-spacing:.12em;color:rgba(255,255,255,.55);direction:ltr;text-align:right;margin-top:8px;font-weight:400}
  h1{font-size:72px;font-weight:900;line-height:1.25;background:linear-gradient(90deg,#f8fafc,#c7d2fe 55%,#7dd3fc);-webkit-background-clip:text;color:transparent}
  .tags{display:flex;gap:14px;flex-wrap:wrap}
  .tag{font-size:26px;font-weight:800;padding:12px 26px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06)}
</style></head><body><div class="grid"></div><div class="wrap">
  <div class="brand">${svg}<div><div class="name">گره</div><div class="domain">gereh.cloud</div></div></div>
  <h1>سرعت ابر، استواری زمین</h1>
  <div class="tags"><span class="tag">سرور ابری NVMe</span><span class="tag">هاست پرسرعت</span><span class="tag">ثبت دامنه</span><span class="tag">آپتایم ۹۹٫۹۹٪</span></div>
</div></body></html>`;

const jobs = [
  // [file, size, html, transparent]
  ["icon-192.png", 192, icon(192), true],
  ["icon-512.png", 512, icon(512), true],
  ["icon-maskable-512.png", 512, maskable(512), false],
  ["apple-icon.png", 180, maskable(180), false],
  ["og.png", [1200, 630], og, false],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const [file, size, html, transparent] of jobs) {
    const [width, height] = Array.isArray(size) ? size : [size, size];
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await writeFile(pub(file), await page.screenshot({ type: "png", omitBackground: transparent }));
    await page.close();
    console.log("✓", file);
  }
} finally {
  await browser.close();
}
