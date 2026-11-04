/* Rows the demo seed (./seed.ts, demo=true) writes, found again by their fixed ids. Used by the admin card
   «داده‌های نمونه» to show what an old demo seed left in a production database and to remove exactly
   those rows. Every user-owned row counts only when its owner is a verified seed account (fixed id AND its
   seed email), so a real customer's records never match; global rows match on id plus a seeded value. */
import "server-only";
import { and, eq, inArray, like, notInArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { DEMO_POSTS } from "@/content/demo-posts";
import type { SeedItem, SeedReport } from "@/lib/dashboard";
import type { DB, Tx } from "./db/client";
import * as t from "./db/schema";
import { verifyPassword } from "./password";
import { DEFAULT_VIRT, DEMO_PASSWORD } from "./seed";
import { logAudit } from "./util";

const range = (prefix: string, from: number, n: number, pad = 0) => Array.from({ length: n }, (_, i) => prefix + String(from + i).padStart(pad, "0"));

/** the seed's accounts: [id, email] */
export const SEED_USERS: [string, string][] = [
  ["u1", "demo@gereh.net"], ...Array.from({ length: 23 }, (_, i): [string, string] => ["u" + (i + 2), "user" + (i + 2) + "@mail.ir"]),
  ["st-2", "kaveh@gereh.net"], ["st-3", "shima@gereh.net"],
];
const SERVERS = ["srv-1042", "srv-1043", "srv-1101", ...range("srv-", 1200, 14)];
const HOSTING = ["hst-221", ...range("hst-", 300, 9)];
const DOMAINS = ["dom-501", "dom-502", "dom-503", ...range("dom-", 600, 12)];
const INVOICES = ["INV-14062", "INV-14058", "INV-14031", "INV-13990", "INV-13950", ...range("INV-", 14100, 26)];
const TICKETS = ["TK-3021", "TK-2988", ...range("TK-", 3030, 11)];
const TXS = ["TX-90812", "TX-90790", "TX-90511", "TX-90420"];
const APPS = ["app-demo1", "app-demo-salon"], DBS = ["pdb-demo1", "pdb-demo-salon"];
const NODES: [string, string][] = [["thr-hv-01", "EPYC 9354 / 768GB"], ["thr-hv-02", "EPYC 9354 / 768GB"], ["thr-hv-03", "EPYC 7543 / 512GB"], ["isf-hv-01", "Xeon Gold 6338 / 512GB"], ["fra-hv-01", "EPYC 7443P / 256GB"], ["ams-hv-01", "EPYC 7443P / 256GB"]];
const COUPONS: [string, string][] = [["cp-1", "YALDA1404"], ["cp-2", "WELCOME"], ["cp-3", "MIGRATE50"]];
const AUDIT: [string, string][] = [["au1", "تغییر قیمت پلن حرفه‌ای"], ["au2", "پاسخ به تیکت"], ["au3", "تعلیق کاربر"]];
const VIRT_LOG: [string, string][] = [["vl1", "۶ سرور، ۲۱۷ VPS"], ["vl2", "۲۱۷ VPS به‌روز شد"], ["vl3", "۱ VPS در Virtualizor بدون سفارش در گره (vpsid 3517)"]];
const FAKE_VIRT_VERSION = "Virtualizor 3.1.x";

type Spec = { key: string; label: string; table: PgTable; id: SQL; where: (u: string[]) => SQL | undefined };
const pairs = <C1, C2>(list: [string, string][], a: C1, b: C2) => sql.join(list.map(([x, y]) => sql`(${a} = ${x} and ${b} = ${y})`), sql` or `);

/** in deletion order: children before the rows they point to; `u` = the verified seed account ids */
const SPECS: Spec[] = [
  { key: "inquiryCalls", label: "درخواست‌های استعلام نمونه", table: t.inquiryCalls, id: sql`${t.inquiryCalls.id}`, where: (u) => and(like(t.inquiryCalls.id, "INQ-DEMO%"), inArray(t.inquiryCalls.userId, u)) },
  { key: "inquiryGrants", label: "مجوزهای استعلام نمونه", table: t.inquiryGrants, id: sql`${t.inquiryGrants.id}::text`, where: (u) => inArray(t.inquiryGrants.userId, u) },
  { key: "inquiryAccounts", label: "حساب API استعلام نمونه", table: t.inquiryAccounts, id: sql`${t.inquiryAccounts.userId}`, where: (u) => and(inArray(t.inquiryAccounts.userId, u), eq(t.inquiryAccounts.apiKey, "GerehDemoKey2024")) },
  { key: "mailDomains", label: "دامنه ایمیل نمونه (با پیام‌ها و صندوق‌ها)", table: t.mailDomains, id: sql`${t.mailDomains.id}`, where: (u) => and(eq(t.mailDomains.id, "mail-demo1"), inArray(t.mailDomains.userId, u)) },
  { key: "geoZones", label: "دامنه‌های Geo DNS نمونه", table: t.geoZones, id: sql`${t.geoZones.id}`, where: (u) => and(inArray(t.geoZones.id, ["geo-demo1", "geo-demo2"]), inArray(t.geoZones.userId, u)) },
  { key: "builderProjects", label: "پروژه سازنده AI نمونه", table: t.builderProjects, id: sql`${t.builderProjects.id}`, where: (u) => and(eq(t.builderProjects.id, "bld-demo1"), inArray(t.builderProjects.userId, u)) },
  { key: "paasApps", label: "اپ‌های نمونه", table: t.paasApps, id: sql`${t.paasApps.id}`, where: (u) => and(inArray(t.paasApps.id, APPS), inArray(t.paasApps.userId, u)) },
  { key: "paasDbs", label: "پایگاه‌های داده نمونه", table: t.paasDbs, id: sql`${t.paasDbs.id}`, where: (u) => and(inArray(t.paasDbs.id, DBS), inArray(t.paasDbs.userId, u)) },
  { key: "devopsProjects", label: "پروژه دواپس نمونه", table: t.devopsProjects, id: sql`${t.devopsProjects.id}`, where: (u) => and(eq(t.devopsProjects.id, "dvp-demo1"), inArray(t.devopsProjects.userId, u)) },
  { key: "devopsLeads", label: "درخواست‌های دواپس نمونه", table: t.devopsLeads, id: sql`${t.devopsLeads.id}`, where: () => pairs([["DO-1001", "sina@pardakhtyar.example"], ["DO-1000", "demo@gereh.net"]], t.devopsLeads.id, t.devopsLeads.email) },
  { key: "tickets", label: "تیکت‌های نمونه", table: t.tickets, id: sql`${t.tickets.id}`, where: (u) => and(inArray(t.tickets.id, TICKETS), inArray(t.tickets.userId, u)) },
  { key: "transactions", label: "تراکنش‌های نمونه", table: t.transactions, id: sql`${t.transactions.id}`, where: (u) => and(inArray(t.transactions.id, TXS), inArray(t.transactions.userId, u)) },
  { key: "invoices", label: "صورتحساب‌های نمونه", table: t.invoices, id: sql`${t.invoices.id}`, where: (u) => and(inArray(t.invoices.id, INVOICES), inArray(t.invoices.userId, u)) },
  { key: "domains", label: "دامنه‌های نمونه", table: t.domains, id: sql`${t.domains.id}`, where: (u) => and(inArray(t.domains.id, DOMAINS), inArray(t.domains.userId, u)) },
  { key: "domainContacts", label: "شناسه ایرنیک نمونه", table: t.domainContacts, id: sql`${t.domainContacts.userId}`, where: (u) => and(inArray(t.domainContacts.userId, u), eq(t.domainContacts.irnicHandle, "am1234-irnic")) },
  { key: "hosting", label: "هاست‌های نمونه", table: t.hosting, id: sql`${t.hosting.id}`, where: (u) => and(inArray(t.hosting.id, HOSTING), inArray(t.hosting.userId, u)) },
  { key: "servers", label: "سرورهای نمونه (srv-1042 و…)", table: t.servers, id: sql`${t.servers.id}`, where: (u) => and(inArray(t.servers.id, SERVERS), inArray(t.servers.userId, u)) },
  { key: "sshKeys", label: "کلید SSH نمونه", table: t.sshKeys, id: sql`${t.sshKeys.id}`, where: (u) => and(eq(t.sshKeys.id, "key-1"), inArray(t.sshKeys.userId, u)) },
  { key: "notifications", label: "اعلان‌های نمونه", table: t.notifications, id: sql`${t.notifications.id}`, where: (u) => and(inArray(t.notifications.id, ["n1", "n2", "n3"]), inArray(t.notifications.userId, u)) },
  { key: "activity", label: "فعالیت‌های نمونه", table: t.activity, id: sql`${t.activity.id}`, where: (u) => and(inArray(t.activity.id, ["a1", "a2", "a3"]), inArray(t.activity.userId, u)) },
  { key: "nodes", label: "نودهای نمونه (با بار CPU ساختگی)", table: t.nodes, id: sql`${t.nodes.id}`, where: () => pairs(NODES, t.nodes.id, t.nodes.model) },
  { key: "coupons", label: "کدهای تخفیف نمونه (با آمار استفاده ساختگی)", table: t.coupons, id: sql`${t.coupons.id}`, where: () => pairs(COUPONS, t.coupons.id, t.coupons.code) },
  { key: "announcements", label: "اطلاعیه نمونه", table: t.announcements, id: sql`${t.announcements.id}`, where: () => and(eq(t.announcements.id, "an-1"), eq(t.announcements.title, "نگهداری برنامه‌ریزی‌شده آمستردام")) },
  { key: "audit", label: "رویدادهای ساختگی گزارش ممیزی", table: t.audit, id: sql`${t.audit.id}`, where: () => pairs(AUDIT, t.audit.id, t.audit.action) },
  { key: "virtLog", label: "لاگ‌های ساختگی Virtualizor", table: t.virtLog, id: sql`${t.virtLog.id}`, where: () => pairs(VIRT_LOG, t.virtLog.id, t.virtLog.detail) },
];


async function seedUsers(db: DB | Tx) {
  return db.select({ id: t.users.id, email: t.users.email }).from(t.users).where(pairs(SEED_USERS, t.users.id, sql`lower(${t.users.email})`));
}
/** seed accounts that own rows the seed did not write (someone used them for real): they are kept */
async function busyUsers(db: DB | Tx, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const own = (table: PgTable, col: AnyPgColumn, idCol: AnyPgColumn, seeded: string[]) =>
    db.selectDistinct({ u: sql<string>`${col}` }).from(table).where(and(inArray(col, ids), seeded.length ? notInArray(idCol, seeded) : undefined));
  const owned = await Promise.all([
    own(t.servers, t.servers.userId, t.servers.id, SERVERS), own(t.hosting, t.hosting.userId, t.hosting.id, HOSTING), own(t.domains, t.domains.userId, t.domains.id, DOMAINS),
    own(t.invoices, t.invoices.userId, t.invoices.id, INVOICES), own(t.transactions, t.transactions.userId, t.transactions.id, TXS), own(t.payments, t.payments.userId, t.payments.id, []),
    own(t.tickets, t.tickets.userId, t.tickets.id, TICKETS), own(t.devopsProjects, t.devopsProjects.userId, t.devopsProjects.id, ["dvp-demo1"]),
    own(t.paasApps, t.paasApps.userId, t.paasApps.id, APPS), own(t.paasDbs, t.paasDbs.userId, t.paasDbs.id, DBS),
  ]);
  return new Set(owned.flat().map((r) => r.u));
}

/** what the demo seed left behind (read-only) */
export async function findSeedRows(db: DB): Promise<SeedReport> {
  const users = await seedUsers(db);
  const u = users.map((x) => x.id);
  const items: SeedItem[] = [];
  for (const s of SPECS) {
    const rows = await db.select({ id: s.id }).from(s.table).where(s.where(u));
    if (rows.length) items.push({ key: s.key, label: s.label, count: rows.length, sample: rows.slice(0, 5).map((r) => String(r.id)) });
  }
  const notSeed = await busyUsers(db, u);
  const deletable = users.filter((x) => !notSeed.has(x.id));
  if (deletable.length) items.push({ key: "users", label: "حساب‌های نمونه (demo@gereh.net و…)", count: deletable.length, sample: deletable.slice(0, 5).map((x) => x.email) });
  const [virt] = await db.select().from(t.kv).where(eq(t.kv.key, "virt"));
  const v = (virt?.value ?? {}) as Record<string, unknown>;
  const fakeVirt = v.version === FAKE_VIRT_VERSION && !v.passEnc;
  const warnings: string[] = [];
  if (notSeed.size) warnings.push("حساب‌های نمونه " + [...notSeed].join("، ") + " رکوردهای غیرنمونه هم دارند؛ این حساب‌ها حذف نمی‌شوند.");
  // the demo seed's owner account (admin@gereh.net / the published demo password) is a takeover risk, not removable data
  for (const a of await db.select({ id: t.users.id, email: t.users.email, hash: t.users.passwordHash }).from(t.users).where(and(eq(t.users.role, "admin"), inArray(sql`lower(${t.users.email})`, ["admin@gereh.net", "kaveh@gereh.net", "shima@gereh.net"]))))
    if (await verifyPassword(DEMO_PASSWORD, a.hash)) warnings.push("حساب مدیر " + a.email + " هنوز رمز نمایشی عمومی را دارد؛ فوراً رمز را عوض کنید.");
  const [{ n: posts }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.posts).where(inArray(t.posts.slug, DEMO_POSTS.map((p) => p.slug)));
  const total = items.reduce((a, i) => a + i.count, 0) + (fakeVirt ? 1 : 0);
  return { items, total, users, keptUsers: [...notSeed], fakeVirt, warnings, posts };
}

export const CLEANUP_CONFIRM = "حذف داده‌های نمونه";

/** removes exactly the demo seed's rows (idempotent: a second run removes nothing) and writes one audit entry */
export async function removeSeedRows(db: DB, by: { actor: string; ip: string }) {
  const removed: Record<string, number> = {};
  let keptUsers: string[] = [];
  await db.transaction(async (tx) => {
    const users = await seedUsers(tx);
    const u = users.map((x) => x.id);
    for (const s of SPECS) {
      const rows = await tx.delete(s.table).where(s.where(u)).returning({ id: s.id });
      if (rows.length) removed[s.key] = rows.length;
    }
    const busy = await busyUsers(tx, u);
    keptUsers = [...busy];
    const gone = u.filter((id) => !busy.has(id));
    if (gone.length) removed.users = (await tx.delete(t.users).where(inArray(t.users.id, gone)).returning({ id: t.users.id })).length;
    const [virt] = await tx.select().from(t.kv).where(eq(t.kv.key, "virt"));
    const v = (virt?.value ?? {}) as Record<string, unknown>;
    if (v.version === FAKE_VIRT_VERSION && !v.passEnc) {
      await tx.update(t.kv).set({ value: { ...v, connected: false, passSet: false, version: DEFAULT_VIRT.version } }).where(eq(t.kv.key, "virt"));
      removed.virt = 1;
    }
    const total = Object.values(removed).reduce((a, n) => a + n, 0);
    if (total) await logAudit(tx, by.actor, "حذف داده‌های نمونه (seed): " + total.toLocaleString("fa-IR") + " ردیف", Object.entries(removed).map(([k, n]) => k + ":" + n).join(" "), by.ip);
  });
  return { removed, total: Object.values(removed).reduce((a, n) => a + n, 0), keptUsers };
}
