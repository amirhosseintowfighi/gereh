import { describe, expect, it } from "vitest";
import { TLDS, VPS, cloudPrice, configPrice, isAvailable, parseDomain, tbRate } from "@/lib/catalog";

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
  const base = { cpu: 2, ram: 4, disk: 80, tb: 1, loc: "thr", os: "ubuntu", ips: 0, backup: false };

  it("prices from unit costs: core 299k, GB RAM 125k, 10 GB disk 125k, TB 840k, IPv4 240k", () => {
    expect(configPrice(base)).toBe(2 * 299000 + 4 * 125000 + 8 * 125000 + 840000 + 240000);
    expect(configPrice({ ...base, disk: 81 }) % 1000).toBe(0);
    expect(configPrice({ ...base, tb: undefined })).toBe(configPrice(base));
  });

  it("steps traffic down to 800k per TB at 10 TB and never below", () => {
    expect(tbRate(1)).toBe(840000);
    expect(tbRate(10)).toBe(800000);
    expect(tbRate(50)).toBe(800000);
    for (let tb = 1; tb < 50; tb++) {
      expect(tbRate(tb + 1)).toBeLessThanOrEqual(tbRate(tb));
      expect((tb + 1) * tbRate(tb + 1)).toBeGreaterThan(tb * tbRate(tb));
    }
    expect(configPrice({ ...base, tb: 10 }) - configPrice(base)).toBe(10 * 800000 - 840000);
  });

  it("prices every cloud plan from its resources", () => {
    expect(VPS.cloud.map((p) => p.price)).toEqual([2960000, 5645000, 9343000, 16872000]);
    expect(cloudPrice({ cpu: 1, ram: 2, disk: 40, tb: 2, ips: 1 })).toBe(VPS.cloud[0].price);
  });

  it("applies foreign location, Windows licence, extra IPs and backup", () => {
    const p = configPrice(base);
    expect(configPrice({ ...base, loc: "fra" })).toBeGreaterThan(p);
    expect(configPrice({ ...base, os: "win" })).toBe(p + 150000);
    expect(configPrice({ ...base, ips: 2 })).toBe(p + 2 * 240000);
    expect(configPrice({ ...base, backup: true })).toBe(p + Math.round((p * 0.12) / 1000) * 1000);
  });

  it("is monotonic in each resource", () => {
    expect(configPrice({ ...base, cpu: 4 })).toBeGreaterThan(configPrice(base));
    expect(configPrice({ ...base, ram: 8 })).toBeGreaterThan(configPrice(base));
    expect(configPrice({ ...base, disk: 160 })).toBeGreaterThan(configPrice(base));
  });
});
