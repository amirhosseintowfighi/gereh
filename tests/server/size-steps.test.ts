import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TB_STEPS, diskSizeError, layoutSizeError, priceSku, trafficError, type CatalogView } from "@/lib/catalog";
import type { VpsExtrasView } from "@/lib/vps-billing";
import { saveDoc, vpsPrices } from "@/server/billing-extras";
import { jobs, servers, users, vpsTraffic } from "@/server/db/schema";
import { SimulatorDriver, setVirt } from "@/server/virt/driver";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

const SRV = "srv-1042"; // u1, running, vpsid 3300, 160 GB disk, 2000 GB traffic
const custom = (o: Record<string, unknown> = {}) => ({ t: "custom", cpu: 2, ram: 4, disk: 80, loc: "thr", os: "ubuntu", ips: 0, backup: false, ...o });
const extras = () => call<VpsExtrasView>("servers.extras", SRV);
let sim: SimulatorDriver;
beforeEach(async () => {
  await fresh();
  sim = new SimulatorDriver(); setVirt(sim);
  const [s] = await (await db()).select().from(servers).where(eq(servers.id, SRV));
  sim.adopt({ vpsid: 3300, uid: 7, hostname: s.hostname, disks: [{ slot: 0, sizeGb: 160, primary: true }], ipv4: ["185.143.232.17"], ipv6: [], bwLimit: 2000, cores: 4, ramMb: 8192, osName: "Ubuntu 24.04", serverId: 1 });
});
afterEach(() => setVirt(undefined));

describe("rules", () => {
  it("disk: multiples of 10 from 10, no 500 cap; traffic: multiples of 500 from 500", () => {
    expect(diskSizeError(25)).toContain("مضرب");
    expect(diskSizeError(5)).toBeTruthy();
    for (const ok of [10, 30, 500, 1920]) expect(diskSizeError(ok)).toBe("");
    expect(diskSizeError(2010, 2000)).toContain("حداکثر");
    for (const bad of [0, 300, 400, 750, 1001]) expect(trafficError(bad)).toBeTruthy();
    for (const ok of [500, 1000, 1500, 50_000]) expect(trafficError(ok)).toBe("");
    expect(TB_STEPS.slice(0, 3)).toEqual([0.5, 1, 1.5]);
    const cat = { plans: { cloud: [], metal: [], hosting: [] }, tlds: [] } as CatalogView;
    expect(priceSku(custom({ disk: 25 }) as never, cat)).toHaveProperty("error");
    expect(priceSku(custom({ disk: 30 }) as never, cat)).not.toHaveProperty("error");
  });

  it("layout: new sizes in 10 GB steps; an older server keeps its odd sizes and its primary carries the remainder", () => {
    expect(layoutSizeError([160], [135, 25], 160)).toContain("مضرب");
    expect(layoutSizeError([160], [130, 30], 160)).toBe("");
    // a 165 GB allowance sold before the rule
    expect(layoutSizeError([165], [85, 80], 165)).toBe("");
    expect(layoutSizeError([165], [80, 85], 165)).toBeTruthy();
    // disks left as they were are not checked
    expect(layoutSizeError([25, 35], [25, 35, 40], 100)).toBe("");
    expect(layoutSizeError([25, 35], [25, 45, 30], 100)).toBeTruthy();
  });
});

