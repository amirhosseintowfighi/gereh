import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { context } from "@/server/ctx";
import { jobs, notifications, serverTasks, servers, transactions, usageHourly, usageSamples, vpsDisks, vpsLayouts, vpsPower, vpsRelayout, vpsSyncLog } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { isCapacityError } from "@/server/virt/relayout";
import { buildState } from "@/server/state";
import { SimulatorDriver, setVirt } from "@/server/virt/driver";
import { virtSync } from "@/server/virt/sync";
import { drain } from "@/server/worker";
import { collectUsage } from "@/server/worker/ops";
import { vpsBilling } from "@/server/worker/vps";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

/* the real Virtualizor client against a scripted HTTP answer (as in virtualizor.test.ts) */
const calls: { url: URL; body: URLSearchParams | null }[] = [];
let reply: (url: URL, body: URLSearchParams | null) => unknown = () => ({});
vi.mock("undici", () => ({
  Agent: class { constructor(public opts: unknown) {} },
  fetch: async (url: string, init: { method: string; body?: URLSearchParams }) => {
    const u = new URL(url);
    calls.push({ url: u, body: init.body ?? null });
    const r = reply(u, init.body ?? null);
    return { ok: true, status: 200, json: async () => r };
  },
}));
const { VirtualizorDriver } = await import("@/server/virt/virtualizor");
const real = () => new VirtualizorDriver({ host: "vz.example.com", key: "KEY", pass: "PASS" });
const act = (u: URL) => u.searchParams.get("act");

const SRV = "srv-1042"; // u1, running, vpsid 3300, 160 GB disk in the seed
const row = async () => (await (await db()).select().from(servers).where(eq(servers.id, SRV)))[0];
const setStatus = async (status: "running" | "stopped") => (await db()).update(servers).set({ status }).where(eq(servers.id, SRV));
/** runs the queued power confirmations now instead of waiting for their delay */
async function runPowerJobs() {
  const d = await db();
  await d.update(jobs).set({ runAt: new Date(0) }).where(and(eq(jobs.type, "virt.power"), eq(jobs.status, "pending")));
  await drain(d, 5);
}
const state = async () => { const c = await context(); return buildState(c.db, c.auth, "customer"); };
/** the listing answer of an install that ignores the vs_status filter: configuration only, no live state */
const LISTING = { vs: { 3300: { vpsid: "3300", uid: "7", hostname: "web-prod-1.gereh.net", cores: "4", ram: "8192", space: "160", ips: { 1: "185.143.232.17" }, ips6: { 2: "2a01:4f8:c0c:1042::1" }, bandwidth: "2000", suspended: "0" } } };

beforeEach(async () => { await fresh(); calls.length = 0; reply = () => ({}); });
afterEach(() => setVirt(undefined));

