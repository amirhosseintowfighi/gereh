/* «دستیار گره» in a Telegram or Bale private chat. A linked chat talks to the same engine as the panel, as the linked
   person (team members get their role's tools, the customer wallet pays); an unknown chat only gets the linking help.
   The reply is one «در حال فکر…» message, edited a few times with the tool activity and then with the answer.
   A dangerous action becomes a message with «تأیید / لغو» buttons whose callback_data is a short id mapped here to
   the one-time confirm token (bound to the chat, the person and the account; single use). Actions that the panel
   guards with a typed resource name, and every dangerous staff tool, are refused with a link to the panel.
   Tool results are stripped of credentials before the model sees them, and every outgoing text is redacted again. */
import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { AssistantEvent, ConfirmCard } from "@/lib/assistant";
import { fa } from "@/lib/format";
import { SITE_URL } from "@/lib/seo";
import { customAllows } from "../account-extras";
import { redact } from "../ai/explain";
import { decide } from "../assistant/confirm";
import { runTurn } from "../assistant/engine";
import { wrapResult } from "../assistant/prompt";
import { rateLimit } from "../auth";
import { teamAllows, type Ctx } from "../ctx";
import type { DB } from "../db/client";
import { assistantActions, assistantBotButtons, assistantBotChats, assistantMessages, notifyChannels, paasApps, paasDbs, rateLimits, servers, users } from "../db/schema";
import { open, seal } from "../secrets";
import { AppError, logActivity } from "../util";
import { answerCallback, botConf, BOT_NAME, editText, sendText, type BotConf, type BotKind, type Button } from "./api";
import { claimCode, linkByChat, linkChat, liveAuth, revokeLink, type BotLink } from "./links";

type Json = Record<string, unknown>;
export type TgChat = { id: number | string; type?: string; username?: string; first_name?: string };
export type TgMessage = { message_id: number | string; chat: TgChat; from?: { id: number | string }; text?: string; voice?: unknown; audio?: unknown; video_note?: unknown };
export type TgUpdate = { update_id?: number; message?: TgMessage; callback_query?: { id: string; from: { id: number | string }; message?: TgMessage; data?: string } };

const panel = (path: string) => SITE_URL + path;
const TOPUP = "/panel/billing?tab=wallet";
/** the panel asks for the resource name typed before these; a chat button is not enough */
const TYPED = new Set(["delete_server", "reinstall_server", "transfer_wallet"]);
const typedAction = (c: ConfirmCard) => TYPED.has(c.tool) || (c.tool === "set_disk_layout" && /بازسازی/.test(c.title));
const editGap = () => Number(process.env.BOT_EDIT_MS ?? (process.env.NODE_ENV === "test" ? 0 : 1500));
const MAX_STATUS_EDITS = 5;

/* ---------- credentials never reach the model or the chat ---------- */
const SECRET_KEY = /pass(word|wd|phrase)?$|^pass|secret|token$|_token|api[_-]?key|private[_-]?key|credential|^dsn$|connection[_-]?(string|uri|url)|database_url|^uri$/i;
const HIDDEN = "[پنهان؛ فقط در پنل نمایش داده می‌شود]";
export function scrubSecrets(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redact(v);
  if (depth > 12 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => scrubSecrets(x, depth + 1));
  const out: Json = {};
  for (const [k, x] of Object.entries(v as Json)) out[k] = typeof x === "string" && x && SECRET_KEY.test(k) ? HIDDEN : scrubSecrets(x, depth + 1);
  return out;
}

/* ---------- texts ---------- */
const helpUnknown = (kind: BotKind) =>
  "سلام! من **دستیار گره** هستم.\nبرای استفاده، این گفتگو را به حساب گره خود وصل کنید:\n" +
  "۱. در پنل گره، صفحه «دستیار گره» یا «حساب › اعلان‌ها»، روی «اتصال به " + BOT_NAME[kind] + "» بزنید.\n" +
  "۲. لینک یا QR نمایش‌داده‌شده را باز کنید و Start را بزنید (لینک ۱۰ دقیقه معتبر و یک‌بارمصرف است).\n\n" + panel("/panel/assistant");
