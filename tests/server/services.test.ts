import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { apiTokens, dnsRecords, firewallRules, servers, sshKeys, tickets, users } from "@/server/db/schema";
import { fingerprint } from "@/server/rpc/account";
import { sha256 } from "@/server/util";
import { asAdmin, asUser, call, db, fails, fresh, login } from "./helpers";

beforeEach(fresh);

describe("servers: ownership and state", () => {
  it("customers can only touch their own servers", async () => {
    await asUser();
    expect(await fails("servers.power", "srv-1200", "stop")).toContain("پیدا نشد");
    await call("servers.power", "srv-1042", "stop");
    expect((await (await db()).select().from(servers).where(eq(servers.id, "srv-1042")))[0].status).toBe("stopped");
  });

  it("suspended servers are read-only for the customer but not for staff", async () => {
    const d = await db();
    await d.update(servers).set({ status: "suspended" }).where(eq(servers.id, "srv-1042"));
    await asUser();
    expect(await fails("servers.reinstall", "srv-1042", "Debian 12")).toContain("معلق");
    expect(await fails("servers.addRule", "srv-1042", { proto: "TCP", port: "22", source: "0.0.0.0/0", action: "allow", note: "" })).toContain("معلق");
    await asAdmin();
    await call("servers.setStatus", "srv-1042", "running");
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1042")))[0].status).toBe("running");
  });

  it("validates firewall rules server-side", async () => {
    await asUser();
    const rule = { proto: "TCP" as const, port: "8100-8000", source: "0.0.0.0/0", action: "allow" as const, note: "" };
    expect(await fails("servers.addRule", "srv-1042", rule)).toContain("پورت");
    expect(await fails("servers.addRule", "srv-1042", { ...rule, port: "70000" })).toContain("پورت");
    expect(await fails("servers.addRule", "srv-1042", { ...rule, port: "22", source: "10.0.0.0/33" })).toContain("مبدأ");
    await call("servers.addRule", "srv-1042", { ...rule, port: "5432", source: "10.0.0.0/8" });
    expect((await (await db()).select().from(firewallRules).where(eq(firewallRules.serverId, "srv-1042")))).toHaveLength(4);
  });

  it("reinstall only offers enabled templates and mails a fresh root password", async () => {
    await asUser();
    expect(await fails("servers.reinstall", "srv-1042", "FreeBSD 14")).toContain("در دسترس نیست");
    await call("servers.reinstall", "srv-1042", "Debian 12");
    const { outbox } = await import("@/server/messaging");
    expect(outbox[0]).toMatchObject({ channel: "email", to: "demo@gereh.cloud" });
    expect(outbox[0].text).toMatch(/رمز root جدید: \S{16}/);
  });

  it("resize refuses shrinking the disk", async () => {
    await asUser();
    expect(await fails("servers.resize", "srv-1043", "c2")).toContain("کاهش");
  });

  it("snapshot limit", async () => {
    await asUser();
    for (let i = 0; i < 4; i++) await call("servers.snapshot", "srv-1042");
    expect(await fails("servers.snapshot", "srv-1042")).toContain("سقف");
  });
});

describe("DNS", () => {
  it("validates records and blocks foreign domains", async () => {
    await asUser();
    const rec = { type: "A" as const, name: "api", value: "1.2.3.4", ttl: 3600 };
    expect(await fails("domains.addRecord", "dom-501", { ...rec, value: "1.2.3" })).toContain("IPv4");
    expect(await fails("domains.addRecord", "dom-501", { ...rec, type: "CNAME", name: "@", value: "x.example.com" })).toContain("ریشه");
    expect(await fails("domains.addRecord", "dom-503", rec)).toContain("مدیریت نمی‌شود");
    expect(await fails("domains.addRecord", "dom-600", rec)).toContain("پیدا نشد");
    await call("domains.addRecord", "dom-501", rec);
    expect((await (await db()).select().from(dnsRecords).where(eq(dnsRecords.domainId, "dom-501")))).toHaveLength(5);
  });

  it("nameserver changes are validated", async () => {
    await asUser();
    expect(await fails("domains.setNs", "dom-501", ["ns1.example.com", "ns1.example.com"])).toContain("تکراری");
    expect(await fails("domains.setNs", "dom-501", ["ns1", "ns2.example.com"])).toContain("معتبر نیست");
    await call("domains.setNs", "dom-501", ["NS1.Example.com.", "ns2.example.com"]);
  });

  it("availability check excludes domains already in the database", async () => {
    const r = await call<{ tld: string; available: boolean }[]>("domains.check", "novin");
    expect(r.find((x) => x.tld === ".studio")).toBeUndefined();
    const cafeland = await call<{ tld: string; available: boolean }[]>("domains.check", "cafeland");
    expect(cafeland.find((x) => x.tld === ".ir")!.available).toBe(false);
  });
});