describe("power state: the running VPS that kept flipping to off", () => {
  it("a status answer without the VPS means unknown: neither the usage poll nor the sync writes «off»", async () => {
    // the deployment's symptom: vs_status ignored, the act=vs listing comes back for every call, with no status
    reply = (u) => (act(u) === "vpsmanage" ? {} : LISTING);
    setVirt(real());
    expect(await real().status([3300])).toEqual([]);
    const d = await db();
    await collectUsage(d);
    expect((await row()).status).toBe("running");
    expect(await d.select().from(usageSamples).where(eq(usageSamples.serverId, SRV))).toHaveLength(0); // no zero samples either
    await virtSync(d, { all: true });
    expect((await row()).status).toBe("running");
    // an explicit 0 from vs_status is a real «off» and is applied
    reply = (u) => (u.searchParams.has("vs_status[]") ? { status: { 3300: { status: 0 } } } : LISTING);
    await collectUsage(d);
    expect((await row()).status).toBe("stopped");
  });

  it("start: a transition is shown, a stale «off» poll cannot revert it, a live read confirms it", async () => {
    let live = 0;
    reply = (u) => (u.searchParams.has("vs_status[]") ? { status: { 3300: { status: live, used_cpu: "3", used_ram: 1024, ram: 8192, used_disk: 40, disk: 160 } } }
      : act(u) === "start" ? { done: 1 } : LISTING);
    setVirt(real());
    await setStatus("stopped");
    await asUser();
    expect(await call("servers.power", SRV, "start")).toBe("pending");
    // the start went to the enduser API; nothing was written optimistically
    expect(calls.some((c) => act(c.url) === "start" && c.url.port === "4083" && c.url.searchParams.get("svs") === "3300")).toBe(true);
    expect((await row()).status).toBe("stopped");
    expect((await state()).db.servers.find((s) => s.id === SRV)!.power).toMatchObject({ action: "start" });
    expect(await fails("servers.power", SRV, "start")).toContain("در حال انجام");
    // the VPS is still booting: the 5-minute poll and the sync read «off» and must leave it alone
    const d = await db();
    await collectUsage(d);
    await virtSync(d, { all: true });
    await runPowerJobs();
    expect(await d.select().from(vpsPower)).toHaveLength(1);
    // the live read now says running: confirmed
    live = 1;
    await runPowerJobs();
    expect((await row()).status).toBe("running");
    expect(await d.select().from(vpsPower)).toHaveLength(0);
    const tasks = (await d.select().from(serverTasks).where(eq(serverTasks.serverId, SRV))).map((t) => [t.action, t.status]);
    expect(tasks).toContainEqual(["روشن کردن", "done"]);
    expect(tasks).toContainEqual(["روشن کردن تأیید شد", "done"]);
    // and the next polls keep it running
    await collectUsage(d);
    await virtSync(d, { all: true });
    expect((await row()).status).toBe("running");
    // usage stored as % (used_ram / ram)
    const [smp] = await d.select().from(usageSamples).where(eq(usageSamples.serverId, SRV));
    expect(smp).toMatchObject({ cpu: 3, ram: 12.5, disk: 25 });
  });

  it("vs_status silent: the enduser VPS info gives the power state", async () => {
    reply = (u) => (act(u) === "vpsmanage" ? { info: { status: 1, bandwidth: { used_gb: 12.5, limit_gb: 2000 } } } : u.searchParams.has("vs_status[]") ? { status: {} } : LISTING);
    expect(await real().powerState(3300)).toBe("running");
    const m = await real().details([3300]);
    expect(m.get(3300)).toMatchObject({ status: "running", bwUsed: 12.5 });
    reply = () => ({});
    expect(await real().powerState(3300)).toBeNull();
  });

  it("a stop that never shows up is reported after the checks run out", async () => {
    const sim = new SimulatorDriver();
    setVirt(sim);
    sim.adopt({ vpsid: 3300, status: "running" });
    sim.powerLag = 1000;
    await asUser();
    expect(await call("servers.power", SRV, "stop")).toBe("pending");
    for (let i = 0; i < 30; i++) await runPowerJobs();
    const d = await db();
    expect(await d.select().from(vpsPower)).toHaveLength(0);
    expect((await row()).status).toBe("running");
    expect((await d.select().from(serverTasks).where(eq(serverTasks.serverId, SRV))).some((t) => t.status === "failed" && t.action.includes("تأیید نشد"))).toBe(true);
  });

  it("the simulator confirms at once; power-off and restart are offered", async () => {
    const sim = new SimulatorDriver();
    setVirt(sim);
    sim.adopt({ vpsid: 3300, status: "running" });
    await asUser();
    expect(await call("servers.power", SRV, "poweroff")).toBe("done");
    expect((await row()).status).toBe("stopped");
    expect(await call("servers.power", SRV, "start")).toBe("done");
    expect(await call("servers.power", SRV, "restart")).toBe("done");
    expect((await row()).status).toBe("running");
  });
});

