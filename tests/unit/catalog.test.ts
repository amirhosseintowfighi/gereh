import { describe, expect, it } from "vitest";
import { TLDS, configPrice, isAvailable, parseDomain } from "@/lib/catalog";

describe("parseDomain", () => {
  it.each([
    ["mybrand", { name: "mybrand", tld: null }],
    ["mybrand.ir", { name: "mybrand", tld: ".ir" }],
    ["MyBrand.CO.IR", { name: "mybrand", tld: ".co.ir" }],
    ["https://www.mybrand.com/path", { name: "mybrand", tld: ".com" }],
    ["  shop-1.online ", { name: "shop-1", tld: ".online" }],
    ["mybrand.unknown", { name: "mybrand", tld: null }],
  ])("%s", (input, out) => {
    expect(parseDomain(input)).toEqual(out);
  });

  it.each(["", "   ", "-bad", "bad-", "bad_name", "سلام", "a".repeat(64), ".ir"])("rejects %j", (input) => {
    expect(parseDomain(input)).toHaveProperty("error");
  });

  it("prefers the longest matching TLD", () => {
    expect(parseDomain("x.co.ir")).toEqual({ name: "x", tld: ".co.ir" });
  });
});

describe("isAvailable", () => {
  it("is deterministic and blocks reserved / very short names", () => {
    expect(isAvailable("google", ".com")).toBe(false);
    expect(isAvailable("ab", ".ir")).toBe(false);
    expect(isAvailable("mybrand", ".ir")).toBe(isAvailable("mybrand", ".ir"));
  });

  it("returns a mix of results across TLDs", () => {
    const results = TLDS.map((t) => isAvailable("novinstudio", t.tld));
    expect(results).toContain(true);
  });
});

describe("configPrice", () => {
  const base = { cpu: 2, ram: 4, disk: 80, loc: "thr", os: "ubuntu", ips: 0, backup: false };

  it("prices the base config and rounds to thousands", () => {
    expect(configPrice(base)).toBe(90000 + 2 * 150000 + 4 * 60000 + 80 * 900);
    expect(configPrice({ ...base, disk: 81 }) % 1000).toBe(0);
  });

  it("applies foreign location, Windows licence, extra IPs and backup", () => {
    const p = configPrice(base);
    expect(configPrice({ ...base, loc: "fra" })).toBeGreaterThan(p);
    expect(configPrice({ ...base, os: "win" })).toBe(p + 150000);
    expect(configPrice({ ...base, ips: 2 })).toBe(p + 240000);
    expect(configPrice({ ...base, backup: true })).toBe(Math.round((p * 1.12) / 1000) * 1000);
  });

  it("is monotonic in each resource", () => {
    expect(configPrice({ ...base, cpu: 4 })).toBeGreaterThan(configPrice(base));
    expect(configPrice({ ...base, ram: 8 })).toBeGreaterThan(configPrice(base));
    expect(configPrice({ ...base, disk: 160 })).toBeGreaterThan(configPrice(base));
  });
});
