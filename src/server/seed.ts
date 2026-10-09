/* Seeds an empty database.
   - Always: settings, Virtualizor config, catalog (plans, TLDs, plan map, OS templates, ISOs) and
     the first owner account (ADMIN_EMAIL / ADMIN_PASSWORD).
   - With demo=true (dev, staging, e2e): the demo customer, sample services, invoices and tickets.
   Mock dates were written as Jalali strings around 1404/07/14; they are shifted so that day is "today". */
import "server-only";
import { eq } from "drizzle-orm";
import { DEMO_POSTS } from "@/content/demo-posts";
import { seedGeoPlans } from "./geo/service";
import { seedInquiry } from "./inquiry/service";
import { DEFAULT_PLANS, seedPlans } from "./paas/service";
import { seal } from "./secrets";
import { HOSTING, LOCS, OSES, TLDS, VPS, type Plan } from "@/lib/catalog";
import { fa, hashStr } from "@/lib/format";
import { faDate, parseJalali } from "@/lib/jalali";
import type { DB } from "./db/client";
import * as t from "./db/schema";
import { hashPassword } from "./password";
import { randomSecret, sha256 } from "./util";

export const DEMO_PASSWORD = "Demo1234!";
export const DEFAULT_SETTINGS = {
  siteName: "گره", supportEmail: "support@gereh.net", supportPhone: "۰۲۱-۹۱۰۰۰۰۰۰", registration: true, maintenance: false, tax: 10,
  gateways: { zarinpal: true, idpay: true, wallet: true, crypto: false } as Record<string, boolean>,
  smsProvider: "کاوه‌نگار", smsKeySet: false, smtpHost: "smtp.gereh.net", smtpPort: 587,
  /** % of a referred customer's paid invoices credited to the referrer during their first year */
  affiliateRate: 10,
  legalName: "شرکت گره ابر پارس (سهامی خاص)", sellerNationalId: "", sellerEconomicCode: "", sellerAddress: "تهران، خیابان ولیعصر", sellerPostalCode: "",
  paasDomain: process.env.PAAS_APPS_DOMAIN || "gereh.dev",
};
export const DEFAULT_VIRT = { host: "panel.gereh.net", port: 4085, key: "", passSet: false, connected: false, version: "", lastSync: "", autoSync: true, bandSuspend: true, suspendUnpaid: true, terminateUnpaid: true, adminManaged: true } as Record<string, string | number | boolean>;