const helpLinked = (name: string) =>
  "این گفتگو به حساب **" + name + "** وصل است. سؤال یا درخواستتان را بنویسید؛ مثلاً «وضعیت سرورهایم چطور است؟»\n\n" +
  "/new گفتگوی جدید\n/status خلاصه وضعیت سرویس‌ها\n/balance موجودی کیف پول\n/unlink قطع اتصال این گفتگو\n/help همین راهنما\n\n" +
  "کارهای حساس با دکمه تأیید انجام می‌شوند؛ حذف، نصب مجدد، بازسازی دیسک و انتقال وجه فقط در پنل. رمزها و کلیدها هرگز اینجا فرستاده نمی‌شوند.";

function cardText(c: ConfirmCard) {
  const mins = Math.max(1, Math.round((c.expiresAt - Date.now()) / 60_000));
  return "🛡 **" + c.title + "**\n" + c.summary + (c.resource ? "\nمنبع: " + c.resource : "") +
    (c.cost !== null ? "\nهزینه: " + fa(c.cost) + " تومان" + (c.costNote ? " — " + c.costNote : "") : "") +
    "\n\nاین درخواست تا " + fa(mins) + " دقیقه معتبر است.";
}
function panelLinkFor(c: ConfirmCard | { tool: string; args: Json }) {
  const sid = String(c.args.server_id ?? "");
  if (c.tool === "transfer_wallet") return panel(TOPUP);
  return panel(/^[\w.-]{1,40}$/.test(sid) ? "/panel/servers/" + sid : "/panel");
}

/* ---------- the reply message ---------- */
/** one «در حال فکر…» message: a few throttled edits with the tool activity, then the answer */
class Reply {
  private chain: Promise<unknown> = Promise.resolve();
  private last = 0;
  private edits = 0;
  constructor(private c: BotConf, private chatId: string, public id: string | null) {}
  static async start(c: BotConf, chatId: string, text = "⏳ در حال فکر…") {
    const [id] = await sendText(c, chatId, text);
    return new Reply(c, chatId, id ?? null);
  }
  status(text: string) {
    const now = Date.now();
    if (!this.id || this.edits >= MAX_STATUS_EDITS || now - this.last < editGap()) return;
    this.last = now;
    this.edits++;
    const id = this.id;
    this.chain = this.chain.then(() => editText(this.c, this.chatId, id, "⏳ " + text)).catch(() => {});
  }
  async final(text: string, buttons?: Button[]) {
    await this.chain;
    if (this.id) await editText(this.c, this.chatId, this.id, text, buttons ?? null);
    else await sendText(this.c, this.chatId, text, buttons);
  }
}

