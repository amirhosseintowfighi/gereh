/* The Telegram and Bale bots (Bale speaks the Telegram Bot API): their settings (kv "assistant_bots": the token
   sealed, the mode, Telegram's outbound proxy), the HTTP transport and message rendering. Telegram's API is not
   reachable from Iran, so its calls go through a proxy (admin value, else BOT_PROXY, else the platform egress
   proxy); Bale is called directly. The bot token never appears in a log line or an error message. */
import "server-only";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { fetch as ufetch, ProxyAgent, Socks5ProxyAgent, type Dispatcher } from "undici";
import { PROXY_RE } from "@/lib/paas-egress";
import { SITE_URL } from "@/lib/seo";
import type { DB } from "../db/client";
import { kv } from "../db/schema";
import { outbox } from "../messaging";
import { platformEgress } from "../paas/egress";
import { open, seal } from "../secrets";

type Json = Record<string, unknown>;
export type BotKind = "telegram" | "bale";
export const BOT_KINDS: BotKind[] = ["telegram", "bale"];
export const BOT_NAME: Record<BotKind, string> = { telegram: "تلگرام", bale: "بله" };
export type BotMode = "auto" | "webhook" | "poll";
const KV_KEY = "assistant_bots";
type Stored = { tokenEnc?: string; username?: string; mode?: BotMode; proxyEnc?: string; enabled?: boolean };

export type BotConf = {
  kind: BotKind; token: string; username: string; api: string; link: string;
  /** the admin can switch a bot off without removing its token */
  enabled: boolean;
  /** what the admin chose, and what it means here */
  setMode: BotMode; mode: "webhook" | "poll";
  /** Telegram only; "" = direct */
  proxy: string; proxySource: "admin" | "env" | "platform" | "";
  source: "admin" | "env" | "";
};

async function stored(db: DB): Promise<Partial<Record<BotKind, Stored>>> {
  const [row] = await db.select().from(kv).where(eq(kv.key, KV_KEY));
  return (row?.value as Partial<Record<BotKind, Stored>> | undefined) ?? {};
}

/** a site the messenger can call back: https on a public name */
export const publicHttps = (url = SITE_URL) => { try { const u = new URL(url); return u.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$|\.internal$/i.test(u.hostname); } catch { return false; } };

/** path secret of the webhook URL (/api/bot/<kind>/<secret>) */
export const botSecret = (kind: BotKind) => createHmac("sha256", process.env.APP_SECRET || "dev").update("bot:" + kind).digest("hex").slice(0, 32);
/** the secret_token given to setWebhook; the messenger sends it back in X-Telegram-Bot-Api-Secret-Token */
export const hookSecret = (kind: BotKind) => createHmac("sha256", process.env.APP_SECRET || "dev").update("bot-hook:" + kind).digest("hex").slice(0, 48);
export const webhookUrl = (kind: BotKind) => SITE_URL + "/api/bot/" + kind + "/" + botSecret(kind);

export async function botConf(db: DB, kind: BotKind): Promise<BotConf> {
  const s = (await stored(db))[kind] ?? {};
  const up = kind.toUpperCase();
  const adminToken = s.tokenEnc ? open(s.tokenEnc) ?? "" : "";
  const token = adminToken || process.env[up + "_BOT_TOKEN"] || "";
  const setMode: BotMode = s.mode ?? "auto";
  const mode = setMode === "auto" ? (kind === "bale" && publicHttps() ? "webhook" : "poll") : setMode;
  let proxy = "", proxySource: BotConf["proxySource"] = "";
  if (kind === "telegram") {
    const own = s.proxyEnc ? open(s.proxyEnc) ?? "" : "";
    const env = (process.env.BOT_PROXY || "").trim();
    if (own) { proxy = own; proxySource = "admin"; }
    else if (env && PROXY_RE.test(env)) { proxy = env; proxySource = "env"; }
    else { const p = await platformEgress(db); if (p.url) { proxy = p.url; proxySource = "platform"; } }
  }
  return {
    kind, token, enabled: s.enabled !== false,
    username: (s.username || process.env[up + "_BOT_USERNAME"] || "").replace(/^@/, ""),
    api: (process.env[up + "_API_BASE"] || (kind === "telegram" ? "https://api.telegram.org" : "https://tapi.bale.ai")).replace(/\/$/, ""),
    link: kind === "telegram" ? "https://t.me/" : "https://ble.ir/",
    setMode, mode, proxy, proxySource, source: adminToken ? "admin" : token ? "env" : "",
  };
}

