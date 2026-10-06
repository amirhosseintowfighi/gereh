import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __getDB as snapshot, __resetDB, api, byId, genPassword, invGross, invTotal } from "@/lib/store";
import { totp } from "@/lib/totp";

/** run an api call to completion with fake timers; resolves to { v } or { e } */
async function settle<T>(p: Promise<T>): Promise<{ v?: T; e?: Error }> {
  const out = p.then((v) => ({ v }), (e: Error) => ({ e }));
  await vi.runAllTimersAsync();
  return out;
}
const ok = async <T,>(p: Promise<T>) => { const r = await settle(p); if (r.e) throw r.e; return r.v as T; };
const fail = async (p: Promise<unknown>) => { const r = await settle(p); expect(r.e).toBeInstanceOf(Error); return r.e!.message; };

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); __resetDB(); });
afterEach(() => { vi.useRealTimers(); });

describe("auth", () => {
  it("logs in users and admins and persists the session", async () => {
    const s = await ok(api.auth.login("demo@gereh.cloud", "x"));
    expect(s).toMatchObject({ role: "user", userId: "u1" });
    expect(JSON.parse(localStorage.getItem("gereh:session")!)).toMatchObject({ role: "user" });
    await ok(api.auth.logout());
    expect(localStorage.getItem("gereh:session")).toBeNull();
    expect(await ok(api.auth.login("admin@gereh.cloud", "x"))).toMatchObject({ role: "admin" });
  });

  it("validates inputs", async () => {
    await fail(api.auth.login("  ", "x"));
    await fail(api.auth.sendOtp("0912"));
    await fail(api.auth.verifyOtp("09121234567", "123"));
    await fail(api.auth.forgot("nope"));
    expect(await ok(api.auth.sendOtp("09121234567"))).toBe(true);
  });
});

describe("billing", () => {
  beforeEach(() => api.auth.demo("user"));

  it("computes invoice totals with VAT", () => {
    const inv = { id: "x", userId: "u1", date: "", due: "", status: "unpaid", items: [{ desc: "a", amount: 1_000_000 }, { desc: "b", amount: 234_000 }] };
    expect(invTotal(inv)).toBe(1_234_000);
    expect(invGross(inv, 10)).toBe(1_357_000);
  });

  it("pays from the wallet, debits the balance and records a transaction", async () => {
    const db = snapshot();
    const inv = byId(db.invoices, "INV-14058")!;
    const gross = invGross(inv, db.settings.tax);
    const before = byId(db.users, "u1")!.balance;
    await ok(api.billing.pay(inv.id, "wallet"));
    const after = snapshot();
    expect(byId(after.invoices, inv.id)!.status).toBe("paid");
    expect(byId(after.users, "u1")!.balance).toBe(before - gross);
    expect(after.transactions[0]).toMatchObject({ type: "payment", amount: -gross, desc: "پرداخت " + inv.id });
  });

  it("refuses double payment and insufficient wallet balance", async () => {
    await fail(api.billing.pay("INV-14031", "wallet"));
    await ok(api.admin.adjustBalance("u1", -byId(snapshot().users, "u1")!.balance, "test"));
    expect(await fail(api.billing.pay("INV-14062", "wallet"))).toContain("موجودی");
    await ok(api.billing.pay("INV-14062", "gateway"));
    expect(byId(snapshot().invoices, "INV-14062")!.status).toBe("paid");
  });

  it("checkout creates an unpaid invoice; empty cart is rejected", async () => {
    await fail(api.billing.checkout([]));
    const inv = await ok(api.billing.checkout([{ title: "VPS", meta: "حرفه‌ای", base: 1_290_000 }]));
    expect(inv).toMatchObject({ status: "unpaid", userId: "u1", items: [{ desc: "VPS، حرفه‌ای", amount: 1_290_000 }] });
    expect(snapshot().invoices[0].id).toBe(inv.id);
  });

  it("never reuses invoice ids across checkout, renewals and manual invoices", async () => {
    const ids = new Set(snapshot().invoices.map((i) => i.id));
    for (let i = 0; i < 60; i++) {
      const created = i % 3 === 0
        ? (await ok(api.billing.checkout([{ title: "x", base: 1 }]))).id
        : i % 3 === 1
          ? (await ok(api.domains.renew("dom-501", 1))).id
          : (await ok(api.billing.createInvoice({ userId: "u2", due: "", items: [{ desc: "m", amount: 1 }] })), snapshot().invoices[0].id);
      expect(ids.has(created)).toBe(false);
      ids.add(created);
    }
  });

  it("topup credits the wallet; refund credits the invoice owner", async () => {
    const before = byId(snapshot().users, "u1")!.balance;
    await ok(api.billing.topup(500_000));
    expect(byId(snapshot().users, "u1")!.balance).toBe(before + 500_000);
    const inv = snapshot().invoices.find((i) => i.userId === "u2")!;
    const u2 = byId(snapshot().users, "u2")!.balance;
    await ok(api.billing.refund(inv.id));
    expect(byId(snapshot().users, "u2")!.balance).toBe(u2 + invGross(inv, snapshot().settings.tax));
  });
});

