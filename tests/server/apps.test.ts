import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { APPS } from "@/lib/catalog";
import { PAAS_TEMPLATES } from "@/lib/paas-templates";
import { ENV_KEY_RE } from "@/lib/paas";
import { APP_IDS, cloudInitFor } from "@/server/apps";

describe("one-click apps", () => {
  it("every VPS app has valid cloud-init YAML whose commands parse in bash", () => {
    expect(APPS.filter((a) => a.id).map((a) => a.id).sort()).toEqual([...APP_IDS].sort());
    for (const id of APP_IDS) {
      let y: { runcmd: string[][] };
      try { y = parse(cloudInitFor(id)!); } catch (e) { throw new Error(id + ": " + (e as Error).message); }
      for (const c of y.runcmd) expect(() => execFileSync("bash", ["-n", "-c", c[2]]), id).not.toThrow();
    }
  });
  it("PaaS templates are well formed", () => {
    expect(new Set(PAAS_TEMPLATES.map((t) => t.id)).size).toBe(PAAS_TEMPLATES.length);
    for (const t of PAAS_TEMPLATES) {
      for (const k of Object.keys(t.env)) expect(ENV_KEY_RE.test(k), t.id + " " + k).toBe(true);
      for (const s of t.show ?? []) expect(t.env[s.key], t.id).toContain("${secret}");
      if (t.diskGb) expect(t.diskMount.startsWith("/")).toBe(true);
    }
  });
});
