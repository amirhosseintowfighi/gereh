import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_RE } from "@/lib/format";
import { rateLimit } from "../auth";
import { actor, isStaff, method, needUser } from "../ctx";
import { domains, inbox, servers, ticketMessages, tickets, users } from "../db/schema";
import { enqueue } from "../jobs";
import { fail, logAudit, nextId, notify, rid } from "../util";

const DEPTS = ["فنی", "مالی", "فروش", "دواپس"] as const;
const PRIOS = ["low", "normal", "high"] as const;
const STATUSES = ["open", "answered", "customer-reply", "closed"] as const;

export const supportRpc = {
  "tickets.create": method(z.tuple([z.object({ subject: z.string().max(120), dept: z.enum(DEPTS), priority: z.enum(PRIOS), service: z.string().max(40), message: z.string().max(5000) })]), async (ctx, [t]) => {
    const a = needUser(ctx);
    const subject = t.subject.trim(), message = t.message.trim();
    if (subject.length < 3) fail("موضوع را وارد کنید.");
    if (message.length < 10) fail("توضیح باید حداقل ۱۰ کاراکتر باشد.");
    await rateLimit(ctx.db, "ticket:" + a.uid, 20, 3600);
    if (t.service) {
      const [s] = await ctx.db.select({ id: servers.id }).from(servers).where(and(eq(servers.id, t.service), eq(servers.userId, a.uid)));
      const [d] = s ? [s] : await ctx.db.select({ id: domains.id }).from(domains).where(and(eq(domains.id, t.service), eq(domains.userId, a.uid)));
      if (!d) fail("سرویس انتخابی پیدا نشد.");
    }
    const [me] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, a.uid));
    const id = await nextId(ctx.db, "TK", 3100);
    await ctx.db.insert(tickets).values({ id, userId: a.uid, subject, dept: t.dept, priority: t.priority, service: t.service, status: "open" });
    await ctx.db.insert(ticketMessages).values({ ticketId: id, from: "user", name: me?.name || "کاربر", text: message });
    await enqueue(ctx.db, "tickets.sla", { ticketId: id, kind: "auto-reply" });
    return id;
  }),

  "tickets.reply": method(z.tuple([z.string().max(20), z.string().max(5000), z.enum(["user", "staff"]).optional()]), async (ctx, [tid, raw, as]) => {
    const a = needUser(ctx);
    const text = raw.trim();
    if (text.length < 2) fail("متن پاسخ خالی است.");
    const staff = as === "staff";
    if (staff && !isStaff(ctx, "tickets")) fail("اجازه این کار را ندارید.", 403);
    const [t] = await ctx.db.select().from(tickets).where(staff ? eq(tickets.id, tid) : and(eq(tickets.id, tid), eq(tickets.userId, a.uid)));
    if (!t) fail("تیکت پیدا نشد.", 404);
    if (t!.status === "closed" && !staff) fail("این تیکت بسته شده است؛ تیکت جدید ثبت کنید.");
    const [author] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, staff ? a.user.id : t!.userId));
    await ctx.db.insert(ticketMessages).values({ ticketId: t!.id, from: staff ? "staff" : "user", name: author?.name || (staff ? "پشتیبانی" : "کاربر"), text });
    await ctx.db.update(tickets).set({
      status: staff ? "answered" : "customer-reply", updatedAt: new Date(),
      ...(staff && !t!.firstResponseAt ? { firstResponseAt: new Date() } : {}),
      ...(staff && !t!.assignee ? { assignee: a.user.name } : {}),
    }).where(eq(tickets.id, t!.id));
    if (staff) {
      await notify(ctx.db, t!.userId, "message-circle", "پاسخ جدید در تیکت " + t!.id);
      await enqueue(ctx.db, "notify.send", { userId: t!.userId, kind: "service", subject: "پاسخ تیکت " + t!.id, text: "به تیکت «" + t!.subject + "» پاسخ داده شد:\n\n" + text });
      await logAudit(ctx.db, actor(ctx), "پاسخ به تیکت", t!.id, ctx.ip);
    }
  }),

  "tickets.update": method(z.tuple([z.string().max(20), z.object({ status: z.enum(STATUSES).optional(), priority: z.enum(PRIOS).optional(), dept: z.enum(DEPTS).optional(), assignee: z.string().max(80).optional() })]), async (ctx, [tid, patch]) => {
    const a = needUser(ctx);
    const staff = isStaff(ctx, "tickets");
    const [t] = await ctx.db.select().from(tickets).where(staff ? eq(tickets.id, tid) : and(eq(tickets.id, tid), eq(tickets.userId, a.uid)));
    if (!t) fail("تیکت پیدا نشد.", 404);
    // customers may only close their own ticket
    const allowed = staff ? patch : patch.status === "closed" ? { status: "closed" as const } : fail("اجازه این کار را ندارید.", 403);
    await ctx.db.update(tickets).set({ ...allowed, updatedAt: new Date() }).where(eq(tickets.id, t!.id));
    if (staff) await logAudit(ctx.db, actor(ctx), "ویرایش تیکت " + Object.keys(patch).join(","), t!.id, ctx.ip);
  }),

  "contact.send": method(z.tuple([z.object({ name: z.string().max(80), email: z.string().max(120), dept: z.string().max(40), subject: z.string().max(120), message: z.string().max(5000) })]), async (ctx, [m]) => {
    if (m.name.trim().length < 2 || !EMAIL_RE.test(m.email.trim()) || m.message.trim().length < 10) fail("فرم کامل نیست.");
    await rateLimit(ctx.db, "contact:" + ctx.ip, 5, 3600);
    await ctx.db.insert(inbox).values({ id: rid("msg"), name: m.name.trim(), email: m.email.trim(), dept: m.dept.trim(), subject: m.subject.trim(), message: m.message.trim() });
    await enqueue(ctx.db, "notify.send", { to: process.env.CONTACT_INBOX || "hello@gereh.net", subject: "پیام جدید: " + (m.subject.trim() || m.dept), text: m.name + " <" + m.email + ">\n\n" + m.message });
  }),
};
