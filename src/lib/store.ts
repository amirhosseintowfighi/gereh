/* =====================================================================
   DATA LAYER — the seam between UI and backend.
   ---------------------------------------------------------------------
   Everything the UI reads lives in DB; everything that changes goes
   through `api.*`. Each api method is async and mirrors one backend
   endpoint (see docs/HANDOFF.md §4). To wire the real backend, replace
   each method body with a fetch() call and keep the signatures.
   ponytail: in-browser mock DB; swap for fetch + TanStack Query once the API exists.
   ===================================================================== */
import { useSyncExternalStore } from "react";
import { HOSTING, LOCS, OSES, TLDS, VPS, type Plan, type Tld } from "./catalog";
import { verifyTotp } from "./totp";
import { hashStr, nowFa, nowTime, roundK, strength, toEnDigits, toman, fa, EMAIL_RE, PHONE_RE } from "./format";

export type Status = string;
export type User = { id: string; name: string; email: string; phone: string; company: string; balance: number; status: Status; kyc: Status; joined: string; services: number; role: "user" | "admin" };
export type FwRule = { id: string; proto: string; port: string; source: string; action: "allow" | "deny"; note: string };
export type Task = { id: string; action: string; status: "done" | "running" | "failed"; at: string; progress: number };
export type Server = {
  id: string; userId: string; name: string; plan: string; cpu: number; ram: number; disk: number; loc: string; os: string; ip: string; ipv6: string; rdns: string;
  status: Status; created: string; price: number; backups: boolean; firewall: FwRule[];
  snapshots: { id: string; name: string; size: number; at: string }[]; backupsList: { id: string; at: string; size: number }[];
  vpsid: number; hostname: string; boot: string; iso: string; rescue: boolean; bwLimit: number; vnc: { host: string; port: number; password: string }; tasks: Task[];
};
export type Hosting = { id: string; userId: string; domain: string; plan: string; diskUsed: number; diskTotal: number; bwUsed: number; bwTotal: number; emails: number; dbs: number; status: Status; expires: string; price: number; panel: string; server: string };
export type DnsRecord = { id: string; type: string; name: string; value: string; ttl: number; priority?: number };
export type Domain = { id: string; userId: string; name: string; registered: string; expires: string; autoRenew: boolean; privacy: boolean; locked: boolean; status: Status; ns: string[]; dns: DnsRecord[]; authCode: string };
export type Invoice = { id: string; userId: string; date: string; due: string; status: Status; items: { desc: string; amount: number }[] };
export type Transaction = { id: string; userId: string; date: string; type: "topup" | "payment" | "refund"; amount: number; method: string; desc: string };
export type Message = { from: "user" | "staff"; name: string; at: string; text: string };
export type Ticket = { id: string; userId: string; subject: string; dept: string; priority: string; status: Status; service: string; updated: string; assignee: string; messages: Message[] };
export type Coupon = { id: string; code: string; type: "percent" | "fixed"; value: number; used: number; limit: number; expires: string; active: boolean };
export type Announcement = { id: string; title: string; body: string; level: "info" | "warning" | "critical"; at: string };
export type Node = { id: string; loc: string; cpu: number; ram: number; disk: number; vms: number; status: Status; model: string };
export type CartItem = { id: string; title: string; meta?: string; base: number; icon?: string; ltr?: boolean };
export type Session = { userId: string; role: "user" | "admin"; name: string };

const FIRST = ["امیر", "سارا", "رضا", "مریم", "علی", "نگار", "حسین", "زهرا", "محمد", "الهام", "کاوه", "نازنین", "پویا", "شیما"];
const LAST = ["رضایی", "احمدی", "کریمی", "موسوی", "حسینی", "محمدی", "جعفری", "صادقی", "نوری", "تهرانی", "کاظمی", "رحیمی"];
let seq = 0;
const uid = (p: string) => p + "-" + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
const sid = (p: string) => p + "-s" + (++seq); // deterministic ids for seed data
const delay = (ms = 380) => new Promise((r) => setTimeout(r, ms));

