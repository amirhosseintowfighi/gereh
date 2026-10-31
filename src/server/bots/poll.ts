/* Receiving updates. Webhook mode: setWebhook with a secret_token (checked on every request by
   /api/bot/<kind>/<secret>). Poll mode: a long-lived getUpdates loop per bot, started beside the worker (its own
   loop, never a job lane), with backoff. Only one process polls a bot: a kv lease ("botpoll:<kind>") renewed on
   every round; the next offset is kept in kv ("botoffset:<kind>"). Updates of one chat run in order, different
   chats side by side. */
import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { kv } from "../db/schema";
import { botApi, BotApiError, botConf, BOT_KINDS, BOT_NAME, hookSecret, saveBot, webhookUrl, type BotKind } from "./api";
import type { TgUpdate } from "./chat";

const LEASE_MS = 90_000;
export const POLL_OWNER = randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const handle = async (db: DB, kind: BotKind, u: TgUpdate) => {
  const chat = await import("./chat");
  if (await chat.firstDelivery(db, kind, u.update_id)) await chat.handleUpdate(db, kind, u);
};

/** takes or renews the poll lease; false while another live process holds it */
export async function takeLease(db: DB, kind: BotKind, owner: string, ms = LEASE_MS) {
  const key = "botpoll:" + kind, now = Date.now();
  const r = await db.insert(kv).values({ key, value: { owner, until: now + ms } })
    .onConflictDoUpdate({ target: kv.key, set: { value: { owner, until: now + ms } }, setWhere: sql`(${kv.value}->>'owner') = ${owner} or coalesce((${kv.value}->>'until')::bigint, 0) < ${now}` })
    .returning();
  return r.length > 0;
}
export async function releaseLease(db: DB, kind: BotKind, owner: string) {
  await db.delete(kv).where(sql`${kv.key} = ${"botpoll:" + kind} and (${kv.value}->>'owner') = ${owner}`);
}
async function offsetOf(db: DB, kind: BotKind) {
  const [r] = await db.select().from(kv).where(eq(kv.key, "botoffset:" + kind));
  return Number((r?.value as { offset?: number } | undefined)?.offset) || 0;
}
async function setStatus(db: DB, kind: BotKind, v: { at: number; error: string }) {
  await db.insert(kv).values({ key: "botstatus:" + kind, value: v }).onConflictDoUpdate({ target: kv.key, set: { value: v } });
}
export async function pollStatus(db: DB, kind: BotKind) {
  const [r] = await db.select().from(kv).where(eq(kv.key, "botstatus:" + kind));
  return (r?.value as { at: number; error: string } | undefined) ?? null;
}

const chains = new Map<string, Promise<void>>();
function inOrder(key: string, fn: () => Promise<void>) {
  const next = (chains.get(key) ?? Promise.resolve()).then(fn).catch((e) => console.error("[bot] update failed:", (e as Error).message));
  chains.set(key, next);
  void next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
  return next;
}

/** one getUpdates round: "idle" when this bot does not poll here, "busy" when another process holds the lease */
export async function pollOnce(db: DB, kind: BotKind, owner: string = POLL_OWNER, timeoutSec = 25): Promise<{ state: "idle" | "busy" | "ok"; got: number; done: Promise<unknown> }> {
  const none = { got: 0, done: Promise.resolve() };
  const c = await botConf(db, kind);
  if (!c.token || !c.enabled || c.mode !== "poll") return { state: "idle", ...none };
  if (!(await takeLease(db, kind, owner))) return { state: "busy", ...none };
  const offset = await offsetOf(db, kind);
  let updates: TgUpdate[];
  try {
    updates = await botApi<TgUpdate[]>(c, "getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] }, (timeoutSec + 15) * 1000);
  } catch (e) {
    // a webhook is still set: polling needs it removed
    if (e instanceof BotApiError && e.code === 409) await botApi(c, "deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    await setStatus(db, kind, { at: Date.now(), error: (e as Error).message.slice(0, 200) });
    throw e;
  }
  const work: Promise<unknown>[] = [];
  let next = offset;
  for (const u of updates ?? []) {
    if (typeof u.update_id === "number") next = Math.max(next, u.update_id + 1);
    const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? "x";
    work.push(inOrder(kind + ":" + chat, () => handle(db, kind, u)));
  }
  // the offset moves on as soon as the updates are taken (each is handled once; see firstDelivery)
  if (next !== offset) await db.insert(kv).values({ key: "botoffset:" + kind, value: { offset: next } }).onConflictDoUpdate({ target: kv.key, set: { value: { offset: next } } });
  await setStatus(db, kind, { at: Date.now(), error: "" });
  return { state: "ok", got: updates?.length ?? 0, done: Promise.all(work) };
}

let running = false;
/** the poll loops of both bots, beside the worker (BOT_POLL=0 turns them off) */
export function startBotPoller(getDb: () => Promise<DB>) {
  if (running || process.env.BOT_POLL === "0") return;
  running = true;
  for (const kind of BOT_KINDS) void (async () => {
    let backoff = 1000;
    while (running) {
      try {
        const r = await pollOnce(await getDb(), kind);
        if (r.state !== "ok") await sleep(r.state === "busy" ? 20_000 : 10_000);
        else if (chains.size > 32) await r.done;
        backoff = 1000;
      } catch (e) {
        console.warn("[bot] " + kind + " poll: " + (e as Error).message + "; retry in " + Math.round(backoff / 1000) + "s");
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  })();
}
export const stopBotPoller = () => { running = false; };

/** «تست اتصال»: getMe (through the proxy for Telegram), then the webhook set or removed for the chosen mode */
export async function applyMode(db: DB, kind: BotKind): Promise<{ ok: boolean; detail: string; username: string; mode: "webhook" | "poll" }> {
  const c = await botConf(db, kind);
  if (!c.token) return { ok: false, detail: "توکن ربات " + BOT_NAME[kind] + " وارد نشده است.", username: c.username, mode: c.mode };
  try {
    const me = await botApi<{ username?: string }>(c, "getMe");
    const username = (me.username ?? "").replace(/^@/, "");
    if (username && username !== c.username) await saveBot(db, kind, { username });
    if (c.mode === "webhook") await botApi(c, "setWebhook", { url: webhookUrl(kind), secret_token: hookSecret(kind), allowed_updates: ["message", "callback_query"] });
    else await botApi(c, "deleteWebhook", { drop_pending_updates: false });
    return { ok: true, detail: "@" + username + " — " + (c.mode === "webhook" ? "وب‌هوک تنظیم شد" : "دریافت دوره‌ای (long polling)" + (kind === "telegram" ? (c.proxy ? " از طریق پروکسی" : " بدون پروکسی") : "")), username, mode: c.mode };
  } catch (e) {
    return { ok: false, detail: (e as Error).message, username: c.username, mode: c.mode };
  }
}