const refCode = () => randomSecret(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");

/** runs on every boot: catalog rows added by later releases (idempotent), and one-off catalog updates */
export async function upgrade(db: DB) {
  await seedPlans(db);
  await seedInquiry(db);
  await seedGeoPlans(db);
  // v2 pricing: cloud plans priced from unit costs (CPU, RAM, disk, stepped traffic, IP). Replaces the
  // stored cloud plan rows once, keeping each plan's on/off switch from the admin panel.
  const [pv] = await db.select().from(t.kv).where(eq(t.kv.key, "pricing"));
  const version = Number(pv?.value ?? 0);
  if (version < 2) {
    for (const p of VPS.cloud) {
      const [row] = await db.select().from(t.plans).where(eq(t.plans.id, p.id));
      if (row) await db.update(t.plans).set({ data: { ...p, ...((row.data as Plan).active === false ? { active: false } : {}) } }).where(eq(t.plans.id, p.id));
    }
  }
  // v3: Gereh Apps plans resized and repriced against the market (resources and price; on/off kept)
  if (version < 3) {
    for (const p of DEFAULT_PLANS) await db.update(t.paasPlans).set({ cpu: p.cpu, ramMb: p.ramMb, diskGb: p.diskGb, price: p.price }).where(eq(t.paasPlans.id, p.id));
  }
  if (version < 3) await db.insert(t.kv).values({ key: "pricing", value: 3 }).onConflictDoUpdate({ target: t.kv.key, set: { value: 3 } });
}

export async function seed(db: DB, opts: { demo: boolean; adminEmail?: string; adminPassword?: string }) {
  const now = Date.now();
  const anchor = parseJalali("۱۴۰۴/۰۷/۱۴")!.getTime();
  /** mock Jalali date (optionally with " HH:MM") → real Date shifted to today */
  const J = (s: string) => {
    const [d, hm] = s.split(" ");
    const base = parseJalali(d);
    if (!base) throw new Error("bad seed date " + s);
    const [h, m] = (hm ? hm.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))) : "10:00").split(":").map(Number);
    return new Date(base.getTime() - anchor + now - (now % 86400_000) + (h * 60 + m) * 60_000);
  };

  await db.insert(t.kv).values([{ key: "settings", value: DEFAULT_SETTINGS }, { key: "virt", value: DEFAULT_VIRT }]).onConflictDoNothing();
  await seedPlans(db);
  await seedInquiry(db);
  await seedGeoPlans(db);
  await db.insert(t.plans).values([
    ...VPS.cloud.map((p, i) => ({ id: p.id, kind: "cloud" as const, data: p, position: i })),
    ...VPS.metal.map((p, i) => ({ id: p.id, kind: "metal" as const, data: p, position: i })),
    ...HOSTING.linux.concat(HOSTING.wordpress).map((p, i) => ({ id: p.id, kind: "hosting" as const, data: p, position: i })),
  ]).onConflictDoNothing();
  await db.insert(t.tlds).values(TLDS.map((x, i) => ({ tld: x.tld, reg: x.reg, renew: x.renew, transfer: x.transfer, cat: x.cat, hot: !!x.hot, promo: !!x.promo, position: i }))).onConflictDoNothing();
  await db.insert(t.planMap).values(VPS.cloud.concat(VPS.metal).map((p, i) => ({ id: p.id, name: p.name, plid: opts.demo ? 10 + i : 0, group: i < 4 ? "thr-cloud" : "thr-metal" }))).onConflictDoNothing();
  await db.insert(t.osTemplates).values([
    { osid: 347, name: "Ubuntu 24.04", distro: "ubuntu", on: true }, { osid: 342, name: "Ubuntu 22.04", distro: "ubuntu", on: true },
    { osid: 351, name: "Debian 12", distro: "debian", on: true }, { osid: 338, name: "Debian 11", distro: "debian", on: true },
    { osid: 360, name: "AlmaLinux 9", distro: "almalinux", on: true }, { osid: 362, name: "Rocky Linux 9", distro: "rocky", on: true },
    { osid: 370, name: "CentOS Stream 9", distro: "centos", on: false }, { osid: 381, name: "Windows Server 2022", distro: "windows", on: true },
    { osid: 377, name: "Windows Server 2019", distro: "windows", on: false }, { osid: 390, name: "FreeBSD 14", distro: "freebsd", on: false },
  ]).onConflictDoNothing();
  await db.insert(t.isos).values(["ubuntu-24.04.1-live-server-amd64.iso", "debian-12.7.0-amd64-netinst.iso", "virtio-win-0.1.262.iso", "systemrescue-11.02-amd64.iso"].map((filename) => ({ filename }))).onConflictDoNothing();

  const adminEmail = (opts.adminEmail || (opts.demo ? "admin@gereh.net" : "")).toLowerCase();
  const adminPassword = opts.adminPassword || (opts.demo ? DEMO_PASSWORD : "");
  if (adminEmail && adminPassword) {
    await db.insert(t.users).values({ id: "a1", name: "مدیر سیستم", email: adminEmail, phone: "", passwordHash: await hashPassword(adminPassword), role: "admin", staffRole: "owner", status: "active", kyc: "verified", referralCode: refCode() }).onConflictDoNothing();
  }
  if (!opts.demo) return;

  const pw = await hashPassword(DEMO_PASSWORD);
  await db.insert(t.users).values([
    { id: "st-2", name: "کاوه نوری", email: "kaveh@gereh.net", passwordHash: pw, role: "admin", staffRole: "support", kyc: "verified", referralCode: refCode() },
    { id: "st-3", name: "شیما کاظمی", email: "shima@gereh.net", passwordHash: pw, role: "admin", staffRole: "finance", kyc: "verified", referralCode: refCode() },
  ]).onConflictDoNothing();

  const FIRST = ["امیر", "سارا", "رضا", "مریم", "علی", "نگار", "حسین", "زهرا", "محمد", "الهام", "کاوه", "نازنین", "پویا", "شیما"];
  const LAST = ["رضایی", "احمدی", "کریمی", "موسوی", "حسینی", "محمدی", "جعفری", "صادقی", "نوری", "تهرانی", "کاظمی", "رحیمی"];
  await db.insert(t.users).values([
    { id: "u1", name: "امیر رضایی", email: "demo@gereh.net", phone: "09121234567", company: "استودیو نوین", passwordHash: pw, balance: 24500000, status: "active", kyc: "verified", createdAt: J("۱۴۰۳/۰۸/۱۲"), referralCode: "NOVIN24", notifPrefs: { billing_email: true, billing_sms: true, service_email: true, service_sms: false, news_email: false, security_email: true, security_sms: true } },
    ...Array.from({ length: 23 }, (_, i) => ({
      id: "u" + (i + 2), name: FIRST[(i * 5) % FIRST.length] + " " + LAST[(i * 7) % LAST.length],
      email: "user" + (i + 2) + "@mail.ir", phone: "0912" + String(4000000 + i * 37171).slice(0, 7), company: i % 3 ? "" : "شرکت " + LAST[i % LAST.length],
      balance: (hashStr("b" + i) % 90) * 50000, status: i % 9 === 4 ? "suspended" : i % 7 === 3 ? "pending" : "active",
      kyc: i % 4 === 1 ? "pending" : i % 6 === 2 ? "none" : "verified", createdAt: J("۱۴۰" + fa(3 + (i % 2)) + "/۰" + fa(1 + (i % 9)) + "/۱" + fa(i % 9)), referralCode: refCode(),
    })),
  ]).onConflictDoNothing();

  type S = typeof t.servers.$inferInsert;
  const base: S[] = [
    { id: "srv-1042", userId: "u1", name: "web-prod-1", plan: "حرفه‌ای", cpu: 4, ram: 8, disk: 160, loc: "thr", os: "Ubuntu 24.04", ip: "185.143.232.17", ipv6: "2a01:4f8:c0c:1042::1", rdns: "web.novin.studio", status: "running", createdAt: J("۱۴۰۳/۱۱/۰۴"), price: 1290000, backups: true, hostname: "" },
    { id: "srv-1043", userId: "u1", name: "db-primary", plan: "سازمانی", cpu: 8, ram: 16, disk: 320, loc: "thr", os: "Debian 12", ip: "185.143.232.44", ipv6: "2a01:4f8:c0c:1043::1", status: "running", createdAt: J("۱۴۰۳/۱۱/۰۴"), price: 2390000, backups: true, hostname: "" },
    { id: "srv-1101", userId: "u1", name: "staging", plan: "پایه", cpu: 2, ram: 4, disk: 80, loc: "fra", os: "Ubuntu 24.04", ip: "91.107.211.9", ipv6: "2a01:4f8:1c1e:1101::1", status: "stopped", createdAt: J("۱۴۰۴/۰۳/۲۲"), price: 773000, backups: false, hostname: "", billing: "hourly" },
    ...Array.from({ length: 14 }, (_, i): S => ({ id: "srv-" + (1200 + i), userId: "u" + (2 + ((i * 3) % 20)), name: ["api", "web", "cache", "worker", "vpn", "game"][i % 6] + "-" + (i + 1), plan: VPS.cloud[i % 4].name, cpu: [1, 2, 4, 8][i % 4], ram: [2, 4, 8, 16][i % 4], disk: [40, 80, 160, 320][i % 4], loc: LOCS[i % 4].id, os: OSES[i % 3].label, ip: "185.143.23" + (i % 9) + "." + (20 + i * 7), status: i % 6 === 2 ? "stopped" : i % 11 === 5 ? "suspended" : "running", createdAt: J("۱۴۰۴/۰" + fa(1 + (i % 8)) + "/۱" + fa(i % 9)), price: VPS.cloud[i % 4].price, backups: i % 2 === 0, hostname: "" })),
  ];
  await db.insert(t.servers).values(base.map((s, i) => ({
    ...s, vpsid: 3300 + i, hostname: s.name + ".gereh.net", bwLimit: [2000, 4000, 6000, 10000][i % 4],
    vncHost: "vnc-" + s.loc + ".gereh.net", vncPort: 5900 + i, vncPassword: "xK9" + i + "mQ2p", paidUntil: new Date(now + (20 + i) * 86400_000),
  }))).onConflictDoNothing();
  for (const s of base.slice(0, 3)) {
    await db.insert(t.firewallRules).values([
      { id: s.id + "-fw1", serverId: s.id, proto: "TCP", port: "22", source: "0.0.0.0/0", action: "allow", note: "SSH" },
      { id: s.id + "-fw2", serverId: s.id, proto: "TCP", port: "80,443", source: "0.0.0.0/0", action: "allow", note: "وب" },
      { id: s.id + "-fw3", serverId: s.id, proto: "ICMP", port: "—", source: "0.0.0.0/0", action: "allow", note: "پینگ" },
    ]).onConflictDoNothing();
  }
  await db.insert(t.serverTasks).values(base.flatMap((s) => [
    { id: s.id + "-t1", serverId: s.id, action: "ساخت VPS", createdAt: new Date(s.createdAt!.getTime() + 12 * 60_000) },
    { id: s.id + "-t2", serverId: s.id, action: "نصب سیستم‌عامل " + s.os, createdAt: new Date(s.createdAt!.getTime() + 13 * 60_000) },
  ])).onConflictDoNothing();
  await db.insert(t.snapshots).values({ id: "snap-81", serverId: "srv-1042", name: "before-upgrade", size: 12.4, createdAt: J("۱۴۰۴/۰۵/۲۰") }).onConflictDoNothing();
  await db.insert(t.backups).values([
    { id: "bk-1", serverId: "srv-1042", size: 18.2, createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۳:۰۰") }, { id: "bk-2", serverId: "srv-1042", size: 18.1, createdAt: J("۱۴۰۴/۰۷/۱۲ ۰۳:۰۰") },
    { id: "bk-3", serverId: "srv-1042", size: 17.9, createdAt: J("۱۴۰۴/۰۷/۱۱ ۰۳:۰۰") }, { id: "bk-4", serverId: "srv-1043", size: 64.8, createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۴:۰۰") },
  ]).onConflictDoNothing();

  await db.insert(t.hosting).values([
    { id: "hst-221", userId: "u1", domain: "cafeland.ir", plan: "نقره", diskUsed: 4.2, diskTotal: 10, bwUsed: 62, bwTotal: 200, emails: 7, dbs: 3, status: "active", expiresAt: J("۱۴۰۵/۰۲/۱۵"), price: 189000, server: "thr-web-07" },
    ...Array.from({ length: 9 }, (_, i) => ({ id: "hst-" + (300 + i), userId: "u" + (3 + i * 2), domain: ["shop", "blog", "clinic", "agency", "news"][i % 5] + (i + 1) + ".ir", plan: HOSTING.linux[i % 4].name, diskUsed: 1 + (i % 5), diskTotal: [2, 10, 30, 80][i % 4], bwUsed: 10 + i * 9, bwTotal: 200, emails: i, dbs: i % 4, status: i % 5 === 3 ? "suspended" : "active", expiresAt: J("۱۴۰۵/۰" + fa(1 + (i % 9)) + "/۰۱"), price: HOSTING.linux[i % 4].price, server: "thr-web-0" + (i % 9) })),
  ]).onConflictDoNothing();

  const dns = (domainId: string) => [
    { id: domainId + "-r1", domainId, type: "A", name: "@", value: "185.143.232.17", ttl: 3600 },
    { id: domainId + "-r2", domainId, type: "A", name: "www", value: "185.143.232.17", ttl: 3600 },
    { id: domainId + "-r3", domainId, type: "MX", name: "@", value: "mail.gereh.net", ttl: 3600, priority: 10 },
    { id: domainId + "-r4", domainId, type: "TXT", name: "@", value: "v=spf1 include:gereh.net ~all", ttl: 3600 },
  ];
  const NS = ["ns1.gereh.net", "ns2.gereh.net"];
  await db.insert(t.domains).values([
    { id: "dom-501", userId: "u1", name: "novin.studio", registeredAt: J("۱۴۰۲/۰۴/۱۰"), expiresAt: J("۱۴۰۵/۰۴/۱۰"), autoRenew: true, privacy: true, locked: true, status: "active", ns: NS, authCode: "Gx7#pQ2m!Lw9" },
    { id: "dom-502", userId: "u1", name: "cafeland.ir", registeredAt: J("۱۴۰۳/۰۲/۰۱"), expiresAt: J("۱۴۰۴/۰۸/۰۱"), autoRenew: false, privacy: false, locked: true, status: "expiring", ns: NS },
    { id: "dom-503", userId: "u1", name: "amirrezaei.com", registeredAt: J("۱۴۰۴/۰۱/۱۸"), expiresAt: J("۱۴۰۵/۰۱/۱۸"), autoRenew: true, privacy: true, locked: false, status: "active", ns: ["ns1.cloudflare.com", "ns2.cloudflare.com"], authCode: "kT4@zN8r$Vb1" },
    ...Array.from({ length: 12 }, (_, i) => ({ id: "dom-" + (600 + i), userId: "u" + (2 + i), name: ["parsa", "nova", "arta", "sahand", "dena", "baran"][i % 6] + (i + 1) + TLDS[i % 6].tld, registeredAt: J("۱۴۰۳/۰۱/۰۱"), expiresAt: J("۱۴۰۵/۰" + fa(1 + (i % 9)) + "/۲۰"), autoRenew: i % 2 === 0, privacy: i % 3 === 0, locked: true, status: i % 7 === 3 ? "expired" : "active", ns: NS })),
  ]).onConflictDoNothing();
  await db.insert(t.dnsRecords).values([...dns("dom-501"), ...dns("dom-502")]).onConflictDoNothing();

  const inv = (id: string, userId: string, date: string, due: string, status: string, items: [string, number][]) => ({ id, userId, date, due, status, items });
  const invs = [
    inv("INV-14062", "u1", "۱۴۰۴/۰۷/۰۱", "۱۴۰۴/۰۷/۱۰", "unpaid", [["سرور ابری db-primary، مهر", 2390000], ["بکاپ روزانه", 287000]]),
    inv("INV-14058", "u1", "۱۴۰۴/۰۶/۲۸", "۱۴۰۴/۰۷/۰۵", "overdue", [["تمدید دامنه cafeland.ir، یک سال", 95000]]),
    inv("INV-14031", "u1", "۱۴۰۴/۰۶/۰۱", "۱۴۰۴/۰۶/۱۰", "paid", [["سرور ابری web-prod-1، شهریور", 1290000], ["سرور ابری db-primary، شهریور", 2390000]]),
    inv("INV-13990", "u1", "۱۴۰۴/۰۵/۰۱", "۱۴۰۴/۰۵/۱۰", "paid", [["هاست نقره cafeland.ir، یک سال", 1927000]]),
    inv("INV-13950", "u1", "۱۴۰۴/۰۴/۰۱", "۱۴۰۴/۰۴/۱۰", "refunded", [["سرور ابری test-box", 390000]]),
    ...Array.from({ length: 26 }, (_, i) => inv("INV-" + (14100 + i), "u" + (2 + (i % 20)), "۱۴۰۴/۰" + fa(1 + (i % 7)) + "/" + fa(10 + (i % 18)), "۱۴۰۴/۰" + fa(1 + (i % 7)) + "/" + fa(12 + (i % 16)), ["paid", "paid", "unpaid", "paid", "overdue", "paid", "refunded"][i % 7], [[["سرور ابری", "هاست", "دامنه", "سرور اختصاصی"][i % 4] + " " + fa(i + 1), [690000, 189000, 95000, 9800000][i % 4]]])),
  ];
  await db.insert(t.invoices).values(invs.map((x) => ({ id: x.id, userId: x.userId, status: x.status, createdAt: J(x.date), dueAt: J(x.due), paidAt: x.status === "paid" ? J(x.date) : null }))).onConflictDoNothing();
  await db.insert(t.invoiceItems).values(invs.flatMap((x) => x.items.map(([desc, amount]) => ({ invoiceId: x.id, desc, amount }))));
  await db.insert(t.counters).values([{ name: "INV", value: 14200 }, { name: "TK", value: 3100 }, { name: "DO", value: 1010 }]).onConflictDoNothing();

  await db.insert(t.transactions).values([
    { id: "TX-90812", userId: "u1", createdAt: J("۱۴۰۴/۰۶/۰۲"), type: "payment", amount: -3680000, method: "کیف پول", desc: "پرداخت INV-14031" },
    { id: "TX-90790", userId: "u1", createdAt: J("۱۴۰۴/۰۶/۰۱"), type: "topup", amount: 5000000, method: "درگاه زرین‌پال", desc: "شارژ کیف پول" },
    { id: "TX-90511", userId: "u1", createdAt: J("۱۴۰۴/۰۵/۰۲"), type: "payment", amount: -1927000, method: "درگاه زرین‌پال", desc: "پرداخت INV-13990" },
    { id: "TX-90420", userId: "u1", createdAt: J("۱۴۰۴/۰۴/۰۸"), type: "refund", amount: 390000, method: "کیف پول", desc: "بازگشت وجه INV-13950" },
  ]).onConflictDoNothing();

  await db.insert(t.tickets).values([
    { id: "TK-3021", userId: "u1", subject: "کندی دیسک روی db-primary", dept: "فنی", priority: "high", status: "answered", service: "srv-1043", assignee: "کاوه نوری", createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۹:۱۲"), updatedAt: J("۱۴۰۴/۰۷/۱۳ ۰۹:۲۰"), firstResponseAt: J("۱۴۰۴/۰۷/۱۳ ۰۹:۲۰") },
    { id: "TK-2988", userId: "u1", subject: "درخواست فاکتور رسمی", dept: "مالی", priority: "normal", status: "closed", assignee: "شیما کاظمی", createdAt: J("۱۴۰۴/۰۶/۰۳ ۱۴:۰۰"), updatedAt: J("۱۴۰۴/۰۶/۰۴ ۱۰:۳۰"), firstResponseAt: J("۱۴۰۴/۰۶/۰۴ ۱۰:۳۰") },
    ...Array.from({ length: 11 }, (_, i) => ({ id: "TK-" + (3030 + i), userId: "u" + (2 + i), subject: ["قطعی سایت", "انتقال دامنه", "ارتقای سرور", "مشکل ایمیل", "سؤال درباره قیمت", "خطای SSL"][i % 6], dept: ["فنی", "فروش", "فنی", "فنی", "فروش", "فنی"][i % 6], priority: ["high", "normal", "low"][i % 3], status: ["open", "customer-reply", "answered", "open", "closed"][i % 5], assignee: i % 3 ? "" : "کاوه نوری", createdAt: J("۱۴۰۴/۰۷/۱۲ ۱۱:۰۰"), updatedAt: J("۱۴۰۴/۰۷/" + fa(10 + (i % 4))) })),
  ]).onConflictDoNothing();
  await db.insert(t.ticketMessages).values([
    { ticketId: "TK-3021", from: "user", name: "امیر رضایی", createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۹:۱۲"), text: "از دیشب IOPS دیسک دیتابیس پایین آمده و کوئری‌ها کند شده‌اند. لطفا بررسی کنید." },
    { ticketId: "TK-3021", from: "staff", name: "کاوه نوری", createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۹:۲۰"), text: "سلام. روی نود میزبان یک عملیات rebuild آرایه در جریان بود که ساعت ۹:۱۸ تمام شد. لطفا دوباره بررسی کنید؛ اگر مشکل ادامه داشت، سرور را بدون هزینه به نود دیگری منتقل می‌کنیم." },
    { ticketId: "TK-2988", from: "user", name: "امیر رضایی", createdAt: J("۱۴۰۴/۰۶/۰۳ ۱۴:۰۰"), text: "برای صورتحساب INV-14031 فاکتور رسمی با کد اقتصادی شرکت نیاز دارم." },
    { ticketId: "TK-2988", from: "staff", name: "شیما کاظمی", createdAt: J("۱۴۰۴/۰۶/۰۴ ۱۰:۳۰"), text: "فاکتور رسمی صادر و در بخش صورتحساب‌ها قابل دانلود است." },
    ...Array.from({ length: 11 }, (_, i) => ({ ticketId: "TK-" + (3030 + i), from: "user" as const, name: FIRST[i % FIRST.length], createdAt: J("۱۴۰۴/۰۷/۱۲ ۱۱:۰۰"), text: "سلام، لطفا راهنمایی کنید." })),
  ]);

  await db.insert(t.sshKeys).values({ id: "key-1", userId: "u1", name: "MacBook Pro", fingerprint: "SHA256:3fK9…Qx2a", publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo3fK9Qx2a demo", createdAt: J("۱۴۰۳/۱۱/۰۴") }).onConflictDoNothing();
  await db.insert(t.notifications).values([
    { id: "n1", userId: "u1", icon: "file-search", text: "صورتحساب INV-14062 صادر شد", createdAt: new Date(now - 2 * 3600_000) },
    { id: "n2", userId: "u1", icon: "message-circle", text: "پاسخ جدید در تیکت TK-3021", createdAt: new Date(now - 5 * 3600_000) },
    { id: "n3", userId: "u1", icon: "database-backup", text: "بکاپ روزانه web-prod-1 کامل شد", read: true, createdAt: new Date(now - 26 * 3600_000) },
  ]).onConflictDoNothing();
  await db.insert(t.activity).values([
    { id: "a1", userId: "u1", icon: "refresh-cw", text: "ری‌استارت سرور web-prod-1", createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۸:۴۱"), ip: "5.120.44.18" },
    { id: "a2", userId: "u1", icon: "camera", text: "ساخت اسنپ‌شات before-upgrade", createdAt: J("۱۴۰۴/۰۵/۲۰ ۲۲:۱۰"), ip: "5.120.44.18" },
    { id: "a3", userId: "u1", icon: "lock", text: "ورود موفق به حساب", createdAt: J("۱۴۰۴/۰۵/۲۰ ۲۲:۰۲"), ip: "5.120.44.18" },
  ]).onConflictDoNothing();
  await db.insert(t.nodes).values([
    { id: "thr-hv-01", loc: "thr", cpu: 62, ram: 71, disk: 48, vms: 38, status: "online", model: "EPYC 9354 / 768GB" },
    { id: "thr-hv-02", loc: "thr", cpu: 44, ram: 58, disk: 39, vms: 31, status: "online", model: "EPYC 9354 / 768GB" },
    { id: "thr-hv-03", loc: "thr", cpu: 88, ram: 83, disk: 71, vms: 46, status: "online", model: "EPYC 7543 / 512GB" },
    { id: "isf-hv-01", loc: "isf", cpu: 35, ram: 41, disk: 22, vms: 19, status: "online", model: "Xeon Gold 6338 / 512GB" },
    { id: "fra-hv-01", loc: "fra", cpu: 57, ram: 64, disk: 51, vms: 27, status: "online", model: "EPYC 7443P / 256GB" },
    { id: "ams-hv-01", loc: "ams", cpu: 0, ram: 0, disk: 33, vms: 0, status: "maintenance", model: "EPYC 7443P / 256GB" },
  ]).onConflictDoNothing();
  await db.insert(t.coupons).values([
    { id: "cp-1", code: "YALDA1404", type: "percent", value: 20, used: 143, limit: 500, expiresAt: J("۱۴۰۴/۰۷/۰۱"), active: true },
    { id: "cp-2", code: "WELCOME", type: "percent", value: 10, used: 1208, limit: 0, active: true },
    { id: "cp-3", code: "MIGRATE50", type: "fixed", value: 500000, used: 37, limit: 100, expiresAt: J("۱۴۰۴/۰۸/۳۰"), active: false },
  ]).onConflictDoNothing();
  await db.insert(t.announcements).values({ id: "an-1", title: "نگهداری برنامه‌ریزی‌شده آمستردام", body: "نود ams-hv-01 روز جمعه از ساعت ۲ تا ۴ بامداد به‌روزرسانی می‌شود. سرویس‌های شما خودکار جابه‌جا می‌شوند.", level: "info", createdAt: J("۱۴۰۴/۰۷/۱۲") }).onConflictDoNothing();
  await db.insert(t.posts).values(DEMO_POSTS.map((p, i) => ({ id: "post-" + (i + 1), slug: p.slug, title: p.title, excerpt: p.excerpt, body: p.body, tags: p.tags, status: "published" as const, author: "تیم گره", publishedAt: J(p.date), updatedAt: J(p.date), createdAt: J(p.date) }))).onConflictDoNothing();
  await db.insert(t.devopsLeads).values([
    { id: "DO-1001", name: "سینا فرهادی", company: "پرداخت‌یار", role: "مدیر فنی", email: "sina@pardakhtyar.example", phone: "09121112233", website: "pardakhtyar.example", size: "۱۱ تا ۵۰ نفر", stage: "در حال رشد سریع", infra: ["سرویس‌دهنده ابری دیگر داخلی"], services: ["kubernetes", "monitoring", "managed-devops"], pkg: "growth", budget: "۲۵ تا ۶۰ میلیون تومان در ماه", urgency: "فوری: مشکل فعلی در production", needsNda: true, message: "در ساعات اوج تراکنش سرویس پرداخت کند می‌شود و هفته‌ای یکی دو بار قطعی داریم. مهندس دواپس نداریم.", source: "/devops", createdAt: J("۱۴۰۴/۰۷/۱۳"), updatedAt: J("۱۴۰۴/۰۷/۱۳") },
    { id: "DO-1000", name: "امیر رضایی", company: "استودیو نوین", role: "مدیر", email: "demo@gereh.net", phone: "09121234567", size: "۱ تا ۱۰ نفر", stage: "محصول عرضه‌شده", infra: ["گره"], services: ["ci-cd", "managed-devops"], pkg: "startup", budget: "کمتر از ۲۵ میلیون تومان در ماه", urgency: "ظرف یک ماه", message: "می‌خواهیم استقرار پروژه‌های مشتریان خودکار شود و کسی سرورها را نگه دارد.", status: "won", assignee: "کاوه نوری", value: 24000000, userId: "u1", source: "/devops/ci-cd", createdAt: J("۱۴۰۴/۰۶/۱۰"), updatedAt: J("۱۴۰۴/۰۶/۲۰") },
  ]).onConflictDoNothing();
  await db.insert(t.devopsProjects).values({
    id: "dvp-demo1", userId: "u1", leadId: "DO-1000", title: "استقرار خودکار و نگه‌داری زیرساخت", plan: "startup", status: "active", services: ["ci-cd", "monitoring", "managed-devops"], monthlyFee: 24000000, hoursIncluded: 20, hoursUsed: 7.5, engineer: "کاوه نوری",
    milestones: [{ id: "ms1", title: "ممیزی و نقشه راه", due: faDate(J("۱۴۰۴/۰۶/۲۵")), done: true }, { id: "ms2", title: "پایپ‌لاین GitLab CI برای سه پروژه", due: faDate(J("۱۴۰۴/۰۷/۱۰")), done: true }, { id: "ms3", title: "مانیتورینگ و هشدار در تلگرام", due: faDate(J("۱۴۰۴/۰۷/۲۰")), done: false }, { id: "ms4", title: "مانور بازیابی پشتیبان", due: faDate(J("۱۴۰۴/۰۸/۰۵")), done: false }],
    updates: [{ at: J("۱۴۰۴/۰۶/۲۵ ۱۱:۰۰").toISOString(), by: "کاوه نوری", text: "گزارش ممیزی در تیکت TK-3021 ارسال شد. اولویت اول: پشتیبان‌گیری خارج از سرور اصلی." }, { at: J("۱۴۰۴/۰۷/۱۰ ۱۶:۳۰").toISOString(), by: "کاوه نوری", text: "پایپ‌لاین هر سه پروژه فعال شد؛ از این به بعد هر merge به main ظرف چهار دقیقه روی سرور است و بازگشت با یک کلیک ممکن است." }],
    startedAt: J("۱۴۰۴/۰۶/۲۰"), nextBillAt: J("۱۴۰۴/۰۷/۲۰"),
  }).onConflictDoNothing();
  // Gereh Apps demo: a live Next.js app with history, a Postgres database wired into it
  await db.insert(t.paasApps).values({ id: "app-demo1", userId: "u1", name: "novin-shop", stack: "nextjs", source: "git", gitUrl: "https://github.com/novin-studio/shop.git", gitBranch: "main", port: 3000, planId: "app-small", instances: 2, status: "running", hookToken: "demo-hook-token-novin-shop-000000", liveDeployment: "dep-demo3", createdAt: J("۱۴۰۴/۰۶/۲۰") }).onConflictDoNothing();
  await db.insert(t.paasDeployments).values([
    { id: "dep-demo1", appId: "app-demo1", status: "superseded", trigger: "create", ref: "a1c9e2f", message: "اولین استقرار", image: "registry.gereh.net/u1/novin-shop:dep-demo1", log: "==> Cloning https://github.com/novin-studio/shop.git (main)\n==> Detected Next.js (node 22)\n==> Live", createdAt: J("۱۴۰۴/۰۶/۲۰ ۱۰:۱۲"), startedAt: J("۱۴۰۴/۰۶/۲۰ ۱۰:۱۲"), finishedAt: J("۱۴۰۴/۰۶/۲۰ ۱۰:۱۴") },
    { id: "dep-demo2", appId: "app-demo1", status: "failed", trigger: "git", ref: "4be0d17", message: "Add checkout page", log: "==> Cloning https://github.com/novin-studio/shop.git (main)\n$ npm run build\nType error: Property 'total' does not exist on type 'Cart'.\nERROR: build step exited with code 1", createdAt: J("۱۴۰۴/۰۷/۰۸ ۱۵:۴۰"), startedAt: J("۱۴۰۴/۰۷/۰۸ ۱۵:۴۰"), finishedAt: J("۱۴۰۴/۰۷/۰۸ ۱۵:۴۲") },
    { id: "dep-demo3", appId: "app-demo1", status: "live", trigger: "git", ref: "9d2f6aa", message: "Fix cart total type", image: "registry.gereh.net/u1/novin-shop:dep-demo3", log: "==> Cloning https://github.com/novin-studio/shop.git (main)\n==> Detected Next.js (node 22)\n$ npm ci\n$ npm run build\n   ✓ Compiled successfully\n==> Releasing 2 instance(s)\n==> Live", createdAt: J("۱۴۰۴/۰۷/۰۸ ۱۶:۰۵"), startedAt: J("۱۴۰۴/۰۷/۰۸ ۱۶:۰۵"), finishedAt: J("۱۴۰۴/۰۷/۰۸ ۱۶:۰۸") },
  ]).onConflictDoNothing();
  await db.insert(t.paasEnv).values([{ appId: "app-demo1", key: "NODE_ENV", valueEnc: seal("production"), secret: false }, { appId: "app-demo1", key: "ZARINPAL_MERCHANT", valueEnc: seal("demo-merchant-id"), secret: true }]).onConflictDoNothing();
  await db.insert(t.paasDbs).values({ id: "pdb-demo1", userId: "u1", name: "shop-db", engine: "postgres", version: "16", planId: "db-small", status: "running", host: "shop-db.u1.db.gereh.internal", port: 5432, username: "u_shop_db", passwordEnc: seal("demo-db-password"), dbName: "shop_db", createdAt: J("۱۴۰۴/۰۶/۲۰") }).onConflictDoNothing();
  await db.insert(t.paasLinks).values({ appId: "app-demo1", dbId: "pdb-demo1", envKey: "DATABASE_URL" }).onConflictDoNothing();
  await db.insert(t.paasDbBackups).values([
    { id: "bk-demo1", dbId: "pdb-demo1", kind: "auto", status: "done", sizeMb: 48.2, location: "s3://gereh-backups/u1/pdb-demo1/bk-demo1.dump", createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۳:۳۰") },
    { id: "bk-demo2", dbId: "pdb-demo1", kind: "auto", status: "done", sizeMb: 48.9, location: "s3://gereh-backups/u1/pdb-demo1/bk-demo2.dump", createdAt: J("۱۴۰۴/۰۷/۱۴ ۰۳:۳۰") },
  ]).onConflictDoNothing();
  // inquiry API demo: an account with history; one personal-data service approved, one pending
  await db.insert(t.inquiryAccounts).values({ userId: "u1", accountNo: 512752, apiKey: "GerehDemoKey2024", secretEnc: seal("demo-inquiry-secret-0001"), secretHash: sha256("demo-inquiry-secret-0001"), createdAt: J("۱۴۰۴/۰۶/۰۱") }).onConflictDoNothing();
  await db.insert(t.counters).values({ name: "inquiry", value: 512752 }).onConflictDoNothing();
  await db.insert(t.inquiryGrants).values([
    { userId: "u1", serviceId: "identity_v2", status: "approved", useCase: "احراز هویت خریداران فروشگاه آنلاین هنگام ثبت‌نام", decidedAt: J("۱۴۰۴/۰۶/۰۲"), createdAt: J("۱۴۰۴/۰۶/۰۱") },
    { userId: "u1", serviceId: "shahkar_lite", status: "pending", useCase: "تطبیق موبایل و کد ملی برای جلوگیری از حساب‌های جعلی در ثبت‌نام", createdAt: J("۱۴۰۴/۰۷/۱۲") },
  ]).onConflictDoNothing();
  {
    const svc: [string, number, string][] = [["cards", 572, "card=…7893"], ["ibans", 572, "iban=…9002"], ["identity_v2", 6950, "nationalCode=…5679 birthDate=…5/12"], ["cards_iban", 644, "card=…7893"], ["postal_code", 990, "postalCode=…3111"]];
    const calls = Array.from({ length: 40 }, (_, i) => {
      const [serviceId, price, input] = svc[i % svc.length];
      const status = i % 13 === 5 ? "invalid" : i % 17 === 3 ? "not_found" : "success";
      return { id: "INQ-DEMO" + String(i).padStart(3, "0"), userId: "u1", serviceId, status: status as "success", charged: status === "invalid" ? 0 : price, billed: true, latencyMs: 180 + ((i * 97) % 600), input: status === "invalid" ? "" : input, ip: "185.10.20.30", createdAt: new Date(now - (i * 7 + 1) * 3600_000) };
    });
    await db.insert(t.inquiryCalls).values(calls).onConflictDoNothing();
  }
  // Geo DNS demo: an active zone with health data and one waiting for the nameserver change
  await db.insert(t.geoZones).values([
    { id: "geo-demo1", userId: "u1", domain: "novinshop.ir", planId: "geo-pro", status: "active", nsOk: true, nsSeen: ["ns1.gereh.net", "ns2.gereh.net"], nsCheckedAt: new Date(now - 1800_000), syncToken: "demo-sync-token-novinshop-0000000000", paidUntil: new Date(now + 18 * 86400_000), createdAt: J("۱۴۰۴/۰۵/۱۰") },
    { id: "geo-demo2", userId: "u1", domain: "novin-blog.ir", planId: "geo-basic", status: "pending", nsSeen: ["ns1.example-host.ir", "ns2.example-host.ir"], nsCheckedAt: new Date(now - 3600_000), syncToken: "demo-sync-token-novinblog-0000000000", paidUntil: new Date(now + 27 * 86400_000), createdAt: J("۱۴۰۴/۰۷/۱۲") },
  ]).onConflictDoNothing();
  await db.insert(t.geoRecords).values([
    { zoneId: "geo-demo1", name: "@", type: "A", iran: "185.120.220.14", world: "94.130.88.21", iranUp: true, worldUp: true, checkedAt: new Date(now - 300_000) },
    { zoneId: "geo-demo1", name: "www", type: "A", iran: "185.120.220.14", world: "94.130.88.21", iranUp: true, worldUp: true, checkedAt: new Date(now - 300_000) },
    { zoneId: "geo-demo1", name: "@", type: "MX", iran: "mail.novinshop.ir", priority: 10, ttl: 3600 },
    { zoneId: "geo-demo1", name: "@", type: "TXT", iran: "v=spf1 mx ~all", ttl: 3600 },
    { zoneId: "geo-demo2", name: "@", type: "A", iran: "185.120.220.30", world: "94.130.88.40" },
    { zoneId: "geo-demo2", name: "www", type: "A", iran: "185.120.220.30", world: "94.130.88.40" },
  ]).onConflictDoNothing();
  await db.insert(t.audit).values([
    { id: "au1", actor: "مدیر سیستم", action: "تغییر قیمت پلن حرفه‌ای", target: "products/c3", createdAt: J("۱۴۰۴/۰۷/۱۰ ۱۶:۲۲"), ip: "10.0.0.4" },
    { id: "au2", actor: "کاوه نوری", action: "پاسخ به تیکت", target: "TK-3021", createdAt: J("۱۴۰۴/۰۷/۱۳ ۰۹:۲۰"), ip: "10.0.0.7" },
    { id: "au3", actor: "مدیر سیستم", action: "تعلیق کاربر", target: "u6", createdAt: J("۱۴۰۴/۰۷/۰۹ ۱۱:۰۵"), ip: "10.0.0.4" },
  ]).onConflictDoNothing();
  await db.insert(t.kv).values({ key: "virt", value: { ...DEFAULT_VIRT, connected: true, passSet: true, version: "Virtualizor 3.1.x" } }).onConflictDoUpdate({ target: t.kv.key, set: { value: { ...DEFAULT_VIRT, connected: true, passSet: true, version: "Virtualizor 3.1.x" } } });
  await db.insert(t.virtLog).values([
    { id: "vl1", createdAt: new Date(now - 3600_000), kind: "همگام‌سازی سرورها", result: "ok", detail: "۶ سرور، ۲۱۷ VPS" },
    { id: "vl2", createdAt: new Date(now - 3900_000), kind: "آمار ترافیک", result: "ok", detail: "۲۱۷ VPS به‌روز شد" },
    { id: "vl3", createdAt: new Date(now - 9 * 3600_000), kind: "تطبیق شبانه", result: "warn", detail: "۱ VPS در Virtualizor بدون سفارش در گره (vpsid 3517)" },
  ]).onConflictDoNothing();
}
