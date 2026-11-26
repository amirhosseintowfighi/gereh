import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { BIZ_PACKAGES } from "@/lib/business";
import { context } from "@/server/ctx";
import { devopsLeads, users } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { buildState } from "@/server/state";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(fresh);
const form = { name: "حسن رضایی", business: "سوپرمارکت ستاره", phone: "۰۹۱۲ ۱۲۳ ۴۵۶۷", email: "", pkg: "biz-shop", goal: "shop", message: "", consent: true, source: "/business", hp: "" };

describe("business package requests", () => {
  it("joins the sales pipeline with the package's list price and tells sales", async () => {
    jar.clear();
    const { ref } = await call<{ ref: string }>("business.request", form);
    expect(ref).toMatch(/^BZ-\d+$/);
    const [l] = await (await db()).select().from(devopsLeads).where(eq(devopsLeads.id, ref));
    const shop = BIZ_PACKAGES.find((p) => p.id === "biz-shop")!;
    expect(l).toMatchObject({ company: "سوپرمارکت ستاره", phone: "09121234567", email: "", pkg: "biz-shop", services: ["business"], status: "new", value: shop.setup, source: "business:/business" });
    await drain(await db());
    expect(outbox.some((m) => m.subject?.includes("درخواست بسته کسب‌وکار " + ref))).toBe(true);
    // no email given: nothing is sent to the customer
    expect(outbox.some((m) => m.subject?.includes("درخواست شما در گره ثبت شد (" + ref))).toBe(false);
  });

  it("emails the customer when they leave an address; a priced-after-call package has no deal value yet", async () => {
    jar.clear();
    const { ref } = await call<{ ref: string }>("business.request", { ...form, email: "Hasan@Example.com", pkg: "biz-enterprise", goal: "" });
    const [l] = await (await db()).select().from(devopsLeads).where(eq(devopsLeads.id, ref));
    expect(l).toMatchObject({ email: "hasan@example.com", value: 0 });
    await drain(await db());
    expect(outbox.some((m) => m.to === "hasan@example.com" && m.subject?.includes(ref))).toBe(true);
  });

  it("validates input", async () => {
    jar.clear();
    await fails("business.request", { ...form, phone: "123" });
    await fails("business.request", { ...form, email: "bad" });
    await fails("business.request", { ...form, pkg: "biz-free" });
    await fails("business.request", { ...form, business: "x" });
    await fails("business.request", { ...form, consent: false });
  });

  it("drops honeypot submissions silently and rate-limits per IP", async () => {
    jar.clear();
    const before = (await (await db()).select().from(devopsLeads)).length;
    expect(await call("business.request", { ...form, hp: "http://spam" })).toEqual({ ref: "BZ-0" });
    expect(await (await db()).select().from(devopsLeads)).toHaveLength(before);
    for (let i = 0; i < 3; i++) await call("business.request", form);
    await expect(call("business.request", form)).rejects.toThrow();
  });
});

describe("simple panel view", () => {
  it("is saved per person and reaches the session", async () => {
    await asUser();
    const { auth } = await context();
    expect((await buildState((await context()).db, auth, "customer")).session?.panelView).toBeUndefined();
    await call("account.setPanelView", "simple");
    const [u] = await (await db()).select({ v: users.panelView }).from(users).where(eq(users.email, "demo@gereh.net"));
    expect(u.v).toBe("simple");
    const c = await context();
    expect((await buildState(c.db, c.auth, "customer")).session?.panelView).toBe("simple");
    await fails("account.setPanelView", "fancy");
  });

  it("needs a signed-in user", async () => {
    jar.clear();
    await fails("account.setPanelView", "simple");
  });
});