function seed() {
  seq = 0;
  const users: User[] = [
    { id: "u1", name: "امیر رضایی", email: "demo@gereh.cloud", phone: "09121234567", company: "استودیو نوین", balance: 2450000, status: "active", kyc: "verified", joined: "۱۴۰۳/۰۸/۱۲", services: 6, role: "user" },
    ...Array.from({ length: 23 }, (_, i): User => ({
      id: "u" + (i + 2), name: FIRST[(i * 5) % FIRST.length] + " " + LAST[(i * 7) % LAST.length],
      email: "user" + (i + 2) + "@mail.ir", phone: "0912" + String(4000000 + i * 37171).slice(0, 7), company: i % 3 ? "" : "شرکت " + LAST[i % LAST.length],
      balance: (hashStr("b" + i) % 90) * 50000, status: i % 9 === 4 ? "suspended" : i % 7 === 3 ? "pending" : "active",
      kyc: i % 4 === 1 ? "pending" : i % 6 === 2 ? "none" : "verified", joined: "۱۴۰" + fa(3 + (i % 2)) + "/۰" + fa(1 + (i % 9)) + "/۱" + fa(i % 9),
      services: hashStr("s" + i) % 9, role: "user",
    })),
  ];
  const fw = (): FwRule[] => [
    { id: sid("fw"), proto: "TCP", port: "22", source: "0.0.0.0/0", action: "allow", note: "SSH" },
    { id: sid("fw"), proto: "TCP", port: "80,443", source: "0.0.0.0/0", action: "allow", note: "وب" },
    { id: sid("fw"), proto: "ICMP", port: "—", source: "0.0.0.0/0", action: "allow", note: "پینگ" },
  ];
  type Base = Omit<Server, "vpsid" | "hostname" | "boot" | "iso" | "rescue" | "bwLimit" | "vnc" | "tasks">;
  const base: Base[] = [
    { id: "srv-1042", userId: "u1", name: "web-prod-1", plan: "حرفه‌ای", cpu: 4, ram: 8, disk: 160, loc: "thr", os: "Ubuntu 24.04", ip: "185.143.232.17", ipv6: "2a01:4f8:c0c:1042::1", rdns: "web.novin.studio", status: "running", created: "۱۴۰۳/۱۱/۰۴", price: 1290000, backups: true, firewall: fw(),
      snapshots: [{ id: "snap-81", name: "before-upgrade", size: 12.4, at: "۱۴۰۴/۰۵/۲۰" }], backupsList: [{ id: "bk-1", at: "۱۴۰۴/۰۷/۱۳ ۰۳:۰۰", size: 18.2 }, { id: "bk-2", at: "۱۴۰۴/۰۷/۱۲ ۰۳:۰۰", size: 18.1 }, { id: "bk-3", at: "۱۴۰۴/۰۷/۱۱ ۰۳:۰۰", size: 17.9 }] },
    { id: "srv-1043", userId: "u1", name: "db-primary", plan: "سازمانی", cpu: 8, ram: 16, disk: 320, loc: "thr", os: "Debian 12", ip: "185.143.232.44", ipv6: "2a01:4f8:c0c:1043::1", rdns: "", status: "running", created: "۱۴۰۳/۱۱/۰۴", price: 2390000, backups: true, firewall: fw(), snapshots: [], backupsList: [{ id: "bk-4", at: "۱۴۰۴/۰۷/۱۳ ۰۴:۰۰", size: 64.8 }] },
    { id: "srv-1101", userId: "u1", name: "staging", plan: "پایه", cpu: 2, ram: 4, disk: 80, loc: "fra", os: "Ubuntu 24.04", ip: "91.107.211.9", ipv6: "2a01:4f8:1c1e:1101::1", rdns: "", status: "stopped", created: "۱۴۰۴/۰۳/۲۲", price: 773000, backups: false, firewall: fw(), snapshots: [], backupsList: [] },
    ...Array.from({ length: 14 }, (_, i): Base => ({ id: "srv-" + (1200 + i), userId: "u" + (2 + ((i * 3) % 20)), name: ["api", "web", "cache", "worker", "vpn", "game"][i % 6] + "-" + (i + 1), plan: VPS.cloud[i % 4].name, cpu: [1, 2, 4, 8][i % 4], ram: [2, 4, 8, 16][i % 4], disk: [40, 80, 160, 320][i % 4], loc: LOCS[i % 4].id, os: OSES[i % 3].label, ip: "185.143.23" + (i % 9) + "." + (20 + i * 7), ipv6: "", rdns: "", status: i % 6 === 2 ? "stopped" : i % 11 === 5 ? "suspended" : "running", created: "۱۴۰۴/۰" + fa(1 + (i % 8)) + "/۱" + fa(i % 9), price: VPS.cloud[i % 4].price, backups: i % 2 === 0, firewall: [], snapshots: [], backupsList: [] })),
  ];
  const servers: Server[] = base.map((s, i) => ({
    ...s, vpsid: 3300 + i, hostname: s.name + ".gereh.cloud", boot: "cda", iso: "", rescue: false, bwLimit: [2000, 4000, 6000, 10000][i % 4],
    vnc: { host: "vnc-" + s.loc + ".gereh.cloud", port: 5900 + i, password: "xK9" + i + "mQ2p" },
    tasks: [
      { id: sid("t"), action: "نصب سیستم‌عامل " + s.os, status: "done", at: s.created + " ۱۰:۱۳", progress: 100 },
      { id: sid("t"), action: "ساخت VPS", status: "done", at: s.created + " ۱۰:۱۲", progress: 100 },
    ],
  }));
  const hosting: Hosting[] = [
    { id: "hst-221", userId: "u1", domain: "cafeland.ir", plan: "نقره", diskUsed: 4.2, diskTotal: 10, bwUsed: 62, bwTotal: 200, emails: 7, dbs: 3, status: "active", expires: "۱۴۰۵/۰۲/۱۵", price: 189000, panel: "cPanel", server: "thr-web-07" },
    ...Array.from({ length: 9 }, (_, i): Hosting => ({ id: "hst-" + (300 + i), userId: "u" + (3 + i * 2), domain: ["shop", "blog", "clinic", "agency", "news"][i % 5] + (i + 1) + ".ir", plan: HOSTING.linux[i % 4].name, diskUsed: 1 + (i % 5), diskTotal: [2, 10, 30, 80][i % 4], bwUsed: 10 + i * 9, bwTotal: 200, emails: i, dbs: i % 4, status: i % 5 === 3 ? "suspended" : "active", expires: "۱۴۰۵/۰" + fa(1 + (i % 9)) + "/۰۱", price: HOSTING.linux[i % 4].price, panel: "cPanel", server: "thr-web-0" + (i % 9) })),
  ];
  const dns = (): DnsRecord[] => [
    { id: sid("r"), type: "A", name: "@", value: "185.143.232.17", ttl: 3600 },
    { id: sid("r"), type: "A", name: "www", value: "185.143.232.17", ttl: 3600 },
    { id: sid("r"), type: "MX", name: "@", value: "mail.gereh.cloud", ttl: 3600, priority: 10 },
    { id: sid("r"), type: "TXT", name: "@", value: "v=spf1 include:gereh.cloud ~all", ttl: 3600 },
  ];
  const domains: Domain[] = [
    { id: "dom-501", userId: "u1", name: "novin.studio", registered: "۱۴۰۲/۰۴/۱۰", expires: "۱۴۰۵/۰۴/۱۰", autoRenew: true, privacy: true, locked: true, status: "active", ns: ["ns1.gereh.cloud", "ns2.gereh.cloud"], dns: dns(), authCode: "Gx7#pQ2m!Lw9" },
    { id: "dom-502", userId: "u1", name: "cafeland.ir", registered: "۱۴۰۳/۰۲/۰۱", expires: "۱۴۰۴/۰۸/۰۱", autoRenew: false, privacy: false, locked: true, status: "expiring", ns: ["ns1.gereh.cloud", "ns2.gereh.cloud"], dns: dns(), authCode: "" },
    { id: "dom-503", userId: "u1", name: "amirrezaei.com", registered: "۱۴۰۴/۰۱/۱۸", expires: "۱۴۰۵/۰۱/۱۸", autoRenew: true, privacy: true, locked: false, status: "active", ns: ["ns1.cloudflare.com", "ns2.cloudflare.com"], dns: [], authCode: "kT4@zN8r$Vb1" },
    ...Array.from({ length: 12 }, (_, i): Domain => ({ id: "dom-" + (600 + i), userId: "u" + (2 + i), name: ["parsa", "nova", "arta", "sahand", "dena", "baran"][i % 6] + (i + 1) + TLDS[i % 6].tld, registered: "۱۴۰۳/۰۱/۰۱", expires: "۱۴۰۵/۰" + fa(1 + (i % 9)) + "/۲۰", autoRenew: i % 2 === 0, privacy: i % 3 === 0, locked: true, status: i % 7 === 3 ? "expired" : "active", ns: ["ns1.gereh.cloud", "ns2.gereh.cloud"], dns: [], authCode: "" })),
  ];
  const invoices: Invoice[] = [
    { id: "INV-14062", userId: "u1", date: "۱۴۰۴/۰۷/۰۱", due: "۱۴۰۴/۰۷/۱۰", status: "unpaid", items: [{ desc: "سرور ابری db-primary، مهر ۱۴۰۴", amount: 2390000 }, { desc: "بکاپ روزانه", amount: 287000 }] },
    { id: "INV-14058", userId: "u1", date: "۱۴۰۴/۰۶/۲۸", due: "۱۴۰۴/۰۷/۰۵", status: "overdue", items: [{ desc: "تمدید دامنه cafeland.ir، یک سال", amount: 95000 }] },
    { id: "INV-14031", userId: "u1", date: "۱۴۰۴/۰۶/۰۱", due: "۱۴۰۴/۰۶/۱۰", status: "paid", items: [{ desc: "سرور ابری web-prod-1، شهریور ۱۴۰۴", amount: 1290000 }, { desc: "سرور ابری db-primary، شهریور ۱۴۰۴", amount: 2390000 }] },
    { id: "INV-13990", userId: "u1", date: "۱۴۰۴/۰۵/۰۱", due: "۱۴۰۴/۰۵/۱۰", status: "paid", items: [{ desc: "هاست نقره cafeland.ir، یک سال", amount: 1927000 }] },
    { id: "INV-13950", userId: "u1", date: "۱۴۰۴/۰۴/۰۱", due: "۱۴۰۴/۰۴/۱۰", status: "refunded", items: [{ desc: "سرور ابری test-box", amount: 390000 }] },
    ...Array.from({ length: 26 }, (_, i): Invoice => ({ id: "INV-" + (14100 + i), userId: "u" + (2 + (i % 20)), date: "۱۴۰۴/۰" + fa(1 + (i % 7)) + "/" + fa(10 + (i % 18)), due: "۱۴۰۴/۰" + fa(1 + (i % 7)) + "/" + fa(12 + (i % 16)), status: ["paid", "paid", "unpaid", "paid", "overdue", "paid", "refunded"][i % 7], items: [{ desc: ["سرور ابری", "هاست", "دامنه", "سرور اختصاصی"][i % 4] + " " + fa(i + 1), amount: [690000, 189000, 95000, 9800000][i % 4] }] })),
  ];
  const transactions: Transaction[] = [
    { id: "TX-90812", userId: "u1", date: "۱۴۰۴/۰۶/۰۲", type: "payment", amount: -3680000, method: "کیف پول", desc: "پرداخت INV-14031" },
    { id: "TX-90790", userId: "u1", date: "۱۴۰۴/۰۶/۰۱", type: "topup", amount: 5000000, method: "درگاه زرین‌پال", desc: "شارژ کیف پول" },
    { id: "TX-90511", userId: "u1", date: "۱۴۰۴/۰۵/۰۲", type: "payment", amount: -1927000, method: "درگاه زرین‌پال", desc: "پرداخت INV-13990" },
    { id: "TX-90420", userId: "u1", date: "۱۴۰۴/۰۴/۰۸", type: "refund", amount: 390000, method: "کیف پول", desc: "بازگشت وجه INV-13950" },
  ];
  const tickets: Ticket[] = [
    { id: "TK-3021", userId: "u1", subject: "کندی دیسک روی db-primary", dept: "فنی", priority: "high", status: "answered", service: "srv-1043", updated: "۱۴۰۴/۰۷/۱۳", assignee: "کاوه نوری", messages: [
      { from: "user", name: "امیر رضایی", at: "۱۴۰۴/۰۷/۱۳ ۰۹:۱۲", text: "از دیشب IOPS دیسک دیتابیس پایین آمده و کوئری‌ها کند شده‌اند. لطفا بررسی کنید." },
      { from: "staff", name: "کاوه نوری", at: "۱۴۰۴/۰۷/۱۳ ۰۹:۲۰", text: "سلام. روی نود میزبان یک عملیات rebuild آرایه در جریان بود که ساعت ۹:۱۸ تمام شد. لطفا دوباره بررسی کنید؛ اگر مشکل ادامه داشت، سرور را بدون هزینه به نود دیگری منتقل می‌کنیم." },
    ] },
    { id: "TK-2988", userId: "u1", subject: "درخواست فاکتور رسمی", dept: "مالی", priority: "normal", status: "closed", service: "", updated: "۱۴۰۴/۰۶/۰۴", assignee: "شیما کاظمی", messages: [
      { from: "user", name: "امیر رضایی", at: "۱۴۰۴/۰۶/۰۳ ۱۴:۰۰", text: "برای صورتحساب INV-14031 فاکتور رسمی با کد اقتصادی شرکت نیاز دارم." },
      { from: "staff", name: "شیما کاظمی", at: "۱۴۰۴/۰۶/۰۴ ۱۰:۳۰", text: "فاکتور رسمی صادر و در بخش صورتحساب‌ها قابل دانلود است." },
    ] },
    ...Array.from({ length: 11 }, (_, i): Ticket => ({ id: "TK-" + (3030 + i), userId: "u" + (2 + i), subject: ["قطعی سایت", "انتقال دامنه", "ارتقای سرور", "مشکل ایمیل", "سؤال درباره قیمت", "خطای SSL"][i % 6], dept: ["فنی", "فروش", "فنی", "فنی", "فروش", "فنی"][i % 6], priority: ["high", "normal", "low"][i % 3], status: ["open", "customer-reply", "answered", "open", "closed"][i % 5], service: "", updated: "۱۴۰۴/۰۷/" + fa(10 + (i % 4)), assignee: i % 3 ? "" : "کاوه نوری", messages: [{ from: "user", name: FIRST[i % FIRST.length], at: "۱۴۰۴/۰۷/۱۲ ۱۱:۰۰", text: "سلام، لطفا راهنمایی کنید." }] })),
  ];
  return {
    users, servers, hosting, domains, invoices, transactions, tickets,
    sshKeys: [{ id: "key-1", name: "MacBook Pro", fingerprint: "SHA256:3fK9…Qx2a", added: "۱۴۰۳/۱۱/۰۴" }],
    apiTokens: [{ id: "tok-1", name: "terraform-ci", scope: "read-write", created: "۱۴۰۴/۰۲/۰۱", lastUsed: "۱۴۰۴/۰۷/۱۳", expires: "۱۴۰۵/۰۲/۰۱" }],
    sessions: [
      { id: "ses-1", device: "Chrome، macOS", ip: "5.120.44.18", place: "تهران", last: "همین حالا", current: true },
      { id: "ses-2", device: "Safari، iPhone", ip: "5.120.44.18", place: "تهران", last: "۲ ساعت پیش", current: false },
      { id: "ses-3", device: "Firefox، Windows", ip: "91.98.12.4", place: "اصفهان", last: "۳ روز پیش", current: false },
    ],
    notifPrefs: { billing_email: true, billing_sms: true, service_email: true, service_sms: false, news_email: false, security_email: true, security_sms: true } as Record<string, boolean>,
    inbox: [] as { id: string; at: string; name: string; email: string; dept: string; subject: string; message: string }[],
    twofa: false,
    /** server-side only in production; kept here so disabling 2FA can demand a valid code */
    twofaSecret: "",
    notifications: [
      { id: "n1", icon: "file-search", text: "صورتحساب INV-14062 صادر شد", at: "۲ ساعت پیش", read: false },
      { id: "n2", icon: "message-circle", text: "پاسخ جدید در تیکت TK-3021", at: "۵ ساعت پیش", read: false },
      { id: "n3", icon: "database-backup", text: "بکاپ روزانه web-prod-1 کامل شد", at: "دیروز", read: true },
    ],
    activity: [
      { id: "a1", icon: "refresh-cw", text: "ری‌استارت سرور web-prod-1", at: "۱۴۰۴/۰۷/۱۳ ۰۸:۴۱", ip: "5.120.44.18" },
      { id: "a2", icon: "camera", text: "ساخت اسنپ‌شات before-upgrade", at: "۱۴۰۴/۰۵/۲۰ ۲۲:۱۰", ip: "5.120.44.18" },
      { id: "a3", icon: "lock", text: "ورود موفق به حساب", at: "۱۴۰۴/۰۵/۲۰ ۲۲:۰۲", ip: "5.120.44.18" },
    ],
    nodes: [
      { id: "thr-hv-01", loc: "thr", cpu: 62, ram: 71, disk: 48, vms: 38, status: "online", model: "EPYC 9354 / 768GB" },
      { id: "thr-hv-02", loc: "thr", cpu: 44, ram: 58, disk: 39, vms: 31, status: "online", model: "EPYC 9354 / 768GB" },
      { id: "thr-hv-03", loc: "thr", cpu: 88, ram: 83, disk: 71, vms: 46, status: "online", model: "EPYC 7543 / 512GB" },
      { id: "isf-hv-01", loc: "isf", cpu: 35, ram: 41, disk: 22, vms: 19, status: "online", model: "Xeon Gold 6338 / 512GB" },
      { id: "fra-hv-01", loc: "fra", cpu: 57, ram: 64, disk: 51, vms: 27, status: "online", model: "EPYC 7443P / 256GB" },
      { id: "ams-hv-01", loc: "ams", cpu: 0, ram: 0, disk: 33, vms: 0, status: "maintenance", model: "EPYC 7443P / 256GB" },
    ] as Node[],
    coupons: [
      { id: "cp-1", code: "YALDA1404", type: "percent", value: 20, used: 143, limit: 500, expires: "۱۴۰۴/۱۰/۰۱", active: true },
      { id: "cp-2", code: "WELCOME", type: "percent", value: 10, used: 1208, limit: 0, expires: "—", active: true },
      { id: "cp-3", code: "MIGRATE50", type: "fixed", value: 500000, used: 37, limit: 100, expires: "۱۴۰۴/۰۸/۳۰", active: false },
    ] as Coupon[],
    announcements: [{ id: "an-1", title: "نگهداری برنامه‌ریزی‌شده آمستردام", body: "نود ams-hv-01 روز جمعه ۱۸ مهر از ساعت ۲ تا ۴ بامداد به‌روزرسانی می‌شود. سرویس‌های شما خودکار جابه‌جا می‌شوند.", level: "info", at: "۱۴۰۴/۰۷/۱۲" }] as Announcement[],
    audit: [
      { id: "au1", actor: "مدیر سیستم", action: "تغییر قیمت پلن حرفه‌ای", target: "products/c3", at: "۱۴۰۴/۰۷/۱۰ ۱۶:۲۲", ip: "10.0.0.4" },
      { id: "au2", actor: "کاوه نوری", action: "پاسخ به تیکت", target: "TK-3021", at: "۱۴۰۴/۰۷/۱۳ ۰۹:۲۰", ip: "10.0.0.7" },
      { id: "au3", actor: "مدیر سیستم", action: "تعلیق کاربر", target: "u6", at: "۱۴۰۴/۰۷/۰۹ ۱۱:۰۵", ip: "10.0.0.4" },
    ],
    staff: [
      { id: "st-1", name: "مدیر سیستم", email: "admin@gereh.cloud", role: "مدیر کل" },
      { id: "st-2", name: "کاوه نوری", email: "kaveh@gereh.cloud", role: "پشتیبانی فنی" },
      { id: "st-3", name: "شیما کاظمی", email: "shima@gereh.cloud", role: "مالی" },
    ],
    settings: { siteName: "گره", supportEmail: "support@gereh.cloud", supportPhone: "۰۲۱-۹۱۰۰۰۰۰۰", registration: true, maintenance: false, tax: 10, gateways: { zarinpal: true, idpay: true, wallet: true, crypto: false } as Record<string, boolean>, smsProvider: "کاوه‌نگار", smsKeySet: false, smtpHost: "smtp.gereh.cloud", smtpPort: 587 },
    /* catalog copies the admin can edit (the public site reads the static catalog; a real backend revalidates it) */
    plans: { cloud: structuredClone(VPS.cloud), metal: structuredClone(VPS.metal), hosting: structuredClone(HOSTING.linux.concat(HOSTING.wordpress)) } as Record<"cloud" | "metal" | "hosting", Plan[]>,
    tlds: structuredClone(TLDS) as Tld[],
    /* Virtualizor-backed fields (mirrors what listvs / vpsmanage return) */
    virt: { host: "panel.gereh.cloud", port: 4085, key: "", connected: true, version: "Virtualizor 3.1.x", lastSync: "۱۴۰۵/۰۷/۱۴ ۰۹:۳۰", autoSync: true, passSet: true, bandSuspend: true, suspendUnpaid: true, terminateUnpaid: true, adminManaged: true } as Record<string, string | number | boolean>,
    virtLog: [
      { id: "vl1", at: "۱۴۰۵/۰۷/۱۴ ۰۹:۳۰", kind: "همگام‌سازی سرورها", result: "ok", detail: "۶ سرور، ۲۱۷ VPS" },
      { id: "vl2", at: "۱۴۰۵/۰۷/۱۴ ۰۹:۲۵", kind: "آمار ترافیک", result: "ok", detail: "۲۱۷ VPS به‌روز شد" },
      { id: "vl3", at: "۱۴۰۵/۰۷/۱۴ ۰۳:۰۰", kind: "تطبیق شبانه", result: "warn", detail: "۱ VPS در Virtualizor بدون سفارش در گره (vpsid 3517)" },
    ],
    planMap: VPS.cloud.concat(VPS.metal).map((p, i) => ({ id: p.id, name: p.name, plid: 10 + i, group: i < 4 ? "thr-cloud" : "thr-metal" })),
    osTemplates: [
      { osid: 347, name: "Ubuntu 24.04", distro: "ubuntu", on: true }, { osid: 342, name: "Ubuntu 22.04", distro: "ubuntu", on: true },
      { osid: 351, name: "Debian 12", distro: "debian", on: true }, { osid: 338, name: "Debian 11", distro: "debian", on: true },
      { osid: 360, name: "AlmaLinux 9", distro: "almalinux", on: true }, { osid: 362, name: "Rocky Linux 9", distro: "rocky", on: true },
      { osid: 370, name: "CentOS Stream 9", distro: "centos", on: false }, { osid: 381, name: "Windows Server 2022", distro: "windows", on: true },
      { osid: 377, name: "Windows Server 2019", distro: "windows", on: false }, { osid: 390, name: "FreeBSD 14", distro: "freebsd", on: false },
    ],
    isos: ["ubuntu-24.04.1-live-server-amd64.iso", "debian-12.7.0-amd64-netinst.iso", "virtio-win-0.1.262.iso", "systemrescue-11.02-amd64.iso"],
  };
}
export type DB = ReturnType<typeof seed>;

