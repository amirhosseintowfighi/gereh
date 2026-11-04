import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { seed } from "@/server/seed";
import { demoMode } from "@/server/demo";
import { CLEANUP_CONFIRM, findSeedRows } from "@/server/demo-seed";
import { audit, invoiceItems, invoices, servers, statusChecks, tickets, users, vpsTraffic, vpsTrafficDaily } from "@/server/db/schema";
import { financeReport, slaReport } from "@/server/reports";
import { monthKey } from "@/server/billing-extras";
import { hashPassword } from "@/server/password";
import { statusCheck, statusReport } from "@/server/status";
import { setVirt, VirtualizorDriver, type VirtDriver } from "@/server/virt/driver";
import { meterTraffic } from "@/server/worker/vps";
import { DEMO_PASSWORD } from "@/server/seed";
import { asAdmin, call, db, fails, fresh, login } from "./helpers";

const ENV = ["DEMO", "SEED_DEMO", "NEXT_PUBLIC_DEMO", "ADMIN_EMAIL", "ADMIN_PASSWORD"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  setVirt(undefined);
});

/** a fresh database booted as production: demo mode explicitly off, only the owner account */
async function production() {
  process.env.DEMO = "0";
  process.env.ADMIN_EMAIL = "admin@gereh.net";
  process.env.ADMIN_PASSWORD = DEMO_PASSWORD;
  setVirt(undefined);
  await fresh();
  return db();
}
const pw = () => hashPassword(DEMO_PASSWORD);
async function customer(d: Awaited<ReturnType<typeof db>>, id: string, extra: Partial<typeof users.$inferInsert> = {}) {
  await d.insert(users).values({ id, name: "مشتری " + id, email: id + "@example.com", passwordHash: await pw(), referralCode: "R" + id.toUpperCase(), ...extra });
}
async function vps(d: Awaited<ReturnType<typeof db>>, id: string, userId: string, vpsid: number) {
  await d.insert(servers).values({ id, userId, name: id, plan: "پایه", cpu: 2, ram: 4, disk: 80, loc: "thr", os: "Ubuntu 24.04", price: 100000, hostname: id + ".example.com", vpsid, status: "running" });
}

describe("demo mode: one rule", () => {
  it("is on only when asked for, or in the test suite; DEMO=0 always wins", () => {
    const env = process.env as Record<string, string | undefined>;
    const node = env.NODE_ENV;
    try {
      for (const k of ENV) delete env[k];
      env.NODE_ENV = "production";
      expect(demoMode()).toBe(false);
      env.NODE_ENV = "development";
      expect(demoMode()).toBe(false);
      env.DEMO = "1";
      expect(demoMode()).toBe(true);
      delete env.DEMO; env.SEED_DEMO = "1";
      expect(demoMode()).toBe(true);
      env.DEMO = "0";
      expect(demoMode()).toBe(false);
      delete env.DEMO; delete env.SEED_DEMO; env.NODE_ENV = "test";
      expect(demoMode()).toBe(true);
    } finally { env.NODE_ENV = node; }
  });
});

describe("production: the demo seed never runs", () => {
  it("boots an empty database with the owner only, and refuses the demo seed", async () => {
    const d = await production();
    const all = await d.select({ id: users.id, email: users.email }).from(users);
    expect(all.map((u) => u.email)).toEqual(["admin@gereh.net"]);
    expect(await d.select().from(servers)).toHaveLength(0);
    expect(await d.select().from(invoices)).toHaveLength(0);
    await expect(seed(d, { demo: true })).rejects.toThrow(/demo mode/);
    expect((await findSeedRows(d)).total).toBe(0);
  });
});