/** the admin's change: token/proxy null keeps the stored value, "" clears it */
export async function saveBot(db: DB, kind: BotKind, p: { token?: string | null; proxy?: string | null; mode?: BotMode; username?: string; enabled?: boolean }) {
  const all = await stored(db);
  const cur = all[kind] ?? {};
  const next: Stored = { ...cur };
  if (p.token !== undefined && p.token !== null) next.tokenEnc = p.token ? seal(p.token) : "";
  if (p.proxy !== undefined && p.proxy !== null) next.proxyEnc = p.proxy ? seal(p.proxy) : "";
  if (p.mode) next.mode = p.mode;
  if (p.username !== undefined) next.username = p.username.replace(/^@/, "");
  if (p.enabled !== undefined) next.enabled = p.enabled;
  const value = { ...all, [kind]: next };
  await db.insert(kv).values({ key: KV_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

/* ---------- transport ---------- */
const agents = new Map<string, Dispatcher>();
function dispatcherFor(proxy: string): Dispatcher | undefined {
  if (!proxy) return undefined;
  let d = agents.get(proxy);
  if (!d) {
    d = /^socks5h?:/i.test(proxy) ? new Socks5ProxyAgent(proxy.replace(/^socks5h:/i, "socks5:")) : new ProxyAgent(proxy);
    agents.set(proxy, d);
  }
  return d;
}

export class BotApiError extends Error {
  constructor(message: string, public code: number, public retryAfter = 0) { super(message); }
}
const hide = (s: string, ...secrets: string[]) => secrets.filter(Boolean).reduce((t, x) => t.split(x).join("***"), s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** one Bot API call; Telegram through its proxy, Bale directly */
export async function botApi<T = unknown>(c: BotConf, method: string, body: Json = {}, timeoutMs = 15_000): Promise<T> {
  if (!c.token) throw new BotApiError("ربات " + BOT_NAME[c.kind] + " تنظیم نشده است.", 0);
  const url = c.api + "/bot" + c.token + "/" + method;
  for (let attempt = 0; ; attempt++) {
    let res: Awaited<ReturnType<typeof ufetch>>;
    try {
      res = await ufetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), dispatcher: c.kind === "telegram" ? dispatcherFor(c.proxy) : undefined });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new BotApiError(c.kind + " " + method + ": " + hide(String(cause?.code || cause?.message || (e as Error).message || "network error"), c.token, c.proxy), 0);
    }
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
    if (res.ok && j.ok) return j.result as T;
    const code = j.error_code ?? res.status, after = j.parameters?.retry_after ?? 0;
    // a short flood wait is waited out once; a longer one is the caller's to handle
    if (code === 429 && after && after <= 3 && attempt === 0) { await sleep(after * 1000); continue; }
    throw new BotApiError(c.kind + " " + method + ": " + hide(j.description || "HTTP " + res.status, c.token, c.proxy), code, after);
  }
}

/* ---------- rendering ---------- */
export const MAX_MESSAGE = 4096;
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escHtml(s).replace(/"/g, "&quot;");
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const lineFix = (s: string) => s.replace(/^#{1,6}\s+(.+)$/gm, "**$1**").replace(/^\s*[-*]\s+/gm, "• ");

function inline(text: string, f: { plain: (s: string) => string; code: (s: string) => string; bold: (s: string) => string; link: (t: string, u: string) => string }) {
  let out = "", last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += f.plain(text.slice(last, m.index));
    out += m[1] !== undefined ? f.code(m[1]) : m[2] !== undefined ? f.bold(m[2]) : f.link(m[3], m[4]);
    last = m.index + m[0].length;
  }
  return out + f.plain(text.slice(last));
}
/** the model's markdown → one of the parse modes; code fences are kept verbatim */
function render(md: string, fence: (code: string) => string, f: Parameters<typeof inline>[1]) {
  return md.split(/```[\w-]*\n?([\s\S]*?)```/g).map((part, i) => (i % 2 ? fence(part.replace(/\n$/, "")) : inline(lineFix(part), f))).join("");
}
/** Telegram: HTML parse mode (only <, > and & need escaping) */
export const toHtml = (md: string) => render(md, (c) => "<pre>" + escHtml(c) + "</pre>", {
  plain: escHtml, code: (s) => "<code>" + escHtml(s) + "</code>", bold: (s) => "<b>" + escHtml(s) + "</b>", link: (t, u) => "<a href=\"" + escAttr(u) + "\">" + escHtml(t) + "</a>",
});
/** Bale: the legacy Markdown subset (*bold*, `code`, ```pre```, [text](url)); the markers in plain text are escaped */
const escMd = (s: string) => s.replace(/([*_`[\]])/g, "\\$1");
export const toBaleMd = (md: string) => render(md, (c) => "```\n" + c.replace(/`/g, "'") + "\n```", {
  plain: escMd, code: (s) => "`" + s.replace(/`/g, "'") + "`", bold: (s) => "*" + s.replace(/\*/g, "") + "*", link: (t, u) => "[" + t.replace(/[[\]]/g, "") + "](" + u + ")",
});
/** the fallback when the messenger rejects the formatting */
export const toPlain = (md: string) => render(md, (c) => c, { plain: (s) => s, code: (s) => s, bold: (s) => s, link: (t, u) => t + " (" + u + ")" });

/** splits at paragraph, line or word boundaries so each piece fits one message */
export function splitText(text: string, max = MAX_MESSAGE): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = [rest.lastIndexOf("\n\n", max), rest.lastIndexOf("\n", max), rest.lastIndexOf(" ", max)].find((i) => i > max / 2) ?? max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

const formatted = (kind: BotKind, md: string) => (kind === "telegram" ? { text: toHtml(md), parse_mode: "HTML" } : { text: toBaleMd(md), parse_mode: "Markdown" });
/** markdown pieces whose rendered form also fits (escaping can grow a piece) */
function pieces(kind: BotKind, md: string): string[] {
  const out: string[] = [];
  for (const p of splitText(md, 3800)) {
    if (formatted(kind, p).text.length <= MAX_MESSAGE) out.push(p);
    else out.push(...splitText(p, 1800));
  }
  return out;
}

export type Button = { text: string; data: string };
const keyboard = (b?: Button[] | null) => (b === undefined ? {} : { reply_markup: { inline_keyboard: b && b.length ? [b.map((x) => ({ text: x.text, callback_data: x.data }))] : [] } });
const parseError = (e: unknown) => e instanceof BotApiError && e.code === 400 && /parse|entit|markdown|html|tag/i.test(e.message);

/** a last guard: nothing shaped like a credential leaves for a chat */
async function scrubOut(text: string) {
  const { redact } = await import("../ai/explain");
  return redact(text);
}

/** sends markdown (split as needed; buttons on the last piece); falls back to plain text on a formatting error.
    Returns the message ids. Without a token (development) the text lands in the outbox. */
export async function sendText(c: BotConf, chatId: string, md: string, buttons?: Button[]): Promise<string[]> {
  const safe = await scrubOut(md);
  if (!c.token) { outbox.unshift({ channel: c.kind, to: chatId, text: toPlain(safe), at: Date.now() }); return ["0"]; }
  const ids: string[] = [];
  const all = pieces(c.kind, safe);
  for (let i = 0; i < all.length; i++) {
    const extra = { chat_id: chatId, disable_web_page_preview: true, ...(i === all.length - 1 ? keyboard(buttons) : {}) };
    let m: { message_id: number | string };
    try { m = await botApi(c, "sendMessage", { ...extra, ...formatted(c.kind, all[i]) }); } catch (e) {
      if (!parseError(e)) throw e;
      m = await botApi(c, "sendMessage", { ...extra, text: toPlain(all[i]) });
    }
    ids.push(String(m.message_id));
  }
  return ids;
}

/** replaces a message's text (and its buttons: [] removes them); a too-long text keeps the first piece here and
    sends the rest as new messages */
export async function editText(c: BotConf, chatId: string, messageId: string, md: string, buttons?: Button[] | null): Promise<void> {
  const safe = await scrubOut(md);
  if (!c.token) { outbox.unshift({ channel: c.kind, to: chatId, text: toPlain(safe), at: Date.now() }); return; }
  const [first, ...rest] = pieces(c.kind, safe);
  const base = { chat_id: chatId, message_id: Number(messageId) || messageId, disable_web_page_preview: true, ...keyboard(rest.length ? null : buttons) };
  try {
    try { await botApi(c, "editMessageText", { ...base, ...formatted(c.kind, first ?? "…") }); } catch (e) {
      if (!parseError(e)) throw e;
      await botApi(c, "editMessageText", { ...base, text: toPlain(first ?? "…") });
    }
  } catch (e) {
    if (!(e instanceof BotApiError && /not modified/i.test(e.message))) throw e;
  }
  if (rest.length) await sendText(c, chatId, rest.join("\n\n"), buttons ?? undefined);
}

export const answerCallback = (c: BotConf, id: string, text = "") => (c.token ? botApi(c, "answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => {}) : Promise.resolve());

/** which bots customers can link (the panel shows the buttons) */
export async function botFlags(db: DB): Promise<Record<BotKind, boolean>> {
  const [t, b] = await Promise.all([botConf(db, "telegram"), botConf(db, "bale")]);
  return { telegram: t.enabled && !!t.username, bale: b.enabled && !!b.username };
}