/* ---------- one assistant turn ---------- */
type TurnRun = { message?: string; confirm?: { token: string; args: Json }; cancel?: { token: string } };
async function converse(db: DB, c: BotConf, link: BotLink, ctx: Ctx, run: TurnRun, reply: Reply, onDecided?: (d: Extract<AssistantEvent, { type: "decided" }>) => Promise<void>) {
  const staff = link.staffMode && ctx.auth!.user.role === "admin" && ctx.auth!.uid === ctx.auth!.user.id;
  let text = "", err: Extract<AssistantEvent, { type: "error" }> | null = null, decided: Extract<AssistantEvent, { type: "decided" }> | null = null;
  const cards: ConfirmCard[] = [];
  let threadId = link.threadId;
  await runTurn({
    ctx, threadId: run.confirm || run.cancel ? null : link.threadId, message: run.message, confirm: run.confirm, cancel: run.cancel,
    mode: staff && !run.confirm && !run.cancel ? "staff" : "customer", scrub: (o) => scrubSecrets(o),
    emit: (e) => {
      if (e.type === "thread") threadId = e.id;
      else if (e.type === "text") text += e.delta;
      else if (e.type === "tool") reply.status(e.label);
      else if (e.type === "confirm") cards.push(e.card);
      else if (e.type === "decided") decided = e;
      else if (e.type === "error") err = e;
    },
  });
  if (threadId !== link.threadId && !run.confirm && !run.cancel) await db.update(assistantBotChats).set({ threadId }).where(eq(assistantBotChats.id, link.id));
  if (decided && onDecided) await onDecided(decided);
  const e = err as Extract<AssistantEvent, { type: "error" }> | null;
  let out = text.trim();
  if (e) out += (out ? "\n\n" : "") + (e.code === "insufficient_balance" ? "💳 موجودی کیف پول برای پاسخ دستیار کافی نیست. برای شارژ:\n" + panel(TOPUP) : "⚠️ " + e.message);
  if (!out) out = cards.length ? "برای این کار تأیید شما لازم است:" : "✔️";
  await reply.final(out);
  for (const card of cards) await offerCard(db, c, link, ctx, card, staff);
}

/** a proposal → a message with buttons, or (typed-name actions, staff tools) a refusal with the panel link */
async function offerCard(db: DB, c: BotConf, link: BotLink, ctx: Ctx, card: ConfirmCard, staff: boolean) {
  if (staff || typedAction(card)) {
    await decide(ctx, card.token, null, "cancel").catch(() => {});
    const [a] = await db.select().from(assistantActions).where(eq(assistantActions.id, card.id));
    if (a) {
      const note = "Not available in the messenger chat: this action needs the panel (" + (staff ? "staff tools" : "the resource name typed") + "). Nothing was done; the person got a panel link.";
      const [m] = await db.select().from(assistantMessages).where(and(eq(assistantMessages.threadId, a.threadId), eq(assistantMessages.toolCallId, a.toolCallId), eq(assistantMessages.role, "tool")));
      if (m) await db.update(assistantMessages).set({ content: wrapResult(a.tool, { status: "refused_in_chat", note }), meta: { ...(m.meta as Json), status: "cancelled", summary: "فقط در پنل" } }).where(eq(assistantMessages.id, m.id));
    }
    await logActivity(db, link.accountId, "send", "دستیار گره در " + BOT_NAME[c.kind] + ": «" + card.title + "» به پنل ارجاع شد");
    await sendText(c, link.chatId, "⚠️ «" + card.title + "»" + (card.resource ? " (" + card.resource + ")" : "") + " از طریق پیام‌رسان قابل تأیید نیست" +
      (staff ? "؛ اقدامات حساس کارمندی فقط در پنل مدیریت انجام می‌شوند:\n" + panel("/admin") : "؛ برای امنیت، این کار فقط در پنل و با نوشتن نام منبع انجام می‌شود:\n" + panelLinkFor(card)));
    return;
  }
  const id = randomBytes(9).toString("base64url");
  await db.insert(assistantBotButtons).values({ id, kind: c.kind, chatId: link.chatId, userId: link.userId, accountId: link.accountId, actionId: card.id, tokenEnc: seal(card.token), expiresAt: new Date(card.expiresAt) });
  const ids = await sendText(c, link.chatId, cardText(card), [{ text: "تأیید ✅", data: "ok:" + id }, { text: "لغو ❌", data: "no:" + id }]);
  await db.update(assistantBotButtons).set({ messageId: ids.at(-1) ?? "" }).where(eq(assistantBotButtons.id, id));
}

