import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobs, serverCredentials, servers } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { open } from "@/server/secrets";
import { SimulatorDriver, setVirt, type CreateVps } from "@/server/virt/driver";
import { drain } from "@/server/worker";
import { asUser, call, db, fresh } from "./helpers";

/* the root password of a server order never sits in jobs.payload in the clear */
class Recorder extends SimulatorDriver {
  last: CreateVps | null = null;
  slow = false;
  failBuild = false;
  async create(p: CreateVps) { this.last = p; return super.create(p); }
  async buildDone() {
    if (this.failBuild) throw new Error("build check failed (rootpass=" + this.last!.rootpass + ")");
    return !this.slow;
  }
}
let sim: Recorder;
beforeEach(async () => { await fresh(); sim = new Recorder(); setVirt(sim); });
afterEach(() => setVirt(undefined));

async function order() {
  await asUser();
  const inv = await call<{ id: string }>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
  await call("billing.pay", inv.id, "wallet");
  return inv.id + ":0";
}
/** every pending job runs once (jobs a run enqueues for later wait for the next pass) */
async function pass() {
  const d = await db();
  await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending"));
  return drain(d);
}
async function runAll() { for (let i = 0; i < 6; i++) if (!(await pass())) break; }
const row = async (key: string) => (await (await db()).select().from(servers).where(eq(servers.orderRef, key)))[0];
const waitJobs = async (serverId: string) => (await (await db()).select().from(jobs).where(eq(jobs.type, "provision.server"))).filter((j) => (j.payload as { serverId?: string }).serverId === serverId);
const credential = async (serverId: string) => (await (await db()).select().from(serverCredentials).where(and(eq(serverCredentials.serverId, serverId), eq(serverCredentials.kind, "root"))))[0];
const allJobsText = async () => JSON.stringify(await (await db()).select({ payload: jobs.payload, lastError: jobs.lastError }).from(jobs));

describe("provisioning: the root password in job payloads", () => {
  it("a queued build poll carries only a sealed password; the worker still delivers; nothing is left afterwards", async () => {
    sim.slow = true;
    const key = await order();
    await pass();
    const s = await row(key);
    expect(s.status).toBe("building");
    const pass1 = sim.last!.rootpass;
    expect(pass1.length).toBeGreaterThan(8);
    const [w] = await waitJobs(s.id);
    const p = w.payload as Record<string, unknown>;
    expect(p.rootpass).toBeUndefined();
    expect(typeof p.rootpassEnc).toBe("string");
    expect(open(p.rootpassEnc as string)).toBe(pass1);
    expect(JSON.stringify(p)).not.toContain(pass1);

    // still building: the next poll is queued sealed too
    await pass();
    expect((await waitJobs(s.id)).length).toBeGreaterThanOrEqual(2);
    expect(await allJobsText()).not.toContain(pass1);

    sim.slow = false;
    await runAll();
    expect((await row(key)).status).toBe("running");
    expect(open((await credential(s.id)).passEnc)).toBe(pass1);
    expect(outbox.find((m) => m.subject?.includes("آماده است") && m.text.includes(pass1))).toBeDefined();
    // finished: no job row keeps the password, sealed or plain, and the credential mail's text is gone too
    for (const j of await waitJobs(s.id)) expect(Object.keys(j.payload as object)).not.toEqual(expect.arrayContaining(["rootpassEnc"]));
    const mails = (await (await db()).select().from(jobs).where(eq(jobs.type, "notify.send"))).filter((j) => (j.payload as { secret?: boolean }).secret);
    expect(mails.length).toBeGreaterThan(0);
    for (const m of mails) expect(m.payload).not.toHaveProperty("textEnc");
    expect(await allJobsText()).not.toContain(pass1);
  });

  it("a job queued before sealing (plain rootpass) still delivers, and is scrubbed afterwards", async () => {
    sim.slow = true;
    const key = await order();
    await pass();
    const s = await row(key);
    const d = await db();
    // replace the sealed poll with one in the old format
    await d.delete(jobs).where(and(eq(jobs.type, "provision.server"), eq(jobs.status, "pending")));
    await d.insert(jobs).values({ type: "provision.server", payload: { phase: "wait", serverId: s.id, rootpass: "Legacy-Pass-123", tries: 0 } });
    sim.slow = false;
    await runAll();
    expect((await row(key)).status).toBe("running");
    expect(open((await credential(s.id)).passEnc)).toBe("Legacy-Pass-123");
    expect(await allJobsText()).not.toContain("Legacy-Pass-123");
  });

  it("the sealed value wins over a plain one, and an error never stores the password", async () => {
    sim.slow = true;
    const key = await order();
    await pass();
    const s = await row(key);
    const pass1 = sim.last!.rootpass;
    const d = await db();
    const { rootpassEnc } = (await waitJobs(s.id))[0].payload as { rootpassEnc: string };
    await d.update(jobs).set({ payload: { phase: "wait", serverId: s.id, rootpass: "Old-Plain-999", rootpassEnc, tries: 0 } })
      .where(and(eq(jobs.type, "provision.server"), eq(jobs.status, "pending")));
    sim.failBuild = true;
    await pass();
    const [failed] = (await waitJobs(s.id)).filter((j) => j.lastError);
    expect(failed.lastError).toContain("rootpass=***");
    expect(failed.lastError).not.toContain(pass1);
    sim.failBuild = false;
    sim.slow = false;
    await runAll();
    expect(open((await credential(s.id)).passEnc)).toBe(pass1);
    expect(await allJobsText()).not.toContain(pass1);
  });
});
