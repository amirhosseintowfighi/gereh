import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAuth } from "@/server/auth";
import { teamAllows } from "@/server/ctx";
import { purgeCredentials } from "@/server/credentials";
import { activity, jobs, serverCredentials, servers } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { open } from "@/server/secrets";
import { buildState } from "@/server/state";
import { SimulatorDriver, setVirt } from "@/server/virt/driver";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";

const SRV = "srv-1042"; // u1, running, vpsid 3300
type Pending = { serverId: string; kind: string; username: string; name: string; ip: string; revealed: boolean };
const pending = (sid?: string) => call<Pending[]>("servers.pendingCredentials", ...(sid ? [sid] : []));
const rows = async (kind = "root") => (await db()).select().from(serverCredentials).where(and(eq(serverCredentials.serverId, SRV), eq(serverCredentials.kind, kind)));
const mailed = (subject: string, re: RegExp) => re.exec(outbox.filter((m) => m.subject?.startsWith(subject)).at(-1)!.text)![1];
async function runJobs(rounds = 6) {
  const d = await db();
  for (let i = 0; i < rounds; i++) {
    await d.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.status, "pending"));
    if (!(await drain(d, 50))) break;
  }
}

let sim: SimulatorDriver;
beforeEach(async () => {
  await fresh();
  sim = new SimulatorDriver(); setVirt(sim);
  const [s] = await (await db()).select().from(servers).where(eq(servers.id, SRV));
  sim.adopt({ vpsid: 3300, uid: 7, hostname: s.hostname, disks: [{ slot: 0, sizeGb: 160, primary: true }], ipv4: ["185.143.232.17"], ipv6: [], bwLimit: 2000, cores: 4, ramMb: 8192, osName: "Ubuntu 24.04", serverId: 1 });
});
afterEach(() => setVirt(undefined));