/* ---------- commands ---------- */
async function status(db: DB, ctx: Ctx) {
  const a = ctx.auth!, lines: string[] = [];
  const dot = (s: string) => (/^(running|live|active|ready)$/.test(s) ? "🟢" : /^(stopped|sleeping)$/.test(s) ? "⚪️" : /^(failed|crashed|suspended)$/.test(s) ? "🔴" : "🟡");
  const block = (title: string, rows: { name: string; status: string }[]) => {
    if (!rows.length) return;
    lines.push("**" + title + " (" + fa(rows.length) + ")**");
    for (const r of rows.slice(0, 8)) lines.push(dot(r.status) + " " + r.name);
    if (rows.length > 8) lines.push("… و " + fa(rows.length - 8) + " مورد دیگر");
  };
  if (teamAllows(a.teamRole, "servers.list")) block("سرورهای ابری", await db.select({ name: servers.name, status: servers.status }).from(servers).where(eq(servers.userId, a.uid)));
  if (teamAllows(a.teamRole, "paas.list")) {
    block("اپ‌ها", await db.select({ name: paasApps.name, status: paasApps.status }).from(paasApps).where(eq(paasApps.userId, a.uid)));
    block("پایگاه‌های داده", await db.select({ name: paasDbs.name, status: paasDbs.status }).from(paasDbs).where(eq(paasDbs.userId, a.uid)));
  }
  return lines.length ? "📊 **وضعیت سرویس‌ها**\n" + lines.join("\n") + "\n\nجزئیات: " + panel("/panel") : "سرویسی برای نمایش ندارید (یا نقش شما در این حساب آن را نمی‌بیند).";
}
async function balance(db: DB, ctx: Ctx) {
  const a = ctx.auth!;
  if (!teamAllows(a.teamRole, "billing.balance")) return "نقش شما در این حساب اجازه دیدن کیف پول را ندارد.";
  const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, a.uid));
  return "💰 موجودی کیف پول: **" + fa(u?.balance ?? 0) + " تومان**\nشارژ: " + panel(TOPUP);
}

/* ---------- updates ---------- */
const busy = new Set<string>();
/** a fixed-window limit that answers false instead of throwing */
async function within(db: DB, key: string, max: number, sec: number) {
  try { await rateLimit(db, key, max, sec); return true; } catch (e) { if (e instanceof AppError && e.status === 429) return false; throw e; }
}
/** the same update delivered twice (a webhook retry, a poll after a crash) is handled once */
export async function firstDelivery(db: DB, kind: BotKind, updateId: number | undefined) {
  if (updateId === undefined) return true;
  const r = await db.insert(rateLimits).values({ key: "botupd:" + kind + ":" + updateId, count: 1, resetAt: new Date(Date.now() + 86400_000) }).onConflictDoNothing().returning();
  return r.length > 0;
}