/* ---------- reactive store (immutable snapshots so React Compiler memoization stays correct) ---------- */
let DB: DB | null = null;
const getDB = () => (DB ??= seed());
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
function mutate(fn: (d: DB) => void) { const next = structuredClone(getDB()); fn(next); DB = next; emit(); }
export const useDB = () => useSyncExternalStore(subscribe, getDB, getDB);

/* ---------- session ---------- */
const SESSION_KEY = "gereh:session";
let SESSION: Session | null | undefined; // undefined = not read yet
function readSession(): Session | null {
  if (SESSION === undefined) {
    try { SESSION = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { SESSION = null; }
  }
  return SESSION ?? null;
}
function setSession(s: Session | null) {
  SESSION = s;
  try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch {}
  emit();
}
/** undefined while hydrating (server render), then the session or null. */
export const useSession = () => useSyncExternalStore<Session | null | undefined>(subscribe, readSession, () => undefined);
// ponytail: mock maps a staff session (no customer record) onto the demo customer u1.
const resolveMe = (db: DB, s: Session | null | undefined) => (s && db.users.some((u) => u.id === s.userId) ? s.userId : "u1");
const me = () => resolveMe(getDB(), readSession());
/** the customer id whose data the user panel shows */
export const useMyId = () => resolveMe(useDB(), useSession());

export const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id);
export const invTotal = (inv: Invoice) => inv.items.reduce((s, i) => s + i.amount, 0);
export const invGross = (inv: Invoice, tax: number) => roundK(invTotal(inv) * (1 + tax / 100));
const at = () => nowFa() + " " + nowTime();
/** next sequential id for "PREFIX-<n>" lists, safe against deletions and concurrent id schemes */
const nextNum = (list: { id: string }[], prefix: string, floor: number) =>
  prefix + "-" + (list.reduce((m, x) => Math.max(m, Number(x.id.slice(prefix.length + 1)) || 0), floor) + 1);
