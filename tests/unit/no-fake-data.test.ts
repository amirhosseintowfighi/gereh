import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/* Production shows only real records and measurements. Random numbers belong to the simulators (demo mode
   only, src/server/demo.ts) and to id/secret generation; anywhere else in the UI or server they are how
   invented figures creep in. A new legitimate use goes on this list with its reason. */
const ALLOWED: Record<string, string> = {
  "src/server/virt/driver.ts": "SimulatorDriver (demo mode only): fake vpsids, users and VNC passwords",
  "src/server/providers.ts": "SimHosting (demo mode only): which demo web server a hosting account lands on",
  "src/server/ai/translate.ts": "genId: a unique suffix for response ids",
  "src/components/providers.tsx": "cart line ids",
};
const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mjs)$/.test(n) ? [p] : [];
});

describe("no invented numbers", () => {
  it("Math.random appears only in the allowed modules", () => {
    const hits = ["src/components", "src/server", "src/app", "src/lib"].flatMap((d) => walk(join(ROOT, d)))
      .filter((f) => /Math\.random\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).split("\\").join("/"));
    expect(hits.filter((f) => !(f in ALLOWED))).toEqual([]);
  });

  it("the panels no longer carry hard-coded chart series or KPIs", () => {
    const src = (f: string) => readFileSync(join(ROOT, f), "utf8");
    expect(src("src/components/panel/admin.tsx")).not.toMatch(/\[412, 448|\[84, 96|میانگین پاسخ ۹ دقیقه/);
    expect(src("src/components/panel/user.tsx")).not.toMatch(/Math\.sin|hashStr\("t"|میانگین زمان پاسخ: ۹ دقیقه/);
    expect(src("src/components/home/interactive.tsx")).not.toMatch(/uptimeDays|Math\.sin\(i/);
    // the simulated shell (invented uptime / df / free output) only in demo mode
    expect(src("src/components/panel/server.tsx")).toMatch(/if \(db\.settings\.demo\) return <DemoConsole/);
    // uptime is measured on /status, never typed into the admin location form
    expect(src("src/components/panel/admin.tsx")).not.toMatch(/label="آپتایم ٪"/);
  });
});
