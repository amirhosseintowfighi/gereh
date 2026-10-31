import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { BOT_KINDS } from "../bots/api";
import { channelSend, checkWebhookUrl, NOTIFY_KINDS } from "../channels";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { notifyChannels } from "../db/schema";
import { seal } from "../secrets";
import { fail, logActivity, logAudit } from "../util";
import { botLinkFor } from "./assistant-bots";

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
  /** deep link that connects the person's Telegram/Bale chat (notifications and «دستیار گره»; one-time, 10 minutes) */
  "notify.botLink": method(z.tuple([z.enum(["telegram", "bale"])]), async (ctx, [kind]) => {
    const a = needUser(ctx);
    if (a.uid === a.user.id) await room(ctx, a.uid);
    return (await botLinkFor(ctx, kind)).url;
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
  /** staff: tests both bots and sets each one's webhook or polling (see assistant.adminBotTest) */
  "notify.adminBots": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "settings");
    const { applyMode } = await import("../bots/poll");
    const r = [];
    for (const kind of BOT_KINDS) r.push({ kind, ...(await applyMode(ctx.db, kind)) });
    await logAudit(ctx.db, actor(ctx), "تنظیم وب‌هوک ربات‌ها", r.map((x) => x.kind + ":" + (x.ok ? "ok" : x.detail)).join(" "), ctx.ip);
    return r;
  }),
};
