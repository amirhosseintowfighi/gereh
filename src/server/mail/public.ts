import "server-only";
import { asc, eq } from "drizzle-orm";
import { MAIL_PLAN_DEFAULTS } from "@/lib/mail";
import { db } from "../ctx";
import { mailPlans } from "../db/schema";

export async function publicMailPlans() {
  try {
    return (await (await db()).select().from(mailPlans).where(eq(mailPlans.active, true)).orderBy(asc(mailPlans.position)))
      .map((p) => ({ id: p.id, name: p.name, price: p.price, dailyLimit: p.dailyLimit, monthlyLimit: p.monthlyLimit, mailboxes: p.mailboxes, quotaMb: p.quotaMb, active: true }));
  } catch {
    return MAIL_PLAN_DEFAULTS;
  }
}
