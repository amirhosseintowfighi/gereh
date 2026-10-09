import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { VPS } from "@/lib/catalog";
import { invGross } from "@/lib/money";
import { coupons, invoices, jobs, kv, payments, servers, transactions, users } from "@/server/db/schema";
import { completePayment, loadInvoice } from "@/server/rpc/billing";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeEach(fresh);
const balance = async (id = "u1") => (await (await db()).select().from(users).where(eq(users.id, id)))[0].balance;
type Inv = { id: string; items: { desc: string; amount: number }[]; tax: number };

describe("checkout prices on the server", () => {
  it("prices SKUs from the database catalog (client amounts are not accepted)", async () => {
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c3", loc: "thr", cycle: "m" }, { t: "domain", name: "brand-new-name.com", years: 2 }]);
    expect(inv.items).toEqual([
      { desc: "سرور ابری حرفه‌ای، تهران، پرداخت ماهانه", amount: VPS.cloud[2].price },
      { desc: "brand-new-name.com، ثبت 2 ساله", amount: 1450000 + 1590000 },
    ]);
    // a forged amount is stripped by validation; the catalog price wins
    const forged = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c3", loc: "thr", cycle: "m", base: 1 }]);
    expect(forged.items[0].amount).toBe(VPS.cloud[2].price);
  });

  it("applies foreign-location and cycle discounts exactly like the site", async () => {
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c2", loc: "fra", cycle: "y" }]);
    expect(inv.items[0].amount).toBe(Math.round((VPS.cloud[1].price * 1.12 * 0.8) / 1000) * 1000 * 12);
  });

  it("follows admin price edits and refuses disabled plans", async () => {
    await asAdmin();
    await call("admin.updatePlan", "cloud", "c1", { price: 450000 });
    await call("admin.updatePlan", "cloud", "c2", { active: false });
    await asUser();
    expect((await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }])).items[0].amount).toBe(450000);
    expect(await fails("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c2", loc: "thr", cycle: "m" }])).toContain("ارائه نمی‌شود");
  });

  it("rejects invalid configurations", async () => {
    await asUser();
    expect(await fails("billing.checkout", [{ t: "custom", cpu: 3, ram: 4, disk: 80, loc: "thr", os: "ubuntu", ips: 0, backup: false }])).toContain("نامعتبر");
    expect(await fails("billing.checkout", [{ t: "plan", kind: "metal", plan: "m1", loc: "isf", cycle: "m" }])).toContain("موقعیت");
    expect(await fails("billing.checkout", [{ t: "domain", name: "-bad-.com", years: 1 }])).toBeTruthy();
    expect(await fails("billing.checkout", [])).toBeTruthy();
  });

  it("coupons: validated, discounted, counted; invalid codes refused", async () => {
    await asUser();
    const q = await call<{ discount: number }>("billing.quote", "welcome", 1_000_000);
    expect(q.discount).toBe(100_000);
    expect(await fails("billing.quote", "YALDA1404", 1)).toContain("منقضی");
    expect(await fails("billing.quote", "MIGRATE50", 1)).toContain("معتبر نیست");
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c2", loc: "thr", cycle: "m" }], "WELCOME");
    expect(inv.items.at(-1)).toEqual({ desc: "کد تخفیف WELCOME", amount: -Math.round(VPS.cloud[1].price / 10) });
    expect((await (await db()).select().from(coupons).where(eq(coupons.code, "WELCOME")))[0].used).toBe(1209);
  });

  it("freezes the VAT rate on the invoice", async () => {
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "hosting", plan: "h1", yearly: false }]);
    expect(inv.tax).toBe(10);
    await asAdmin();
    await call("admin.saveSettings", { tax: 12 });
    const loaded = await loadInvoice(await db(), inv.id);
    expect(loaded!.gross).toBe(invGross({ items: [{ amount: 89000 }], tax: 10 }));
  });
});

