/* Mail jobs: hourly billing from the wallet (sending suspended without credit), DNS re-checks,
   delivery of queued messages, 90-day log retention and mailbox usage. */
import "server-only";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { LOG_DAYS } from "@/lib/mail";
import type { DB } from "../db/client";
import { mailDomains, mailMailboxes, mailMessages, mailPlans, transactions, users } from "../db/schema";
import { enqueue } from "../jobs";
import { mailDriver } from "../mail/driver";
import { checkDns, deliverMessage, mailHourly } from "../mail/service";
import { notify, rid } from "../util";

export const mailDeliver = (db: DB, p: { id: string }) => deliverMessage(db, p);

/** hourly: one wallet charge per customer for all their mail domains; no credit → sending suspended */
export async function mailBilling(db: DB) {
  const plans = new Map((await db.select().from(mailPlans)).map((p) => [p.id, p]));
  const doms = await db.select().from(mailDomains).where(ne(mailDomains.suspendReason, "staff"));
  const byUser = new Map<string, typeof doms>();
  for (const d of doms) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
  for (const [uid, list] of byUser) {
    const billable = list.filter((d) => d.suspendReason !== "credit");
    const cost = billable.reduce((s, d) => s + mailHourly(plans.get(d.planId)?.price ?? 0), 0);
    if (cost > 0) {
      const ok = await db.transaction(async (tx) => {
        const [u] = await tx.update(users).set({ balance: sql`${users.balance} - ${cost}` }).where(and(eq(users.id, uid), sql`${users.balance} >= ${cost}`)).returning({ id: users.id });
        if (!u) return false;
        await tx.insert(transactions).values({ id: rid("TX"), userId: uid, type: "usage", amount: -cost, method: "کیف پول", desc: "مصرف ساعتی سرویس ایمیل: " + billable.slice(0, 4).map((d) => d.domain).join("، ") + (billable.length > 4 ? " و…" : "") });
        return true;
      });
      if (!ok) {
        await db.update(mailDomains).set({ status: "suspended", suspendReason: "credit" }).where(inArray(mailDomains.id, billable.map((d) => d.id)));
        await notify(db, uid, "wallet", "موجودی کیف پول تمام شد؛ ارسال ایمیل دامنه‌های شما متوقف شد");
        await enqueue(db, "notify.send", { userId: uid, kind: "billing", subject: "توقف ارسال ایمیل", text: "موجودی کیف پول برای هزینه ساعتی سرویس ایمیل کافی نیست و ارسال متوقف شد. صندوق‌ها و تنظیمات حفظ شده‌اند؛ پس از شارژ کیف پول، ارسال خودکار از سر گرفته می‌شود." });
        continue;
      }
    }
    // credit is back (24 hours of the suspended domains' cost): resume
    const held = list.filter((d) => d.suspendReason === "credit");
    if (!held.length) continue;
    const need = 24 * held.reduce((s, d) => s + mailHourly(plans.get(d.planId)?.price ?? 0), 0);
    const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
    if (!u || u.balance < need) continue;
    for (const d of held) {
      await db.update(mailDomains).set({ status: "pending", suspendReason: "" }).where(eq(mailDomains.id, d.id));
      await checkDns(db, { ...d, status: "pending", suspendReason: "" });
    }
    await notify(db, uid, "play", "ارسال ایمیل دوباره فعال شد");
  }
}

/** hourly: re-check DNS of domains still waiting for verification (or one on demand) */
export async function mailDns(db: DB, p: { domainId?: string } = {}) {
  const list = p.domainId ? await db.select().from(mailDomains).where(eq(mailDomains.id, p.domainId)) : await db.select().from(mailDomains).where(eq(mailDomains.status, "pending"));
  for (const d of list) await checkDns(db, d);
}

/** daily: drop logs older than 90 days, refresh mailbox usage, re-verify active domains */
export async function mailDaily(db: DB) {
  await db.delete(mailMessages).where(lt(mailMessages.createdAt, new Date(Date.now() - LOG_DAYS * 86400_000)));
  const boxes = await db.select({ b: mailMailboxes, domain: mailDomains.domain }).from(mailMailboxes).innerJoin(mailDomains, eq(mailDomains.id, mailMailboxes.domainId));
  if (boxes.length) {
    const used = await mailDriver().usage(boxes.map((x) => x.b.local + "@" + x.domain));
    for (const { b, domain } of boxes) { const mb = used[b.local + "@" + domain]; if (mb !== undefined && mb !== b.usedMb) await db.update(mailMailboxes).set({ usedMb: mb }).where(eq(mailMailboxes.id, b.id)); }
  }
  for (const d of await db.select().from(mailDomains).where(eq(mailDomains.status, "active"))) await checkDns(db, d);
}