describe("disk layout", () => {
  let sim: SimulatorDriver;
  beforeEach(async () => {
    sim = new SimulatorDriver(); setVirt(sim);
    sim.adopt({ vpsid: 3300, uid: 7, hostname: (await row()).hostname, disks: [{ slot: 0, sizeGb: 160, primary: true }], ipv4: ["185.143.232.17"], ipv6: ["2a01:4f8:c0c:1042::1"], bwLimit: 2000, cores: 4, ramMb: 8192, osName: "Ubuntu 24.04", serverId: 1 });
  });
  /** runs every due job (and the retries of failed ones) until the queue is quiet */
  async function runJobs(rounds = 6) {
    const d = await db();
    for (let i = 0; i < rounds; i++) {
      await d.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.status, "pending"));
      if (!(await drain(d, 50))) break;
    }
  }
  const relayoutRow = async () => (await (await db()).select().from(vpsRelayout).where(eq(vpsRelayout.serverId, SRV)))[0];

  it("160 → 60 + 100 recreates the VPS in a job: same IP, new vpsid, old VPS deleted, OS reinstalled, price unchanged", async () => {
    await asUser();
    const s = await row();
    expect(await call("servers.layout", SRV)).toMatchObject({ allowanceGb: 160, disks: [{ slot: 0, sizeGb: 160, primary: true }], relayout: null });
    expect(await fails("servers.setLayout", SRV, { sizes: [60, 90] })).toContain("باید برابر");
    expect(await fails("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12" })).toContain("hostname");
    expect(await fails("servers.setLayout", SRV, { sizes: [60, 100], confirm: s.hostname })).toContain("سیستم‌عامل");
    const edit = vi.spyOn(sim, "setDiskLayout");
    expect(await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: s.hostname })).toEqual({ mode: "rebuild" });
    // nothing ran in the request: the server shows the transition and the edit path (which refuses a shrink) is not used
    expect(edit).not.toHaveBeenCalled();
    expect((await row()).status).toBe("relayout");
    expect(sim.vms.get(3300)!.disks.map((d) => d.sizeGb)).toEqual([160]);
    expect((await call<{ relayout: { sizes: number[] } }>("servers.layout", SRV)).relayout).toMatchObject({ sizes: [60, 100], os: "Debian 12" });
    expect((await state()).db.servers.find((x) => x.id === SRV)!.status).toBe("relayout");
    expect(await fails("servers.power", SRV, "stop")).toContain("بازسازی");
    expect(await fails("servers.setLayout", SRV, { sizes: [80, 80], os: "Debian 12", confirm: s.hostname })).toContain("بازسازی");
    // the usage poll and the sync leave it alone while the job runs
    const d = await db();
    await collectUsage(d);
    await virtSync(d, { all: true });
    expect((await row()).status).toBe("relayout");
    expect(await d.select().from(usageSamples).where(eq(usageSamples.serverId, SRV))).toHaveLength(0);

    await runJobs();
    const after = await row();
    expect(after).toMatchObject({ status: "running", ip: "185.143.232.17", disk: 60, os: "Debian 12", price: s.price });
    expect(after.vpsid).not.toBe(3300);
    expect(sim.gone.has(3300)).toBe(true);
    const vm = sim.vms.get(after.vpsid!)!;
    expect(vm.disks.map((x) => x.sizeGb)).toEqual([60, 100]);
    expect(vm).toMatchObject({ osName: "Debian 12", ipv4: ["185.143.232.17"], serverId: 1, cores: 4, ramMb: 8192, bwLimit: 2000, uid: 7 });
    // created on the same node with the new disks and a temporary address (Plan A), then the old address moved
    expect(sim.made.get(after.vpsid!)!.req).toMatchObject({ node: 1, disks: [60, 100], uid: 7, osid: 351 });
    expect(sim.made.get(after.vpsid!)!.req.ips).toBeUndefined();
    expect(sim.made.size).toBe(1);
    expect(await relayoutRow()).toBeUndefined();
    expect((await d.select().from(vpsDisks).where(eq(vpsDisks.serverId, SRV))).map((x) => [x.sizeGb, x.billed, x.goneAt])).toEqual([[100, false, null]]);
    const [log] = await d.select().from(vpsSyncLog).where(and(eq(vpsSyncLog.serverId, SRV), eq(vpsSyncLog.field, "layout")));
    expect(log).toMatchObject({ before: "160", after: "60+100" });
    const tasks = await d.select().from(serverTasks).where(eq(serverTasks.serverId, SRV));
    expect(tasks.some((t) => t.action.startsWith("چیدمان دیسک ۱۶۰→۶۰+۱۰۰"))).toBe(true);
    expect(tasks.filter((t) => t.status === "running")).toHaveLength(0);
    expect(outbox.find((m) => m.subject?.startsWith("تغییر چیدمان دیسک"))!.text).toContain("رمز root جدید");
    // the sync sees exactly this layout on the new VPS: nothing to log
    await virtSync(d, { all: true });
    expect((await d.select().from(vpsSyncLog).where(eq(vpsSyncLog.serverId, SRV))).filter((l) => l.field === "disk" || l.field === "ip")).toHaveLength(0);
    expect((await row()).disk).toBe(60);
    // the split disk is never charged
    await vpsBilling(d);
    expect((await d.select().from(transactions)).some((t) => t.desc.includes("دیسک"))).toBe(false);
    // and changed again later: 40 + 60 + 60 (the 100 GB disk shrinks): recreated again
    expect(await call("servers.setLayout", SRV, { sizes: [40, 60, 60], os: "Debian 12", confirm: s.hostname })).toEqual({ mode: "rebuild" });
    await runJobs();
    const again = await row();
    expect(sim.vms.get(again.vpsid!)!.disks.map((x) => x.sizeGb)).toEqual([40, 60, 60]);
    expect(again.ip).toBe("185.143.232.17");
    expect((await d.select().from(vpsDisks).where(eq(vpsDisks.serverId, SRV))).filter((x) => !x.goneAt).map((x) => x.sizeGb).sort()).toEqual([60, 60]);
  });

  it("adding a disk from unused allowance, or growing one, is edited in place (no recreate, no reinstall, no hostname)", async () => {
    await asUser();
    const s = await row();
    const create = vi.spyOn(sim, "create"), reinstall = vi.spyOn(sim, "reinstall"), edit = vi.spyOn(sim, "setDiskLayout");
    // the plan grew by 20 GB (e.g. an upgrade); the new GB are unused
    await (await db()).insert(vpsLayouts).values({ serverId: SRV, allowanceGb: 180 });
    expect(await call("servers.layout", SRV)).toMatchObject({ allowanceGb: 180, usedGb: 160 });
    expect(await call("servers.setLayout", SRV, { sizes: [160, 20] })).toEqual({ mode: "append" });
    expect(sim.vms.get(3300)!.disks.map((x) => x.sizeGb)).toEqual([160, 20]);
    // another 20 GB later: growing the second disk goes through Edit VPS
    await (await db()).update(vpsLayouts).set({ allowanceGb: 200 }).where(eq(vpsLayouts.serverId, SRV));
    expect(await call("servers.setLayout", SRV, { sizes: [160, 40] })).toEqual({ mode: "grow" });
    expect(edit).toHaveBeenCalledWith(3300, [160, 40]);
    expect(sim.vms.get(3300)!.disks.map((x) => x.sizeGb)).toEqual([160, 40]);
    expect(create).not.toHaveBeenCalled();
    expect(reinstall).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({ vpsid: 3300, status: "running", disk: 160, os: s.os, ip: s.ip });
    expect((await (await db()).select().from(vpsDisks).where(eq(vpsDisks.serverId, SRV))).filter((x) => !x.goneAt).map((x) => x.sizeGb)).toEqual([40]);
    expect(await relayoutRow()).toBeUndefined();
  });

  it("the simulator refuses a shrink through Edit VPS, as the real Virtualizor does", async () => {
    await expect(sim.setDiskLayout(3300, [60, 100])).rejects.toThrow("You cannot shrink the disk space of a vps");
    await expect(sim.setDiskLayout(3300, [200])).resolves.toEqual([0]);
  });

  it("Plan B: no free IP for a second VPS → the old one is deleted first and the new one gets its address", async () => {
    await asUser();
    sim.poolFull = true;
    const create = vi.spyOn(sim, "create"), remove = vi.spyOn(sim, "remove");
    await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: (await row()).hostname });
    await runJobs();
    const after = await row();
    expect(after).toMatchObject({ status: "running", ip: "185.143.232.17", disk: 60, os: "Debian 12" });
    expect(sim.gone.has(3300)).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toMatchObject({ ips: ["185.143.232.17"], node: 1, disks: [60, 100] });
    // the old VPS went before the second create
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[1]);
    expect(sim.vms.get(after.vpsid!)!.ipv4).toEqual(["185.143.232.17"]);
    const tasks = (await (await db()).select().from(serverTasks).where(eq(serverTasks.serverId, SRV))).map((t) => t.action);
    expect(tasks.some((t) => t.includes("جای VPS دوم را ندارد"))).toBe(true);
  });

  it("Plan A refused for another reason: the old VPS stays as it was, with Virtualizor's reason in the log", async () => {
    await asUser();
    const { VirtualizorError } = await import("@/server/virt/virtualizor");
    vi.spyOn(sim, "create").mockRejectedValue(new VirtualizorError("addvs", { os: "Invalid OS template" }));
    await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: (await row()).hostname });
    await runJobs();
    expect(await row()).toMatchObject({ vpsid: 3300, status: "running", disk: 160, os: "Ubuntu 24.04" });
    expect(sim.gone.has(3300)).toBe(false);
    expect(await relayoutRow()).toBeUndefined();
    const d = await db();
    expect((await d.select().from(serverTasks).where(eq(serverTasks.serverId, SRV))).some((t) => t.status === "failed" && t.action.includes("Invalid OS template"))).toBe(true);
    expect((await d.select().from(notifications).where(eq(notifications.userId, "a1"))).some((n) => n.text.includes("Invalid OS template"))).toBe(true);
  });

  it("Plan B create keeps failing → three tries, then manual delivery (undelivered orders) with the full error for staff", async () => {
    await asUser();
    const { VirtualizorError } = await import("@/server/virt/virtualizor");
    const create = vi.spyOn(sim, "create").mockRejectedValue(new VirtualizorError("addvs", "There is not enough space on the storage"));
    const d = await db();
    await d.update(servers).set({ orderRef: "INV-9001:0" }).where(eq(servers.id, SRV));
    await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: (await row()).hostname });
    await runJobs(10);
    // Plan A once, then Plan B three times
    expect(create).toHaveBeenCalledTimes(4);
    expect(sim.gone.has(3300)).toBe(true);
    const s = await row();
    expect(s).toMatchObject({ status: "provisioning", vpsid: null });
    expect(s.provisionError).toContain("not enough space");
    expect(s.provisionTicket).toBeTruthy();
    expect(await relayoutRow()).toMatchObject({ step: "failed", plan: "B" });
    expect((await d.select().from(notifications).where(eq(notifications.userId, "a1"))).some((n) => n.text.includes("تحویل دستی") && n.text.includes("not enough space"))).toBe(true);
    await asAdmin();
    const list = await call<{ key: string; serverId: string; error: string }[]>("provisioning.list");
    expect(list.find((x) => x.serverId === SRV)).toMatchObject({ key: "INV-9001:0" });
    // staff fix the node and retry: the rebuild continues as Plan B (never the original order)
    create.mockRestore();
    await call("provisioning.retry", "INV-9001:0");
    await runJobs();
    expect(await row()).toMatchObject({ status: "running", ip: "185.143.232.17", disk: 60, provisionError: null });
    expect(await relayoutRow()).toBeUndefined();
  });

  it("a retry after a crash mid-job continues from the stored step and never creates twice", async () => {
    await asUser();
    const create = vi.spyOn(sim, "create");
    vi.spyOn(sim, "buildDone").mockResolvedValueOnce(false);
    await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: (await row()).hostname });
    const d = await db();
    await drain(d, 5);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await relayoutRow()).toMatchObject({ step: "build" });
    // the worker died right after addvs, before the new vpsid was stored
    await d.update(vpsRelayout).set({ step: "create", newVpsid: null }).where(eq(vpsRelayout.serverId, SRV));
    // and the delete of the old VPS fails once
    vi.spyOn(sim, "remove").mockRejectedValueOnce(new Error("socket hang up"));
    await runJobs(10);
    expect(create).toHaveBeenCalledTimes(1);
    expect(sim.made.size).toBe(1);
    const s = await row();
    expect(s).toMatchObject({ status: "running", vpsid: [...sim.made.keys()][0], ip: "185.143.232.17" });
    expect(sim.gone.has(3300)).toBe(true);
  });

  it("a relayout that has not touched Virtualizor yet can be cancelled; the server goes back as it was", async () => {
    await asUser();
    const s = await row();
    await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: s.hostname });
    expect((await call<{ relayout: { cancellable: boolean } }>("servers.layout", SRV)).relayout.cancellable).toBe(true);
    await call("servers.cancelRelayout", SRV);
    expect((await row()).status).toBe(s.status);
    expect((await call<{ relayout: unknown }>("servers.layout", SRV)).relayout).toBeNull();
    const d = await db();
    expect(await d.select().from(jobs).where(and(eq(jobs.type, "virt.relayout"), eq(jobs.status, "pending")))).toHaveLength(0);
    await drain(d, 20);
    expect(sim.vms.get(3300)!.disks.map((x) => x.sizeGb)).toEqual([160]);
    expect(await fails("servers.cancelRelayout", SRV)).toContain("لغو");
  });

  it("a paid extra disk must be detached before a destructive layout", async () => {
    await asUser();
    await call("servers.addDisk", SRV, { name: "data", sizeGb: 20 });
    expect(await fails("servers.setLayout", SRV, { sizes: [80, 80], os: "Debian 12", confirm: (await row()).hostname })).toContain("جدا کنید");
  });

  it("an edit Virtualizor refuses shows its reason (not a bare 500), logs a failed task and leaves the row as is", async () => {
    await asUser();
    const s = await row();
    await (await db()).insert(vpsLayouts).values({ serverId: SRV, allowanceGb: 200 });
    const { VirtualizorError } = await import("@/server/virt/virtualizor");
    vi.spyOn(sim, "setDiskLayout").mockRejectedValue(new VirtualizorError("managevps", { space: "Invalid disk size" }));
    const msg = await fails("servers.setLayout", SRV, { sizes: [200] });
    const { errorResponse } = await import("@/server/http");
    const res = errorResponse(await call("servers.setLayout", SRV, { sizes: [200] }).catch((e) => e));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("Invalid disk size");
    expect(msg).toContain("Invalid disk size");
    expect(await row()).toMatchObject({ disk: s.disk, os: s.os });
    const tasks = await (await db()).select().from(serverTasks).where(eq(serverTasks.serverId, SRV));
    expect(tasks.some((t) => t.status === "failed" && t.action.includes("Invalid disk size"))).toBe(true);
  });

  it("the order builder's split is validated and delivered as several disks", async () => {
    await asUser();
    const sku = { t: "custom", cpu: 2, ram: 4, disk: 80, loc: "thr", os: "ubuntu", ips: 0, backup: false };
    expect(await fails("billing.checkout", [{ ...sku, disks: [30, 40] }])).toContain("تقسیم دیسک");
    const inv = await call<{ id: string }>("billing.checkout", [{ ...sku, disks: [30, 50] }]);
    await call("billing.pay", inv.id, "wallet");
    const d = await db();
    await drain(d, 20);
    const [srv] = (await d.select().from(servers).where(eq(servers.userId, "u1"))).filter((x) => x.orderRef?.startsWith(inv.id));
    expect(srv.disk).toBe(30);
    expect(sim.vms.get(srv.vpsid!)!.disks.map((x) => x.sizeGb)).toEqual([30, 50]);
    expect((await d.select().from(vpsDisks).where(eq(vpsDisks.serverId, srv.id))).map((x) => [x.sizeGb, x.billed])).toEqual([[50, false]]);
    expect((await d.select().from(vpsLayouts).where(eq(vpsLayouts.serverId, srv.id)))[0].allowanceGb).toBe(80);
  });
});

