import { describe, expect, it } from "vitest";
import { MIRROR_ECOSYSTEMS, mirrorEnv, mirrorSetupScript } from "@/lib/mirror";

describe("package mirror", () => {
  it("builds env and per-tool snippets from the base URL", () => {
    expect(mirrorEnv("https://m.test/")).toMatchObject({ NPM_CONFIG_REGISTRY: "https://m.test/repository/npm/", GOPROXY: "https://m.test/repository/go/,direct" });
    const docker = MIRROR_ECOSYSTEMS.find((e) => e.id === "docker")!.snippet("https://m.test");
    expect(JSON.parse(docker.code.split("\n\n")[0])).toEqual({ "registry-mirrors": ["https://m.test"] });
    expect(new Set(MIRROR_ECOSYSTEMS.map((e) => e.repo)).size).toBe(MIRROR_ECOSYSTEMS.length);
  });
  it("setup script configures apt, docker and the shell env", () => {
    const s = mirrorSetupScript("https://m.test", "https://site.test");
    expect(s.startsWith("#!/bin/sh")).toBe(true);
    expect(s).toContain("curl -fsSL https://site.test/mirror/setup.sh | sudo sh");
    expect(s).toContain("export PIP_INDEX_URL=https://m.test/repository/pypi/simple");
    expect(s).toContain("$M/repository/ubuntu/");
  });
});
