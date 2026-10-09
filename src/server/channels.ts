/* Notification channels beyond email/SMS: Telegram and Bale bots (Bale speaks the Telegram Bot API)
   and customer webhooks signed with HMAC-SHA256. Without bot tokens, messages land in the outbox
   (messaging.ts) like SMS and email do in development. */
import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import type { DB, Tx } from "./db/client";
import { kv, notifyChannels, users } from "./db/schema";
import { enqueue } from "./jobs";
import { outbox } from "./messaging";
import { open } from "./secrets";

export type BotKind = "telegram" | "bale";
export const NOTIFY_KINDS = ["billing", "service", "security", "news"] as const;

export function botConfig(kind: BotKind) {
  const up = kind.toUpperCase();
  return {
    token: process.env[up + "_BOT_TOKEN"] || "",
    username: (process.env[up + "_BOT_USERNAME"] || "").replace(/^@/, ""),
    api: (process.env[up + "_API_BASE"] || (kind === "telegram" ? "https://api.telegram.org" : "https://tapi.bale.ai")).replace(/\/$/, ""),
    link: kind === "telegram" ? "https://t.me/" : "https://ble.ir/",
  };
}
/** path secret of the bot webhook (/api/bot/<kind>/<secret>) */
export const botSecret = (kind: BotKind) => createHmac("sha256", process.env.APP_SECRET || "dev").update("bot:" + kind).digest("hex").slice(0, 32);