describe("account", () => {
  it("API tokens are returned once and stored hashed", async () => {
    await asUser();
    const secret = await call<string>("account.createToken", { name: "ci", scope: "read", expires: "۹۰ روز" });
    expect(secret).toMatch(/^grh_[A-Za-z0-9]{40}$/);
    const [row] = await (await db()).select().from(apiTokens);
    expect(row.tokenHash).toBe(sha256(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it("SSH keys get a real SHA256 fingerprint and duplicates are refused", async () => {
    await asUser();
    const pub = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl user@host";
    expect(fingerprint(pub)).toBe("SHA256:" + (await import("node:crypto")).createHash("sha256").update(Buffer.from(pub.split(" ")[1], "base64")).digest("base64").replace(/=+$/, ""));
    await call("account.addKey", { name: "laptop", pub });
    expect(await fails("account.addKey", { name: "again", pub })).toContain("قبلا");
    expect(await fails("account.addKey", { name: "bad", pub: "ssh-ed25519 short" })).toContain("معتبر نیست");
    expect((await (await db()).select().from(sshKeys).where(eq(sshKeys.userId, "u1")))).toHaveLength(2);
  });

  it("changing the password needs the current one and signs out other sessions", async () => {
    await asUser();
    expect(await fails("account.changePassword", "wrong", "NewPass123")).toContain("درست نیست");
    await call("account.changePassword", "Demo1234!", "NewPass123");
    expect(await fails("auth.login", "demo@gereh.cloud", "Demo1234!")).toContain("درست نیست");
    expect(await call("auth.login", "demo@gereh.cloud", "NewPass123")).toMatchObject({ userId: "u1" });
  });
});

describe("tickets", () => {
  it("customer creates and replies, staff answer and record first response", async () => {
    await asUser();
    const id = await call<string>("tickets.create", { subject: "مشکل شبکه", dept: "فنی", priority: "high", service: "srv-1042", message: "سرور به پینگ جواب نمی‌دهد." });
    expect(id).toMatch(/^TK-31\d\d$/);
    expect(await fails("tickets.create", { subject: "x", dept: "فنی", priority: "high", service: "srv-1200", message: "متن طولانی‌تر از ده حرف" })).toBeTruthy();
    expect(await fails("tickets.reply", "TK-3030", "سلام")).toContain("پیدا نشد");
    expect(await fails("tickets.update", id, { priority: "low" })).toContain("اجازه");
    await asAdmin();
    await call("tickets.reply", id, "بررسی شد.", "staff");
    const [t] = await (await db()).select().from(tickets).where(eq(tickets.id, id));
    expect(t.status).toBe("answered");
    expect(t.firstResponseAt).toBeInstanceOf(Date);
    expect(t.assignee).toBe("مدیر سیستم");
  });
});

describe("staff roles", () => {
  it("support staff can answer tickets but cannot touch billing or settings", async () => {
    await login("kaveh@gereh.cloud");
    await call("tickets.reply", "TK-3030", "در حال بررسی", "staff");
    expect(await fails("billing.refund", "INV-14031")).toContain("نقش شما");
    expect(await fails("admin.saveSettings", { tax: 9 })).toContain("نقش شما");
  });

  it("finance staff can refund but not edit products", async () => {
    await login("shima@gereh.cloud");
    await call("billing.refund", "INV-14031");
    expect(await fails("admin.updatePlan", "cloud", "c1", { price: 1 })).toContain("نقش شما");
  });

  it("the last owner cannot be removed, and removal revokes access", async () => {
    await asAdmin();
    expect(await fails("admin.removeStaff", "a1")).toContain("خودتان");
    await call("admin.removeStaff", "st-2");
    const [u] = await (await db()).select().from(users).where(eq(users.id, "st-2"));
    expect(u).toMatchObject({ role: "user", staffRole: null });
  });

  it("admin balance adjustments cannot go negative and are ledgered", async () => {
    await asAdmin();
    expect(await fails("admin.adjustBalance", "u1", -999_999_999, "x")).toContain("منفی");
    await call("admin.adjustBalance", "u1", 100000, "جبران قطعی");
  });
});