describe("charts, logs and the enduser tools (simulator)", () => {
  let sim: SimulatorDriver;
  beforeEach(() => { sim = new SimulatorDriver(); setVirt(sim); sim.adopt({ vpsid: 3300, ipv6: ["2a01:4f8:c0c:1042::1"] }); });

  it("collects samples, rolls them up per hour and serves 1h / 24h / 7d / 30d", async () => {
    const d = await db();
    await collectUsage(d);
    await collectUsage(d);
    const hourly = await d.select().from(usageHourly).where(eq(usageHourly.serverId, SRV));
    expect(hourly).toHaveLength(1);
    expect(hourly[0].n).toBe(2);
    await asUser();
    type Stats = { source: string; points: { cpu: number; ioRead: number }[] };
    // two samples are not enough for a chart: Virtualizor's own history fills the hour
    const h1 = await call<Stats>("servers.stats", SRV, "1h");
    expect(h1.source).toBe("virtualizor");
    expect(h1.points.length).toBeGreaterThan(5);
    await d.insert(usageSamples).values([1, 2, 3].map((i) => ({ serverId: SRV, cpu: 10 * i, ram: 20, disk: 30, netIn: 1, netOut: 2, ioRead: 5, ioWrite: 6, bwUsed: 0, createdAt: new Date(Date.now() - i * 600_000) })));
    const h24 = await call<Stats>("servers.stats", SRV, "24h");
    expect(h24.source).toBe("site");
    expect(h24.points.length).toBeGreaterThanOrEqual(3);
    const m30 = await call<Stats>("servers.stats", SRV, "30d");
    expect(m30.points.length).toBeGreaterThan(100); // demo history, 4-hour buckets
    expect(m30.points.every((p) => p.ioRead >= 0)).toBe(true);
  });

  it("one paginated, filterable log: Virtualizor (in Persian), the site's tasks and the sync's changes", async () => {
    const d = await db();
    sim.edit(3300, { hostname: "changed.example.com" });
    await virtSync(d, { all: true });
    await asUser();
    await call("servers.setHostname", SRV, "web.example.com");
    type Logs = { items: { source: string; text: string }[]; total: number; pages: number; vzError: string };
    const all = await call<Logs>("servers.logs", SRV, { page: 1, source: "all", q: "" });
    expect(all.vzError).toBe("");
    expect(all.items.some((i) => i.source === "virtualizor" && i.text === "ساخت VPS")).toBe(true);
    expect(all.items.some((i) => i.source === "virtualizor" && i.text === "روشن کردن")).toBe(true);
    expect(all.items.some((i) => i.source === "site" && i.text === "تغییر hostname به web.example.com")).toBe(true);
    expect(all.items.some((i) => i.source === "sync" && i.text.includes("changed.example.com"))).toBe(true);
    const onlySync = await call<Logs>("servers.logs", SRV, { page: 1, source: "sync", q: "" });
    expect(onlySync.items.every((i) => i.source === "sync")).toBe(true);
    const q = await call<Logs>("servers.logs", SRV, { page: 1, source: "all", q: "web.example" });
    expect(q.items.length).toBeGreaterThan(0);
    expect(q.items.every((i) => i.text.includes("web.example"))).toBe(true);
    for (let i = 0; i < 25; i++) await d.insert(serverTasks).values({ id: "tx-" + i, serverId: SRV, action: "عملیات " + i });
    const p2 = await call<Logs>("servers.logs", SRV, { page: 2, source: "site", q: "" });
    expect(p2.pages).toBeGreaterThanOrEqual(2);
    expect(p2.items.length).toBeGreaterThan(0);
  });

  it("backups, processes, services, SSH keys and IPv6 PTR: owner only, logged, rate limited", async () => {
    await asUser();
    const s = await row();
    await call("servers.vzBackup", SRV);
    const b = await call<{ enabled: boolean; list: { id: string }[] }>("servers.vzBackups", SRV);
    expect(b.enabled).toBe(true);
    expect(b.list).toHaveLength(1);
    expect(await fails("servers.vzRestore", SRV, b.list[0].id, "nope")).toContain("hostname");
    await call("servers.vzRestore", SRV, b.list[0].id, s.hostname);
    const procs = await call<{ pid: number }[]>("servers.processes", SRV);
    await call("servers.killProcesses", SRV, [procs.at(-1)!.pid]);
    expect((await call<{ pid: number }[]>("servers.processes", SRV)).length).toBe(procs.length - 1);
    expect(await fails("servers.killProcesses", SRV, [1])).toBeTruthy();
    await call("servers.serviceAction", SRV, ["nginx"], "stop");
    expect((await call<{ name: string; running: boolean }[]>("servers.services", SRV)).find((x) => x.name === "nginx")!.running).toBe(false);
    await call("servers.applySshKeys", SRV, ["key-1"]);
    expect(sim.keys.get(3300)![0]).toContain("ssh-ed25519");
    expect(await fails("servers.applySshKeys", SRV, ["key-nope"])).toContain("پیدا نشد");
    const ptr = vi.spyOn(sim, "setPtr");
    await (await db()).update(servers).set({ ipv6: "2a01:4f8:c0c:1042::1" }).where(eq(servers.id, SRV));
    expect(await call("servers.ipv6", SRV)).toEqual(["2a01:4f8:c0c:1042::1"]);
    await call("servers.setPtr6", SRV, "2a01:4f8:c0c:1042::1", "v6.example.com");
    expect(ptr).toHaveBeenCalledWith(3300, "2a01:4f8:c0c:1042::1", "v6.example.com");
    expect(await fails("servers.setPtr6", SRV, "2a01::99", "x.example.com")).toContain("متعلق");
    // the primary address's rDNS goes to Virtualizor too
    await call("servers.setRdns", SRV, "mail.example.com");
    expect(ptr).toHaveBeenCalledWith(3300, "185.143.232.17", "mail.example.com");
    const tasks = (await (await db()).select().from(serverTasks).where(eq(serverTasks.serverId, SRV))).map((t) => t.action);
    for (const t of ["ساخت بکاپ در Virtualizor", "توقف سرویس nginx", "نصب کلید SSH: MacBook Pro", "تنظیم PTR برای 2a01:4f8:c0c:1042::1"]) expect(tasks).toContain(t);
    expect(tasks.some((t) => t.startsWith("بازیابی بکاپ"))).toBe(true);
    // two backups per hour
    await call("servers.vzBackup", SRV);
    expect(await fails("servers.vzBackup", SRV)).toContain("تعداد تلاش‌ها زیاد است");
    // someone else's server
    await call("auth.register", { name: "غریبه", email: "x@example.com", phone: "09351110000", password: "Abcdefg1" });
    for (const m of ["servers.processes", "servers.vzBackups", "servers.layout", "servers.logs", "servers.stats"]) {
      const args = m === "servers.logs" ? [{ page: 1, source: "all", q: "" }] : m === "servers.stats" ? ["1h"] : [];
      expect(await fails(m, SRV, ...args)).toContain("پیدا نشد");
    }
  });
});

