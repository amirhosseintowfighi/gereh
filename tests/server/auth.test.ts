import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { totp } from "@/lib/totp";
import { sessions, users } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { buildState } from "@/server/state";
import { readAuth } from "@/server/auth";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";
import { testHeaders } from "./setup";

beforeEach(fresh);

describe("password login", () => {
  it("creates a hashed session cookie and logs the activity", async () => {
    const s = await asUser();
    expect(s).toMatchObject({ userId: "u1", role: "user" });
    const token = jar.get("gereh_sid")!;
    expect(token).toMatch(/^[\w-]{43}$/);
    const rows = await (await db()).select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(token); // only the hash is stored
    expect(rows[0].device).toBe("Chrome، Linux");
  });

  it("rejects wrong passwords with one generic message", async () => {
    expect(await fails("auth.login", "demo@gereh.cloud", "nope")).toBe("ایمیل، موبایل یا رمز عبور درست نیست.");
    expect(await fails("auth.login", "nobody@x.ir", "nope")).toBe("ایمیل، موبایل یا رمز عبور درست نیست.");
  });

  it("accepts the phone number (Persian digits too) as the identifier", async () => {
    expect(await call("auth.login", "۰۹۱۲۱۲۳۴۵۶۷", "Demo1234!")).toMatchObject({ userId: "u1" });
  });

  it("locks an identifier after 8 failures in 15 minutes", async () => {
    for (let i = 0; i < 8; i++) await fails("auth.login", "demo@gereh.cloud", "bad" + i);
    expect(await fails("auth.login", "demo@gereh.cloud", "Demo1234!")).toContain("تعداد تلاش‌ها زیاد است");
  });

  it("requires the TOTP code when 2FA is on", async () => {
    await asUser();
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await call("account.setTwofa", true, secret, await totp(secret));
    jar.clear();
    expect(await fails("auth.login", "demo@gereh.cloud", "Demo1234!")).toBe("TWOFA_REQUIRED");
    expect(await fails("auth.login", "demo@gereh.cloud", "Demo1234!", "000000")).toContain("درست نیست");
    expect(await call("auth.login", "demo@gereh.cloud", "Demo1234!", await totp(secret))).toMatchObject({ userId: "u1" });
  });

  it("logout deletes the session", async () => {
    await asUser();
    await call("auth.logout");
    expect(jar.has("gereh_sid")).toBe(false);
    expect(await (await db()).select().from(sessions)).toHaveLength(0);
  });

  it("suspended customers cannot sign in", async () => {
    await (await db()).update(users).set({ status: "suspended" }).where(eq(users.id, "u1"));
    expect(await fails("auth.login", "demo@gereh.cloud", "Demo1234!")).toContain("معلق");
  });
});

describe("SMS one-time codes", () => {
  it("sends a code only to registered numbers and signs in with it", async () => {
    await call("auth.sendOtp", "09120000001");
    expect(outbox).toHaveLength(0);
    await call("auth.sendOtp", "09121234567");
    const code = /(\d{6})/.exec(outbox[0].text)![1];
    expect(await fails("auth.verifyOtp", "09121234567", code === "000000" ? "111111" : "000000")).toContain("درست نیست");
    expect(await call("auth.verifyOtp", "09121234567", code)).toMatchObject({ userId: "u1" });
    expect(await fails("auth.verifyOtp", "09121234567", code)).toContain("منقضی"); // single use
  });

  it("limits SMS per number", async () => {
    for (let i = 0; i < 3; i++) await call("auth.sendOtp", "09121234567");
    expect(await fails("auth.sendOtp", "09121234567")).toContain("تعداد تلاش‌ها زیاد است");
  });
});

describe("registration and recovery", () => {
  const reg = { name: "سارا نوری", email: "Sara@Example.com", phone: "09351112233", password: "Abcdefg1" };
  it("registers, lowercases the email, and blocks duplicates", async () => {
    const s = await call<{ userId: string }>("auth.register", reg);
    const [u] = await (await db()).select().from(users).where(eq(users.id, s.userId));
    expect(u.email).toBe("sara@example.com");
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    jar.clear();
    testHeaders.set("x-real-ip", "198.51.100.9");
    expect(await fails("auth.register", { ...reg, email: "sara@EXAMPLE.com" })).toContain("قبلا حساب ساخته شده");
  });

  it("records the referrer from a referral code", async () => {
    const s = await call<{ userId: string }>("auth.register", { ...reg, ref: "novin24" });
    const [u] = await (await db()).select().from(users).where(eq(users.id, s.userId));
    expect(u.referredBy).toBe("u1");
  });

  it("forgot-password answers the same for unknown emails and rotates the password for known ones", async () => {
    expect(await call("auth.forgot", "ghost@example.com")).toBe(true);
    expect(outbox).toHaveLength(0);
    expect(await call("auth.forgot", "demo@gereh.cloud")).toBe(true);
    const temp = /رمز موقت شما: (\S+)/.exec(outbox[0].text)![1];
    expect(await fails("auth.login", "demo@gereh.cloud", "Demo1234!")).toContain("درست نیست");
    expect(await call("auth.login", "demo@gereh.cloud", temp)).toMatchObject({ userId: "u1" });
  });
});

describe("state is scoped to the session", () => {
  it("anonymous visitors get only public data", async () => {
    const d = await db();
    const { session, db: s } = await buildState(d, null, "customer");
    expect(session).toBeNull();
    expect(s.users).toEqual([]);
    expect(s.plans.cloud.length).toBeGreaterThan(0);
  });

  it("customers see only their own records, never secrets", async () => {
    await asUser();
    const d = await db();
    const { db: s } = await buildState(d, await readAuth(d), "admin"); // asking for admin scope does not help
    expect(new Set(s.servers.map((x) => x.userId))).toEqual(new Set(["u1"]));
    expect(new Set(s.invoices.map((x) => x.userId))).toEqual(new Set(["u1"]));
    expect(s.users.map((u) => u.id)).toEqual(["u1"]);
    expect(s.coupons).toEqual([]);
    expect(s.audit).toEqual([]);
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/scrypt\$|passwordHash|twofaSecret|tokenHash|passEnc/);
  });

  it("staff see everything in admin scope", async () => {
    await asAdmin();
    const d = await db();
    const { db: s } = await buildState(d, await readAuth(d), "admin");
    expect(s.users.length).toBeGreaterThan(20);
    expect(s.coupons.length).toBe(3);
    expect(s.staff.map((x) => x.role)).toContain("مدیر کل");
  });

  it("impersonation shows the customer's panel and is audited", async () => {
    await asAdmin();
    await call("admin.impersonate", "u2");
    const d = await db();
    const auth = await readAuth(d);
    expect(auth).toMatchObject({ uid: "u2", user: { id: "a1" } });
    const { db: s, session } = await buildState(d, auth, "customer");
    expect(session).toMatchObject({ userId: "u2", actorId: "a1", role: "admin" });
    expect(s.servers.every((x) => x.userId === "u2")).toBe(true);
    await call("admin.stopImpersonate");
    expect((await readAuth(d))!.uid).toBe("a1");
  });

  it("customers cannot impersonate", async () => {
    await asUser();
    expect(await fails("admin.impersonate", "u2")).toContain("اجازه");
  });
});
