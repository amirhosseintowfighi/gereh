import { generateKeyPairSync, verify, createPublicKey } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { totp } from "@/lib/totp";
import { calcTotal, levelAllows, methodLevel, nextRun, type BillingExtrasView, type TeamRoleView, type VpsExtrasView } from "@/lib/vps-billing";
import { customAllows, pushEndpointOk, vapidJwt } from "@/server/account-extras";
import type { Auth } from "@/server/auth";
import { creditForecast, debit, saveDoc } from "@/server/billing-extras";
import { invoices, notifications, servers, snapshots, subWallets, teamMembers, transactions, users, vpsDisks, vpsIps, vpsSnapSchedules, vpsTraffic, vpsTrafficDaily } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { SimulatorDriver } from "@/server/virt/driver";
import { drain } from "@/server/worker";
import { hourly } from "@/server/worker/billing";
import { notifySend } from "@/server/worker/ops";
import { meterTraffic, vpsBilling, vpsSnapshots } from "@/server/worker/vps";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(fresh);
const SRV = "srv-1042"; // u1, running, monthly, vpsid 3300
const extras = () => call<VpsExtrasView>("servers.extras", SRV);
const balance = async (uid = "u1") => (await (await db()).select({ b: users.balance }).from(users).where(eq(users.id, uid)))[0].b;
const setBalance = async (b: number, uid = "u1") => (await db()).update(users).set({ balance: b }).where(eq(users.id, uid));

