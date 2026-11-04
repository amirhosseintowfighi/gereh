/* Dashboard figures from real records (../dashboard.ts) and the «داده‌های نمونه» diagnostic and cleanup
   (../demo-seed.ts). */
import "server-only";
import { z } from "zod";
import { actor, method, needStaff, needUser } from "../ctx";
import { adminDashboardStats, trafficSummary } from "../dashboard";
import { CLEANUP_CONFIRM, findSeedRows, removeSeedRows } from "../demo-seed";
import { sendEmail } from "../messaging";
import { getSettings } from "../state";
import { fail } from "../util";

export const realDataRpc = {
  /** every staff role sees the dashboard (viewer included), like the rest of the admin state */
  "admin.dashboardStats": method(z.tuple([]), async (ctx) => {
    if (needUser(ctx).user.role !== "admin") fail("اجازه این کار را ندارید.", 403);
    return adminDashboardStats(ctx.db);
  }),
  "servers.trafficSummary": method(z.tuple([]), async (ctx) => trafficSummary(ctx.db, needUser(ctx).uid)),
  "admin.seedRows": method(z.tuple([]), async (ctx) => { needStaff(ctx, "settings"); return findSeedRows(ctx.db); }),
  /** a real message through SMTP to the support address; without SMTP_HOST it says so instead of pretending */
  "admin.testEmail": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "settings");
    if (!process.env.SMTP_HOST) fail("SMTP_HOST در فایل تنظیمات سرور (.env) خالی است؛ تا تنظیم نشود ایمیلی ارسال نمی‌شود.");
    const to = (await getSettings(ctx.db)).supportEmail;
    await sendEmail(to, "ایمیل آزمایشی گره", "این پیام برای آزمایش تنظیمات SMTP از پنل مدیریت ارسال شد.");
    return { to };
  }),
  /** owner only, with the phrase typed out; removes nothing but the seed's own rows */
  "admin.removeSeedRows": method(z.tuple([z.string().max(60)]), async (ctx, [confirm]) => {
    needStaff(ctx, "settings");
    if (confirm.trim() !== CLEANUP_CONFIRM) fail("برای تأیید، عبارت «" + CLEANUP_CONFIRM + "» را دقیق بنویسید.");
    return removeSeedRows(ctx.db, { actor: actor(ctx), ip: ctx.ip });
  }),
};