describe("servers (Virtualizor actions)", () => {
  beforeEach(() => api.auth.demo("user"));

  it("power actions change status and log activity", async () => {
    await ok(api.servers.power("srv-1042", "stop"));
    expect(byId(snapshot().servers, "srv-1042")!.status).toBe("stopped");
    await ok(api.servers.power("srv-1042", "start"));
    expect(byId(snapshot().servers, "srv-1042")!.status).toBe("running");
    expect(snapshot().activity[0].text).toContain("web-prod-1");
  });

  it("rejects weak root / VNC / rescue passwords", async () => {
    await fail(api.servers.resetRootPassword("srv-1042", "short"));
    await ok(api.servers.resetRootPassword("srv-1042", "Str0ngPass"));
    await fail(api.servers.setVncPass("srv-1042", "123"));
    await fail(api.servers.setRescue("srv-1042", true));
    await ok(api.servers.setRescue("srv-1042", true, "rescue1"));
    expect(byId(snapshot().servers, "srv-1042")!.rescue).toBe(true);
  });

  it("firewall rules, snapshots and removal", async () => {
    const n = byId(snapshot().servers, "srv-1042")!.firewall.length;
    await ok(api.servers.addRule("srv-1042", { proto: "TCP", port: "5432", source: "10.0.0.0/8", action: "allow", note: "pg" }));
    const rules = byId(snapshot().servers, "srv-1042")!.firewall;
    expect(rules).toHaveLength(n + 1);
    await ok(api.servers.removeRule("srv-1042", rules.at(-1)!.id));
    expect(byId(snapshot().servers, "srv-1042")!.firewall).toHaveLength(n);

    await ok(api.servers.snapshot("srv-1101"));
    expect(byId(snapshot().servers, "srv-1101")!.snapshots[0].name).toBe("snapshot-1");

    await ok(api.servers.remove("srv-1101"));
    expect(byId(snapshot().servers, "srv-1101")).toBeUndefined();
    expect(await fail(api.servers.power("srv-1101", "start"))).toContain("پیدا نشد");
  });

  it("mutations produce new snapshots (immutability for React Compiler)", async () => {
    const a = snapshot();
    await ok(api.servers.rename("srv-1042", "renamed"));
    const b = snapshot();
    expect(b).not.toBe(a);
    expect(byId(a.servers, "srv-1042")!.name).toBe("web-prod-1");
    expect(byId(b.servers, "srv-1042")!.name).toBe("renamed");
  });
});

