/* «راه‌اندازی کسب‌وکار» (group "business"): a small business asks for a done-for-you package from /business or the
   home page. The request joins the sales pipeline as a lead (devops_leads, source "business"), so staff call back,
   price it and turn a won lead into a project with monthly invoices from /admin/devops, as for DevOps work. */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { BIZ_GOALS, BIZ_PACKAGES, bizPackage, type BizGoal } from "@/lib/business";
import { EMAIL_RE, toEnDigits, toman } from "@/lib/format";
import { rateLimit } from "../auth";
import { method } from "../ctx";
import { devopsLeads, users } from "../db/schema";
import { enqueue } from "../jobs";
import { fail, nextId, notify } from "../util";

const PHONE_ANY = /^(?:\+98|0)\d{10}$/;
const str = (max: number) => z.string().trim().max(max);
const PKGS = BIZ_PACKAGES.map((p) => p.id) as [string, ...string[]];
const GOALS = BIZ_GOALS.map((g) => g.id) as [BizGoal, ...BizGoal[]];

export const BUSINESS_INPUT = z.object({
  name: str(80), business: str(120), phone: str(20), email: str(120).default(""),
  pkg: z.enum(PKGS), goal: z.enum(GOALS).or(z.literal("")).default(""),
  message: str(2000).default(""),
  consent: z.literal(true, { message: "پذیرش حریم خصوصی لازم است." }),
  source: str(120).default(""),
  /** honeypot: real visitors never see or fill it */
  hp: z.string().max(200).default(""),
});

const priceLine = (id: string) => {
  const p = bizPackage(id)!;
  return p.quote ? "قیمت بعد از جلسه آشنایی" : "راه‌اندازی " + toman(p.setup) + " + ماهانه " + toman(p.monthly);
};

export const businessRpc = {
  /** public: works signed in or out */
  "business.request": method(z.tuple([BUSINESS_INPUT]), async (ctx, [f]) => {
    if (f.hp) return { ref: "BZ-0" }; // bot: pretend success, store nothing
    await rateLimit(ctx.db, "business:" + (ctx.ip || "anon"), 3, 3600);
    if (f.name.length < 2) fail("نام را وارد کنید.");
    if (f.business.length < 2) fail("نام کسب‌وکار را وارد کنید.");
    const phone = toEnDigits(f.phone).replace(/[\s-]/g, "");
    if (!PHONE_ANY.test(phone)) fail("شماره تماس معتبر نیست؛ مثلا ۰۹۱۲۱۲۳۴۵۶۷.");
    const email = f.email.toLowerCase();
    if (email && !EMAIL_RE.test(email)) fail("ایمیل معتبر نیست.");
    const pkg = bizPackage(f.pkg)!;
    const goal = BIZ_GOALS.find((g) => g.id === f.goal);
    const ref = await nextId(ctx.db, "BZ", 1000);
    await ctx.db.insert(devopsLeads).values({
      id: ref, name: f.name, company: f.business, email, phone,
      size: "کسب‌وکار کوچک", stage: goal?.title ?? "—", infra: [], services: ["business"], pkg: pkg.id,
      budget: priceLine(pkg.id), urgency: pkg.days, message: f.message || "—",
      // the list price is the deal's first value; sales adjust it after the call
      value: pkg.quote ? 0 : pkg.setup,
      userId: ctx.auth?.uid ?? null, source: "business" + (f.source ? ":" + f.source : ""), ip: ctx.ip,
    });
    const summary = ["شماره پیگیری: " + ref, "بسته: «" + pkg.name + "» (" + priceLine(pkg.id) + ")", goal ? "هدف: " + goal.title : "", "کسب‌وکار: " + f.business].filter(Boolean).join("\n");
    await enqueue(ctx.db, "notify.send", { to: process.env.SALES_INBOX || process.env.DEVOPS_INBOX || process.env.CONTACT_INBOX || "hello@gereh.net", subject: "درخواست بسته کسب‌وکار " + ref + ": " + f.business, text: summary + "\n\n" + f.name + "\n" + phone + (email ? "\n" + email : "") + "\n\n" + (f.message || "") });
    if (email) await enqueue(ctx.db, "notify.send", { to: email, subject: "درخواست شما در گره ثبت شد (" + ref + ")", text: "سلام " + f.name + "،\n\nدرخواست بسته «" + pkg.name + "» برای «" + f.business + "» رسید. همکار ما امروز یا حداکثر یک روز کاری بعد با شماره " + phone + " تماس می‌گیرد تا نیازتان را بپرسد. این تماس رایگان است و تعهدی ایجاد نمی‌کند.\n\n" + summary + "\n\nتیم گره" });
    const staff = await ctx.db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), inArray(users.staffRole, ["owner", "sales"])));
    for (const s of staff) await notify(ctx.db, s.id, "store", "درخواست بسته کسب‌وکار: " + f.business + " (" + ref + ")");
    return { ref };
  }),
};
