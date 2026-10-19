import { and, eq, like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Check, OrderDetail, SearchHit, UserActivity, UserOrders, UserServices, UserSummary, UserUsage } from "@/lib/admin-detail";
import { audit, invoices, jobs, osTemplates, servers, tickets, transactions } from "@/server/db/schema";
import { SimulatorDriver, setVirt } from "@/server/virt/driver";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh, login } from "./helpers";

beforeEach(async () => { await fresh(); setVirt(new SimulatorDriver()); });
afterEach(() => setVirt(undefined));

async function runAll() {
  const d = await db();
  for (let i = 0; i < 5; i++) {
    await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending"));
    if (!(await drain(d))) break;
  }
}
async function runOnce() {
  const d = await db();
  await d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.status, "pending"));
  await drain(d);
}
async function buy(skus: unknown[]) {
  await asUser();
  const inv = await call<{ id: string }>("billing.checkout", skus);
  await call("billing.pay", inv.id, "wallet");
  return inv.id;
}
const spec = (d: OrderDetail) => Object.fromEntries(d.item.spec);
const check = (list: Check[], key: Check["key"]) => list.find((c) => c.key === key)!;

describe("order detail", () => {
  it("decodes a custom VPS sku and a domain sku", async () => {
    const inv = await buy([
      { t: "custom", cpu: 2, ram: 4, disk: 80, tb: 2, loc: "thr", os: "debian", ips: 1, backup: true, app: "docker" },
      { t: "domain", name: "gereh-admin-detail-test.com", years: 2 },
    ]);
    await asAdmin();
    const d = await call<OrderDetail>("admin.orderDetail", inv, 0);
    expect(d.customer).toMatchObject({ id: "u1", email: "demo@gereh.net" });
    expect(d.invoice).toMatchObject({ id: inv, status: "paid", method: "کیف پول" });
    expect(d.invoice.lines).toHaveLength(2);
    expect(d.invoice.lines[0].mine).toBe(true);
    expect(d.item).toMatchObject({ type: "server", editable: true, os: "debian", loc: "thr", osid: 351 });
    const s = spec(d);
    expect(s["نوع"]).toBe("سرور ابری سفارشی");
    expect(s["منابع"]).toContain("۲ هسته");
    expect(s["موقعیت"]).toContain("تهران");
    expect(s["گروه سرور Virtualizor"]).toBe("thr-cloud");
    expect(s["سیستم‌عامل"]).toContain("Debian 12");
    expect(s["اپلیکیشن یک‌کلیکی"]).toBe("Docker");
    expect(s["بکاپ"]).toBe("بکاپ روزانه");
    expect(s["IPv4 اضافه"]).toContain("۱");
    expect(d.job).toMatchObject({ type: "provision.server", status: "pending" });
    expect(d.state.state).toBe("pending");

    const dom = await call<OrderDetail>("admin.orderDetail", inv, 1);
    expect(dom.item).toMatchObject({ type: "domain", editable: false });
    expect(spec(dom)).toMatchObject({ "دامنه": "gereh-admin-detail-test.com", "مدت ثبت": "۲ سال", "شناسه ایرنیک": "لازم نیست" });

    await runAll();
    const done = await call<OrderDetail>("admin.orderDetail", inv, 0);
    expect(done.state.state).toBe("delivered");
    expect(done.server?.status).toBe("running");
    expect(done.tasks.length).toBeGreaterThan(0);
    expect((await call<OrderDetail>("admin.orderDetail", inv, 1)).state.state).toBe("delivered");
  });

  it("preflights one order against Virtualizor", async () => {
    const inv = await buy([{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m", os: "debian" }]);
    await asAdmin();
    let out = await call<Check[]>("admin.orderPreflight", inv, 0);
    for (const k of ["conn", "plan", "loc", "os", "virtuser"] as const) expect(check(out, k).ok).toBe(true);
    expect(check(out, "plan").detail).toContain("10");
    await (await db()).update(osTemplates).set({ on: false }).where(eq(osTemplates.distro, "debian"));
    out = await call<Check[]>("admin.orderPreflight", inv, 0);
    expect(check(out, "os")).toMatchObject({ ok: false, href: "/admin/virtualizor" });
    expect(check(out, "os").hint).not.toBe("");
  });

  it("edits the OS of a stuck order, then a retry delivers it", async () => {
    await (await db()).update(osTemplates).set({ on: false }).where(eq(osTemplates.distro, "debian"));
    const inv = await buy([{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m", os: "debian" }]);
    await runOnce();
    const key = inv + ":0";
    const d = await db();
    expect((await d.select().from(servers).where(eq(servers.orderRef, key)))[0].provisionError).toContain("قالب سیستم‌عامل");

    await asAdmin();
    expect(await fails("admin.orderEdit", inv, 0, { os: "beos" })).toContain("معتبر");
    expect(await fails("admin.orderEdit", inv, 0, { osid: 99999 })).toContain("همگام");
    expect(await fails("admin.orderEdit", inv, 0, { plid: 999 })).toContain("Plan ID");
    expect(await call<string[]>("admin.orderEdit", inv, 0, { os: "ubuntu", osid: 342 })).toHaveLength(2);
    expect(check(await call<Check[]>("admin.orderPreflight", inv, 0), "os").ok).toBe(true);
    const detail = await call<OrderDetail>("admin.orderDetail", inv, 0);
    expect(detail.item.osid).toBe(342);
    expect(spec(detail)["سیستم‌عامل"]).toContain("Ubuntu 22.04");
    const [a] = await d.select().from(audit).where(and(eq(audit.target, key), like(audit.action, "ویرایش مشخصات سفارش%")));
    expect(a.action).toContain("osid");

    await call("provisioning.retry", key);
    await runAll();
    const [s] = await d.select().from(servers).where(eq(servers.orderRef, key));
    expect(s).toMatchObject({ status: "running", os: "Ubuntu 22.04", provisionError: null });
    expect(await fails("admin.orderEdit", inv, 0, { os: "debian" })).toContain("ساخته شده");
  });

  it("finance staff can read an order but cannot edit it", async () => {
    const inv = await buy([{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    await login("shima@gereh.net");
    expect((await call<OrderDetail>("admin.orderDetail", inv, 0)).invoiceId).toBe(inv);
    expect(await fails("admin.orderEdit", inv, 0, { os: "ubuntu" })).toContain("اجازه");
  });
});

describe("customer 360", () => {
  it("every tab returns only that customer's data", async () => {
    const inv = await buy([{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    await runAll();
    await asAdmin();
    const d = await db();

    const sum = await call<UserSummary>("admin.userDetail", "u1", "summary");
    expect(sum.user).toMatchObject({ id: "u1", email: "demo@gereh.net", twofa: false });
    expect(sum.counts.servers).toBeGreaterThan(0);
    expect(JSON.stringify(sum)).not.toContain("passwordHash");

    const orders = await call<UserOrders>("admin.userDetail", "u1", "orders");
    const mine = new Set((await d.select({ id: invoices.id }).from(invoices).where(eq(invoices.userId, "u1"))).map((r) => r.id));
    expect(orders.total).toBe(mine.size);
    expect(orders.invoices.every((i) => mine.has(i.id))).toBe(true);
    const line = orders.invoices.find((i) => i.id === inv)!.lines[0];
    expect(line.state.state).toBe("delivered");
    expect(line.decoded).toContain("سرور ابری");

    const svc = await call<UserServices>("admin.userDetail", "u1", "services");
    const myServers = new Set((await d.select({ id: servers.id }).from(servers).where(eq(servers.userId, "u1"))).map((r) => r.id));
    const listed = svc.rows.filter((r) => r.kind === "server");
    expect(listed.length).toBe(myServers.size);
    expect(listed.every((r) => myServers.has(r.id))).toBe(true);

    const usage = await call<UserUsage>("admin.userDetail", "u1", "usage", { tx: { type: "payment", limit: 100 } });
    const myTx = new Set((await d.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, "u1"))).map((r) => r.id));
    expect(usage.tx.length).toBeGreaterThan(0);
    expect(usage.tx.every((x) => myTx.has(x.id) && x.type === "payment")).toBe(true);
    expect(usage.months).toHaveLength(6);
    expect(usage.hourly.data).toHaveLength(30);
    const csv = await call<string>("admin.userTxCsv", "u1", { type: "payment" });
    expect(csv.split("\n")[0]).toContain("id,date,type,amount");
    expect(csv).toContain(inv);

    const act = await call<UserActivity>("admin.userDetail", "u1", "activity");
    const myTk = new Set((await d.select({ id: tickets.id }).from(tickets).where(eq(tickets.userId, "u1"))).map((r) => r.id));
    expect(act.tickets.every((x) => myTk.has(x.id))).toBe(true);
    expect(act.activity.length).toBeGreaterThan(0);

    const other = await call<UserServices>("admin.userDetail", "u2", "services");
    expect(other.rows.some((r) => myServers.has(r.id))).toBe(false);
    expect(await fails("admin.userDetail", "nobody", "summary")).toContain("پیدا نشد");
  });

  it("resets 2FA and sends a notification, both audited", async () => {
    const d = await db();
    const { users } = await import("@/server/db/schema");
    await d.update(users).set({ twofaSecret: "SECRET" }).where(eq(users.id, "u1"));
    await asAdmin();
    await call("admin.resetTwofa", "u1");
    expect((await d.select().from(users).where(eq(users.id, "u1")))[0].twofaSecret).toBeNull();
    await call("admin.notifyUser", "u1", "سرور شما بررسی شد");
    const acts = await d.select().from(audit).where(eq(audit.target, "u1"));
    expect(acts.map((a) => a.action).join(" ")).toContain("دومرحله‌ای");
    expect(acts.map((a) => a.action).join(" ")).toContain("ارسال اعلان");
  });

  it("refuses customers", async () => {
    const inv = await buy([{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    await asUser();
    for (const [m, args] of [["admin.userDetail", ["u1", "summary"]], ["admin.orderDetail", [inv, 0]], ["admin.orderPreflight", [inv, 0]], ["admin.orderEdit", [inv, 0, { os: "ubuntu" }]], ["admin.search", ["demo"]], ["admin.resetTwofa", ["u1"]], ["admin.notifyUser", ["u1", "hello"]], ["admin.userTxCsv", ["u1", {}]]] as const)
      expect(await fails(m, ...args)).toContain("اجازه");
  });
});

describe("admin search", () => {
  it("finds the customer by email, server IP and invoice id", async () => {
    const inv = await buy([{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    await asAdmin();
    const byEmail = await call<SearchHit[]>("admin.search", "demo@gereh");
    expect(byEmail.find((h) => h.kind === "user")?.userId).toBe("u1");
    const byIp = await call<SearchHit[]>("admin.search", "185.143.232.17");
    expect(byIp).toContainEqual(expect.objectContaining({ kind: "server", userId: "u1" }));
    const byInv = await call<SearchHit[]>("admin.search", inv.toLowerCase());
    expect(byInv).toContainEqual(expect.objectContaining({ kind: "invoice", label: inv, userId: "u1" }));
    expect(await call<SearchHit[]>("admin.search", "x")).toEqual([]);
  });
});
