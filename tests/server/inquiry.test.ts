import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/inquiry/v1/[[...path]]/route";
import { context } from "@/server/ctx";
import { inquiryAccounts, inquiryCalls, transactions, users } from "@/server/db/schema";
import { settleInquiry } from "@/server/inquiry/service";
import { buildState } from "@/server/state";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(fresh);
const KEY = "GerehDemoKey2024", SECRET = "demo-inquiry-secret-0001";
const api = async (method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const fn = method === "GET" ? GET : POST;
  const res = await fn(new Request("http://x/api/inquiry/v1/" + path, { method, headers: { "x-api-key": KEY, "x-api-password": SECRET, "content-type": "application/json", "x-real-ip": "185.10.20.30", ...headers }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ path: path.split("/") }) } as never);
  return { status: res.status, body: await res.json() };
};
const balance = async () => (await (await db()).select({ b: users.balance }).from(users).where(eq(users.id, "u1")))[0].b;

describe("inquiry API", () => {
  it("authenticates by key + password (headers or Basic) and rejects anything else", async () => {
    expect((await api("GET", "balance", undefined, { "x-api-password": "wrong" })).status).toBe(401);
    expect((await api("GET", "balance")).body).toMatchObject({ ok: true, balance: 2450000 });
    const basic = "Basic " + Buffer.from(KEY + ":" + SECRET).toString("base64");
    const res = await GET(new Request("http://x/api/inquiry/v1/balance", { headers: { authorization: basic } }), { params: Promise.resolve({ path: ["balance"] }) } as never);
    expect(res.status).toBe(200);
  });

  it("charges a successful request, never an invalid one, and refunds upstream failures", async () => {
    const before = await balance();
    const ok = await api("POST", "cards", { card: "6037-9912-3456-7893" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, status: "success", charged: 572, result: { bank: "بانک ملی" } });
    expect(await balance()).toBe(before - 572);
    const bad = await api("POST", "cards", { card: "6037991234567894" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: "invalid_input" });
    expect(await balance()).toBe(before - 572);
    // the simulator fails inputs ending in 9999: the reserved amount comes back
    const fail = await api("POST", "postal_code", { postalCode: "1434869999" });
    expect(fail.status).toBe(502);
    expect(await balance()).toBe(before - 572);
    // "not found" is a definitive answer and is billed
    const nf = await api("POST", "postal_code", { postalCode: "1434860000" });
    expect(nf.body).toMatchObject({ ok: true, status: "not_found", charged: 990 });
    // only masked inputs are stored
    const rows = await (await db()).select().from(inquiryCalls).where(eq(inquiryCalls.id, ok.body.trackId));
    expect(rows[0].input).toBe("card=…7893");
  });

  it("sandbox answers are free; approval-only services need a grant", async () => {
    const before = await balance();
    const sb = await api("POST", "cards_iban", { card: "6037991234567893" }, { "x-sandbox": "1" });
    expect(sb.body).toMatchObject({ ok: true, sandbox: true, charged: 0 });
    expect(await balance()).toBe(before);
    expect((await api("POST", "shahkar_lite", { mobile: "09121234567", nationalCode: "0012345679" })).body.error).toMatchObject({ code: "access_required", access: "pending" });
    expect((await api("POST", "identity_v2", { nationalCode: "0012345679", birthDate: "۱۳۷۰/۰۵/۱۲" })).body).toMatchObject({ ok: true, charged: 6950 });
    expect((await api("POST", "nope", {})).status).toBe(404);
  });

  it("insufficient balance is refused before calling the provider; IP allow-list is enforced", async () => {
    await (await db()).update(users).set({ balance: 100 }).where(eq(users.id, "u1"));
    expect((await api("POST", "cards", { card: "6037991234567893" })).body.error).toMatchObject({ code: "insufficient_balance", price: 572 });
    await (await db()).update(inquiryAccounts).set({ ipAllow: ["10.0.0.0/8"] }).where(eq(inquiryAccounts.userId, "u1"));
    expect((await api("GET", "balance")).body.error).toMatchObject({ code: "ip_not_allowed" });
    await (await db()).update(inquiryAccounts).set({ ipAllow: ["185.10.20.0/24"] }).where(eq(inquiryAccounts.userId, "u1"));
    expect((await api("GET", "balance")).status).toBe(200);
  });

  it("settlement writes one usage transaction per customer", async () => {
    await api("POST", "cards", { card: "6037991234567893" });
    await api("POST", "ibans", { iban: "IR820540102680020817909002" });
    await settleInquiry(await db());
    const tx = (await (await db()).select().from(transactions).where(eq(transactions.userId, "u1"))).filter((t) => t.desc.startsWith("API استعلام"));
    expect(tx).toHaveLength(1);
    expect(tx[0].amount).toBe(-1144);
    await settleInquiry(await db());
    expect((await (await db()).select().from(transactions).where(eq(transactions.userId, "u1"))).filter((t) => t.desc.startsWith("API استعلام"))).toHaveLength(1);
  });
});

describe("inquiry panel", () => {
  it("activation needs KYC; reveal, rotate and IP rules", async () => {
    await asUser();
    expect(await call<string>("inquiry.reveal")).toBe(SECRET);
    await call("inquiry.rotate");
    const next = await call<string>("inquiry.reveal");
    expect(next).not.toBe(SECRET);
    expect((await api("GET", "balance")).status).toBe(401);
    expect(await fails("inquiry.setIps", ["not-an-ip"])).toContain("معتبر نیست");
    await call("inquiry.setIps", ["185.10.20.30", "5.6.7.0/24"]);
    // a customer without KYC cannot open an account
    jar.clear();
    await call("auth.register", { name: "بدون احراز", email: "nokyc@example.com", phone: "09351112290", password: "Abcdefg1" });
    expect(await fails("inquiry.activate")).toContain("احراز هویت");
  });

  it("access requests are reviewed by staff; the playground uses the same billing", async () => {
    await asUser();
    expect(await fails("inquiry.requestAccess", "shahkar_lite", "برای تطبیق موبایل در ثبت‌نام کاربران جدید")).toContain("در حال بررسی");
    expect(await fails("inquiry.requestAccess", "cards", "برای تطبیق موبایل در ثبت‌نام کاربران جدید")).toContain("نیاز به درخواست ندارد");
    const r = await call<{ http: number; body: { ok: boolean; charged: number } }>("inquiry.test", "cards", { card: "6037991234567893" }, true);
    expect(r.body).toMatchObject({ ok: true, charged: 0 });
    await asAdmin();
    const c = await context();
    const s = await buildState(c.db, c.auth, "admin");
    const g = s.db.inquiry.grants.find((x) => x.serviceId === "shahkar_lite")!;
    expect(g).toMatchObject({ userId: "u1", status: "pending" });
    expect(await fails("inquiry.decide", g.id, false, "")).toContain("دلیل");
    await call("inquiry.decide", g.id, true, "");
    await call("inquiry.adminService", "cards", { price: 600 });
    await asUser();
    expect((await api("POST", "shahkar_lite", { mobile: "09121234567", nationalCode: "0012345679" })).body).toMatchObject({ ok: true, charged: 1430 });
    expect((await api("POST", "cards", { card: "6037991234567893" })).body.charged).toBe(600);
    const c2 = await context();
    const mine = (await buildState(c2.db, c2.auth, "customer")).db.inquiry;
    expect(mine.account).toMatchObject({ accountNo: 512752, apiKey: KEY });
    expect(JSON.stringify(mine)).not.toContain(SECRET);
    expect(mine.services.find((x) => x.id === "shahkar_lite")!.access).toBe("approved");
  });
});
