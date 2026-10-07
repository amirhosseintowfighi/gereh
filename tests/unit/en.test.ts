import { describe, expect, it } from "vitest";
import { enSpec, PLAN_EN, tomanEn } from "@/content/en";
import { HOSTING, VPS } from "@/lib/catalog";

describe("English catalogue", () => {
  it("translates specs", () => {
    expect(enSpec("۴ هسته")).toBe("4 vCPU");
    expect(enSpec("۱۶ هسته / ۳۲ رشته")).toBe("16 cores / 32 threads");
    expect(enSpec("۱۶۰ گیگ NVMe")).toBe("160 GB NVMe");
    expect(enSpec("۸ گیگابایت")).toBe("8 GB");
    expect(enSpec("۲×۱٫۹۲ ترابایت NVMe")).toBe("2×1.92 TB NVMe");
    expect(enSpec("۱۰ گیگابیت")).toBe("10 Gbps");
    expect(enSpec("۱ سایت")).toBe("1 site");
    expect(enSpec("نامحدود")).toBe("Unlimited");
    expect(tomanEn(1290000)).toBe("1,290,000 Toman");
  });
  it("every plan has an English name and no Persian left in its specs", () => {
    const plans = [...VPS.cloud, ...VPS.metal, ...HOSTING.linux, ...HOSTING.wordpress];
    for (const p of plans) {
      expect(PLAN_EN[p.id]?.name).toBeTruthy();
      for (const v of [p.cpu, p.ram, p.disk, p.traffic, p.port, p.ipv4, p.snap, p.backup, p.sites, p.email, p.db]) if (v) expect(enSpec(v)).not.toMatch(/[؀-ۿ]/);
    }
  });
});
