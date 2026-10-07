import "server-only";
import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { BUDGETS, COMPANY_SIZES, COMPANY_STAGES, DEVOPS_PACKAGES, DEVOPS_SERVICES, INFRA_OPTIONS, URGENCIES } from "@/content/devops";
import { EMAIL_RE, toEnDigits } from "@/lib/format";
import { addMonths, faDate } from "@/lib/jalali";
import { rateLimit } from "../auth";
import { actor, method, needStaff } from "../ctx";
import type { DB } from "../db/client";
import { devopsLeads, devopsProjects, users } from "../db/schema";
import { enqueue } from "../jobs";
import { fail, logAudit, nextId, notify, rid } from "../util";
import { createInvoice } from "./billing";

const SLUGS = DEVOPS_SERVICES.map((s) => s.slug) as [string, ...string[]];
const PLANS = ["startup", "growth", "enterprise", "project", "audit"] as const;
export const PLAN_LABEL: Record<(typeof PLANS)[number], string> = { startup: "بسته استارتاپ", growth: "بسته رشد", enterprise: "بسته سازمانی", project: "پروژه", audit: "ممیزی زیرساخت" };
const PHONE_ANY = /^(?:\+98|0)\d{10}$/;
const id = z.string().max(40);
const str = (max: number) => z.string().trim().max(max);

export const LEAD_INPUT = z.object({
  name: str(80), company: str(120), role: str(80).default(""), email: str(120), phone: str(20), website: str(200).default(""),
  size: z.enum(COMPANY_SIZES), stage: z.enum(COMPANY_STAGES), infra: z.array(z.enum(INFRA_OPTIONS)).min(1).max(5),
  services: z.array(z.enum(SLUGS)).min(1).max(SLUGS.length), pkg: z.enum(["", ...DEVOPS_PACKAGES.map((p) => p.id), "audit", "project", "hours"] as [string, ...string[]]).default(""),
  budget: z.enum(BUDGETS), urgency: z.enum(URGENCIES), needsNda: z.boolean().default(false), message: str(4000),
  consent: z.literal(true, { message: "پذیرش حریم خصوصی لازم است." }),
  source: str(120).default(""),
  /** honeypot: real visitors never see or fill it */
  hp: z.string().max(200).default(""),
});

const serviceTitle = (slug: string) => DEVOPS_SERVICES.find((s) => s.slug === slug)?.title ?? slug;

/** monthly retainer invoices for active projects (run daily by the worker) */
export async function devopsBilling(db: DB, now = new Date()) {
  const due = await db.select().from(devopsProjects).where(and(eq(devopsProjects.status, "active"), sql`${devopsProjects.monthlyFee} > 0`, isNotNull(devopsProjects.nextBillAt), lte(devopsProjects.nextBillAt, now))).orderBy(asc(devopsProjects.nextBillAt));
  let issued = 0;
  for (const p of due) {
    await db.transaction(async (tx) => {
      // claim the period first so a concurrent run cannot bill it twice
      const r = await tx.update(devopsProjects).set({ nextBillAt: addMonths(p.nextBillAt!, 1) }).where(and(eq(devopsProjects.id, p.id), eq(devopsProjects.nextBillAt, p.nextBillAt!))).returning({ id: devopsProjects.id });
      if (!r.length) return;
      const inv = await createInvoice(tx, p.userId, [{ desc: "خدمات دواپس، " + PLAN_LABEL[p.plan] + " — " + p.title + " (دوره " + faDate(p.nextBillAt!) + " تا " + faDate(addMonths(p.nextBillAt!, 1)) + ")", amount: p.monthlyFee }], { dueDays: 10 });
      await tx.update(devopsProjects).set({ hoursUsed: 0 }).where(eq(devopsProjects.id, p.id));
      await enqueue(tx, "notify.send", { userId: p.userId, kind: "billing", subject: "صورتحساب خدمات دواپس " + inv, text: "صورتحساب ماهانه «" + p.title + "» صادر شد و در پنل گره قابل پرداخت است." });
      issued++;
    });
  }
  return issued;
}