export async function handleUpdate(db: DB, kind: BotKind, u: TgUpdate): Promise<void> {
  const c = await botConf(db, kind);
  if (!c.enabled) return;
  if (u.callback_query) return onCallback(db, c, u.callback_query);
  const msg = u.message;
  if (!msg?.chat || msg.chat.id === undefined) return;
  // private chats only: a group never gets the assistant (nor an account's data)
  if (msg.chat.type && msg.chat.type !== "private") return;
  const chatId = String(msg.chat.id);
  if (!(await within(db, "bot:" + kind + ":" + chatId, 20, 60))) {
    if (await within(db, "bot-notice:" + kind + ":" + chatId, 1, 60)) await sendText(c, chatId, "پیام‌ها زیاد است؛ یک دقیقه دیگر دوباره بنویسید.");
    return;
  }
  const text = (msg.text ?? "").trim();
  if (!text) {
    await sendText(c, chatId, msg.voice || msg.audio || msg.video_note ? "پیام صوتی هنوز پشتیبانی نمی‌شود؛ لطفاً درخواستتان را بنویسید." : "فقط پیام متنی پشتیبانی می‌شود.");
    return;
  }
  const [first, ...rest] = text.split(/\s+/);
  const cmd = first.startsWith("/") ? first.replace(/@\w+$/, "").toLowerCase() : "";

  if (cmd === "/start" && rest[0]) {
    const code = await claimCode(db, kind, rest[0]);
    const r = code && (await linkChat(db, kind, chatId, msg.chat.username ? "@" + msg.chat.username : msg.chat.first_name ?? "", code));
    if (!r) { await sendText(c, chatId, "این لینک نامعتبر یا منقضی شده است. از پنل گره لینک جدید بگیرید (هر لینک ۱۰ دقیقه معتبر و یک‌بارمصرف است).\n" + panel("/panel/assistant")); return; }
    await sendText(c, chatId, "✅ این گفتگو به حساب **" + r.user.name + "** وصل شد" + (r.link.notifyChannelId ? " و اعلان‌های حساب هم اینجا ارسال می‌شود" : "") + ".\n\n" + helpLinked(r.user.name));
    return;
  }
  const link = await linkByChat(db, kind, chatId);
  if (!link) { await sendText(c, chatId, helpUnknown(kind)); return; }
  const auth = await liveAuth(db, link);
  if (!auth) { await sendText(c, chatId, "اتصال این گفتگو به حساب لغو شده است (مثلاً پس از تغییر رمز). برای ادامه، از پنل دوباره وصل کنید.\n" + panel("/panel/assistant")); return; }
  await db.update(assistantBotChats).set({ lastAt: new Date() }).where(eq(assistantBotChats.id, link.id));
  const ctx: Ctx = { db, auth, ip: "", device: BOT_NAME[kind] };

  if (cmd === "/help" || cmd === "/start") return void (await sendText(c, chatId, helpLinked(auth.user.name)));
  if (cmd === "/new") {
    await db.update(assistantBotChats).set({ threadId: null }).where(eq(assistantBotChats.id, link.id));
    return void (await sendText(c, chatId, "🆕 گفتگوی جدید شروع شد؛ بفرمایید."));
  }
  if (cmd === "/stop") {
    if (link.notifyChannelId) await db.update(notifyChannels).set({ active: false }).where(eq(notifyChannels.id, link.notifyChannelId));
    return void (await sendText(c, chatId, "اعلان‌ها در این گفتگو قطع شد؛ دستیار همچنان پاسخ می‌دهد. برای قطع کامل اتصال: /unlink"));
  }
  if (cmd === "/unlink") {
    await revokeLink(db, link, "درخواست از " + BOT_NAME[kind]);
    return void (await sendText(c, chatId, "اتصال این گفتگو به حساب گره قطع شد. برای اتصال دوباره از پنل لینک بگیرید."));
  }
  if (cmd === "/status") return void (await sendText(c, chatId, await status(db, ctx)));
  if (cmd === "/balance") return void (await sendText(c, chatId, await balance(db, ctx)));
  if (cmd) return void (await sendText(c, chatId, "این فرمان را نمی‌شناسم.\n\n" + helpLinked(auth.user.name)));

  if (!teamAllows(auth.teamRole, "assistant.chat") || !(await customAllows(db, auth, "assistant.chat"))) return void (await sendText(c, chatId, "نقش شما در این حساب اجازه استفاده از دستیار را ندارد."));
  // the panel's own per-person limits, shared with it
  if (!(await within(db, "assistant:" + auth.user.id, 20, 60)) || !(await within(db, "assistant-h:" + auth.user.id, 200, 3600))) return void (await sendText(c, chatId, "تعداد پیام‌ها به دستیار زیاد است؛ کمی بعد دوباره بنویسید."));
  const key = kind + ":" + chatId;
  if (busy.has(key)) return void (await sendText(c, chatId, "هنوز در حال پاسخ به پیام قبلی هستم؛ کمی صبر کنید."));
  busy.add(key);
  try {
    const reply = await Reply.start(c, chatId);
    await converse(db, c, link, ctx, { message: text.slice(0, 4000) }, reply);
  } finally { busy.delete(key); }
}

