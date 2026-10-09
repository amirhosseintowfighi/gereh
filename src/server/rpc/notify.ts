import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { SITE_URL } from "@/lib/seo";
import { botConfig, channelSend, checkWebhookUrl, NOTIFY_KINDS, newLinkCode, setBotWebhooks } from "../channels";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { notifyChannels } from "../db/schema";
import { seal } from "../secrets";
import { fail, logActivity, logAudit } from "../util";

const events = z.array(z.enum(NOTIFY_KINDS)).min(1).max(4);
async function own(ctx: Ctx, id: string) {
  const a = needUser(ctx);
  const [c] = await ctx.db.select().from(notifyChannels).where(and(eq(notifyChannels.id, id), eq(notifyChannels.userId, a.uid)));
  if (!c) fail("کانال پیدا نشد.", 404);
  return c!;
}
async function room(ctx: Ctx, uid: string) {
  const [{ n }] = await ctx.db.select({ n: count() }).from(notifyChannels).where(eq(notifyChannels.userId, uid));
  if (n >= 10) fail("حداکثر ۱۰ کانال اعلان.");
}

export const notifyRpc = {
  /** deep link that connects the user's Telegram/Bale chat to the account (valid 15 minutes) */
  "notify.botLink": method(z.tuple([z.enum(["telegram", "bale"])]), async (ctx, [kind]) => {
    const a = needUser(ctx);
    const c = botConfig(kind);
    if (!c.username) fail("ربات " + (kind === "telegram" ? "تلگرام" : "بله") + " هنوز راه‌اندازی نشده است.");
    await room(ctx, a.uid);
    return c.link + c.username + "?start=" + (await newLinkCode(ctx.db, a.uid, kind));
  }),
  /** returns the signing secret once */
  "notify.addWebhook": method(z.tuple([z.object({ url: z.string().trim().max(500), label: z.string().trim().max(40).default(""), events })]), async (ctx, [w]) => {
    const a = needUser(ctx);
    const err = await checkWebhookUrl(w.url);
    if (err) fail(err);
    await room(ctx, a.uid);
    const secret = "whsec_" + randomBytes(24).toString("base64url");
    await ctx.db.insert(notifyChannels).values({ id: "ch-" + randomBytes(6).toString("hex"), userId: a.uid, kind: "webhook", target: w.url, label: w.label || new URL(w.url).hostname, secretEnc: seal(secret), events: w.events });
    await logActivity(ctx.db, a.uid, "plug", "افزودن وب‌هوک اعلان " + new URL(w.url).hostname, ctx.ip);
    return secret;
  }),
  "notify.updateChannel": method(z.tuple([z.string().max(40), z.object({ events: events.optional(), active: z.boolean().optional(), label: z.string().trim().max(40).optional() })]), async (ctx, [id, patch]) => {
    await own(ctx, id);
    await ctx.db.update(notifyChannels).set(patch).where(eq(notifyChannels.id, id));
  }),
  "notify.removeChannel": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    await own(ctx, id);
    await ctx.db.delete(notifyChannels).where(eq(notifyChannels.id, id));
  }),
  "notify.testChannel": method(z.tuple([z.string().max(40)]), async (ctx, [id]) => {
    const c = await own(ctx, id);
    try { await channelSend(ctx.db, { channelId: c.id, kind: "service", subject: "پیام آزمایشی گره", text: "اتصال اعلان‌ها درست کار می‌کند.", attempt: 4, test: true }); }
    catch (e) { fail("ارسال ناموفق بود: " + (e as Error).message); }
  }),
  /** staff: points both bots at this site's webhook */
  "notify.adminBots": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "settings");
    const r = await setBotWebhooks(SITE_URL);
    await logAudit(ctx.db, actor(ctx), "تنظیم وب‌هوک ربات‌ها", r.map((x) => x.kind + ":" + (x.ok ? "ok" : x.detail)).join(" "), ctx.ip);
    return r;
  }),
};