export const devopsRpc = {
  /** public: consultation request from /devops (works signed in or out) */
  "devops.request": method(z.tuple([LEAD_INPUT]), async (ctx, [f]) => {
    if (f.hp) return { ref: "DO-0" }; // bot: pretend success, store nothing
    await rateLimit(ctx.db, "devops:" + (ctx.ip || "anon"), 3, 3600);
    if (f.name.length < 2) fail("نام را وارد کنید.");
    if (f.company.length < 2) fail("نام شرکت یا محصول را وارد کنید.");
    const email = f.email.toLowerCase();
    if (!EMAIL_RE.test(email)) fail("ایمیل معتبر نیست.");
    const phone = toEnDigits(f.phone).replace(/[\s-]/g, "");
    if (!PHONE_ANY.test(phone)) fail("شماره تماس معتبر نیست؛ مثلا ۰۹۱۲۱۲۳۴۵۶۷ یا ۰۲۱۹۱۰۰۰۰۰۰.");
    if (f.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(f.website)) fail("نشانی وب‌سایت معتبر نیست.");
    if (f.message.length < 20) fail("کمی بیشتر از وضعیت و نیازتان بنویسید (حداقل ۲۰ نویسه).");
    const ref = await nextId(ctx.db, "DO", 1000);
    await ctx.db.insert(devopsLeads).values({
      id: ref, name: f.name, company: f.company, role: f.role, email, phone, website: f.website, size: f.size, stage: f.stage, infra: [...new Set(f.infra)],
      services: [...new Set(f.services)], pkg: f.pkg, budget: f.budget, urgency: f.urgency, needsNda: f.needsNda, message: f.message,
      userId: ctx.auth?.uid ?? null, source: f.source, ip: ctx.ip,
    });
    const summary = ["شماره پیگیری: " + ref, "شرکت: " + f.company + " (" + f.size + "، " + f.stage + ")", "خدمات: " + f.services.map(serviceTitle).join("، "), "زیرساخت: " + f.infra.join("، "), "بودجه: " + f.budget, "فوریت: " + f.urgency, f.needsNda ? "قرارداد محرمانگی پیش از جلسه لازم است." : ""].filter(Boolean).join("\n");
    await enqueue(ctx.db, "notify.send", { to: process.env.DEVOPS_INBOX || process.env.CONTACT_INBOX || "hello@gereh.net", subject: (f.urgency.startsWith("فوری") ? "[فوری] " : "") + "درخواست دواپس " + ref + ": " + f.company, text: summary + "\n\n" + f.name + (f.role ? " — " + f.role : "") + "\n" + email + "\n" + phone + (f.website ? "\n" + f.website : "") + "\n\n" + f.message });
    await enqueue(ctx.db, "notify.send", { to: email, subject: "درخواست شما در گره ثبت شد (" + ref + ")", text: "سلام " + f.name + "،\n\nدرخواست مشاوره دواپس برای «" + f.company + "» رسید. یکی از مهندسان ما ظرف یک روز کاری" + (f.urgency.startsWith("فوری") ? " (برای موارد فوری، همین امروز)" : "") + " برای هماهنگی جلسه آشنایی رایگان تماس می‌گیرد.\n\n" + summary + "\n\nاگر قرارداد محرمانگی لازم دارید، پیش از جلسه نسخه آن ارسال می‌شود.\n\nتیم دواپس گره" });
    const staff = await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), inArray(users.staffRole, ["owner", "sales"])));
    for (const s of staff) await notify(ctx.db, s.id, "rocket", "درخواست دواپس جدید: " + f.company + " (" + ref + ")");
    return { ref };
  }),

  "devops.updateLead": method(z.tuple([id, z.object({ status: z.enum(["new", "contacted", "meeting", "proposal", "won", "lost"]).optional(), assignee: str(80).optional(), value: z.number().int().min(0).max(1e12).optional() })]), async (ctx, [lid, patch]) => {
    needStaff(ctx, "devops");
    const r = await ctx.db.update(devopsLeads).set({ ...patch, updatedAt: new Date() }).where(eq(devopsLeads.id, lid)).returning({ id: devopsLeads.id });
    if (!r.length) fail("درخواست پیدا نشد.", 404);
    if (patch.status) await logAudit(ctx.db, actor(ctx), "تغییر وضعیت درخواست دواپس به " + patch.status, lid, ctx.ip);
  }),

  "devops.noteLead": method(z.tuple([id, str(2000)]), async (ctx, [lid, text]) => {
    const a = needStaff(ctx, "devops");
    if (text.length < 2) fail("یادداشت خالی است.");
    const note = { at: new Date().toISOString(), by: a.user.name, text };
    const r = await ctx.db.update(devopsLeads).set({ notes: sql`${devopsLeads.notes} || ${JSON.stringify([note])}::jsonb`, updatedAt: new Date() }).where(eq(devopsLeads.id, lid)).returning({ id: devopsLeads.id });
    if (!r.length) fail("درخواست پیدا نشد.", 404);
  }),

  /** turn a customer (optionally from a won lead) into an engagement */
  "devops.createProject": method(z.tuple([z.object({ userId: id, leadId: id.optional(), title: str(160), plan: z.enum(PLANS), services: z.array(z.enum(SLUGS)).max(SLUGS.length), monthlyFee: z.number().int().min(0).max(1e11), hoursIncluded: z.number().int().min(0).max(2000), engineer: str(80), start: z.boolean() })]), async (ctx, [p]) => {
    needStaff(ctx, "devops");
    if (p.title.length < 3) fail("عنوان پروژه را بنویسید.");
    const [u] = await ctx.db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, p.userId));
    if (!u || u.role !== "user") fail("مشتری پیدا نشد.", 404);
    if (p.plan !== "project" && p.plan !== "audit" && p.monthlyFee <= 0 && p.plan !== "enterprise") fail("مبلغ ماهانه بسته را وارد کنید.");
    const pid = rid("dvp");
    const now = new Date();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(devopsProjects).values({ id: pid, userId: p.userId, leadId: p.leadId ?? null, title: p.title, plan: p.plan, services: p.services, monthlyFee: p.monthlyFee, hoursIncluded: p.hoursIncluded, engineer: p.engineer, status: p.start ? "active" : "planning", startedAt: p.start ? now : null, nextBillAt: p.start && p.monthlyFee > 0 ? now : null });
      if (p.leadId) await tx.update(devopsLeads).set({ status: "won", userId: p.userId, updatedAt: now }).where(eq(devopsLeads.id, p.leadId));
      await notify(tx, p.userId, "rocket", "پروژه دواپس «" + p.title + "» در پنل شما فعال شد");
    });
    await logAudit(ctx.db, actor(ctx), "ایجاد پروژه دواپس", pid, ctx.ip);
    return pid;
  }),

  "devops.updateProject": method(z.tuple([id, z.object({ title: str(160).optional(), status: z.enum(["planning", "active", "paused", "done"]).optional(), monthlyFee: z.number().int().min(0).max(1e11).optional(), hoursIncluded: z.number().int().min(0).max(2000).optional(), hoursUsed: z.number().min(0).max(5000).optional(), engineer: str(80).optional() })]), async (ctx, [pid, patch]) => {
    needStaff(ctx, "devops");
    const [cur] = await ctx.db.select().from(devopsProjects).where(eq(devopsProjects.id, pid));
    if (!cur) fail("پروژه پیدا نشد.", 404);
    const starting = patch.status === "active" && cur!.status !== "active";
    await ctx.db.update(devopsProjects).set({
      ...patch,
      ...(starting ? { startedAt: cur!.startedAt ?? new Date(), nextBillAt: cur!.nextBillAt ?? ((patch.monthlyFee ?? cur!.monthlyFee) > 0 ? new Date() : null) } : {}),
    }).where(eq(devopsProjects.id, pid));
    if (patch.status && patch.status !== cur!.status) await logAudit(ctx.db, actor(ctx), "وضعیت پروژه دواپس: " + patch.status, pid, ctx.ip);
  }),

  "devops.setMilestones": method(z.tuple([id, z.array(z.object({ id: str(20).optional(), title: str(160).min(2), due: str(20), done: z.boolean() })).max(50)]), async (ctx, [pid, ms]) => {
    needStaff(ctx, "devops");
    const r = await ctx.db.update(devopsProjects).set({ milestones: ms.map((m) => ({ id: m.id || rid("ms"), title: m.title, due: m.due, done: m.done })) }).where(eq(devopsProjects.id, pid)).returning({ userId: devopsProjects.userId });
    if (!r.length) fail("پروژه پیدا نشد.", 404);
  }),

  /** progress note the customer sees (and is emailed) */
  "devops.postUpdate": method(z.tuple([id, str(4000)]), async (ctx, [pid, text]) => {
    const a = needStaff(ctx, "devops");
    if (text.length < 5) fail("متن گزارش کوتاه است.");
    const note = { at: new Date().toISOString(), by: a.user.name, text };
    const [p] = await ctx.db.update(devopsProjects).set({ updates: sql`${devopsProjects.updates} || ${JSON.stringify([note])}::jsonb` }).where(eq(devopsProjects.id, pid)).returning();
    if (!p) fail("پروژه پیدا نشد.", 404);
    await notify(ctx.db, p.userId, "rocket", "گزارش جدید پروژه «" + p.title + "»");
    await enqueue(ctx.db, "notify.send", { userId: p.userId, kind: "service", subject: "گزارش پیشرفت: " + p.title, text });
  }),

  /** one-off invoice for fixed-price work, audits or extra hours */
  "devops.invoice": method(z.tuple([id, z.object({ desc: str(200), amount: z.number().int().min(10_000).max(1e11) })]), async (ctx, [pid, item]) => {
    needStaff(ctx, "devops");
    if (item.desc.length < 3) fail("شرح صورتحساب را بنویسید.");
    const [p] = await ctx.db.select().from(devopsProjects).where(eq(devopsProjects.id, pid));
    if (!p) fail("پروژه پیدا نشد.", 404);
    const inv = await createInvoice(ctx.db, p!.userId, [{ desc: item.desc + " — " + p!.title, amount: item.amount }], { dueDays: 10 });
    await logAudit(ctx.db, actor(ctx), "صدور صورتحساب دواپس " + inv, pid, ctx.ip);
    return inv;
  }),
};
