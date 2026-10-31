import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { BotAdminView, BotChatView, BotLinkView } from "@/lib/assistant-bots";
import { faDateTime } from "@/lib/jalali";
import { proxyError } from "@/lib/paas-egress";
import { rateLimit } from "../auth";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { assistantBotChats } from "../db/schema";
import { fail, logAudit } from "../util";
import { BOT_KINDS, BOT_NAME, botConf, publicHttps, saveBot, type BotKind } from "../bots/api";
import { LINK_TTL_MS, listLinks, newLinkCode, revokeLink } from "../bots/links";

const kind = z.enum(["telegram", "bale"]);
const id = z.string().max(40);

/** a deep link with a one-time code for the person in the account they work in (also used by notify.botLink) */
export async function botLinkFor(ctx: Ctx, k: BotKind) {
  const a = needUser(ctx);
  const c = await botConf(ctx.db, k);
  if (!c.enabled || !c.username) fail("ربات " + BOT_NAME[k] + " هنوز راه‌اندازی نشده است.");
  await rateLimit(ctx.db, "botlink:" + a.user.id, 10, 600);
  const { code, exp } = await newLinkCode(ctx.db, { userId: a.user.id, accountId: a.uid }, k);
  return { url: c.link + c.username + "?start=" + code, expiresAt: exp, username: c.username };
}

const hostOf = (url: string) => { try { const u = new URL(url); return u.hostname + (u.port ? ":" + u.port : ""); } catch { return ""; } };

/* names under "assistant." so every team role (whose policy allows the assistant) can link its own chats */
export const assistantBotsRpc = {
  /** «اتصال به تلگرام / بله»: t.me/<bot>?start=<code> or ble.ir/<bot>?start=<code>; single use, 10 minutes */
  "assistant.botLink": method(z.tuple([kind]), async (ctx, [k]): Promise<BotLinkView> => ({ ...(await botLinkFor(ctx, k)), ttlMs: LINK_TTL_MS })),

  "assistant.botChats": method(z.tuple([]), async (ctx): Promise<BotChatView[]> => {
    const a = needUser(ctx);
    return (await listLinks(ctx.db, a)).map((l) => ({ id: l.id, kind: l.kind, label: l.label, created: faDateTime(l.createdAt), last: l.lastAt ? faDateTime(l.lastAt) : "", staffMode: l.staffMode, notify: !!l.notifyChannelId }));
  }),

  "assistant.botUnlink": method(z.tuple([id]), async (ctx, [lid]) => {
    const a = needUser(ctx);
    const [l] = await ctx.db.select().from(assistantBotChats).where(and(eq(assistantBotChats.id, lid), eq(assistantBotChats.userId, a.user.id), eq(assistantBotChats.accountId, a.uid)));
    if (!l) fail("گفتگو پیدا نشد.", 404);
    await revokeLink(ctx.db, l!, "از پنل");
  }),

  /** staff in their own account: the chat answers as the operator console (its dangerous tools stay panel-only) */
  "assistant.botStaffMode": method(z.tuple([id, z.boolean()]), async (ctx, [lid, on]) => {
    const a = needUser(ctx);
    if (on && !(a.user.role === "admin" && a.uid === a.user.id)) fail("حالت کارمندی فقط برای کارمندان در حساب خودشان است.", 403);
    const [l] = await ctx.db.update(assistantBotChats).set({ staffMode: on, threadId: null }).where(and(eq(assistantBotChats.id, lid), eq(assistantBotChats.userId, a.user.id), eq(assistantBotChats.accountId, a.uid))).returning();
    if (!l) fail("گفتگو پیدا نشد.", 404);
    if (on) await logAudit(ctx.db, actor(ctx), "حالت کارمندی دستیار گره در " + BOT_NAME[l!.kind], l!.id, ctx.ip);
  }),

  /* ---------- staff: the bots ---------- */
  "assistant.adminBots": method(z.tuple([]), async (ctx): Promise<BotAdminView[]> => {
    needStaff(ctx, "settings");
    const { pollStatus } = await import("../bots/poll");
    const out: BotAdminView[] = [];
    for (const k of BOT_KINDS) {
      const c = await botConf(ctx.db, k);
      const st = await pollStatus(ctx.db, k);
      out.push({ kind: k, tokenSet: !!c.token, source: c.source, username: c.username, enabled: c.enabled, setMode: c.setMode, mode: c.mode, proxySource: c.proxySource, proxyHost: hostOf(c.proxy), publicHttps: publicHttps(), lastPoll: st?.at ? faDateTime(new Date(st.at)) : "", lastError: st?.error ?? "" });
    }
    return out;
  }),

  /** token/proxy: omitted or null keeps the stored value, "" clears it; neither is ever sent back */
  "assistant.adminBotSave": method(z.tuple([kind, z.object({
    token: z.string().trim().max(200).nullish(), proxy: z.string().trim().max(500).nullish(),
    mode: z.enum(["auto", "webhook", "poll"]).optional(), enabled: z.boolean().optional(),
  })]), async (ctx, [k, p]) => {
    needStaff(ctx, "settings");
    if (p.token && !/^\d{3,20}:[\w-]{20,120}$/.test(p.token)) fail("توکن ربات معتبر نیست؛ مثل 123456789:AAH… از BotFather تلگرام یا بله کپی کنید.");
    if (p.proxy) { if (k !== "telegram") fail("ربات بله مستقیم وصل می‌شود و پروکسی ندارد."); const e = proxyError(p.proxy); if (e) fail(e); }
    if (p.mode === "webhook" && !publicHttps()) fail("وب‌هوک به نشانی https عمومی سایت نیاز دارد (NEXT_PUBLIC_SITE_URL)؛ حالت دریافت دوره‌ای را انتخاب کنید.");
    await saveBot(ctx.db, k, { token: p.token, proxy: p.proxy, mode: p.mode, enabled: p.enabled, ...(p.token ? { username: "" } : {}) });
    await logAudit(ctx.db, actor(ctx), "تنظیم ربات " + BOT_NAME[k] + (p.token ? " (توکن جدید)" : "") + (p.proxy !== undefined && p.proxy !== null ? (p.proxy ? " (پروکسی)" : " (حذف پروکسی)") : ""), "assistant_bots", ctx.ip);
  }),

  /** «تست اتصال»: getMe through the proxy, then the webhook set (with its secret header) or removed for polling */
  "assistant.adminBotTest": method(z.tuple([kind]), async (ctx, [k]) => {
    needStaff(ctx, "settings");
    const r = await (await import("../bots/poll")).applyMode(ctx.db, k);
    await logAudit(ctx.db, actor(ctx), "تست اتصال ربات " + BOT_NAME[k] + ": " + (r.ok ? "موفق" : "ناموفق"), "assistant_bots", ctx.ip);
    return r;
  }),
};

