/* Notification channels beyond email/SMS: Telegram and Bale chats (linked through «دستیار گره», ./bots) and
   customer webhooks signed with HMAC-SHA256. Without bot tokens, messages land in the outbox (messaging.ts) like
   SMS and email do in development. */
import "server-only";
import { createHash, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import type { DB, Tx } from "./db/client";
import { notifyChannels, users } from "./db/schema";
import { botConf, sendText, type BotKind } from "./bots/api";
import { channelStillLinked } from "./bots/links";
import { enqueue } from "./jobs";
import { outbox } from "./messaging";
import { open } from "./secrets";

export type { BotKind } from "./bots/api";
export const NOTIFY_KINDS = ["billing", "service", "security", "news"] as const;

/** a notification to a linked chat, with the admin's bot settings (Telegram through its proxy) */
export async function botSend(db: DB, kind: BotKind, chatId: string, text: string) {
  await sendText(await botConf(db, kind), chatId, text.slice(0, 4000));
}

/* ---------- webhooks ---------- */
const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(10|127|192\.168)\./i];
/** https only, no credentials in the URL, and the host must resolve to public addresses (no SSRF into the platform) */
export async function checkWebhookUrl(raw: string): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return "نشانی معتبر نیست."; }
  if (u.protocol !== "https:") return "فقط نشانی‌های https پذیرفته می‌شوند.";
  if (u.username || u.password) return "نام کاربری و رمز در نشانی مجاز نیست؛ از امضای HMAC استفاده کنید.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return "نشانی داخلی مجاز نیست.";
  const addrs = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((x) => x.address)).catch(() => [] as string[]);
  if (!addrs.length) return "دامنه نشانی پیدا نشد.";
  if (addrs.some((a) => PRIVATE.some((re) => re.test(a)))) return "نشانی به شبکه خصوصی اشاره می‌کند.";
  return null;
}
export const signBody = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

export async function webhookSend(url: string, secret: string, payload: Record<string, unknown>) {
  const err = await checkWebhookUrl(url);
  if (err) throw new Error(err);
  const body = JSON.stringify(payload);
  if (process.env.NODE_ENV !== "production" && !process.env.WEBHOOKS_LIVE) { outbox.unshift({ channel: "webhook" as never, to: url, text: body, at: Date.now() }); return; }
  const res = await fetch(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", "user-agent": "Gereh-Webhooks/1", "x-gereh-event": String(payload.event), "x-gereh-signature": signBody(secret, body) }, body, signal: AbortSignal.timeout(10_000) });
  if (res.status < 200 || res.status >= 300) throw new Error("HTTP " + res.status);
}

/* ---------- delivery ---------- */
/** fans a notification out to the user's channels (one job per channel, retried); the 10-minute
    dedupe stops the in-app and the email copy of the same event arriving twice */
export async function fanout(db: DB | Tx, userId: string, kind: string, subject: string, text = "") {
  const all = await db.select({ id: notifyChannels.id, events: notifyChannels.events, kind: notifyChannels.kind }).from(notifyChannels).where(and(eq(notifyChannels.userId, userId), eq(notifyChannels.active, true)));
  if (!all.length) return;
  // the preferences matrix can switch the chat bots off for one kind of event
  const [u] = await db.select({ prefs: users.notifPrefs }).from(users).where(eq(users.id, userId));
  const list = u?.prefs?.[kind + "_telegram"] === false ? all.filter((c) => c.kind === "webhook") : all;
  const h =createHash("sha1").update(subject).digest("hex").slice(0, 12), bucket = Math.floor(Date.now() / 600_000);
  for (const c of list) if (c.events.includes(kind)) await enqueue(db, "notify.channel", { channelId: c.id, kind, subject, text, attempt: 1 }, { dedupe: "ch:" + c.id + ":" + h + ":" + bucket });
}

export async function channelSend(db: DB, p: { channelId: string; kind: string; subject: string; text: string; attempt: number; test?: boolean }) {
  const [c] = await db.select().from(notifyChannels).where(eq(notifyChannels.id, p.channelId));
  if (!c || (!c.active && !p.test)) return;
  try {
    if (c.kind === "webhook") await webhookSend(c.target, open(c.secretEnc ?? "") ?? "", { event: p.test ? "test" : "notification." + p.kind, kind: p.kind, subject: p.subject, text: p.text, at: new Date().toISOString() });
    else {
      // a chat whose assistant link was revoked (password change, suspension…) stops receiving too
      if (!(await channelStillLinked(db, c.id))) return;
      await botSend(db, c.kind, c.target, p.subject + (p.text ? "\n\n" + p.text : ""));
    }
    await db.update(notifyChannels).set({ lastStatus: "ok", lastAt: new Date() }).where(eq(notifyChannels.id, c.id));
  } catch (e) {
    await db.update(notifyChannels).set({ lastStatus: (e as Error).message.slice(0, 200), lastAt: new Date() }).where(eq(notifyChannels.id, c.id));
    if (p.test) throw e;
    // 1, 5 and 30 minutes, then give up
    if (p.attempt < 4) await enqueue(db, "notify.channel", { ...p, attempt: p.attempt + 1 }, { runAt: new Date(Date.now() + [60_000, 300_000, 1_800_000][p.attempt - 1]) });
  }
}
