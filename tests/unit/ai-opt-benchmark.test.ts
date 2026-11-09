/* Offline benchmark of the token optimizer on tests/fixtures/ai-opt: deterministic estimates, every
   integrity check must pass. AI_OPT_BENCH_PRINT=1 prints the table used in docs/token-optimizer.md. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { offlineOne, type Fixture } from "@/server/ai/optimizer/offline";

const dir = path.join(process.cwd(), "tests/fixtures/ai-opt");
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Fixture);

describe("offline benchmark", () => {
  it("covers every workload shape", () => {
    const ids = fixtures.map((f) => f.id);
    for (const id of ["persian-support", "english-chat", "mixed-fa-en", "markdown-doc", "assistant-history", "builder-project", "json-heavy", "code-heavy", "multimodal", "tool-calls"]) expect(ids).toContain(id);
  });

  it("passes every integrity check and is deterministic", async () => {
    const a = await Promise.all(fixtures.map(offlineOne));
    const b = await Promise.all(fixtures.map(offlineOne));
    if (process.env.AI_OPT_BENCH_PRINT === "1") {
      console.log("| workload | feature / policy | original (est.) | optimized (est.) | reduction | steps | checks |");
      console.log("|---|---|---:|---:|---:|---|---|");
      for (const r of a) console.log(`| ${r.workload} | ${r.policy} | ${r.origTokens} | ${r.optTokens} | ${r.reductionPct}% | ${Object.entries(r.steps).map(([k, v]) => k + "×" + v).join(", ") || "—"} | ${r.pass ? "pass" : "FAIL"} |`);
    }
    for (const r of a) {
      expect(r.pass, r.id + " " + JSON.stringify(r)).toBe(true);
      expect(r.optTokens).toBeLessThanOrEqual(r.origTokens);
    }
    expect(a.map((r) => [r.id, r.optTokens])).toEqual(b.map((r) => [r.id, r.optTokens]));
    const byId = Object.fromEntries(a.map((r) => [r.id, r]));
    // the long shapes are where the savings are
    expect(byId["assistant-history"].reductionPct).toBeGreaterThan(15);
    expect(byId["markdown-doc"].reductionPct).toBeGreaterThan(30);
  });
});
