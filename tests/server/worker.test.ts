import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { VPS } from "@/lib/catalog";
import { domains, hosting, invoices, jobs, notifications, schedules, servers, ticketMessages, transactions, usageSamples, users } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { drain, tickSchedule } from "@/server/worker";
import { asUser, call, db, fresh } from "./helpers";

beforeEach(fresh);
type Inv = { id: string };
/** run everything queued, pulling delayed jobs (build polling) forward */
async function runAll() {
  const d = await db();
  for (let i = 0; i < 5; i++) {
    await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending"));
    if (!(await drain(d))) break;
  }
}
const balance = async (id: string) => (await (await db()).select().from(users).where(eq(users.id, id)))[0].balance;

describe("provisioning after payment", () => {
  it("builds the VPS, marks it running and mails the root password once", async () => {
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c2", loc: "thr", cycle: "q", app: "docker" }]);
    await call("billing.pay", inv.id, "wallet");
    await runAll();
    const d = await db();
    const [s] = await d.select().from(servers).where(eq(servers.orderRef, inv.id + ":0"));
    expect(s).toMatchObject({ userId: "u1", plan: "پایه", cpu: 2, ram: 4, disk: 80, status: "running", app: "docker", billing: "monthly" });
    expect(s.vpsid).toBeGreaterThan(0);
    expect(Math.round((s.paidUntil!.getTime() - Date.now()) / 86400_000)).toBeGreaterThanOrEqual(88); // 3 months
    const mail = outbox.find((m) => m.subject?.includes("آماده است"));
    expect(mail?.text).toMatch(/رمز: \S{16}/);
    // a retried job does not create a second server
    const { enqueue } = await import("@/server/jobs");
    await enqueue(d, "provision.server", { userId: "u1", invoiceId: inv.id, index: 0, sku: { t: "plan", kind: "cloud", plan: "c2", loc: "thr", cycle: "q" } });
    await runAll();
    expect(await d.select().from(servers).where(eq(servers.orderRef, inv.id + ":0"))).toHaveLength(1);
  });

  it("hourly servers turn the prepaid month into wallet credit", async () => {
    await asUser();
    const before = await balance("u1");
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m", hourly: true }]);
    await call("billing.pay", inv.id, "wallet");
    await runAll();
    const [s] = await (await db()).select().from(servers).where(eq(servers.orderRef, inv.id + ":0"));
    expect(s.billing).toBe("hourly");
    expect(await balance("u1")).toBe(before - Math.round(VPS.cloud[0].price * 1.1 / 1000) * 1000 + VPS.cloud[0].price);
  });

  it("provisions hosting with a domain and registers domains with DNS", async () => {
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "hosting", plan: "h2", yearly: true, domain: "mynewsite.ir" }, { t: "domain", name: "mynewsite.ir", years: 1 }]);
    await call("billing.pay", inv.id, "wallet");
    await runAll();
    const d = await db();
    const [h] = await d.select().from(hosting).where(eq(hosting.orderRef, inv.id + ":0"));
    expect(h).toMatchObject({ domain: "mynewsite.ir", plan: "نقره", status: "active" });
    expect(h.username).toMatch(/^[a-z0-9]{2,8}$/);
    const [dm] = await d.select().from(domains).where(eq(domains.name, "mynewsite.ir"));
    expect(dm).toMatchObject({ userId: "u1", ns: ["ns1.gereh.net", "ns2.gereh.net"] });
  });
});

describe("recurring billing", () => {
  it("renewal invoices are auto-paid from the wallet when possible", async () => {
    const d = await db();
    await d.update(servers).set({ paidUntil: new Date(Date.now() + 3 * 86400_000) }).where(eq(servers.id, "srv-1042"));
    const before = await balance("u1");
    await (await import("@/server/worker/billing")).renewals(d);
    const [s] = await d.select().from(servers).where(eq(servers.id, "srv-1042"));
    expect(Math.round((s.paidUntil!.getTime() - Date.now()) / 86400_000)).toBeGreaterThanOrEqual(32);
    expect(await balance("u1")).toBeLessThan(before);
    // running it again does not double-bill
    const n = (await d.select().from(invoices)).length;
    await (await import("@/server/worker/billing")).renewals(d);
    expect((await d.select().from(invoices)).length).toBe(n);
  });

  it("without auto-pay the customer gets an invoice and a reminder", async () => {
    const d = await db();
    await d.update(users).set({ autoPay: false }).where(eq(users.id, "u1"));
    await d.update(servers).set({ paidUntil: new Date(Date.now() + 2 * 86400_000) }).where(eq(servers.id, "srv-1043"));
    await (await import("@/server/worker/billing")).renewals(d);
    const open = await d.select().from(invoices).where(and(eq(invoices.userId, "u1"), eq(invoices.status, "unpaid"), sql`${invoices.fulfil} @> '[{"kind":"server","id":"srv-1043"}]'::jsonb`));
    expect(open).toHaveLength(1);
    await drain(d);
    expect(outbox.some((m) => m.subject?.startsWith("صورتحساب تمدید"))).toBe(true);
  });

  it("unpaid services are suspended after 7 days, then terminated after 14 more", async () => {
    const d = await db();
    await d.update(servers).set({ paidUntil: new Date(Date.now() - 8 * 86400_000) }).where(eq(servers.id, "srv-1042"));
    const w = await import("@/server/worker/billing");
    await w.overdue(d);
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1042")))[0].status).toBe("suspended");
    await d.update(servers).set({ suspendedAt: new Date(Date.now() - 15 * 86400_000) }).where(eq(servers.id, "srv-1042"));
    await w.overdue(d);
    expect(await d.select().from(servers).where(eq(servers.id, "srv-1042"))).toHaveLength(0);
  });

  it("paying a renewal lifts the suspension", async () => {
    const d = await db();
    await d.update(servers).set({ status: "suspended", paidUntil: new Date(Date.now() - 9 * 86400_000), suspendedAt: new Date() }).where(eq(servers.id, "srv-1043"));
    await d.update(users).set({ autoPay: false, balance: 5_000_000 }).where(eq(users.id, "u1"));
    await (await import("@/server/worker/billing")).renewals(d);
    const [inv] = await d.select().from(invoices).where(and(eq(invoices.userId, "u1"), eq(invoices.status, "unpaid"), sql`${invoices.fulfil} @> '[{"id":"srv-1043"}]'::jsonb`));
    await asUser();
    await call("billing.pay", inv.id, "wallet");
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1043")))[0].status).toBe("running");
  });

  it("hourly metering charges the wallet and suspends at zero, reactivating after top-up", async () => {
    const d = await db();
    const w = await import("@/server/worker/billing");
    await d.update(users).set({ balance: 3000 }).where(eq(users.id, "u1"));
    await w.hourly(d); // srv-1101 is hourly (773 000/720 ≈ 1 074 per hour)
    expect(await balance("u1")).toBe(3000 - 1074);
    expect((await d.select().from(transactions).where(eq(transactions.type, "usage")))).toHaveLength(1);
    await d.update(users).set({ balance: 10 }).where(eq(users.id, "u1"));
    await w.hourly(d);
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1101")))[0].status).toBe("suspended");
    await d.update(users).set({ balance: 100000 }).where(eq(users.id, "u1"));
    await w.hourly(d);
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1101")))[0].status).toBe("running");
  });
});