/** a tap on «تأیید» or «لغو»: only from the chat the buttons were sent to, by its linked person, once */
async function onCallback(db: DB, c: BotConf, q: NonNullable<TgUpdate["callback_query"]>) {
  const msg = q.message;
  const chatId = msg ? String(msg.chat.id) : "";
  const m = /^(ok|no):([\w-]{8,24})$/.exec(q.data ?? "");
  const reject = async (why: string) => { await answerCallback(c, q.id, why); };
  if (!msg || !m || (msg.chat.type && msg.chat.type !== "private") || String(q.from.id) !== chatId) return reject("این دکمه معتبر نیست.");
  if (!(await within(db, "bot:" + c.kind + ":" + chatId, 20, 60))) return reject("درخواست‌ها زیاد است؛ کمی بعد.");
  const [b] = await db.select().from(assistantBotButtons).where(eq(assistantBotButtons.id, m[2]));
  const link = await linkByChat(db, c.kind, chatId);
  if (!b || !link || b.kind !== c.kind || b.chatId !== chatId || b.userId !== link.userId || b.accountId !== link.accountId) {
    if (b && link) await logActivity(db, link.accountId, "shield-alert", "دکمه تأیید دستیار گره از گفتگوی دیگری رد شد");
    return reject("این دکمه معتبر نیست.");
  }
  const auth = await liveAuth(db, link);
  if (!auth) return reject("اتصال این گفتگو لغو شده است.");
  // single use: both buttons of the proposal are spent by the first tap
  const [claimed] = await db.update(assistantBotButtons).set({ usedAt: new Date() }).where(and(eq(assistantBotButtons.id, b.id), isNull(assistantBotButtons.usedAt), gt(assistantBotButtons.expiresAt, new Date()))).returning();
  if (!claimed) return reject(b.usedAt ? "این درخواست قبلاً تأیید یا لغو شده است." : "مهلت این درخواست تمام شده است.");
  await db.update(assistantBotButtons).set({ usedAt: new Date() }).where(and(eq(assistantBotButtons.actionId, b.actionId), isNull(assistantBotButtons.usedAt)));
  const token = open(b.tokenEnc);
  const [act] = await db.select().from(assistantActions).where(eq(assistantActions.id, b.actionId));
  if (!token || !act) return reject("این دکمه معتبر نیست.");
  const confirm = m[1] === "ok";
  await answerCallback(c, q.id, confirm ? "در حال انجام…" : "لغو شد");
  const ctx: Ctx = { db, auth, ip: "", device: BOT_NAME[c.kind] };
  const head = "🛡 **" + act.summary.slice(0, 300) + "**";
  const cardMsg = b.messageId || null;
  if (cardMsg) await editText(c, chatId, cardMsg, head + "\n\n⏳ " + (confirm ? "در حال انجام…" : "لغو…"), []).catch(() => {});
  const reply = new Reply(c, chatId, null);
  await converse(db, c, link, ctx, confirm ? { confirm: { token, args: act.args } } : { cancel: { token } }, reply, async (d) => {
    const pass = d.status === "done" && act.tool === "reset_root_password" ? "\nرمز جدید در پنل نمایش داده می‌شود: " + panelLinkFor({ tool: act.tool, args: act.args }) : "";
    const line = d.status === "done" ? "✅ انجام شد: " + d.summary + pass : d.status === "failed" ? "❌ ناموفق: " + d.summary : "❌ لغو شد؛ کاری انجام نشد.";
    if (cardMsg) await editText(c, chatId, cardMsg, head + "\n\n" + line, []);
    else await sendText(c, chatId, line);
  });
  await logActivity(db, link.accountId, "send", "دستیار گره در " + BOT_NAME[c.kind] + ": " + (confirm ? "تأیید" : "لغو") + " «" + act.summary.slice(0, 120) + "»");
}
