import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VpsExtrasView } from "@/lib/vps-billing";
import { context } from "@/server/ctx";
import { jobs, notifications, serverTasks, servers, transactions, users, vpsDisks, vpsIps, vpsSync, vpsSyncLog, vpsTraffic } from "@/server/db/schema";
import { buildState } from "@/server/state";
import { SimulatorDriver, setVirt, type VpsDetail } from "@/server/virt/driver";
import { virtSync } from "@/server/virt/sync";
import { drain } from "@/server/worker";
import { vpsBilling } from "@/server/worker/vps";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

const SRV = "srv-1042"; // u1, running, vpsid 3300, 4C / 8G / 160G, bwLimit 2000 in the seed
let sim: SimulatorDriver;

const row = async (id = SRV) => (await (await db()).select().from(servers).where(eq(servers.id, id)))[0];
const logs = async (id = SRV) => (await db()).select().from(vpsSyncLog).where(eq(vpsSyncLog.serverId, id));
const syncTasks = async (id = SRV) => (await (await db()).select().from(serverTasks).where(eq(serverTasks.serverId, id))).filter((t) => t.action.startsWith("تغییر از Virtualizor"));
const sync = async () => virtSync(await db(), {});
/** the VPS exists in Virtualizor exactly as the site has it */
async function adoptAsIs(id = SRV, over: Partial<VpsDetail> = {}) {
  const s = await row(id);
  return sim.adopt({ vpsid: s.vpsid!, hostname: s.hostname, cores: s.cpu, ramMb: s.ram * 1024, disks: [{ slot: 0, sizeGb: s.disk, primary: true }], ipv4: [s.ip], ipv6: s.ipv6 ? [s.ipv6] : [],
    bwLimit: s.bwLimit, bwUsed: 0, osid: 0, osName: s.os, status: s.status === "stopped" ? "stopped" : "running", ...over });
}
const state = async () => { const c = await context(); return buildState(c.db, c.auth, "customer"); };

beforeEach(async () => { await fresh(); sim = new SimulatorDriver(); setVirt(sim); });
afterEach(() => setVirt(undefined));