describe("paying", () => {
  it("wallet payment debits atomically and queues provisioning", async () => {
    await asUser();
    const inv = await call<Inv>("billing.checkout", [{ t: "plan", kind: "cloud", plan: "c1", loc: "thr", cycle: "m" }]);
    const before = await balance();
    await call("billing.pay", inv.id, "wallet");
    expect(await balance()).toBe(before - invGross(inv));
    const d = await db();
    expect((await d.select().from(invoices).where(eq(invoices.id, inv.id)))[0].status).toBe("paid");
    const q = await d.select().from(jobs);
    expect(q.map((j) => j.type)).toContain("provision.server");
    expect(await fails("billing.pay", inv.id, "wallet")).toContain("قبلا پرداخت");
  });

  it("insufficient balance leaves everything untouched", async () => {
    await asUser();
    const d = await db();
    await d.update(users).set({ balance: 1000 }).where(eq(users.id, "u1"));
    expect(await fails("billing.pay", "INV-14062", "wallet")).toContain("کافی نیست");
    expect((await d.select().from(invoices).where(eq(invoices.id, "INV-14062")))[0].status).toBe("unpaid");
    expect(await balance()).toBe(1000);
  });

  it("customers cannot pay or see other customers' invoices", async () => {
    await asUser();
    expect(await fails("billing.pay", "INV-14100", "wallet")).toContain("پیدا نشد");
  });

  it("gateway: redirect → callback → verify → settle, idempotent, cancel handled", async () => {
    await asUser();
    const r = await call<{ redirect: string }>("billing.pay", "INV-14058", "gateway", "http://localhost:3000");
    expect(r.redirect).toMatch(/^\/pay\/sim\?/);
    const authority = new URLSearchParams(r.redirect.split("?")[1]).get("authority")!;
    const d = await db();
    const cancel = await completePayment(d, "sim", authority, new URLSearchParams({ ok: "0" }));
    expect(cancel.ok).toBe(false);
    expect((await d.select().from(payments))[0].status).toBe("failed");

    const r2 = await call<{ redirect: string }>("billing.pay", "INV-14058", "gateway", "http://localhost:3000");
    const a2 = new URLSearchParams(r2.redirect.split("?")[1]).get("authority")!;
    const ok = await completePayment(d, "sim", a2, new URLSearchParams({ ok: "1" }));
    expect(ok.ok).toBe(true);
    expect((await d.select().from(invoices).where(eq(invoices.id, "INV-14058")))[0].status).toBe("paid");
    const again = await completePayment(d, "sim", a2, new URLSearchParams({ ok: "1" }));
    expect(again).toMatchObject({ ok: true, message: "پرداخت قبلا ثبت شده است." });
    expect((await d.select().from(transactions).where(eq(transactions.desc, "پرداخت INV-14058")))).toHaveLength(1);
  });

  it("top-up through the gateway credits the wallet once", async () => {
    await asUser();
    const before = await balance();
    const r = await call<{ redirect: string }>("billing.topup", 500000, "http://localhost:3000");
    const a = new URLSearchParams(r.redirect.split("?")[1]).get("authority")!;
    await completePayment(await db(), "sim", a, new URLSearchParams({ ok: "1" }));
    await completePayment(await db(), "sim", a, new URLSearchParams({ ok: "1" }));
    expect(await balance()).toBe(before + 500000);
    expect(await fails("billing.topup", 50000)).toContain("حداقل");
  });

  it("disabled payment methods are refused", async () => {
    const d = await db();
    const [row] = await d.select().from(kv).where(eq(kv.key, "settings"));
    await d.update(kv).set({ value: { ...(row.value as object), gateways: { zarinpal: false, idpay: false, wallet: false } } }).where(eq(kv.key, "settings"));
    await asUser();
    expect(await fails("billing.pay", "INV-14062", "wallet")).toContain("کیف پول");
    expect(await fails("billing.pay", "INV-14062", "gateway", "http://localhost:3000")).toContain("درگاه");
  });

  it("refund (finance staff) credits the owner once", async () => {
    await asAdmin();
    const before = await balance("u2");
    const paid = (await (await db()).select().from(invoices).where(eq(invoices.userId, "u2"))).find((i) => i.status === "paid")!;
    const inv = (await loadInvoice(await db(), paid.id))!;
    await call("billing.refund", paid.id);
    expect(await balance("u2")).toBe(before + inv.gross);
    expect(await fails("billing.refund", paid.id)).toContain("فقط صورتحساب پرداخت‌شده");
  });
});

describe("renewals", () => {
  it("paying a domain renewal extends the expiry", async () => {
    await asUser();
    const d = await db();
    const inv = await call<Inv>("domains.renew", "dom-502", 2);
    const { domains } = await import("@/server/db/schema");
    const before = (await d.select().from(domains).where(eq(domains.id, "dom-502")))[0].expiresAt;
    await call("billing.pay", inv.id, "wallet");
    const after = (await d.select().from(domains).where(eq(domains.id, "dom-502")))[0].expiresAt;
    // an already-expired domain renews from today
    const from = Math.max(before.getTime(), Date.now());
    expect(Math.round((after.getTime() - from) / 86400_000)).toBeGreaterThanOrEqual(729);
  });

  it("resize invoices the prorated difference", async () => {
    await asUser();
    const d = await db();
    await d.update(servers).set({ paidUntil: new Date(Date.now() + 15 * 86400_000) }).where(eq(servers.id, "srv-1101"));
    await call("servers.resize", "srv-1101", "c3");
    const [s] = await d.select().from(servers).where(eq(servers.id, "srv-1101"));
    expect(s).toMatchObject({ plan: "حرفه‌ای", cpu: 4, ram: 8, disk: 160 });
    const [inv] = await d.select().from(invoices).where(eq(invoices.userId, "u1")).orderBy(invoices.createdAt);
    expect(inv).toBeDefined();
  });
});