describe("Virtualizor request shapes", () => {
  it("disk layout, rDNS, VNC password, logs and history use the documented fields", async () => {
    reply = (u) => act(u) === "managevps" && !u.searchParams.has("editvps") ? { vps: { disks: { 0: { disk_num: "0", primary: "1", st_uuid: "st1", disk_uuid: "d0" }, 1: { disk_num: "1", primary: "0", st_uuid: "st1", disk_uuid: "d1" } } } }
      : act(u) === "logs" ? { logs: { 9: { actid: "9", vpsid: "3300", action: "vps_start", time: "1760000000", status: "1" }, 8: { actid: "8", vpsid: "1", action: "addvs", time: "1760000000" } } }
      : act(u) === "ctasks" ? { tasks: { 21: { actid: "21", vpsid: "3300", action: "rebuild", started: "1760000500", progress: "40", status: "0" } } }
      : act(u) === "statuslogs" ? { statuslogs: { 1: { time: String(Math.floor(Date.now() / 1000) - 60), cpu: "12", ram: "40", disk: "20", net_in: "5", net_out: "7" } } }
      : {};
    const v = real();
    expect(await v.setDiskLayout(3300, [30, 50])).toEqual([0, 1]);
    const post = calls.find((c) => c.body?.get("editvps") === "1")!.body!;
    expect(Object.fromEntries(post)).toMatchObject({ vpsid: "3300", "space[0][size]": "30", "space[0][st_uuid]": "st1", "space[0][disk_uuid]": "d0", "space[1][size]": "50", "space[1][disk_uuid]": "d1" });
    await v.setPtr(3300, "185.1.2.3", "mail.example.com");
    expect(Object.fromEntries(calls.at(-1)!.body!)).toEqual({ rdns: "1", rdns_ip: "185.1.2.3", rdns_domain: "mail.example.com" });
    await v.vncPassword(3300, "secret12");
    expect(Object.fromEntries(calls.at(-1)!.body!)).toEqual({ vncpass: "secret12", conf: "secret12" });
    await v.killProcesses(3300, [77, 78]);
    expect(calls.at(-1)!.body!.getAll("sel_proc[]")).toEqual(["77", "78"]);
    const logs = await v.logs(3300);
    expect(logs.map((l) => [l.action, l.status, l.progress])).toEqual([["rebuild", "running", 40], ["vps_start", "done", 100]]);
    const h = await v.history(3300, Date.now() - 3600_000);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ cpu: 12, ram: 40, netOut: 7 });
  });

  it("addvs for a relayout: several disks, one given node and explicit addresses; a normal order is unchanged", async () => {
    reply = (u) => (act(u) === "addvs" ? { newvs: { vpsid: "5001", ips: { 0: "185.143.232.17" }, ipv6: ["2a01::5"] } } : act(u) === "servergroups" ? { servergroups: { 3: { sgid: "3", sg_name: "thr-cloud" } } } : {});
    const v = real();
    const made = await v.create({ uid: 7, plid: 0, osid: 351, hostname: "web.example.com", rootpass: "Secret-123", serverGroup: "", node: 4, cores: 4, ram: 8192, bandwidth: 2000, disks: [60, 100], stUuid: "st1", ips: ["185.143.232.17"] });
    expect(made).toMatchObject({ vpsid: 5001, ip: "185.143.232.17", ipv6: "2a01::5" });
    const post = calls.find((c) => act(c.url) === "addvs")!.body!;
    expect(Object.fromEntries(post)).toMatchObject({ "space[0][size]": "60", "space[1][size]": "100", "space[0][st_uuid]": "st1", "space[1][st_uuid]": "st1", slave_server: "4", num_ips: "1", cores: "4", ram: "8192", bandwidth: "2000" });
    expect(post.getAll("ips[]")).toEqual(["185.143.232.17"]);
    for (const k of ["space", "node_select", "server_group", "plid"]) expect(post.has(k)).toBe(false);
    expect(calls.some((c) => act(c.url) === "servergroups")).toBe(false);
    calls.length = 0;
    await v.create({ uid: 7, plid: 12, osid: 347, hostname: "a.example.com", rootpass: "Secret-123", serverGroup: "thr-cloud", space: 80, ram: 4096, cores: 2 });
    const plain = calls.find((c) => act(c.url) === "addvs")!.body!;
    expect(Object.fromEntries(plain)).toMatchObject({ space: "80", node_select: "1", server_group: "3", num_ips: "1" });
    expect([...plain.keys()].some((k) => k.startsWith("space[") || k === "slave_server" || k === "ips[]")).toBe(false);
  });

  it("only a lack of room or addresses counts as a capacity refusal (Plan B deletes the old VPS first)", () => {
    for (const m of ["There are no free IPs in the IP pool", "There is no storage available", "The server does not have enough RAM", "Not enough space on the storage", "Insufficient resources on the server"]) expect(isCapacityError(m)).toBe(true);
    for (const m of ["Invalid OS template", "Plan not found for disk", "You cannot shrink the disk space of a vps", "The IP 1.2.3.4 is already in use", "HTTP 403"]) expect(isCapacityError(m)).toBe(false);
  });

  it("vs_status as a list of entries, and garbage status values, are read safely", async () => {
    reply = () => ({ status: [{ vpsid: "1", status: "1" }, { vpsid: "2", status: "" }, { vpsid: "3", status: "7" }] });
    expect((await real().status([1, 2, 3, 4])).map((l) => [l.vpsid, l.status])).toEqual([[1, "running"]]);
  });
});
