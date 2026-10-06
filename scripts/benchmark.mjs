// Lighthouse (mobile + desktop) and HTTP load benchmark against a running production server.
// Usage: npm run build && npm start   (in another shell)
//        BASE_URL=http://localhost:3000 npm run bench
// Writes benchmarks/results.json and benchmarks/RESULTS.md; raw Lighthouse reports go to benchmarks/raw/.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PAGES = (process.env.PAGES || "/,/vps,/hosting,/domains,/about,/auth").split(",");
const RUNS = Number(process.env.RUNS || 3); // median of N runs per page/form factor
const out = fileURLToPath(new URL("../benchmarks/", import.meta.url));
await mkdir(out + "raw", { recursive: true });

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const CATS = ["performance", "accessibility", "best-practices", "seo"];
const METRICS = { "first-contentful-paint": "FCP", "largest-contentful-paint": "LCP", "total-blocking-time": "TBT", "cumulative-layout-shift": "CLS", "speed-index": "SI" };

const chrome = await chromeLauncher.launch({ chromePath: process.env.CHROMIUM_PATH, chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"] });
const lh = [];
try {
  for (const formFactor of ["mobile", "desktop"]) {
    for (const path of PAGES) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        const r = await lighthouse(BASE + path, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: CATS }, formFactor === "desktop" ? desktopConfig : undefined);
        runs.push(r.lhr);
        if (i === 0) await writeFile(`${out}raw/${formFactor}${path.replace(/\//g, "_") || "_"}.json`, r.report);
      }
      const row = { page: path, formFactor };
      for (const c of CATS) row[c] = Math.round(median(runs.map((l) => l.categories[c].score)) * 100);
      for (const [id, k] of Object.entries(METRICS)) row[k] = median(runs.map((l) => l.audits[id].numericValue));
      row.bytes = median(runs.map((l) => l.audits["total-byte-weight"].numericValue));
      lh.push(row);
      console.log(formFactor.padEnd(8), path.padEnd(10), CATS.map((c) => row[c]).join(" / "), `LCP ${Math.round(row.LCP)}ms TBT ${Math.round(row.TBT)}ms CLS ${row.CLS.toFixed(3)}`);
    }
  }
} finally {
  await chrome.kill();
}

const load = [];
for (const path of ["/", "/vps", "/sitemap.xml"]) {
  const r = await autocannon({ url: BASE + path, connections: Number(process.env.CONNECTIONS || 50), duration: Number(process.env.DURATION || 15) });
  load.push({ page: path, rps: Math.round(r.requests.average), p50: r.latency.p50, p99: r.latency.p99, errors: r.errors + r.non2xx, throughputMB: +(r.throughput.average / 1e6).toFixed(1) });
  console.log("load", path, load.at(-1));
}

const env = { date: new Date().toISOString(), node: process.version, base: BASE, runs: RUNS };
await writeFile(out + "results.json", JSON.stringify({ env, lighthouse: lh, load }, null, 2));

const ms = (v) => Math.round(v) + " ms";
const md = [
  "# Benchmarks", "",
  `Generated ${env.date} · Node ${env.node} · median of ${RUNS} Lighthouse runs · production build (\`next start\`).`, "",
  "Lighthouse uses simulated throttling (mobile: Moto G Power on slow 4G; desktop: cable). Scores are Performance / Accessibility / Best Practices / SEO.", "",
  "## Lighthouse", "",
  "| Page | Device | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | Transfer |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...lh.map((r) => `| \`${r.page}\` | ${r.formFactor} | ${r.performance} | ${r.accessibility} | ${r["best-practices"]} | ${r.seo} | ${ms(r.FCP)} | ${ms(r.LCP)} | ${ms(r.TBT)} | ${r.CLS.toFixed(3)} | ${Math.round(r.bytes / 1024)} KB |`),
  "", "`/auth` scores lower on SEO by design: it is `noindex`.", "",
  `## HTTP load (autocannon, ${process.env.CONNECTIONS || 50} connections, ${process.env.DURATION || 15}s, single \`next start\` process)`, "",
  "| Path | Req/s | p50 | p99 | Errors | Throughput |", "|---|---|---|---|---|---|",
  ...load.map((r) => `| \`${r.page}\` | ${r.rps} | ${r.p50} ms | ${r.p99} ms | ${r.errors} | ${r.throughputMB} MB/s |`),
  "",
];
await writeFile(out + "RESULTS.md", md.join("\n"));
console.log("wrote benchmarks/RESULTS.md");
