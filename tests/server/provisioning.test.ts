import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VPS } from "@/lib/catalog";
import { jobs, notifications, osTemplates, planMap, servers, tickets, transactions, users } from "@/server/db/schema";
import { SimulatorDriver, setVirt, type CreateVps } from "@/server/virt/driver";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

class Recorder extends SimulatorDriver {
  last: CreateVps | null = null;
  fail = "";
  async create(p: CreateVps) {
    this.last = p;
    if (this.fail) throw new Error(this.fail);
    return super.create(p);
  }
}
let sim: Recorder;
beforeEach(async () => { await fresh(); sim = new Recorder(); setVirt(sim); });
afterEach(() => setVirt(undefined));

type Inv = { id: string };
type Row = { key: string; stage: string; error: string; amount: number; attempts: number; serverId: string | null };
async function runAll() {
  const d = await db();
  for (let i = 0; i < 5; i++) {
    await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending"));
    if (!(await drain(d))) break;
  }
}
/** one pass: every due job runs once (failures are rescheduled into the future) */
async function runOnce() {
  const d = await db();
  await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending"));
  await drain(d);
}
async function order(plan = "c1", cycle: "m" | "q" = "m") {
  await asUser();
  const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan, loc: "thr", cycle }]);
  await call("billing.pay", inv.id, "wallet");
  return inv.id + ":0";
}
const row = async (key: string) => (await (await db()).select().from(servers).where(eq(servers.orderRef, key)))[0];
const job = async (key: string) => (await (await db()).select().from(jobs).where(and(eq(jobs.type, "provision.server"), eq(jobs.dedupe, key))))[0];
const balance = async () => (await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance;

describe("server provisioning", () => {
  it("delivers an order with virt, group and resources sent to Virtualizor", async () => {
    const key = await order("c2", "q");
    await runAll();
    const s = await row(key);
    expect(s).toMatchObject({ status: "running", provisionError: null, cpu: 2, ram: 4, disk: 80 });
    expect(s.vpsid).toBeGreaterThan(0);
    expect(sim.last).toMatchObject({ plid: 11, serverGroup: "thr-cloud", space: 80, ram: 4096, cores: 2, bandwidth: 4000, virt: "" });
    expect(Math.round((s.paidUntil!.getTime() - Date.now()) / 86400_000)).toBeGreaterThanOrEqual(88);
  });

  it("falls back to explicit resources when the plan has no Plan ID", async () => {
    const d = await db();
    await d.update(planMap).set({ plid: 0, virt: "xen" }).where(eq(planMap.id, "c1"));
    const key = await order("c1");
    await runAll();
    expect(sim.last).toMatchObject({ plid: 0, space: 40, ram: 2048, cores: 1, bandwidth: 2000, virt: "xen" });
    expect((await row(key)).status).toBe("running");
  });

  it("a failing create leaves a visible row, one staff ticket and a retrying job", async () => {
    sim.fail = "Virtualizor addvs: There is no storage available";
    const key = await order();
    await runOnce();
    const s = await row(key);
    expect(s).toMatchObject({ status: "provisioning", vpsid: null });
    expect(s.provisionError).toContain("no storage");
    expect((await job(key))).toMatchObject({ status: "pending", attempts: 1 });
    await runOnce();
    expect((await job(key)).attempts).toBe(2);
    const d = await db();
    const tk = await d.select().from(tickets).where(eq(tickets.service, s.id));
    expect(tk).toHaveLength(1);
    expect((await row(key)).provisionTicket).toBe(tk[0].id);
    expect((await d.select().from(notifications).where(eq(notifications.userId, "u1"))).some((n) => n.text.includes("تأخیر"))).toBe(true);
    // the customer cannot delete or operate it
    await asUser();
    expect(await fails("servers.remove", s.id)).toContain("آماده‌سازی");
    expect(await fails("servers.power", s.id, "start")).toContain("تحویل");

    // staff see it and retry after fixing Virtualizor
    await asAdmin();
    const list = await call<Row[]>("provisioning.list");
    expect(list.find((x) => x.key === key)).toMatchObject({ stage: "retrying", serverId: s.id });
    expect(list.find((x) => x.key === key)!.error).toContain("no storage");
    sim.fail = "";
    await call("provisioning.retry", key);
    expect((await job(key))).toMatchObject({ status: "pending", attempts: 0 });
    await runAll();
    expect(await row(key)).toMatchObject({ status: "running", provisionError: null });
    expect(await call<Row[]>("provisioning.list")).toHaveLength(0);
  });

  it("names the missing mapping before calling Virtualizor", async () => {
    await (await db()).update(osTemplates).set({ on: false });
    const key = await order();
    await runOnce();
    expect((await row(key)).provisionError).toContain("قالب سیستم‌عامل");
    expect(sim.last).toBeNull();
  });

  it("manual delivery attaches an existing vpsid and closes the job", async () => {
    sim.fail = "boom";
    const key = await order("c1", "q");
    await runOnce();
    await asAdmin();
    await call("provisioning.deliverServer", key, { vpsid: 5555, rootpass: "Secret-pass-123", note: "ساخت دستی" });
    const s = await row(key);
    expect(s).toMatchObject({ status: "running", vpsid: 5555, provisionError: null, hostname: "vps5555.gereh.net" });
    expect(Math.round((s.paidUntil!.getTime() - Date.now()) / 86400_000)).toBeGreaterThanOrEqual(88);
    const j = await job(key);
    expect(j.status).toBe("done");
    expect((j.payload as { resolved?: { how: string } }).resolved?.how).toBe("manual");
    await runAll();
    expect((await row(key)).vpsid).toBe(5555);
    expect(await fails("provisioning.deliverServer", key, { vpsid: 5556 })).toContain("بسته");
  });

  it("refunds the paid line to the wallet and removes the placeholder", async () => {
    sim.fail = "boom";
    const key = await order("c1");
    await runOnce();
    const sid = (await row(key)).id;
    const before = await balance();
    await asAdmin();
    const amount = await call<number>("provisioning.refund", key, "ظرفیت تمام شد");
    expect(amount).toBe(Math.round((VPS.cloud[0].price * 1.1) / 1000) * 1000);
    expect(await balance()).toBe(before + amount);
    const d = await db();
    expect(await d.select().from(servers).where(eq(servers.id, sid))).toHaveLength(0);
    expect((await d.select().from(transactions).where(and(eq(transactions.userId, "u1"), eq(transactions.type, "refund")))).some((t) => t.amount === amount)).toBe(true);
    expect((await job(key)).status).toBe("done");
    expect(await fails("provisioning.refund", key, "")).toBeTruthy();
    await runAll();
    expect(await row(key)).toBeUndefined();
  });

  it("assigns a server without an order and validates the dry run", async () => {
    await asAdmin();
    const sid = await call<string>("provisioning.assign", { email: "demo@gereh.net", ip: "185.1.2.3", hostname: "manual.gereh.net", plan: "ویژه", cpu: 2, ram: 4, disk: 80, loc: "thr", os: "Ubuntu 24.04", price: 1_000_000, billing: "monthly", months: 1 });
    expect((await (await db()).select().from(servers).where(eq(servers.id, sid)))[0]).toMatchObject({ userId: "u1", status: "running", ip: "185.1.2.3", vpsid: null });
    const out = await call<{ level: string; text: string }[]>("provisioning.dryRun");
    expect(out[0].level).toBe("ok");
    await asUser();
    await expect(call("provisioning.list")).rejects.toThrow();
  });
});