describe("account", () => {
  beforeEach(() => api.auth.demo("user"));

  it("enables 2FA only with a valid TOTP for the new secret", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(await fail(api.account.setTwofa(true, secret, "000000"))).toContain("کد");
    expect(snapshot().twofa).toBe(false);
    const code = await totp(secret, Date.now());
    await ok(api.account.setTwofa(true, secret, code));
    expect(snapshot().twofa).toBe(true);
  });

  it("validates profile updates", async () => {
    await fail(api.account.updateProfile({ email: "bad" }));
    await fail(api.account.updateProfile({ phone: "123" }));
    await fail(api.account.updateProfile({ name: " " }));
    await ok(api.account.updateProfile({ name: "نام تازه" }));
    expect(byId(snapshot().users, "u1")!.name).toBe("نام تازه");
  });

  it("validates KYC uploads by type and size", async () => {
    await fail(api.account.submitKyc(new File(["x"], "a.exe", { type: "application/x-msdownload" })));
    await fail(api.account.submitKyc(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })));
    await ok(api.account.submitKyc(new File(["x"], "id.jpg", { type: "image/jpeg" })));
    expect(byId(snapshot().users, "u1")!.kyc).toBe("pending");
  });

  it("API tokens are random and prefixed", async () => {
    const a = await ok(api.account.createToken({ name: "ci", scope: "read", expires: "—" }));
    const b = await ok(api.account.createToken({ name: "ci2", scope: "read", expires: "—" }));
    expect(a).toMatch(/^grh_[a-z0-9]{32}$/);
    expect(a).not.toBe(b);
  });

  it("generated passwords are strong", () => {
    for (let i = 0; i < 20; i++) expect(genPassword()).toHaveLength(16);
  });
});

describe("tickets", () => {
  beforeEach(() => api.auth.demo("user"));

  it("creates tickets with unique ids and tracks reply status", async () => {
    const id = await ok(api.tickets.create({ subject: "s", dept: "فنی", priority: "high", service: "", message: "m" }));
    const id2 = await ok(api.tickets.create({ subject: "s2", dept: "فنی", priority: "low", service: "", message: "m" }));
    expect(id).not.toBe(id2);
    await ok(api.tickets.reply(id, "staff reply", "staff"));
    expect(byId(snapshot().tickets, id)!.status).toBe("answered");
    await ok(api.tickets.reply(id, "thanks"));
    expect(byId(snapshot().tickets, id)!.status).toBe("customer-reply");
    expect(byId(snapshot().tickets, id)!.messages).toHaveLength(3);
  });
});

describe("admin", () => {
  it("impersonation requires an admin session", async () => {
    api.auth.demo("user");
    await fail(api.admin.impersonate("u2"));
    api.auth.demo("admin");
    await ok(api.admin.impersonate("u2"));
    expect(JSON.parse(localStorage.getItem("gereh:session")!)).toMatchObject({ role: "admin", userId: "u2" });
    expect(snapshot().audit[0].action).toBe("ورود به‌جای کاربر");
  });

  it("rejects duplicates for users, nodes and coupons", async () => {
    api.auth.demo("admin");
    await fail(api.admin.createUser({ name: "x", email: "demo@gereh.cloud", phone: "09120000000" }));
    await fail(api.admin.addNode({ id: "thr-hv-01", loc: "thr", model: "x" }));
    await fail(api.admin.saveCoupon({ code: "WELCOME" }));
    await ok(api.admin.saveCoupon({ code: "NEW10", value: 10 }));
    expect(snapshot().coupons[0]).toMatchObject({ code: "NEW10", used: 0, active: true });
    await fail(api.admin.addStaff({ name: "x", email: "bad", role: "r" }));
  });

  it("virtualizor connection test requires host and key", async () => {
    api.auth.demo("admin");
    await fail(api.admin.virtTest({ host: "", port: 4085, key: "" }));
    await ok(api.admin.virtTest({ host: "vz.example.com", port: 4085, key: "k" }));
    expect(snapshot().virt).toMatchObject({ host: "vz.example.com", connected: true });
  });
});