describe("one-time root password in the panel", () => {
  it("reinstall: stored sealed, listed without the password, revealed once by the owner, gone after «ذخیره کردم»", async () => {
    await asUser();
    await call("servers.reinstall", SRV, "Debian 12");
    const pass = mailed("نصب مجدد", /رمز root جدید: (\S+)/);
    const [r] = await rows();
    expect(r.passEnc).toMatch(/^v1\./);
    expect(r.passEnc).not.toContain(pass);
    expect(open(r.passEnc)).toBe(pass);
    expect(r.expiresAt.getTime() - r.createdAt.getTime()).toBe(7 * 86400_000);

    const list = await pending();
    expect(list).toEqual([expect.objectContaining({ serverId: SRV, kind: "root", username: "root", ip: "185.143.232.17", revealed: false })]);
    expect(JSON.stringify(list)).not.toContain(pass);
    // never in the cached/broadcast panel state
    const d = await db();
    expect(JSON.stringify(await buildState(d, await readAuth(d), "customer"))).not.toContain(pass);

    expect(await call("servers.revealCredential", SRV, "root")).toBe(pass);
    expect((await pending())[0].revealed).toBe(true);
    const acts = await d.select().from(activity).where(eq(activity.userId, "u1"));
    expect(acts.some((a) => a.text.startsWith("رمز root نمایش داده شد"))).toBe(true);
    expect(acts.some((a) => a.text.includes(pass))).toBe(false);

    await call("servers.ackCredential", SRV, "root");
    expect(await pending()).toEqual([]);
    expect((await rows())[0]).toMatchObject({ passEnc: null });
    expect((await rows())[0].acknowledgedAt).not.toBeNull();
    expect(await fails("servers.revealCredential", SRV, "root")).toContain("رمزی برای نمایش نیست");
  });

  it("only the owner (or a team member who manages servers) sees it; never another customer or staff", async () => {
    await asUser();
    await call("servers.resetRootPassword", SRV, "Strong-Pass-123");
    await call("team.invite", "sara@example.com", "tech", "http://localhost:3000");
    const token = /token=([\w-]+)/.exec(outbox.find((m) => m.subject?.startsWith("دعوت"))!.text)![1];
    // another customer
    jar.clear();
    await call("auth.register", { name: "سارا", email: "sara@example.com", phone: "09351112233", password: "Abcdefg1" });
    expect((await readAuth(await db()))!.uid).not.toBe("u1");
    expect(await pending()).toEqual([]);
    expect(await fails("servers.revealCredential", SRV, "root")).toContain("پیدا نشد");
    // the same person as a «tech» member of the owner's team manages the servers, so sees it
    await call("team.accept", token);
    expect(await readAuth(await db())).toMatchObject({ uid: "u1", teamRole: "tech" });
    expect(await call("servers.revealCredential", SRV, "root")).toBe("Strong-Pass-123");
    // staff, directly and while impersonating the owner
    await asAdmin();
    expect(await fails("servers.revealCredential", SRV, "root")).toContain("پیدا نشد");
    await call("admin.impersonate", "u1");
    expect(await pending()).toEqual([]);
    expect(await fails("servers.revealCredential", SRV, "root")).toContain("پیدا نشد");
    expect(await fails("servers.ackCredential", SRV, "root")).toContain("پیدا نشد");
    expect(open((await rows())[0].passEnc)).toBe("Strong-Pass-123");
    // team: tech/admin roles reach servers.*, billing does not
    expect(teamAllows("billing", "servers.revealCredential")).toBe(false);
    expect(teamAllows("tech", "servers.revealCredential")).toBe(true);
  });

  it("a newer password replaces the pending one; expiry hides it and the daily purge clears it", async () => {
    await asUser();
    await call("servers.resetRootPassword", SRV, "First-Pass-123");
    await call("servers.resetRootPassword", SRV, "Second-Pass-456");
    expect(await rows()).toHaveLength(1);
    expect(await call("servers.revealCredential", SRV, "root")).toBe("Second-Pass-456");
    const d = await db();
    await d.update(serverCredentials).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(serverCredentials.serverId, SRV));
    expect(await pending()).toEqual([]);
    expect(await fails("servers.revealCredential", SRV, "root")).toContain("رمزی برای نمایش نیست");
    await purgeCredentials(d);
    expect((await rows())[0].passEnc).toBeNull();
  });

  it("reveal is rate limited", async () => {
    await asUser();
    await call("servers.resetRootPassword", SRV, "Strong-Pass-123");
    for (let i = 0; i < 10; i++) await call("servers.revealCredential", SRV, "root");
    expect(await fails("servers.revealCredential", SRV, "root")).toBeTruthy();
  });

  it("rescue mode: its password is a «rescue» credential, dropped when rescue ends", async () => {
    await asUser();
    await call("servers.setRescue", SRV, true, "Rescue-77");
    expect((await pending()).map((c) => c.kind)).toEqual(["rescue"]);
    expect(await call("servers.revealCredential", SRV, "rescue")).toBe("Rescue-77");
    await call("servers.setRescue", SRV, false);
    expect(await pending()).toEqual([]);
  });

  it("first delivery: the worker's provisioning and the manual delivery both create one", async () => {
    await asUser();
    const inv = await call<{ id: string }>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    await call("billing.pay", inv.id, "wallet");
    await runJobs();
    const d = await db();
    const [srv] = await d.select().from(servers).where(eq(servers.orderRef, inv.id + ":0"));
    expect(srv.status).toBe("running");
    const pass = mailed("سرور " + srv.name + " آماده است", /رمز: (\S+)/);
    expect((await pending(srv.id))[0]).toMatchObject({ serverId: srv.id, kind: "root" });
    expect(await call("servers.revealCredential", srv.id, "root")).toBe(pass);

    // manual delivery from Admin › undelivered orders
    const inv2 = await call<{ id: string }>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    await call("billing.pay", inv2.id, "wallet");
    await asAdmin();
    const sid = await call<string>("provisioning.deliverServer", inv2.id + ":0", { vpsid: 5555, ip: "185.143.232.99", hostname: "vps5555.gereh.net", rootpass: "Manual-Pass-1" });
    await asUser();
    expect(await call("servers.revealCredential", sid, "root")).toBe("Manual-Pass-1");
  });

  it("disk-layout rebuild (recreate job): the new VPS's password is shown once", async () => {
    await asUser();
    const [s] = await (await db()).select().from(servers).where(eq(servers.id, SRV));
    await call("servers.setLayout", SRV, { sizes: [60, 100], os: "Debian 12", confirm: s.hostname });
    expect(await pending(SRV)).toEqual([]);
    await runJobs();
    const pass = mailed("تغییر چیدمان دیسک", /رمز root جدید: (\S+)/);
    expect(await call("servers.revealCredential", SRV, "root")).toBe(pass);
  });
});