describe("admin dashboard counts real records", () => {
  it("sign-ups are customer rows of the last 7 days, without staff or deleted accounts", async () => {
    const d = await production();
    const old = new Date(Date.now() - 10 * 86400_000);
    await customer(d, "u-new1"); await customer(d, "u-new2"); await customer(d, "u-new3", { status: "suspended" });
    await customer(d, "u-old", { createdAt: old });
    await customer(d, "u-gone", { status: "deleted" });
    await customer(d, "st-new", { role: "admin", staffRole: "support" });
    await asAdmin();
    const s = await call<{ signups: { counts: number[]; total: number; labels: string[]; period: string }; customers: { total: number; active: number }; revenue: { gross: number[]; total: number }; firstResponse: { minutes: number | null } }>("admin.dashboardStats");
    expect(s.signups.total).toBe(3);
    expect(s.signups.counts).toHaveLength(7);
    expect(s.signups.counts[6]).toBe(3);
    expect(s.signups.period).toContain("۷ روز");
    expect(s.customers).toEqual({ total: 4, active: 3 });
    expect(s.revenue.total).toBe(0);
    expect(s.revenue.gross.every((g) => g === 0)).toBe(true);
    expect(s.firstResponse.minutes).toBeNull();
  });

  it("revenue and first response come from paid invoices and answered tickets", async () => {
    const d = await production();
    await customer(d, "u-pay");
    await d.insert(invoices).values({ id: "INV-T1", userId: "u-pay", status: "paid", taxRate: 10, dueAt: new Date(), paidAt: new Date() });
    await d.insert(invoiceItems).values({ invoiceId: "INV-T1", desc: "سرور ابری", amount: 1_000_000 });
    const t0 = new Date(Date.now() - 3600_000);
    await d.insert(tickets).values({ id: "TK-T1", userId: "u-pay", subject: "x", dept: "فنی", priority: "normal", status: "answered", createdAt: t0, updatedAt: t0, firstResponseAt: new Date(t0.getTime() + 20 * 60_000) });
    await asAdmin();
    const s = await call<{ revenue: { gross: number[]; total: number }; firstResponse: { minutes: number | null; tickets: number } }>("admin.dashboardStats");
    expect(s.revenue.total).toBe(1_100_000);
    expect(s.revenue.gross.at(-1)).toBe(1_100_000);
    expect(s.firstResponse).toMatchObject({ minutes: 20, tickets: 1 });
  });

  it("customers cannot read it", async () => {
    const d = await production();
    await customer(d, "u-c");
    await login("u-c@example.com");
    expect(await fails("admin.dashboardStats")).toMatch(/اجازه/);
  });
});

describe("VPS charts and traffic: nothing generated", () => {
  it("usage stats with no samples are empty (no simulator history in production)", async () => {
    const d = await production();
    await customer(d, "u-v"); await vps(d, "srv-v1", "u-v", 4401);
    await login("u-v@example.com");
    for (const range of ["1h", "24h", "7d", "30d"]) {
      const r = await call<{ source: string; points: unknown[] }>("servers.stats", "srv-v1", range);
      expect(r.points).toEqual([]);
      expect(r.source).toBe("none");
    }
  });

  it("an empty bandwidth answer from Virtualizor stores nothing and the dashboard says why", async () => {
    const d = await production();
    await customer(d, "u-b"); await vps(d, "srv-b1", "u-b", 4402);
    const was = new Date(Date.now() - 86400_000);
    await d.insert(vpsTraffic).values({ serverId: "srv-b1", month: monthKey(new Date()), usedGb: 0, updatedAt: was });
    setVirt({ name: "virtualizor", bandwidth: async () => [] } as unknown as VirtDriver);
    await meterTraffic(d);
    expect(await d.select().from(vpsTrafficDaily)).toHaveLength(0);
    // no invented "0 GB used this month": the row is not touched until Virtualizor reports
    expect((await d.select().from(vpsTraffic))[0].updatedAt.getTime()).toBe(was.getTime());
    await login("u-b@example.com");
    const t = await call<{ days: unknown[]; totalGb: number; empty: string }>("servers.trafficSummary");
    expect(t.days).toEqual([]);
    expect(t.totalGb).toBe(0);
    expect(t.empty).toContain("Virtualizor هنوز آماری برای این ماه برنگردانده است");
  });

  it("the Virtualizor driver maps an empty bandwidth reply to no days", async () => {
    const v = new VirtualizorDriver({ host: "panel.example.com", key: "k", pass: "p" });
    (v as unknown as { enduser: () => Promise<unknown> }).enduser = async () => ({});
    expect(await v.bandwidth(1, "202611")).toEqual([]);
    (v as unknown as { enduser: () => Promise<unknown> }).enduser = async () => ({ bandwidth: { usage: { 1: 3072, 2: 1024 }, in: { 1: 1024, 2: 512 }, out: { 1: 2048, 2: 512 } } });
    expect(await v.bandwidth(1, "202611")).toEqual([{ day: 1, inMb: 1024, outMb: 2048 }, { day: 2, inMb: 512, outMb: 512 }]);
  });

  it("reported days sum per day in GB (MB / 1024), in + out", async () => {
    const d = await production();
    await customer(d, "u-g"); await vps(d, "srv-g1", "u-g", 4403); await vps(d, "srv-g2", "u-g", 4404);
    const day = new Date().toISOString().slice(0, 10);
    await d.insert(vpsTrafficDaily).values([{ serverId: "srv-g1", day, inMb: 1024, outMb: 2048 }, { serverId: "srv-g2", day, inMb: 512, outMb: 512 }]);
    await login("u-g@example.com");
    const t = await call<{ days: { day: string; inGb: number; outGb: number }[]; totalGb: number }>("servers.trafficSummary");
    expect(t.days).toEqual([{ day, inGb: 1.5, outGb: 2.5 }]);
    expect(t.totalGb).toBe(4);
  });
});