describe("Virtualizor → site sync", () => {
  it("an unchanged VPS logs nothing", async () => {
    await adoptAsIs();
    await sync();
    await sync();
    expect(await logs()).toHaveLength(0);
    expect(await syncTasks()).toHaveLength(0);
    const [y] = await (await db()).select().from(vpsSync).where(eq(vpsSync.serverId, SRV));
    expect(y).toMatchObject({ state: "ok", node: "thr-hv-01", bwLimit: 2000, lastError: "" });
    expect(y.syncedAt).not.toBeNull();
  });

  it("the quota shown is Virtualizor's limit: 1 TB bought, not the 2 TB the row defaulted to", async () => {
    await adoptAsIs(SRV, { bwLimit: 1000, bwUsed: 120 });
    await sync();
    expect((await row()).bwLimit).toBe(1000);
    expect((await logs()).map((l) => l.text)).toEqual(["سهمیه ترافیک ۲→۱ ترابایت"]);
    await asUser();
    const x = await call<VpsExtrasView>("servers.extras", SRV);
    expect(x.traffic).toMatchObject({ quotaGb: 1000, planGb: 1000, usedGb: 120 });
    const s = (await state()).db.servers.find((v) => v.id === SRV)!;
    expect(s).toMatchObject({ bwLimit: 1000, bwUsed: 120 });
    expect(s.sync?.last).toBe("سهمیه ترافیک ۲→۱ ترابایت");
  });

  it("a new order stores the traffic bought, and the sync keeps it", async () => {
    await asUser();
    const inv = await call<{ id: string }>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c2", loc: "thr", cycle: "m" }]);
    await call("billing.pay", inv.id, "wallet");
    const d = await db();
    for (let i = 0; i < 5; i++) { await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending")); if (!(await drain(d))) break; }
    const [s] = await d.select().from(servers).where(eq(servers.orderRef, inv.id + ":0"));
    expect(s).toMatchObject({ status: "running", bwLimit: 4000 });
    await sync();
    expect((await row(s.id)).bwLimit).toBe(4000);
    expect(await logs(s.id)).toHaveLength(0);
  });

  it("manual edits in Virtualizor update the row, extras and quota, each logged exactly once", async () => {
    await adoptAsIs();
    await asUser();
    const extraIp = await call<string>("servers.addIp", SRV);
    await sync();
    expect(await logs()).toHaveLength(0); // the site's own change is not a manual edit
    const s0 = await row();

    sim.edit(s0.vpsid!, {
      ramMb: 16 * 1024,
      disks: [{ slot: 0, sizeGb: 80, primary: true }, { slot: 1, sizeGb: 80, primary: false }],
      ipv4: [s0.ip, "1.2.3.4"], // the extra the customer bought was taken away, a new one added
      bwLimit: 3000, bwUsed: 50,
      hostname: "renamed.example.com",
      status: "suspended", suspendReason: "abuse",
      serverName: "thr-hv-02",
    });
    await sync();
    const s = await row();
    expect(s).toMatchObject({ ram: 16, disk: 80, hostname: "renamed.example.com", status: "suspended", bwLimit: 3000 });
    expect(s.suspendedAt).toBeNull(); // not a billing suspension: no automatic termination
    const d = await db();
    const ips = await d.select().from(vpsIps).where(eq(vpsIps.serverId, SRV));
    expect(ips.find((r) => r.ip === "1.2.3.4")).toMatchObject({ price: 0, goneAt: null });
    expect(ips.find((r) => r.ip === extraIp)!.goneAt).not.toBeNull();
    const disks = await d.select().from(vpsDisks).where(eq(vpsDisks.serverId, SRV));
    expect(disks).toHaveLength(1);
    expect(disks[0]).toMatchObject({ sizeGb: 80, slot: 1, billed: false });

    const texts = (await logs()).map((l) => l.text).sort();
    expect(texts).toEqual([
      "IP جدید 1.2.3.4", "IP حذف‌شده " + extraIp, "hostname " + s0.hostname + "→renamed.example.com", "انتقال از نود thr-hv-01 به thr-hv-02",
      "تعلیق در Virtualizor (abuse)", "دیسک ۱۶۰→۸۰+۸۰ گیگ", "رم ۸→۱۶ گیگ", "سهمیه ترافیک ۲→۳ ترابایت",
    ].sort());
    expect(await syncTasks()).toHaveLength(1);
    const x = await (await asUser(), call<VpsExtrasView>("servers.extras", SRV));
    expect(x.traffic.quotaGb).toBe(3000);
    expect(x.ips.map((i) => i.ip)).toEqual([s0.ip, "1.2.3.4"]);
    expect(x.disks).toMatchObject([{ sizeGb: 80, billed: false }]);

    // a second run with nothing new changes nothing
    await sync();
    expect(await logs()).toHaveLength(8);
    expect(await syncTasks()).toHaveLength(1);

    // the hourly add-on charge skips the address that is gone and the disk the admin added
    await d.update(servers).set({ status: "running" }).where(eq(servers.id, SRV));
    sim.edit(s0.vpsid!, { status: "running" });
    await d.delete(transactions);
    await vpsBilling(d);
    const charged = (await d.select().from(transactions).where(eq(transactions.userId, "u1"))).filter((t) => t.desc.startsWith("افزونه‌های سرور web-prod-1"));
    expect(charged.some((t) => /IPv4|دیسک اضافه/.test(t.desc))).toBe(false);
  });

  it("a site action reconciles that server right away, consistently", async () => {
    await adoptAsIs();
    await asUser();
    await call("servers.addDisk", SRV, { name: "data", sizeGb: 50 });
    await call("servers.setHostname", SRV, "app.novin.studio");
    const d = await db();
    expect((await d.select().from(jobs).where(and(eq(jobs.type, "virt.sync"), eq(jobs.status, "pending")))).map((j) => j.dedupe)).toEqual(["virt.sync:" + SRV]);
    await drain(d);
    expect(await logs()).toHaveLength(0);
    expect((await d.select().from(vpsDisks).where(eq(vpsDisks.serverId, SRV)))[0]).toMatchObject({ name: "data", billed: true, goneAt: null });
    expect((await row()).hostname).toBe("app.novin.studio");
  });

  it("a traffic pack is the site's own limit; an admin's later edit wins over plan + packs", async () => {
    await adoptAsIs(SRV, { bwUsed: 10 });
    await asUser();
    await (await db()).update(users).set({ balance: 50_000_000 }).where(eq(users.id, "u1"));
    await call("servers.buyTraffic", SRV);
    const x = await call<VpsExtrasView>("servers.extras", SRV);
    expect(sim.vms.get(3300)!.bwLimit).toBe(x.traffic.quotaGb);
    await sync();
    expect(await logs()).toHaveLength(0);
    sim.edit(3300, { bwLimit: 500 });
    await sync();
    const [t] = await (await db()).select().from(vpsTraffic).where(eq(vpsTraffic.serverId, SRV));
    expect(t.extraGb).toBe(0);
    expect((await row()).bwLimit).toBe(500);
    expect((await call<VpsExtrasView>("servers.extras", SRV)).traffic.quotaGb).toBe(500);
    expect((await logs()).map((l) => [l.field, l.before, l.after])).toEqual([["bw", String(2000 + x.prices.packGb), "500"]]);
  });

  it("a VPS deleted in Virtualizor is flagged, not deleted, and shown to staff", async () => {
    await adoptAsIs();
    await sim.remove(3300);
    await sync();
    await sync();
    expect((await row()).status).toBe("missing");
    expect((await logs()).map((l) => l.text)).toEqual(["VPS 3300 در Virtualizor پیدا نشد"]);
    expect((await (await db()).select().from(notifications)).some((n) => n.text.includes("در Virtualizor پیدا نشد"))).toBe(true);
    await asUser();
    expect(await fails("servers.power", SRV, "start")).toContain("پیدا نمی‌شود");
    await asAdmin();
    const v = await call<{ rows: { id: string; status: string; notes?: string[]; changes?: { text: string }[] }[] }>("admin.userDetail", "u1", "services");
    const r = v.rows.find((x) => x.id === SRV)!;
    expect(r.status).toBe("missing");
    expect(r.notes!.some((n) => n.startsWith("در Virtualizor پیدا نشد"))).toBe(true);
    expect(r.changes![0].text).toBe("VPS 3300 در Virtualizor پیدا نشد");
    // found again
    await adoptAsIs(SRV, { status: "running" });
    await sync();
    expect((await row()).status).toBe("running");
  });

  it("staff see when resources differ from the plan", async () => {
    await adoptAsIs(SRV, { cores: 16 });
    await sync();
    await asAdmin();
    const v = await call<{ rows: { id: string; notes?: string[] }[] }>("admin.userDetail", "u1", "services");
    expect(v.rows.find((x) => x.id === SRV)!.notes!.some((n) => n.startsWith("منابع با پلن فرق دارد"))).toBe(true);
    expect((await row()).price).toBe(1290000); // billing untouched
  });

  it("the per-server sync button is scoped to the owner and rate-limited", async () => {
    await adoptAsIs();
    await call("auth.register", { name: "غریبه", email: "x@example.com", phone: "09351110000", password: "Abcdefg1" });
    expect(await fails("servers.sync", SRV)).toContain("پیدا نشد");
    await asUser();
    sim.edit(3300, { hostname: "edited.example.com" });
    expect(await call("servers.sync", SRV)).toEqual({ changes: ["hostname web-prod-1.gereh.net→edited.example.com"], state: "ok" });
    expect(await call("servers.sync", SRV)).toEqual({ changes: [], state: "ok" });
    await call("servers.sync", SRV);
    expect(await fails("servers.sync", SRV)).toContain("تعداد تلاش‌ها زیاد است");
    // staff have their own, larger allowance
    await asAdmin();
    expect(await call("servers.sync", SRV)).toMatchObject({ state: "ok" });
  });

  it("the admin button queues every VPS", async () => {
    await adoptAsIs();
    await asAdmin();
    await call("admin.virtSync", "VPSها و وضعیت");
    const d = await db();
    const [j] = await d.select().from(jobs).where(eq(jobs.type, "virt.sync"));
    expect(j.payload).toEqual({ all: true });
    sim.edit(3300, { cores: 6 });
    await drain(d);
    expect((await row()).cpu).toBe(6);
  });
});
