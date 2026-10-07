import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { invoices, users } from "@/server/db/schema";
import { buildState } from "@/server/state";
import { readAuth } from "@/server/auth";
import { validNationalCode } from "@/server/rpc/billing";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeEach(fresh);
const official = { name: "شرکت نمونه", nationalId: "0013542419", economicCode: "", address: "تهران، خیابان آزادی، پلاک ۱۰", postalCode: "1234567890" };

describe("official invoices", () => {
  it("validates Iranian national codes", () => {
    expect(validNationalCode("0013542419")).toBe(true);
    expect(validNationalCode("0013542418")).toBe(false);
    expect(validNationalCode("1111111111")).toBe(false);
    expect(validNationalCode("123")).toBe(false);
  });

  it("stores buyer details (Persian digits accepted) and shows them in state", async () => {
    await asUser();
    await call("billing.setOfficial", "INV-14031", { ...official, postalCode: "۱۲۳۴۵۶۷۸۹۰" });
    const [inv] = await (await db()).select().from(invoices).where(eq(invoices.id, "INV-14031"));
    expect(inv.official).toMatchObject({ nationalId: "0013542419", postalCode: "1234567890" });
    const d = await db();
    const s = await buildState(d, await readAuth(d), "customer");
    expect(s.db.invoices.find((i) => i.id === "INV-14031")!.official?.name).toBe("شرکت نمونه");
  });

  it("rejects bad details and other customers' invoices", async () => {
    await asUser();
    expect(await fails("billing.setOfficial", "INV-14031", { ...official, nationalId: "0013542418" })).toContain("کد ملی");
    expect(await fails("billing.setOfficial", "INV-14031", { ...official, postalCode: "12" })).toContain("کد پستی");
    expect(await fails("billing.setOfficial", "INV-14031", { ...official, economicCode: "123" })).toContain("کد اقتصادی");
    expect(await fails("billing.setOfficial", "INV-14100", official)).toContain("پیدا نشد");
  });
});

describe("account switches", () => {
  it("auto-pay can be turned off", async () => {
    await asUser();
    await call("account.setAutoPay", false);
    expect((await (await db()).select().from(users).where(eq(users.id, "u1")))[0].autoPay).toBe(false);
  });

  it("referral stats are part of the customer's state", async () => {
    const d = await db();
    await d.update(users).set({ referredBy: "u1" }).where(eq(users.id, "u5"));
    await asUser();
    const s = await buildState(d, await readAuth(d), "customer");
    expect(s.db.affiliate).toMatchObject({ code: "NOVIN24", referred: 1 });
  });

  it("usage alert thresholds are stored per server", async () => {
    await asUser();
    await call("servers.setAlerts", "srv-1042", { cpu: 90, bw: 80 });
    expect(await fails("servers.setAlerts", "srv-1042", { cpu: 150, bw: 0 })).toBeTruthy();
  });
});