describe("disk sizes in each RPC", () => {
  it("order builder and its split: 25 rejected, 30 accepted", async () => {
    await asUser();
    expect(await fails("billing.checkout", [custom({ disk: 25 })])).toContain("مضرب");
    await call("billing.checkout", [custom({ disk: 30 })]);
    expect(await fails("billing.checkout", [custom({ disk: 60, disks: [35, 25] })])).toContain("تقسیم دیسک");
    await call("billing.checkout", [custom({ disk: 60, disks: [30, 30] })]);
  });

  it("extra disk and its resize: 25 rejected, 30 accepted; the admin cap still applies", async () => {
    await asUser();
    expect(await fails("servers.addDisk", SRV, { name: "data", sizeGb: 25 })).toContain("مضرب");
    const id = await call<string>("servers.addDisk", SRV, { name: "data", sizeGb: 30 });
    expect(await fails("servers.resizeDisk", id, 45)).toContain("مضرب");
    await call("servers.resizeDisk", id, 600); // above 500: no cap other than the admin's
    const p = await vpsPrices(await db());
    expect(await fails("servers.addDisk", SRV, { name: "big", sizeGb: p.maxDiskGb + 10 })).toContain("حداکثر");
    // a disk bought at an odd size before the rule grows to the next step
    const { vpsDisks } = await import("@/server/db/schema");
    await (await db()).update(vpsDisks).set({ sizeGb: 25 }).where(eq(vpsDisks.id, id));
    await call("servers.resizeDisk", id, 30);
  });

  it("disk layout: 25 rejected, 30 accepted", async () => {
    await asUser();
    const [s] = await (await db()).select().from(servers).where(eq(servers.id, SRV));
    expect(await fails("servers.setLayout", SRV, { sizes: [135, 25], os: "Debian 12", confirm: s.hostname })).toContain("مضرب");
    expect(await call("servers.setLayout", SRV, { sizes: [130, 30], os: "Debian 12", confirm: s.hostname })).toEqual({ mode: "rebuild" });
  });

  it("admin pricing: the disk cap and the pack size follow the steps", async () => {
    await asAdmin();
    const base = { ip: 1, diskGb: 1, snapshotGb: 1, packGb: 1000, packPrice: 840_000, maxIps: 8, maxDisks: 4, maxDiskGb: 2000 };
    expect(await fails("billing.adminSavePrices", { ...base, maxDiskGb: 25 })).toContain("مضرب");
    expect(await fails("billing.adminSavePrices", { ...base, packGb: 750 })).toContain("مضرب");
    await call("billing.adminSavePrices", { ...base, packGb: 1500, packPrice: 1_260_000 });
    expect(await vpsPrices(await db())).toMatchObject({ packGb: 1500, pack500Price: 420_000 });
  });
});

describe("traffic", () => {
  it("order builder: 400 and 750 GB rejected, 500 and 1000 accepted", async () => {
    await asUser();
    expect(await fails("billing.checkout", [custom({ tb: 0.4 })])).toContain("۵۰۰");
    expect(await fails("billing.checkout", [custom({ tb: 0.75 })])).toContain("۵۰۰");
    const inv = await call<{ id: string }>("billing.checkout", [custom({ tb: 0.5 })]);
    await call("billing.checkout", [custom({ tb: 1 })]);
    // the chosen traffic reaches the delivered server's limit
    await call("billing.pay", inv.id, "wallet");
    const d = await db();
    for (let i = 0; i < 5; i++) { await d.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.status, "pending")); if (!(await drain(d, 50))) break; }
    const [srv] = await d.select().from(servers).where(eq(servers.orderRef, inv.id + ":0"));
    expect(srv.bwLimit).toBe(500);
  });

  it("packs: 500 GB accepted, 300 rejected, repeated purchases add up on top of the plan's limit", async () => {
    await asUser();
    const d = await db();
    const [u] = await d.select({ b: users.balance }).from(users).where(eq(users.id, "u1"));
    const p = await vpsPrices(d);
    expect(p.pack500Price).toBe(420_000); // the default 1000 GB pack's per-GB price
    expect(await fails("servers.buyTraffic", SRV, 300)).toContain("مضرب");
    await call("servers.buyTraffic", SRV, 500);
    await call("servers.buyTraffic", SRV, 1000);
    await call("servers.buyTraffic", SRV, 500);
    const t = (await extras()).traffic;
    expect(t).toMatchObject({ planGb: 2000, extraGb: 2000, quotaGb: 4000, packs: 3 });
    expect(sim.vms.get(3300)!.bwLimit).toBe(4000);
    const [after] = await d.select({ b: users.balance }).from(users).where(eq(users.id, "u1"));
    expect(u.b - after.b).toBe(4 * 420_000);
    // the admin's default pack still works without an amount
    await call("servers.buyTraffic", SRV);
    expect((await d.select().from(vpsTraffic).where(eq(vpsTraffic.serverId, SRV)))[0].extraGb).toBe(3000);
  });

  it("a pack size saved before the rule reads as a 500 GB multiple with the same per-GB price", async () => {
    const d = await db();
    await saveDoc(d, "vps_prices", { packGb: 300, packPrice: 300_000 });
    expect(await vpsPrices(d)).toMatchObject({ packGb: 500, packPrice: 500_000, pack500Price: 500_000 });
  });
});