const logActivity = (d: DB, icon: string, text: string) => d.activity.unshift({ id: uid("a"), icon, text, at: at(), ip: "5.120.44.18" });
const logAudit = (d: DB, action: string, target: string) => d.audit.unshift({ id: uid("au"), actor: readSession()?.name || "مدیر سیستم", action, target, at: at(), ip: "10.0.0.4" });
const addTask = (d: DB, id: string, action: string) => byId(d.servers, id)!.tasks.unshift({ id: uid("t"), action, status: "done", at: at(), progress: 100 });
const srv = (d: DB, id: string) => {
  const s = byId(d.servers, id);
  if (!s) throw new Error("سرور پیدا نشد.");
  return s;
};
const randomSecret = (n: number, abc: string) => {
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return Array.from(a, (x) => abc[x % abc.length]).join("");
};
/** Jalali "YYYY/MM/DD" in any digits → comparable ASCII string, or "" when not a date */
const jdate = (v: string) => { const x = toEnDigits(v.trim()); return /^\d{4}\/\d{2}\/\d{2}$/.test(x) ? x : ""; };
export type Quote = { code: string; discount: number };
/** validates a coupon against the current DB and prices the discount for a subtotal (Toman) */
export function quoteCoupon(d: DB, raw: string, subtotal: number): Quote {
  const code = raw.trim().toUpperCase();
  const c = d.coupons.find((x) => x.code === code);
  if (!c || !c.active) throw new Error("کد تخفیف معتبر نیست.");
  if (c.limit && c.used >= c.limit) throw new Error("ظرفیت این کد تخفیف تمام شده است.");
  const exp = jdate(c.expires);
  if (exp && exp < jdate(nowFa())) throw new Error("این کد تخفیف منقضی شده است.");
  const discount = Math.min(subtotal, c.type === "percent" ? Math.round((subtotal * c.value) / 100) : c.value);
  return { code, discount };
}
const gatewayOn = (d: DB) => !!(d.settings.gateways.zarinpal || d.settings.gateways.idpay);
export const gatewayName = (d: DB) => (d.settings.gateways.zarinpal ? "درگاه زرین‌پال" : d.settings.gateways.idpay ? "درگاه آیدی‌پی" : "");