describe("reports: no assumed figures", () => {
  it("SLA rate is null without answered tickets; new customers exclude staff and deleted accounts", async () => {
    const d = await production();
    expect((await slaReport(d)).slaRate).toBeNull();
    await customer(d, "u-r1"); await customer(d, "u-r2", { status: "deleted" }); await customer(d, "st-r", { role: "admin", staffRole: "support" });
    expect((await financeReport(d, 3)).totals.newCustomers).toBe(1);
  });
});

describe("status page uptime", () => {
  it("is «not enough data» without checks, and ok / all once checks exist", async () => {
    const d = await production();
    let r = await statusReport(d);
    expect(r.components.every((c) => c.uptime === null)).toBe(true);
    expect(r.components.every((c) => c.days.every((x) => x === "nodata"))).toBe(true);
    // the worker's check: the panel heartbeat only (no Virtualizor, no PowerDNS configured)
    await statusCheck(d);
    expect((await d.select().from(statusChecks)).map((c) => c.component)).toEqual(["panel"]);
    await d.insert(statusChecks).values([...Array.from({ length: 10 }, () => ({ component: "panel", ok: true })), { component: "panel", ok: false }]);
    r = await statusReport(d);
    const panel = r.components.find((c) => c.id === "panel")!;
    expect(panel.checks).toBe(12);
    expect(panel.uptime).toBeCloseTo((11 / 12) * 100, 5);
    expect(panel.days.at(-1)).toBe("degraded");
    expect(r.components.find((c) => c.id === "dns")!.uptime).toBeNull();
  });
});

describe("«داده‌های نمونه»: find and remove only the demo seed's rows", () => {
  it("lists the seed rows, keeps real customers, is idempotent and audited", async () => {
    await fresh(); // demo mode (tests): the demo seed runs
    const d = await db();
    // a real customer with real records, and a seed account someone used for real
    await customer(d, "u-real1");
    await vps(d, "srv-real1", "u-real1", 5501);
    await d.insert(invoices).values({ id: "INV-REAL1", userId: "u-real1", status: "paid", dueAt: new Date(), paidAt: new Date() });
    await vps(d, "srv-u2-real", "u2", 5502);

    const before = await findSeedRows(d);
    expect(before.total).toBeGreaterThan(50);
    expect(before.items.find((i) => i.key === "servers")!.sample).toContain("srv-1042");
    expect(before.keptUsers).toEqual(["u2"]);
    expect(before.fakeVirt).toBe(true);
    expect(before.warnings.join(" ")).toContain("رمز نمایشی");

    await asAdmin();
    expect(await fails("admin.removeSeedRows", "حذف")).toContain(CLEANUP_CONFIRM);
    const out = await call<{ total: number; removed: Record<string, number>; keptUsers: string[] }>("admin.removeSeedRows", CLEANUP_CONFIRM);
    expect(out.total).toBeGreaterThan(50);
    expect(out.removed.servers).toBe(17);
    expect(out.keptUsers).toEqual(["u2"]);

    // the real customer and every real row stay
    expect(await d.select().from(users).where(eq(users.id, "u-real1"))).toHaveLength(1);
    expect((await d.select({ id: servers.id }).from(servers)).map((s) => s.id).sort()).toEqual(["srv-real1", "srv-u2-real"]);
    expect((await d.select({ id: invoices.id }).from(invoices)).map((i) => i.id)).toEqual(["INV-REAL1"]);
    // seed accounts are gone except the one with a real server; the owner stays
    expect(await d.select().from(users).where(eq(users.email, "demo@gereh.net"))).toHaveLength(0);
    expect((await d.select({ id: users.id }).from(users).where(inArray(users.id, ["u2", "u3", "a1"]))).map((u) => u.id).sort()).toEqual(["a1", "u2"]);
    expect(await d.select().from(audit).where(and(eq(audit.target, "TK-3021")))).toHaveLength(0);
    const logged = await d.select().from(audit).where(eq(audit.actor, "مدیر سیستم"));
    expect(logged.filter((a) => a.action.startsWith("حذف داده‌های نمونه"))).toHaveLength(1);

    // idempotent: nothing left, nothing removed, no second audit entry
    expect((await findSeedRows(d)).total).toBe(0);
    const again = await call<{ total: number }>("admin.removeSeedRows", CLEANUP_CONFIRM);
    expect(again.total).toBe(0);
    expect((await d.select().from(audit)).filter((a) => a.action.startsWith("حذف داده‌های نمونه"))).toHaveLength(1);
  });

  it("is owner-only", async () => {
    await fresh();
    await login("kaveh@gereh.net");
    expect(await fails("admin.seedRows")).toMatch(/اجازه/);
    expect(await fails("admin.removeSeedRows", CLEANUP_CONFIRM)).toMatch(/اجازه/);
  });
});