export async function botSend(kind: BotKind, chatId: string, text: string) {
  const c = botConfig(kind);
  if (!c.token) { outbox.unshift({ channel: kind as never, to: chatId, text, at: Date.now() }); return; }
  const res = await fetch(c.api + "/bot" + c.token + "/sendMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || !j.ok) throw new Error(kind + ": " + (j.description || "HTTP " + res.status));
}

/** registers the bot webhooks with Telegram/Bale (staff action) */
export async function setBotWebhooks(siteUrl: string) {
  const out: { kind: BotKind; ok: boolean; detail: string }[] = [];
  for (const kind of ["telegram", "bale"] as BotKind[]) {
    const c = botConfig(kind);
    if (!c.token) { out.push({ kind, ok: false, detail: kind.toUpperCase() + "_BOT_TOKEN تنظیم نشده" }); continue; }
    try {
      const res = await fetch(c.api + "/bot" + c.token + "/setWebhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: siteUrl + "/api/bot/" + kind + "/" + botSecret(kind), allowed_updates: ["message"] }), signal: AbortSignal.timeout(10_000) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      out.push({ kind, ok: !!j.ok, detail: j.description || "HTTP " + res.status });
    } catch (e) { out.push({ kind, ok: false, detail: (e as Error).message }); }
  }
  return out;
}

/* ---------- linking a chat ---------- */
export async function newLinkCode(db: DB, userId: string, kind: BotKind) {
  const code = randomBytes(12).toString("base64url");
  await db.insert(kv).values({ key: "botlink:" + code, value: { userId, kind, exp: Date.now() + 15 * 60_000 } });
  return code;
}

/** handles one bot update (message); returns the reply text */
export async function botUpdate(db: DB, kind: BotKind, update: { message?: { chat?: { id?: number | string }; text?: string } }): Promise<string | null> {
  const chatId = update.message?.chat?.id;
  const text = (update.message?.text || "").trim();
  if (chatId === undefined || !text) return null;
  const chat = String(chatId);
  const [cmd, arg] = text.split(/\s+/, 2);
  if (cmd === "/start" && arg) {
    const [row] = await db.select().from(kv).where(eq(kv.key, "botlink:" + arg));
    const v = row?.value as { userId: string; kind: BotKind; exp: number } | undefined;
    if (!v || v.kind !== kind || v.exp < Date.now()) return "این لینک منقضی شده است. از پنل گره › حساب › اعلان‌ها لینک جدید بگیرید.";
    await db.delete(kv).where(eq(kv.key, "botlink:" + arg));
    const [dup] = await db.select({ id: notifyChannels.id }).from(notifyChannels).where(and(eq(notifyChannels.userId, v.userId), eq(notifyChannels.kind, kind), eq(notifyChannels.target, chat)));
    if (dup) await db.update(notifyChannels).set({ active: true }).where(eq(notifyChannels.id, dup.id));
    else await db.insert(notifyChannels).values({ id: "ch-" + randomBytes(6).toString("hex"), userId: v.userId, kind, target: chat, label: kind === "telegram" ? "تلگرام" : "بله" });
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, v.userId));
    return "✅ اعلان‌های حساب " + (u?.name ?? "") + " از این پس اینجا ارسال می‌شود.\n/balance موجودی کیف پول\n/stop قطع اعلان‌ها";
  }
  const linked = await db.select().from(notifyChannels).where(and(eq(notifyChannels.kind, kind), eq(notifyChannels.target, chat), eq(notifyChannels.active, true)));
  if (cmd === "/stop") {
    await db.update(notifyChannels).set({ active: false }).where(and(eq(notifyChannels.kind, kind), eq(notifyChannels.target, chat)));
    return linked.length ? "اعلان‌ها قطع شد. برای اتصال دوباره از پنل گره لینک بگیرید." : "این گفتگو به حسابی متصل نیست.";
  }
  if (cmd === "/balance" && linked.length) {
    const lines: string[] = [];
    for (const l of linked) {
      const [u] = await db.select({ name: users.name, balance: users.balance }).from(users).where(eq(users.id, l.userId));
      if (u) lines.push(u.name + ": " + u.balance.toLocaleString("fa-IR") + " تومان");
    }
    return "💰 موجودی کیف پول\n" + lines.join("\n");
  }
  return "سلام! من ربات اعلان‌های گره هستم. برای اتصال، در پنل گره › حساب › اعلان‌ها روی «اتصال " + (kind === "telegram" ? "تلگرام" : "بله") + "» بزنید.";
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
  const list = await db.select({ id: notifyChannels.id, events: notifyChannels.events }).from(notifyChannels).where(and(eq(notifyChannels.userId, userId), eq(notifyChannels.active, true)));
  const h = createHash("sha1").update(subject).digest("hex").slice(0, 12), bucket = Math.floor(Date.now() / 600_000);
  for (const c of list) if (c.events.includes(kind)) await enqueue(db, "notify.channel", { channelId: c.id, kind, subject, text, attempt: 1 }, { dedupe: "ch:" + c.id + ":" + h + ":" + bucket });
}

export async function channelSend(db: DB, p: { channelId: string; kind: string; subject: string; text: string; attempt: number; test?: boolean }) {
  const [c] = await db.select().from(notifyChannels).where(eq(notifyChannels.id, p.channelId));
  if (!c || (!c.active && !p.test)) return;
  try {
    if (c.kind === "webhook") await webhookSend(c.target, open(c.secretEnc ?? "") ?? "", { event: p.test ? "test" : "notification." + p.kind, kind: p.kind, subject: p.subject, text: p.text, at: new Date().toISOString() });
    else await botSend(c.kind, c.target, p.subject + (p.text ? "\n\n" + p.text : ""));
    await db.update(notifyChannels).set({ lastStatus: "ok", lastAt: new Date() }).where(eq(notifyChannels.id, c.id));
  } catch (e) {
    await db.update(notifyChannels).set({ lastStatus: (e as Error).message.slice(0, 200), lastAt: new Date() }).where(eq(notifyChannels.id, c.id));
    if (p.test) throw e;
    // 1, 5 and 30 minutes, then give up
    if (p.attempt < 4) await enqueue(db, "notify.channel", { ...p, attempt: p.attempt + 1 }, { runAt: new Date(Date.now() + [60_000, 300_000, 1_800_000][p.attempt - 1]) });
  }
}