export const genPassword = () => randomSecret(16, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%");

export const api = {
  auth: {
    async login(id: string, password: string) {
      await delay(600);
      if (!id.trim() || !password) throw new Error("ایمیل یا موبایل و رمز عبور را وارد کنید.");
      const admin = /admin/i.test(id);
      setSession({ userId: admin ? "a1" : "u1", role: admin ? "admin" : "user", name: admin ? "مدیر سیستم" : "امیر رضایی" });
      return readSession()!;
    },
    async sendOtp(phone: string) { await delay(500); if (!PHONE_RE.test(phone)) throw new Error("شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود."); return true; },
    async verifyOtp(_phone: string, code: string) { await delay(500); if (code.length !== 6) throw new Error("کد ۶ رقمی را کامل وارد کنید."); setSession({ userId: "u1", role: "user", name: "امیر رضایی" }); return readSession()!; },
    async register(data: { name: string; email: string; phone: string; password: string }) { await delay(700); if (!getDB().settings.registration) throw new Error("ثبت‌نام کاربران جدید موقتا بسته است."); setSession({ userId: "u1", role: "user", name: data.name || "کاربر جدید" }); return readSession()!; },
    async forgot(email: string) { await delay(500); if (!EMAIL_RE.test(email)) throw new Error("یک ایمیل معتبر وارد کنید."); return true; },
    async logout() { await delay(150); setSession(null); },
    /** demo-only quick login; remove with the mock adapter */
    demo(role: "user" | "admin") { setSession(role === "admin" ? { userId: "a1", role: "admin", name: "مدیر سیستم" } : { userId: "u1", role: "user", name: "امیر رضایی" }); return readSession()!; },
  },
  servers: {
    async power(id: string, action: "start" | "stop" | "reboot") {
      await delay(700);
      mutate((d) => { const s = srv(d, id); s.status = action === "stop" ? "stopped" : "running"; logActivity(d, action === "stop" ? "pause" : action === "reboot" ? "refresh-cw" : "play", { start: "روشن کردن", stop: "خاموش کردن", reboot: "ری‌استارت" }[action] + " سرور " + s.name); });
    },
    async rename(id: string, name: string) { await delay(); mutate((d) => { srv(d, id).name = name; }); },
    async setRdns(id: string, rdns: string) { await delay(); mutate((d) => { srv(d, id).rdns = rdns; }); },
    async resize(id: string, plan: { name: string; cpu: number; ram: number; disk: number; price: number }) {
      await delay(900);
      mutate((d) => { Object.assign(srv(d, id), plan); addTask(d, id, "ارتقا به پلن " + plan.name); logActivity(d, "trending-up", "ارتقای سرور به پلن " + plan.name); });
    },
    async reinstall(id: string, os: string) { await delay(1200); mutate((d) => { const s = srv(d, id); s.os = os; s.status = "running"; addTask(d, id, "نصب مجدد " + os); logActivity(d, "terminal", "نصب مجدد " + os + " روی " + s.name); }); },
    async remove(id: string) { await delay(800); mutate((d) => { const s = srv(d, id); d.servers = d.servers.filter((x) => x.id !== id); logActivity(d, "trash-2", "حذف سرور " + s.name); }); },
    async toggleBackups(id: string) { await delay(); mutate((d) => { const s = srv(d, id); s.backups = !s.backups; }); },
    async snapshot(id: string, name?: string) { await delay(900); mutate((d) => { const s = srv(d, id); s.snapshots.unshift({ id: uid("snap"), name: name || "snapshot-" + (s.snapshots.length + 1), size: +(s.disk * 0.08).toFixed(1), at: nowFa() }); addTask(d, id, "ساخت اسنپ‌شات"); logActivity(d, "camera", "ساخت اسنپ‌شات برای " + s.name); }); },
    async deleteSnapshot(id: string, snapId: string) { await delay(); mutate((d) => { const s = srv(d, id); s.snapshots = s.snapshots.filter((x) => x.id !== snapId); }); },
    async restore(id: string, label: string) { await delay(1200); mutate((d) => { addTask(d, id, "بازیابی " + label); logActivity(d, "refresh-cw", "بازیابی " + label + " روی " + srv(d, id).name); }); },
    async addRule(id: string, rule: Omit<FwRule, "id">) { await delay(); mutate((d) => { srv(d, id).firewall.push({ id: uid("fw"), ...rule }); }); },
    async removeRule(id: string, ruleId: string) { await delay(); mutate((d) => { const s = srv(d, id); s.firewall = s.firewall.filter((r) => r.id !== ruleId); }); },
    async setStatus(id: string, status: string) { await delay(); mutate((d) => { srv(d, id).status = status; logAudit(d, "تغییر وضعیت سرور به " + status, id); }); },
    /* --- Virtualizor enduser features (called server-side with admin creds, svs=vpsid) --- */
    async setHostname(id: string, hostname: string) { await delay(700); mutate((d) => { srv(d, id).hostname = hostname; addTask(d, id, "تغییر hostname به " + hostname); logActivity(d, "pencil", "تغییر hostname سرور"); }); },
    async resetRootPassword(id: string, pass: string) {
      await delay(900);
      if (strength(pass) < 2) throw new Error("رمز ضعیف است؛ حداقل ۸ کاراکتر با عدد و حروف بزرگ.");
      mutate((d) => { addTask(d, id, "تغییر رمز root"); logActivity(d, "key-round", "تغییر رمز root سرور " + srv(d, id).name); });
    },
    async setVncPass(id: string, pass: string) { await delay(600); if (pass.length < 6) throw new Error("رمز VNC حداقل ۶ کاراکتر است."); mutate((d) => { srv(d, id).vnc.password = pass; addTask(d, id, "تغییر رمز VNC"); }); },
    async setBoot(id: string, boot: string) { await delay(600); mutate((d) => { srv(d, id).boot = boot; addTask(d, id, "تغییر ترتیب بوت"); }); },
    async mountIso(id: string, iso: string) { await delay(800); mutate((d) => { srv(d, id).iso = iso; addTask(d, id, iso ? "اتصال ISO " + iso : "جدا کردن ISO"); }); },
    async setRescue(id: string, on: boolean, pass?: string) {
      await delay(1200);
      if (on && (!pass || pass.length < 6)) throw new Error("برای حالت ریسکیو یک رمز حداقل ۶ کاراکتری لازم است.");
      mutate((d) => { srv(d, id).rescue = on; addTask(d, id, on ? "فعال‌سازی حالت ریسکیو" : "غیرفعال‌سازی حالت ریسکیو"); });
    },
    async installPanel(id: string, panel: string) { await delay(1200); mutate((d) => { addTask(d, id, "نصب " + panel); logActivity(d, "layout-dashboard", "نصب " + panel + " روی " + srv(d, id).name); }); },
  },
  hosting: {
    async resetPassword(_id: string) { await delay(600); return "Gh#" + randomSecret(10, "abcdefghjkmnpqrstuvwxyz23456789"); },
    async setStatus(id: string, status: string) { await delay(); mutate((d) => { byId(d.hosting, id)!.status = status; logAudit(d, "تغییر وضعیت هاست", id); }); },
  },
  domains: {
    async addRecord(id: string, r: Omit<DnsRecord, "id">) { await delay(); mutate((d) => { byId(d.domains, id)!.dns.push({ id: uid("r"), ...r }); }); },
    async updateRecord(id: string, r: DnsRecord) { await delay(); mutate((d) => { const dm = byId(d.domains, id)!; dm.dns = dm.dns.map((x) => (x.id === r.id ? r : x)); }); },
    async removeRecord(id: string, rid: string) { await delay(); mutate((d) => { const dm = byId(d.domains, id)!; dm.dns = dm.dns.filter((x) => x.id !== rid); }); },
    async setNs(id: string, ns: string[]) { await delay(700); mutate((d) => { const dm = byId(d.domains, id)!; dm.ns = ns; logActivity(d, "settings-2", "تغییر نام‌سرورهای " + dm.name); }); },
    async toggle(id: string, key: "autoRenew" | "privacy" | "locked") { await delay(); mutate((d) => { const dm = byId(d.domains, id)!; dm[key] = !dm[key]; }); },
    async renew(id: string, years: number) {
      await delay(700);
      let inv!: Invoice;
      mutate((d) => {
        const dm = byId(d.domains, id)!;
        const t = TLDS.slice().sort((a, b) => b.tld.length - a.tld.length).find((x) => dm.name.endsWith(x.tld)) || TLDS[0];
        inv = { id: nextNum(d.invoices, "INV", 14200), userId: me(), date: nowFa(), due: nowFa(), status: "unpaid", items: [{ desc: "تمدید دامنه " + dm.name + "، " + fa(years) + " سال", amount: t.renew * years }] };
        d.invoices.unshift(inv);
      });
      return inv;
    },
  },
  billing: {
    async topup(amount: number) {
      await delay(900);
      if (!gatewayOn(getDB())) throw new Error("درگاه پرداخت آنلاین موقتا غیرفعال است.");
      mutate((d) => { byId(d.users, me())!.balance += amount; d.transactions.unshift({ id: uid("TX"), userId: me(), date: nowFa(), type: "topup", amount, method: gatewayName(d), desc: "شارژ کیف پول" }); logActivity(d, "wallet", "شارژ کیف پول به مبلغ " + toman(amount)); });
    },
    async pay(invId: string, method: "wallet" | "gateway") {
      await delay(900);
      const db = getDB();
      const inv = byId(db.invoices, invId);
      if (!inv) throw new Error("صورتحساب پیدا نشد.");
      if (inv.status === "paid" || inv.status === "refunded") throw new Error("این صورتحساب قبلا پرداخت شده است.");
      if (method === "wallet" && !db.settings.gateways.wallet) throw new Error("پرداخت با کیف پول موقتا غیرفعال است.");
      if (method === "gateway" && !gatewayOn(db)) throw new Error("درگاه پرداخت آنلاین موقتا غیرفعال است.");
      const total = invGross(inv, db.settings.tax);
      if (method === "wallet" && byId(db.users, me())!.balance < total) throw new Error("موجودی کیف پول کافی نیست. ابتدا کیف پول را شارژ کنید.");
      mutate((d) => {
        byId(d.invoices, invId)!.status = "paid";
        if (method === "wallet") byId(d.users, me())!.balance -= total;
        d.transactions.unshift({ id: uid("TX"), userId: me(), date: nowFa(), type: "payment", amount: -total, method: method === "wallet" ? "کیف پول" : gatewayName(d), desc: "پرداخت " + invId });
        logActivity(d, "circle-check", "پرداخت صورتحساب " + invId);
      });
    },
    /** POST /checkout/quote — price a coupon without consuming it */
    async quote(code: string, subtotal: number) { await delay(400); return quoteCoupon(getDB(), code, subtotal); },
    async checkout(cart: Pick<CartItem, "title" | "meta" | "base">[], coupon?: string) {
      await delay(800);
      if (!cart.length) throw new Error("سبد خرید خالی است.");
      const subtotal = cart.reduce((s, c) => s + c.base, 0);
      const q = coupon ? quoteCoupon(getDB(), coupon, subtotal) : null; // re-validated server-side at checkout time
      let inv!: Invoice;
      mutate((d) => {
        const items = cart.map((c) => ({ desc: c.title + (c.meta ? "، " + c.meta : ""), amount: c.base }));
        if (q && q.discount) { items.push({ desc: "کد تخفیف " + q.code, amount: -q.discount }); d.coupons.find((c) => c.code === q.code)!.used++; }
        inv = { id: nextNum(d.invoices, "INV", 14200), userId: me(), date: nowFa(), due: nowFa(), status: "unpaid", items };
        d.invoices.unshift(inv);
      });
      return inv;
    },
    async markPaid(id: string) { await delay(); mutate((d) => { byId(d.invoices, id)!.status = "paid"; logAudit(d, "علامت‌گذاری پرداخت‌شده", id); }); },
    async refund(id: string) {
      await delay();
      mutate((d) => {
        const inv = byId(d.invoices, id)!; inv.status = "refunded";
        const amount = invGross(inv, d.settings.tax);
        const u = byId(d.users, inv.userId); if (u) u.balance += amount;
        d.transactions.unshift({ id: uid("TX"), userId: inv.userId, date: nowFa(), type: "refund", amount, method: "کیف پول", desc: "بازگشت وجه " + id });
        logAudit(d, "بازگشت وجه", id);
      });
    },
    async createInvoice(inv: Pick<Invoice, "userId" | "due" | "items">) { await delay(); mutate((d) => { d.invoices.unshift({ id: nextNum(d.invoices, "INV", 14200), date: nowFa(), status: "unpaid", ...inv }); logAudit(d, "صدور صورتحساب دستی", inv.userId); }); },
  },
  /** POST /contact — public form; the backend opens a ticket in the chosen department and emails a receipt */
  contact: {
    async send(m: { name: string; email: string; dept: string; subject: string; message: string }) {
      await delay(700);
      if (m.name.trim().length < 2 || !EMAIL_RE.test(m.email.trim()) || m.message.trim().length < 10) throw new Error("فرم کامل نیست.");
      mutate((d) => { d.inbox.unshift({ id: uid("msg"), at: at(), ...m }); });
    },
  },
  tickets: {
    async create(t: { subject: string; dept: string; priority: string; service: string; message: string }) {
      await delay(700);
      let id = "";
      mutate((d) => { id = nextNum(d.tickets, "TK", 3100); const name = byId(d.users, me())?.name || "کاربر"; d.tickets.unshift({ id, userId: me(), subject: t.subject, dept: t.dept, priority: t.priority, service: t.service, status: "open", updated: nowFa(), assignee: "", messages: [{ from: "user", name, at: at(), text: t.message }] }); });
      return id;
    },
    async reply(id: string, text: string, from: "user" | "staff" = "user") {
      await delay(500);
      mutate((d) => { const t = byId(d.tickets, id)!; t.messages.push({ from, name: from === "user" ? byId(d.users, t.userId)?.name || "کاربر" : readSession()?.name || "پشتیبانی", at: at(), text }); t.status = from === "user" ? "customer-reply" : "answered"; t.updated = nowFa(); if (from === "staff") logAudit(d, "پاسخ به تیکت", id); });
    },
    async update(id: string, patch: Partial<Ticket>) { await delay(300); mutate((d) => { Object.assign(byId(d.tickets, id)!, patch); }); },
  },
  account: {
    async updateProfile(p: Partial<User>) {
      await delay();
      if (p.email !== undefined && !EMAIL_RE.test(p.email)) throw new Error("ایمیل معتبر نیست.");
      if (p.phone !== undefined && !PHONE_RE.test(p.phone)) throw new Error("شماره موبایل معتبر نیست.");
      if (p.name !== undefined && p.name.trim().length < 2) throw new Error("نام را وارد کنید.");
      mutate((d) => { Object.assign(byId(d.users, me())!, p); });
    },
    async changePassword(cur: string, next: string) { await delay(700); if (!cur) throw new Error("رمز فعلی را وارد کنید."); if (next.length < 8) throw new Error("رمز جدید باید حداقل ۸ کاراکتر باشد."); },
    /** enabling requires a valid code for the freshly generated secret (POST /account/2fa/enable) */
    /** enabling needs a valid code for the new secret; disabling needs a valid code for the stored one */
    async setTwofa(on: boolean, secret?: string, code?: string) {
      await delay(600);
      const check = on ? secret : getDB().twofaSecret;
      if (!(check && code && (await verifyTotp(check, code)))) throw new Error("کد واردشده درست نیست؛ کد فعلی اپلیکیشن را وارد کنید.");
      mutate((d) => { d.twofa = on; d.twofaSecret = on ? check : ""; logActivity(d, "shield-check", on ? "فعال‌سازی ورود دومرحله‌ای" : "غیرفعال‌سازی ورود دومرحله‌ای"); });
    },
    /** POST /account/kyc (multipart) */
    async submitKyc(file: File) {
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw new Error("فقط تصویر JPG، PNG، WebP یا PDF.");
      if (file.size > 5 * 1024 * 1024) throw new Error("حجم فایل باید کمتر از ۵ مگابایت باشد.");
      await delay(900);
      mutate((d) => { byId(d.users, me())!.kyc = "pending"; logActivity(d, "upload", "بارگذاری مدرک احراز هویت"); });
    },
    async revokeSession(id: string) { await delay(); mutate((d) => { d.sessions = d.sessions.filter((s) => s.id !== id); }); },
    async setNotif(key: string, val: boolean) { mutate((d) => { d.notifPrefs[key] = val; }); },
    async addKey(k: { name: string; pub: string }) {
      await delay();
      const parts = k.pub.trim().split(/\s+/);
      const body = parts[1] || "";
      mutate((d) => { d.sshKeys.push({ id: uid("key"), name: k.name.trim(), fingerprint: "SHA256:" + body.slice(-12, -8) + "…" + body.slice(-4), added: nowFa() }); });
    },
    async removeKey(id: string) { await delay(); mutate((d) => { d.sshKeys = d.sshKeys.filter((k) => k.id !== id); }); },
    async createToken(t: { name: string; scope: string; expires: string }) {
      await delay(600);
      const secret = "grh_" + randomSecret(32, "abcdefghijklmnopqrstuvwxyz0123456789");
      mutate((d) => { d.apiTokens.push({ id: uid("tok"), created: nowFa(), lastUsed: "—", ...t }); });
      return secret;
    },
    async revokeToken(id: string) { await delay(); mutate((d) => { d.apiTokens = d.apiTokens.filter((k) => k.id !== id); }); },
    readAll() { mutate((d) => { d.notifications = d.notifications.map((n) => ({ ...n, read: true })); }); },
    readOne(id: string) { mutate((d) => { const n = byId(d.notifications, id); if (n) n.read = true; }); },
  },
  admin: {
    async updateUser(id: string, patch: Partial<User>) { await delay(); mutate((d) => { Object.assign(byId(d.users, id)!, patch); logAudit(d, "ویرایش کاربر", id); }); },
    /** POST /admin/users/:id/impersonate — staff keeps its role, the panel shows the customer's data */
    async impersonate(id: string) {
      await delay(300);
      const s = readSession(); const u = byId(getDB().users, id);
      if (!s || s.role !== "admin" || !u) throw new Error("اجازه این کار را ندارید.");
      mutate((d) => logAudit(d, "ورود به‌جای کاربر", id));
      setSession({ ...s, userId: id });
    },
    /** back to the staff identity after impersonating a customer */
    stopImpersonate() {
      const s = readSession();
      if (!s || s.role !== "admin") return;
      setSession({ ...s, userId: "a1" });
    },
    async adjustBalance(id: string, amount: number, reason: string) { await delay(); mutate((d) => { byId(d.users, id)!.balance += amount; logAudit(d, "تغییر موجودی " + toman(amount) + " (" + reason + ")", id); }); },
    async createUser(u: { name: string; email: string; phone: string }) {
      await delay();
      if (getDB().users.some((x) => x.email === u.email)) throw new Error("کاربری با این ایمیل وجود دارد.");
      mutate((d) => { d.users.unshift({ id: uid("u"), balance: 0, status: "active", kyc: "none", joined: nowFa(), services: 0, role: "user", company: "", ...u }); logAudit(d, "ساخت کاربر", u.email); });
    },
    async updatePlan(kind: "cloud" | "metal" | "hosting", id: string, patch: Partial<Plan>) { await delay(); mutate((d) => { Object.assign(byId(d.plans[kind], id)!, patch); logAudit(d, "ویرایش محصول", id); }); },
    async updateTld(tld: string, patch: Partial<Tld>) { await delay(); mutate((d) => { Object.assign(d.tlds.find((t) => t.tld === tld)!, patch); logAudit(d, "ویرایش قیمت پسوند", tld); }); },
    async toggleNode(id: string) { await delay(); mutate((d) => { const n = byId(d.nodes, id)!; n.status = n.status === "online" ? "maintenance" : "online"; logAudit(d, "تغییر حالت نود", id); }); },
    async addNode(n: { id: string; loc: string; model: string }) {
      await delay();
      if (byId(getDB().nodes, n.id)) throw new Error("نودی با این شناسه وجود دارد.");
      mutate((d) => { d.nodes.push({ cpu: 0, ram: 0, disk: 0, vms: 0, status: "online", ...n }); logAudit(d, "افزودن نود", n.id); });
    },
    async saveCoupon(c: Partial<Coupon> & { code: string }) {
      await delay();
      if (getDB().coupons.some((x) => x.code === c.code && x.id !== c.id)) throw new Error("این کد قبلا تعریف شده است.");
      if (c.expires && c.expires !== "—" && !jdate(c.expires)) throw new Error("تاریخ انقضا باید به شکل ۱۴۰۵/۰۱/۳۰ باشد.");
      mutate((d) => { if (c.id) Object.assign(byId(d.coupons, c.id)!, c); else d.coupons.unshift({ id: uid("cp"), used: 0, active: true, type: "percent", value: 0, limit: 0, expires: "—", ...c }); logAudit(d, "ذخیره کد تخفیف", c.code); });
    },
    async deleteCoupon(id: string) { await delay(); mutate((d) => { const c = byId(d.coupons, id); d.coupons = d.coupons.filter((x) => x.id !== id); logAudit(d, "حذف کد تخفیف", c?.code || id); }); },
    async saveAnnouncement(a: Omit<Announcement, "id" | "at">) { await delay(); mutate((d) => { d.announcements.unshift({ id: uid("an"), at: nowFa(), ...a }); logAudit(d, "انتشار اطلاعیه", a.title); }); },
    async deleteAnnouncement(id: string) { await delay(); mutate((d) => { d.announcements = d.announcements.filter((a) => a.id !== id); logAudit(d, "حذف اطلاعیه", id); }); },
    /** pass is sent to the backend only; the DB keeps a passSet flag, never the secret */
    async virtTest(cfg: { host: string; port: number; key: string; pass?: string }) {
      await delay(1100);
      const { pass, ...rest } = cfg;
      if (!rest.host || !rest.key) throw new Error("آدرس و کلید API لازم است.");
      if (!pass && !getDB().virt.passSet) throw new Error("رمز Admin API لازم است.");
      mutate((d) => { d.virt = { ...d.virt, ...rest, passSet: true, connected: true }; d.virtLog.unshift({ id: uid("vl"), at: at(), kind: "تست اتصال", result: "ok", detail: cfg.host + ":" + cfg.port }); });
    },
    async virtSync(kind: string) { await delay(1400); mutate((d) => { d.virt.lastSync = at(); d.virtLog.unshift({ id: uid("vl"), at: at(), kind: "همگام‌سازی " + kind, result: "ok", detail: "بدون تغییر ناسازگار" }); logAudit(d, "همگام‌سازی Virtualizor: " + kind, "virtualizor"); }); },
    async savePlanMap(id: string, patch: { plid?: number; group?: string }) { await delay(400); mutate((d) => { Object.assign(byId(d.planMap, id)!, patch); logAudit(d, "نگاشت پلن به Virtualizor", id); }); },
    async toggleTemplate(osid: number) { await delay(300); mutate((d) => { const t = d.osTemplates.find((x) => x.osid === osid)!; t.on = !t.on; logAudit(d, "تغییر نمایش قالب سیستم‌عامل", String(osid)); }); },
    async saveVirt(patch: Record<string, string | number | boolean>) { await delay(500); mutate((d) => { d.virt = { ...d.virt, ...patch }; logAudit(d, "ویرایش تنظیمات Virtualizor", "virtualizor"); }); },
    async saveSettings(patch: Partial<DB["settings"]>) { await delay(600); mutate((d) => { d.settings = { ...d.settings, ...patch }; logAudit(d, "ویرایش تنظیمات", Object.keys(patch).join(",")); }); },
    async addStaff(s: { name: string; email: string; role: string }) { await delay(); if (!EMAIL_RE.test(s.email)) throw new Error("ایمیل معتبر نیست."); mutate((d) => { d.staff.push({ id: uid("st"), ...s }); logAudit(d, "افزودن مدیر", s.email); }); },
    async removeStaff(id: string) { await delay(); mutate((d) => { const s = byId(d.staff, id); d.staff = d.staff.filter((x) => x.id !== id); logAudit(d, "حذف مدیر", s?.email || id); }); },
  },
};

/** test hooks: reset / read the mock DB without React */
export const __resetDB = () => { DB = null; SESSION = undefined; emit(); };
export const __getDB = getDB;