describe("pure helpers", () => {
  it("next scheduled run in Tehran time", () => {
    const from = new Date("2026-10-13T10:00:00Z"); // 13:30 Tehran, Tuesday
    expect(nextRun(from, "daily", 3, 0).toISOString()).toBe("2026-10-13T23:30:00.000Z"); // 03:00 Wednesday Tehran
    expect(nextRun(from, "daily", 14, 0).toISOString()).toBe("2026-10-13T10:30:00.000Z");
    const w = nextRun(from, "weekly", 3, 5);
    expect(new Date(w.getTime() + 3.5 * 3600_000).getUTCDay()).toBe(5);
    expect(w > from).toBe(true);
  });
  it("method levels for custom team roles", () => {
    expect(methodLevel("servers.extras")).toBe("view");
    expect(methodLevel("paas.deploy")).toBe("deploy");
    expect(methodLevel("servers.power")).toBe("operate");
    expect(methodLevel("servers.snapshot")).toBe("operate");
    expect(methodLevel("servers.remove")).toBe("manage");
    expect(methodLevel("servers.addIp")).toBe("manage");
    expect(levelAllows("operate", "deploy")).toBe(true);
    expect(levelAllows("view", "operate")).toBe(false);
    expect(levelAllows(undefined, "view")).toBe(false);
  });
  it("cost calculator totals", () => {
    const cat = [{ group: "vps", label: "", icon: "", unit: "", items: [{ id: "c1", name: "", monthly: 100, meta: "" }] }];
    expect(calcTotal(cat, [{ group: "vps", id: "c1", qty: 2 }, { group: "x", id: "y", qty: 1 }], 3)).toEqual({ monthly: 200, months: 3, total: 600 });
    expect(calcTotal(cat, [{ group: "vps", id: "c1", qty: 1 }], 40).months).toBe(12);
  });
  it("push endpoints are limited to browser push services; VAPID JWT verifies", () => {
    expect(pushEndpointOk("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(pushEndpointOk("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(pushEndpointOk("https://169.254.169.254/latest")).toBe(false);
    expect(pushEndpointOk("http://fcm.googleapis.com/x")).toBe(false);
    expect(pushEndpointOk("https://evil.example/fcm.googleapis.com")).toBe(false);
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = privateKey.export({ format: "jwk" });
    const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
    process.env.VAPID_PUBLIC_KEY = raw.toString("base64url");
    process.env.VAPID_PRIVATE_KEY = jwk.d!;
    try {
      const jwt = vapidJwt("https://fcm.googleapis.com")!;
      const [h, b, sig] = jwt.split(".");
      expect(JSON.parse(Buffer.from(b, "base64url").toString()).aud).toBe("https://fcm.googleapis.com");
      expect(verify("sha256", Buffer.from(h + "." + b), { key: createPublicKey(publicKey.export({ format: "pem", type: "spki" })), dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
    } finally { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; }
  });
  it("simulator driver: extra IPs, disks, console", async () => {
    const d = new SimulatorDriver();
    const ips = await d.setIps(10, ["1.1.1.1"], 3);
    expect(ips).toHaveLength(3);
    expect(ips[0]).toBe("1.1.1.1");
    expect(await d.addDisk(10)).toBe(1);
    expect(await d.addDisk(10)).toBe(2);
    expect((await d.vnc(10)).ws).toBe("");
  });
});

describe("cloud server extras", () => {
  it("extra IPv4: add, PTR per address, remove; needs credit", async () => {
    await asUser();
    const ip = await call<string>("servers.addIp", SRV);
    let x = await extras();
    expect(x.ips).toHaveLength(2);
    expect(x.ips[1]).toMatchObject({ ip, primary: false });
    await call("servers.setPtr", SRV, x.ips[1].id, "mail.novin.studio.");
    await call("servers.setPtr", SRV, "primary", "web.novin.studio");
    expect(await fails("servers.setPtr", SRV, "primary", "not a host")).toContain("معتبر نیست");
    x = await extras();
    expect(x.ips.map((i) => i.rdns)).toEqual(["web.novin.studio", "mail.novin.studio"]);
    await call("servers.networkReset", SRV);
    await call("servers.removeIp", SRV, x.ips[1].id);
    expect((await extras()).ips).toHaveLength(1);
    await setBalance(0);
    expect(await fails("servers.addIp", SRV)).toContain("موجودی");
  });

  it("another customer cannot touch the server", async () => {
    await call("auth.register", { name: "غریبه", email: "x@example.com", phone: "09351110000", password: "Abcdefg1" });
    expect(await fails("servers.addIp", SRV)).toContain("پیدا نشد");
    expect(await fails("servers.extras", SRV)).toContain("پیدا نشد");
  });

  it("extra disks: create, grow only, detach, attach, delete", async () => {
    await asUser();
    expect(await fails("servers.addDisk", SRV, { name: "Bad Name", sizeGb: 20 })).toContain("نام دیسک");
    const id = await call<string>("servers.addDisk", SRV, { name: "data", sizeGb: 50 });
    expect(await fails("servers.resizeDisk", id, 40)).toContain("فقط افزایش");
    await call("servers.resizeDisk", id, 80);
    expect(await fails("servers.deleteDisk", id, "data")).toContain("جدا کنید");
    await call("servers.detachDisk", id);
    const x = await extras();
    expect(x.disks).toHaveLength(0);
    expect(x.spareDisks).toEqual([{ id, name: "data", sizeGb: 80 }]);
    expect(await fails("servers.attachDisk", id, "srv-1101")).toContain("همان موقعیت"); // fra vs thr
    await call("servers.attachDisk", id, "srv-1043");
    expect((await call<VpsExtrasView>("servers.extras", "srv-1043")).disks[0]).toMatchObject({ name: "data", sizeGb: 80 });
    await call("servers.detachDisk", id);
    expect(await fails("servers.deleteDisk", id, "nope")).toContain("نام دیسک");
    await call("servers.deleteDisk", id, "data");
    expect(await (await db()).select().from(vpsDisks)).toHaveLength(0);
  });

  it("snapshot schedule creates auto snapshots and keeps the retention; manual limit ignores them", async () => {
    await asUser();
    await call("servers.setSnapSchedule", SRV, { frequency: "daily", retention: 2, hour: 3, weekday: 0 });
    const d = await db();
    await d.delete(snapshots).where(eq(snapshots.serverId, SRV));
    for (let i = 0; i < 3; i++) {
      await d.update(vpsSnapSchedules).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(vpsSnapSchedules.serverId, SRV));
      await vpsSnapshots(d);
    }
    const autos = await d.select().from(snapshots).where(and(eq(snapshots.serverId, SRV), like(snapshots.name, "auto-%")));
    expect(autos.length).toBe(2);
    const [sc] = await d.select().from(vpsSnapSchedules).where(eq(vpsSnapSchedules.serverId, SRV));
    expect(sc.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(await fails("servers.snapshot", SRV, "auto-mine")).toContain("رزرو");
    for (let i = 0; i < 5; i++) await call("servers.snapshot", SRV, "m" + i);
    expect(await fails("servers.snapshot", SRV, "m6")).toContain("سقف");
    expect((await extras()).schedule).toMatchObject({ frequency: "daily", retention: 2 });
    await call("servers.setSnapSchedule", SRV, null);
    expect((await extras()).schedule).toBeNull();
  });

  it("traffic: daily usage, 80/100% alerts, automatic packs", async () => {
    await asUser();
    const d = await db();
    await d.update(servers).set({ bwLimit: 100_000 }).where(eq(servers.id, SRV));
    await meterTraffic(d);
    let x = await extras();
    expect(x.traffic.days.length).toBeGreaterThan(0);
    expect(x.traffic.usedGb).toBeGreaterThan(0);
    const used = x.traffic.usedGb;
    // quota just above usage → 80% alert
    await d.update(servers).set({ bwLimit: Math.ceil(used / 0.9) }).where(eq(servers.id, SRV));
    await meterTraffic(d);
    expect((await d.select().from(notifications).where(eq(notifications.userId, "u1"))).some((n) => n.text.startsWith("۸۰٪ سهمیه ترافیک"))).toBe(true);
    // quota exhausted with auto-buy on → a pack is bought
    await call("servers.setTrafficAutoBuy", SRV, true);
    await d.update(servers).set({ bwLimit: Math.floor(used / 2) }).where(eq(servers.id, SRV));
    const before = await balance();
    await meterTraffic(d);
    x = await extras();
    expect(x.traffic.packs).toBe(1);
    expect(x.traffic.extraGb).toBe(x.prices.packGb);
    expect(await balance()).toBe(before - x.prices.packPrice);
    expect((await d.select().from(transactions).where(eq(transactions.userId, "u1"))).some((t) => t.desc.startsWith("بسته ترافیک"))).toBe(true);
    // manual purchase without credit
    await setBalance(0);
    expect(await fails("servers.buyTraffic", SRV)).toContain("کافی نیست");
    await d.update(vpsTraffic).set({ month: "2000-01" }).where(eq(vpsTraffic.serverId, SRV));
    expect((await extras()).traffic.packs).toBe(0); // new month resets packs
    expect((await d.select().from(vpsTrafficDaily)).length).toBeGreaterThan(0);
  });

  it("plan change needs a stopped server; a smaller plan keeps the disk and refunds the difference", async () => {
    await asUser();
    expect(await fails("servers.changePlan", SRV, "c1")).toContain("خاموش");
    await call("servers.power", SRV, "stop");
    await (await db()).update(servers).set({ price: 20_000_000 }).where(eq(servers.id, SRV));
    const before = await balance();
    await call("servers.changePlan", SRV, "c1");
    const [s] = await (await db()).select().from(servers).where(eq(servers.id, SRV));
    expect(s).toMatchObject({ cpu: 1, ram: 2, disk: 160, plan: "استارت" });
    expect(s.price).toBeGreaterThan(0);
    expect(await balance()).toBeGreaterThan(before);
  });

  it("firewall groups apply to many servers", async () => {
    await asUser();
    expect(await fails("servers.fwGroupSave", { name: "web", rules: [{ proto: "TCP", port: "99999", source: "0.0.0.0/0", action: "allow", note: "" }] })).toContain("پورت");
    const gid = await call<string>("servers.fwGroupSave", { name: "web", rules: [{ proto: "TCP", port: "80,443", source: "0.0.0.0/0", action: "allow", note: "وب" }] });
    await call("servers.fwGroupAttach", gid, SRV, true);
    await call("servers.fwGroupAttach", gid, "srv-1043", true);
    const g = (await extras()).groups.find((x) => x.id === gid)!;
    expect(g).toMatchObject({ attached: true, servers: 2 });
    await call("servers.fwGroupAttach", gid, SRV, false);
    expect((await extras()).groups[0].attached).toBe(false);
    await call("servers.fwGroupDelete", gid);
    expect((await extras()).groups).toHaveLength(0);
  });

  it("console returns the websocket details (simulator: none) and only while running", async () => {
    await asUser();
    expect(await call("servers.vnc", SRV)).toMatchObject({ ws: "" });
    expect(await fails("servers.vnc", "srv-1101")).toContain("خاموش");
  });

  it("hourly add-on charges", async () => {
    await asUser();
    await call("servers.addIp", SRV);
    await call("servers.addDisk", SRV, { name: "data", sizeGb: 100 });
    const before = await balance();
    await vpsBilling(await db());
    expect(await balance()).toBeLessThan(before);
    expect((await (await db()).select().from(transactions).where(eq(transactions.userId, "u1"))).some((t) => t.desc.startsWith("افزونه‌های سرور web-prod-1"))).toBe(true);
  });
});

describe("wallets, budgets and invoices", () => {
  it("project wallets: transfer, link a server, hourly billing draws from it", async () => {
    await asUser();
    const wid = await call<string>("billing.createWallet", "پروژه الف");
    await call("billing.transfer", "", wid, 500_000, "شروع");
    expect(await fails("billing.transfer", wid, "", 900_000)).toContain("کافی نیست");
    await call("billing.linkServer", "srv-1101", wid);
    const main = await balance();
    await hourly(await db());
    const [w] = await (await db()).select().from(subWallets).where(eq(subWallets.id, wid));
    expect(w.balance).toBeLessThan(500_000);
    expect(await balance()).toBe(main);
    const v = await call<BillingExtrasView>("billing.extras");
    expect(v.wallets[0]).toMatchObject({ name: "پروژه الف", servers: [{ id: "srv-1101" }] });
    expect(v.transfers[0]).toMatchObject({ from: "کیف پول اصلی", to: "پروژه الف", amount: 500_000 });
    await call("billing.deleteWallet", wid);
    expect(await balance()).toBe(main + w.balance);
  });

  it("negative-balance grace keeps hourly servers running", async () => {
    const d = await db();
    await setBalance(0);
    await d.update(servers).set({ status: "running" }).where(eq(servers.id, "srv-1101"));
    await saveDoc(d, "billing_policy", { negativeGrace: 1_000_000 });
    await hourly(d);
    expect(await balance()).toBeLessThan(0);
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1101")))[0].status).toBe("running");
    await saveDoc(d, "billing_policy", { negativeGrace: 0 });
    await hourly(d);
    expect((await d.select().from(servers).where(eq(servers.id, "srv-1101")))[0].status).toBe("suspended");
  });

  it("forecast and low-credit alert", async () => {
    const d = await db();
    await debit(d, "u1", 700_000, "مصرف ساعتی سرور تست");
    const f = await creditForecast(d, "u1");
    expect(f.burn).toBe(100_000);
    expect(f.days).toBeGreaterThan(200);
    await setBalance(200_000); // below 3 days of burn
    await vpsBilling(d);
    expect((await d.select().from(notifications).where(eq(notifications.userId, "u1"))).some((n) => n.text.includes("کمتر از آستانه"))).toBe(true);
    await asUser();
    await call("billing.setLowCredit", { auto: false, amount: 50_000 });
    expect((await call<BillingExtrasView>("billing.extras")).forecast).toMatchObject({ auto: false, threshold: 50_000 });
  });

  it("budget caps block purchases and alert", async () => {
    await asUser();
    expect(await fails("billing.setBudget", { service: "nope", monthlyCap: 100_000, alertPct: 80, block: false })).toContain("نامعتبر");
    await call("billing.setBudget", { service: "vps", monthlyCap: 10_000, alertPct: 50, block: true });
    const d = await db();
    await debit(d, "u1", 9_000, "افزونه‌های سرور web-prod-1: تست");
    expect(await fails("servers.addIp", SRV)).toContain("سقف بودجه");
    await vpsBilling(d);
    expect((await d.select().from(notifications).where(eq(notifications.userId, "u1"))).some((n) => n.text.includes("سقف بودجه"))).toBe(true);
    const v = await call<BillingExtrasView>("billing.extras");
    expect(v.budgets[0].spent).toBeGreaterThanOrEqual(9_000);
    await call("billing.removeBudget", "vps");
    await call("servers.addIp", SRV);
  });

  it("invoice profiles", async () => {
    await asUser();
    const p = { label: "شرکت", name: "استودیو نوین", nationalId: "10103218540", economicCode: "", address: "تهران، خیابان آزادی، پلاک ۱۰", postalCode: "1234567890", isDefault: true };
    expect(await fails("billing.saveProfile", { ...p, nationalId: "123" })).toContain("کد ملی");
    const pid = await call<string>("billing.saveProfile", p);
    const [inv] = await (await db()).select().from(invoices).where(eq(invoices.userId, "u1"));
    await call("billing.useProfile", inv.id, pid);
    const [after] = await (await db()).select().from(invoices).where(eq(invoices.id, inv.id));
    expect(after.official).toMatchObject({ name: "استودیو نوین", nationalId: "10103218540" });
    expect((await call<BillingExtrasView>("billing.extras")).profiles).toHaveLength(1);
  });

  it("staff: account levels, add-on prices", async () => {
    await asUser();
    expect(await fails("billing.adminSetLevel", "u1", "startup")).toContain("اجازه");
    await asAdmin();
    await call("billing.adminSetLevel", "u1", "enterprise");
    await call("billing.adminSavePrices", { ip: 300_000, diskGb: 10_000, snapshotGb: 2_000, packGb: 500, packPrice: 400_000, maxIps: 4, maxDisks: 2, maxDiskGb: 1000 });
    await call("billing.adminSavePolicy", { negativeGrace: 50_000 });
    await asUser();
    expect((await call<BillingExtrasView>("billing.extras")).level.id).toBe("enterprise");
    expect((await extras()).prices).toMatchObject({ ip: 300_000, packGb: 500 });
  });
});

describe("account and team extras", () => {
  it("2FA recovery codes work once", async () => {
    await asUser();
    expect(await fails("account.recoveryCodes")).toContain("ابتدا");
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await call("account.setTwofa", true, secret, await totp(secret));
    const codes = await call<string[]>("account.recoveryCodes");
    expect(codes).toHaveLength(10);
    jar.clear();
    expect(await call("auth.login", "demo@gereh.net", "Demo1234!", codes[0])).toMatchObject({ userId: "u1" });
    jar.clear();
    expect(await fails("auth.login", "demo@gereh.net", "Demo1234!", codes[0])).toContain("درست نیست");
    await call("auth.login", "demo@gereh.net", "Demo1234!", codes[1].replace("-", "").toLowerCase());
    expect((await call<{ recoveryLeft: number }>("account.extras")).recoveryLeft).toBe(8);
  });

  it("notification matrix: push and telegram columns", async () => {
    await asUser();
    expect(await fails("account.pushSubscribe", { endpoint: "https://10.0.0.1/x", keys: { p256dh: "abc", auth: "def" } })).toContain("پشتیبانی");
    await call("account.pushSubscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "abc", auth: "def" } });
    await call("account.setNotif", "billing_push", true);
    await call("account.setNotif", "billing_telegram", false);
    outbox.length = 0;
    await notifySend(await db(), { userId: "u1", kind: "billing", subject: "آزمایش", text: "x" });
    expect(outbox.some((m) => (m.channel as string) === "push")).toBe(true);
    expect((await call<{ pushDevices: unknown[] }>("account.extras")).pushDevices).toHaveLength(1);
  });

  it("custom team roles narrow what a member may call; servers can be transferred", async () => {
    await asUser();
    const d = await db();
    await d.insert(teamMembers).values({ id: "tm-x", ownerId: "u1", memberId: "u2", role: "admin" });
    const roleId = await call<string>("team.saveRole", { name: "ناظر سرور", perms: { servers: "view", billing: "none", bogus: "manage" } });
    await call("team.assignRole", "u2", roleId);
    const roles = await call<TeamRoleView[]>("team.roles");
    expect(roles[0]).toMatchObject({ perms: { servers: "view" }, members: ["u2"] });
    expect((await d.select().from(teamMembers).where(eq(teamMembers.id, "tm-x")))[0].role).toBe("tech");
    const [u2] = await d.select().from(users).where(eq(users.id, "u2"));
    const auth = { sessionId: "x", user: u2, uid: "u1", teamRole: "tech" } as Auth;
    expect(await customAllows(d, auth, "servers.extras")).toBe(true);
    expect(await customAllows(d, auth, "servers.power")).toBe(false);
    expect(await customAllows(d, auth, "paas.deploy")).toBe(false);
    expect(await customAllows(d, auth, "auth.logout")).toBe(true);
    expect(await customAllows(d, { ...auth, teamRole: undefined }, "servers.power")).toBe(true);
    expect(await fails("team.transferServers", [SRV], "u2", "wrong@x.ir")).toContain("ایمیل");
    await call("servers.addIp", SRV);
    await call("team.transferServers", [SRV], "u2", "user2@mail.ir");
    expect((await d.select().from(servers).where(eq(servers.id, SRV)))[0].userId).toBe("u2");
    expect((await d.select().from(vpsIps)).every((r) => r.userId === "u2")).toBe(true);
  });

  it("worker jobs are registered", async () => {
    const d = await db();
    const { enqueue } = await import("@/server/jobs");
    await enqueue(d, "vps.billing");
    await enqueue(d, "vps.snapshots");
    expect(await drain(d)).toBeGreaterThanOrEqual(2);
  });
});