describe("referrals", () => {
  it("pays the referrer a commission on the referred customer's invoices", async () => {
    const d = await db();
    await d.update(users).set({ referredBy: "u2", createdAt: new Date() }).where(eq(users.id, "u1"));
    const before = await balance("u2");
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c3", loc: "thr", cycle: "m" }]);
    await call("billing.pay", inv.id, "wallet");
    expect(await balance("u2")).toBe(before + Math.floor(VPS.cloud[2].price / 10 / 1000) * 1000);
    expect((await d.select().from(transactions).where(and(eq(transactions.userId, "u2"), eq(transactions.type, "commission"))))).toHaveLength(1);
  });
});

describe("operations", () => {
  it("usage samples are collected and CPU alerts fire once a day", async () => {
    const d = await db();
    await d.update(servers).set({ alerts: { cpu: 5, bw: 0 } }).where(eq(servers.id, "srv-1042"));
    const ops = await import("@/server/worker/ops");
    for (let i = 0; i < 3; i++) await ops.collectUsage(d);
    expect((await d.select().from(usageSamples).where(eq(usageSamples.serverId, "srv-1042"))).length).toBe(3);
    await ops.usageAlerts(d);
    await ops.usageAlerts(d);
    const n = await d.select().from(notifications).where(sql`${notifications.id} like 'al-srv-1042-cpu-%'`);
    expect(n).toHaveLength(1);
  });

  it("new tickets get an automatic acknowledgement", async () => {
    await asUser();
    const id = await call<string>("tickets.create", { subject: "سؤال", dept: "فروش", priority: "normal", service: "", message: "درباره پلن سازمانی سؤال دارم." });
    await drain(await db());
    const msgs = await (await db()).select().from(ticketMessages).where(eq(ticketMessages.ticketId, id));
    expect(msgs.map((m) => m.name)).toEqual(["امیر رضایی", "پاسخ خودکار گره"]);
    expect(msgs[1].text).toContain("۴ ساعت");
  });

  it("notifications respect the customer's channel preferences", async () => {
    const d = await db();
    const ops = await import("@/server/worker/ops");
    await ops.notifySend(d, { userId: "u1", kind: "news", subject: "خبر", text: "متن" });
    expect(outbox).toHaveLength(0); // news_email is off for the demo customer
    await ops.notifySend(d, { userId: "u1", kind: "billing", subject: "صورتحساب", text: "متن" });
    expect(outbox.map((m) => m.channel).sort()).toEqual(["email", "sms"]);
  });

  it("the scheduler enqueues each periodic job once per interval", async () => {
    const d = await db();
    await tickSchedule(d);
    await tickSchedule(d);
    const queued = await d.select().from(jobs).where(eq(jobs.type, "billing.renewals"));
    expect(queued).toHaveLength(1);
    expect((await d.select().from(schedules)).length).toBeGreaterThanOrEqual(7);
  });

  it("failing jobs back off and eventually stop", async () => {
    const d = await db();
    const { enqueue } = await import("@/server/jobs");
    await enqueue(d, "provision.domain", { userId: "nobody", invoiceId: "X", index: 0, sku: { t: "domain", name: "-bad-", years: 1 } });
    // the registrar simulator rejects nothing, so force a failure through an unknown user on the server path instead
    await enqueue(d, "provision.server", { userId: "ghost", invoiceId: "X", index: 1, sku: { t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" } });
    await drain(d);
    const [j] = await d.select().from(jobs).where(eq(jobs.type, "provision.server"));
    expect(j).toMatchObject({ status: "pending", attempts: 1 });
    expect(j.lastError).toContain("not found");
    expect(j.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });
});
