/* Recurring billing: renewal invoices (paid from the wallet when auto-pay is on), reminders,
   overdue → suspend → terminate per the Virtualizor policies, and hourly metering. */
import "server-only";
import { and, eq, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import { faDate } from "@/lib/jalali";
import { invGross } from "@/lib/money";
import type { DB } from "../db/client";
import { domains, hosting, invoiceItems, invoices, servers, tlds, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { createInvoice, settleInvoice } from "../rpc/billing";
import type { FulfilItem } from "../rpc/fulfil";
import { getSettings, getVirt } from "../state";
import { virt } from "../virt/driver";
import { addTask, logActivity, notify, rid } from "../util";

const DAY = 86400_000;

/** is there already an open invoice renewing this service? */
async function openRenewal(db: DB, kind: string, id: string) {
  const rows = await db.select({ f: invoices.fulfil }).from(invoices).where(and(inArray(invoices.status, ["unpaid", "overdue"]), sql`${invoices.fulfil} @> ${JSON.stringify([{ type: "renew", kind, id }])}::jsonb`));
  return rows.length > 0;
}

async function issueRenewal(db: DB, userId: string, f: Extract<FulfilItem, { type: "renew" }>, desc: string, amount: number, due: Date) {
  if (await openRenewal(db, f.kind, f.id)) return;
  const id = await createInvoice(db, userId, [{ desc, amount }], { fulfil: [f], dueDays: Math.max(1, Math.ceil((due.getTime() - Date.now()) / DAY)) });
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  const gross = invGross({ items, tax: inv.taxRate });
  if (u?.autoPay && u.balance >= gross && (await getSettings(db)).gateways.wallet) {
    try {
      await db.transaction((tx) => settleInvoice(tx, id, "کیف پول (تمدید خودکار)", { wallet: true }));
      await notify(db, userId, "refresh-cw", desc + " خودکار از کیف پول تمدید شد");
      return;
    } catch { /* balance changed meanwhile: leave the invoice for the customer */ }
  }
  await enqueue(db, "notify.send", { userId, kind: "billing", subject: "صورتحساب تمدید " + id, text: desc + "\nمبلغ: " + gross.toLocaleString("fa-IR") + " تومان\nسررسید: " + faDate(due) + "\nپرداخت: https://gereh.net/panel/billing" });
}

/** daily: renewal invoices 7 days ahead (domains 30), auto-paid from the wallet when possible */
export async function renewals(db: DB) {
  const now = Date.now();
  for (const s of await db.select().from(servers).where(and(eq(servers.billing, "monthly"), isNotNull(servers.paidUntil), lte(servers.paidUntil, new Date(now + 7 * DAY)), ne(servers.status, "building"))))
    await issueRenewal(db, s.userId, { type: "renew", kind: "server", id: s.id, months: 1 }, "تمدید ماهانه سرور " + s.name, s.price, s.paidUntil!);
  for (const h of await db.select().from(hosting).where(and(eq(hosting.autoRenew, true), lte(hosting.expiresAt, new Date(now + 7 * DAY)))))
    await issueRenewal(db, h.userId, { type: "renew", kind: "hosting", id: h.id, months: 1 }, "تمدید ماهانه هاست " + h.domain, h.price, h.expiresAt);
  const allTlds = (await db.select().from(tlds)).sort((a, b) => b.tld.length - a.tld.length);
  for (const d of await db.select().from(domains).where(and(eq(domains.autoRenew, true), lte(domains.expiresAt, new Date(now + 30 * DAY)), ne(domains.status, "expired")))) {
    const t = allTlds.find((x) => d.name.endsWith(x.tld));
    if (t) await issueRenewal(db, d.userId, { type: "renew", kind: "domain", id: d.id, months: 12 }, "تمدید یک‌ساله دامنه " + d.name, t.renew, d.expiresAt);
  }
}

/** daily: mark overdue; suspend after 7 days and terminate 14 days after suspension (per policy) */
export async function overdue(db: DB) {
  const now = new Date();
  await db.update(invoices).set({ status: "overdue" }).where(and(eq(invoices.status, "unpaid"), lt(invoices.dueAt, now)));
  const policy = await getVirt(db);
  const v = await virt();
  // services whose paid period ended more than 7 days ago with the renewal still unpaid
  if (policy.suspendUnpaid) {
    for (const s of await db.select().from(servers).where(and(eq(servers.billing, "monthly"), eq(servers.status, "running"), lt(servers.paidUntil, new Date(now.getTime() - 7 * DAY))))) {
      if (s.vpsid) await v.suspend(s.vpsid);
      await db.update(servers).set({ status: "suspended", suspendedAt: now }).where(eq(servers.id, s.id));
      await addTask(db, s.id, "تعلیق به دلیل عدم پرداخت");
      await notify(db, s.userId, "ban", "سرور " + s.name + " به دلیل عدم پرداخت معلق شد");
      await enqueue(db, "notify.send", { userId: s.userId, kind: "service", subject: "تعلیق سرور " + s.name, text: "سرور " + s.name + " به دلیل پرداخت‌نشدن صورتحساب تمدید معلق شد. با پرداخت، سرور خودکار فعال می‌شود." });
    }
    for (const h of await db.select().from(hosting).where(and(eq(hosting.status, "active"), lt(hosting.expiresAt, new Date(now.getTime() - 7 * DAY))))) {
      await (await import("../providers")).providers().then((p) => p.hosting.suspend(h));
      await db.update(hosting).set({ status: "suspended" }).where(eq(hosting.id, h.id));
      await notify(db, h.userId, "ban", "هاست " + h.domain + " به دلیل عدم پرداخت معلق شد");
    }
  }
  if (policy.terminateUnpaid) {
    for (const s of await db.select().from(servers).where(and(eq(servers.status, "suspended"), lt(servers.suspendedAt, new Date(now.getTime() - 14 * DAY)), lt(servers.paidUntil, now)))) {
      if (s.vpsid) await v.remove(s.vpsid);
      await db.delete(servers).where(eq(servers.id, s.id));
      await logActivity(db, s.userId, "trash-2", "حذف سرور " + s.name + " پس از ۱۴ روز تعلیق");
      await notify(db, s.userId, "trash-2", "سرور " + s.name + " پس از ۱۴ روز تعلیق حذف شد");
    }
  }
  await db.update(domains).set({ status: "expired" }).where(and(lt(domains.expiresAt, now), ne(domains.status, "expired")));
  await db.update(domains).set({ status: "expiring" }).where(and(eq(domains.status, "active"), lt(domains.expiresAt, new Date(now.getTime() + 30 * DAY))));
}

/** daily: reminders 3 days before due and on the due date */
export async function reminders(db: DB) {
  const now = Date.now();
  const due = await db.select().from(invoices).where(and(eq(invoices.status, "unpaid"), lte(invoices.dueAt, new Date(now + 3 * DAY))));
  for (const inv of due) {
    const days = Math.round((inv.dueAt.getTime() - now) / DAY);
    if (days !== 3 && days !== 0) continue;
    await enqueue(db, "notify.send", { userId: inv.userId, kind: "billing", subject: "یادآوری صورتحساب " + inv.id, text: "صورتحساب " + inv.id + (days ? " سه روز دیگر" : " امروز") + " سررسید می‌شود.\nپرداخت: https://gereh.net/panel/billing" }, { dedupe: "remind:" + inv.id + ":" + days });
  }
}

/** hourly: meter hourly servers from the wallet; suspend when credit runs out */
export async function hourly(db: DB) {
  const list = await db.select().from(servers).where(and(eq(servers.billing, "hourly"), inArray(servers.status, ["running", "stopped"])));
  for (const s of list) {
    const cost = Math.max(1, Math.round(s.price / 720));
    const ok = await db.transaction(async (tx) => {
      const [u] = await tx.update(users).set({ balance: sql`${users.balance} - ${cost}` }).where(and(eq(users.id, s.userId), sql`${users.balance} >= ${cost}`)).returning({ id: users.id });
      if (!u) return false;
      await tx.insert(transactions).values({ id: rid("TX"), userId: s.userId, type: "usage", amount: -cost, method: "کیف پول", desc: "مصرف ساعتی " + s.name });
      return true;
    });
    if (!ok) {
      if (s.vpsid) await (await virt()).suspend(s.vpsid);
      await db.update(servers).set({ status: "suspended", suspendedAt: new Date() }).where(eq(servers.id, s.id));
      await notify(db, s.userId, "wallet", "موجودی کیف پول تمام شد؛ سرور ساعتی " + s.name + " معلق شد");
      await enqueue(db, "notify.send", { userId: s.userId, kind: "billing", subject: "اتمام موجودی", text: "موجودی کیف پول برای سرور ساعتی " + s.name + " کافی نیست و سرور معلق شد. کیف پول را شارژ کنید تا سرور فعال شود." });
    }
  }
  // credit returned → reactivate suspended hourly servers
  for (const s of await db.select().from(servers).where(and(eq(servers.billing, "hourly"), eq(servers.status, "suspended")))) {
    const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, s.userId));
    if (u && u.balance >= s.price / 720 * 24) {
      if (s.vpsid) await (await virt()).unsuspend(s.vpsid);
      await db.update(servers).set({ status: "running", suspendedAt: null }).where(eq(servers.id, s.id));
      await notify(db, s.userId, "play", "سرور ساعتی " + s.name + " دوباره فعال شد");
    }
  }
}
