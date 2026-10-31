import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotLinkView } from "@/lib/assistant-bots";
import { setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { botSecret, hookSecret, saveBot, splitText, toBaleMd, toHtml, toPlain, type BotKind } from "@/server/bots/api";
import { handleUpdate, scrubSecrets, type TgUpdate } from "@/server/bots/chat";
import { pollOnce, takeLease } from "@/server/bots/poll";
import { assistantActions, assistantBotButtons, assistantBotChats, assistantThreads, kv, notifyChannels, serverCredentials, servers, teamMembers, users } from "@/server/db/schema";
import { open } from "@/server/secrets";
import { notify } from "@/server/util";
import { drain } from "@/server/worker";
import { asUser, call, db, fresh, jar } from "./helpers";
import { outbox } from "@/server/messaging";

/* ---------- the fake Telegram and Bale Bot APIs, behind a mocked undici fetch ---------- */
type Call = { host: string; method: string; body: Record<string, unknown>; proxied: boolean; dispatcher: unknown };
const api = vi.hoisted(() => ({
  calls: [] as Call[], updates: [] as unknown[], nextId: 100, parseFailOnce: false,
}));
vi.mock("undici", async (orig) => {
  const real = await orig<typeof import("undici")>();
  return {
    ...real,
    fetch: vi.fn(async (url: string, init: { body?: string; dispatcher?: unknown }) => {
      const u = new URL(url);
      const method = u.pathname.split("/").pop()!;
      const body = JSON.parse(init.body || "{}") as Record<string, unknown>;
      api.calls.push({ host: u.host, method, body, proxied: init.dispatcher instanceof real.ProxyAgent, dispatcher: init.dispatcher });
      const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
      if ((method === "sendMessage" || method === "editMessageText") && body.parse_mode && api.parseFailOnce) {
        api.parseFailOnce = false;
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities: unexpected end tag" }), { status: 400 });
      }
      if (method === "sendMessage") return ok({ message_id: ++api.nextId });
      if (method === "getMe") return ok({ id: 1, username: u.host.includes("telegram") ? "gereh_tg_bot" : "gereh_bale_bot" });
      if (method === "getUpdates") { const all = api.updates.splice(0); return ok(all); }
      return ok(true);
    }),
  };
});

const TG_TOKEN = "123456789:AAH" + "x".repeat(32), BALE_TOKEN = "987654321:BBH" + "y".repeat(32);
const PROXY = "http://user:pw@proxy.example:3128";
let uid = 1;
beforeEach(async () => {
  await fresh();
  setAiUpstream(null);
  api.calls.length = 0; api.updates.length = 0; api.parseFailOnce = false;
  const d = await db();
  await saveBot(d, "telegram", { token: TG_TOKEN, username: "gereh_tg_bot", mode: "poll", proxy: PROXY });
  await saveBot(d, "bale", { token: BALE_TOKEN, username: "gereh_bale_bot", mode: "webhook" });
});
afterEach(() => { setAiUpstream(null); delete process.env.BOT_PROXY; });

const message = (chat: number, text: string, type = "private"): TgUpdate => ({ update_id: ++uid, message: { message_id: uid, chat: { id: chat, type, first_name: "Amir" }, from: { id: chat }, text } });
const say = async (kind: BotKind, chat: number, text: string, type = "private") => handleUpdate(await db(), kind, message(chat, text, type));
const tap = async (kind: BotKind, chat: number, data: string, from = chat, msgChat = chat) =>
  handleUpdate(await db(), kind, { update_id: ++uid, callback_query: { id: "cq" + uid, from: { id: from }, message: { message_id: 1, chat: { id: msgChat, type: "private" } }, data } });
/** every text the bot sent or edited into a chat */
const out = (chat?: number) => api.calls.filter((c) => (c.method === "sendMessage" || c.method === "editMessageText") && (chat === undefined || String(c.body.chat_id) === String(chat))).map((c) => String(c.body.text));
const last = (chat: number) => out(chat).at(-1) ?? "";
const answers = () => api.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.body.text ?? ""));
const buttonsOf = (chat: number) => {
  const m = api.calls.filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === String(chat) && c.body.reply_markup).at(-1);
  return ((m?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? [[]])[0];
};

async function link(kind: BotKind, chat: number) {
  const v = await call<BotLinkView>("assistant.botLink", kind);
  await say(kind, chat, "/start " + v.url.split("start=")[1]);
  return v;
}

/** a scripted model service: each call returns the next step (text, or tool calls) */
function scripted(steps: ({ text: string } | { calls: { name: string; args: Record<string, unknown> }[] })[]) {
  let n = 0;
  const up: Upstream = {
    name: "http",
    async models() { return []; },
    async chat(req) {
      const s = steps[Math.min(n++, steps.length - 1)];
      const base = { id: "x", object: "chat.completion.chunk", created: 1, model: req.model };
      const chunk = "text" in s
        ? { ...base, choices: [{ index: 0, delta: { content: s.text }, finish_reason: "stop" }] }
        : { ...base, choices: [{ index: 0, delta: { tool_calls: s.calls.map((c, i) => ({ index: i, id: "call_" + n + "_" + i, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }, finish_reason: "tool_calls" }] };
      const usage = { ...base, choices: [], usage: { prompt_tokens: 500, completion_tokens: 40 } };
      return new Response([chunk, usage].map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  };
  setAiUpstream(up);
}

describe("assistant bots: linking", () => {
  it("a one-time code links the chat to the person; reuse, expiry and a wrong code fail", async () => {
    await asUser();
    const v = await call<BotLinkView>("assistant.botLink", "telegram");
    expect(v.url).toMatch(/^https:\/\/t\.me\/gereh_tg_bot\?start=[\w-]{16}$/);
    expect(v.expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect((await call<BotLinkView>("assistant.botLink", "bale")).url).toMatch(/^https:\/\/ble\.ir\/gereh_bale_bot\?start=/);
    const code = v.url.split("start=")[1];
    await say("telegram", 555, "/start " + code);
    expect(last(555)).toContain("وصل شد");
    const [l] = await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.chatId, "555"));
    expect(l).toMatchObject({ kind: "telegram", userId: "u1", accountId: "u1" });
    // the owner's chat also receives notifications (one notify channel, unified)
    expect(l.notifyChannelId).toBeTruthy();
    // single use: another chat cannot take the same code
    await say("telegram", 556, "/start " + code);
    expect(last(556)).toContain("نامعتبر یا منقضی");
    expect(await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.chatId, "556"))).toHaveLength(0);
    // a Bale code does not work in Telegram, a wrong code fails, an expired one fails
    const bale = (await call<BotLinkView>("assistant.botLink", "bale")).url.split("start=")[1];
    await say("telegram", 557, "/start " + bale);
    expect(last(557)).toContain("نامعتبر");
    await say("telegram", 557, "/start notarealcode123");
    expect(last(557)).toContain("نامعتبر");
    const old = (await call<BotLinkView>("assistant.botLink", "telegram")).url.split("start=")[1];
    await (await db()).update(kv).set({ value: { userId: "u1", accountId: "u1", kind: "telegram", exp: Date.now() - 1 } }).where(eq(kv.key, "botlink:" + old));
    await say("telegram", 557, "/start " + old);
    expect(last(557)).toContain("منقضی");
    expect((await call<{ id: string }[]>("assistant.botChats")).map((c) => c.id)).toEqual([l.id]);
  });

  it("an unlinked chat only gets the help; groups are ignored", async () => {
    await say("telegram", 700, "وضعیت سرورهایم چطور است؟");
    expect(last(700)).toContain("وصل کنید");
    expect(last(700)).not.toContain("web-prod-1");
    expect(await (await db()).select().from(assistantThreads)).toHaveLength(0);
    const n = api.calls.length;
    await say("telegram", -1001, "/help", "supergroup");
    expect(api.calls.length).toBe(n);
  });

  it("a team member links to their own person and gets their role's view", async () => {
    await asUser();
    await call("team.invite", "sara@example.com", "billing", "http://localhost:3000");
    const token = /token=([\w-]+)/.exec(outbox.find((m) => m.subject?.startsWith("دعوت"))!.text)![1];
    jar.clear();
    await call("auth.register", { name: "سارا", email: "sara@example.com", phone: "09351112233", password: "Abcdefg1" });
    await call("team.accept", token);
    await link("bale", 901);
    const [l] = await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.chatId, "901"));
    expect(l.accountId).toBe("u1");
    expect(l.userId).not.toBe("u1");
    expect(l.notifyChannelId).toBeNull();
    await say("bale", 901, "/status");
    expect(last(901)).not.toContain("web-prod-1"); // billing role: no servers
    await say("bale", 901, "/balance");
    expect(last(901)).toContain("موجودی");
    // leaving the team revokes the chat
    await (await db()).delete(teamMembers).where(eq(teamMembers.memberId, l.userId));
    await say("bale", 901, "/balance");
    expect(last(901)).toContain("لغو شده");
    expect(await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.id, l.id))).toHaveLength(0);
  });
});

describe("assistant bots: conversation", () => {
  it("runs the engine as the linked person: a placeholder, then the answer, own servers only", async () => {
    await asUser();
    await link("telegram", 555);
    api.calls.length = 0;
    await say("telegram", 555, "وضعیت همه سرویس‌هایم چطور است؟");
    expect(api.calls.find((c) => c.method === "sendMessage")!.body.text).toContain("در حال فکر");
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.length).toBeLessThanOrEqual(7);
    const answer = last(555);
    expect(answer).toContain("web-prod-1");
    expect(answer).not.toContain("api-1"); // another customer's server
    const [l] = await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.chatId, "555"));
    const [t] = await (await db()).select().from(assistantThreads).where(eq(assistantThreads.id, l.threadId!));
    expect(t).toMatchObject({ userId: "u1", accountId: "u1", mode: "customer" });
    // /new starts another thread
    await say("telegram", 555, "/new");
    await say("telegram", 555, "این ماه چقدر هزینه کردم؟");
    const [l2] = await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.chatId, "555"));
    expect(l2.threadId).not.toBe(l.threadId);
    await say("telegram", 555, "/status");
    expect(last(555)).toContain("web-prod-1");
  });

  it("an insufficient balance gets a short message with the top-up link", async () => {
    await asUser();
    await link("bale", 600);
    await (await db()).update(users).set({ balance: 0 }).where(eq(users.id, "u1"));
    await say("bale", 600, "وضعیت سرویس‌هایم؟");
    expect(last(600)).toContain("موجودی کیف پول");
    expect(last(600)).toContain("/panel/billing?tab=wallet");
  });
});

describe("assistant bots: confirmations", () => {
  const resetSteps = () => scripted([{ calls: [{ name: "reset_root_password", args: { server_id: "srv-1042" } }] }, { text: "انجام شد." }, { text: "باشد." }]);

  it("a confirm button runs the action once; replays, forged ids and other chats are rejected; no password in chat", async () => {
    await asUser();
    await link("telegram", 555);
    await link("bale", 777); // another chat of the same person
    resetSteps();
    await say("telegram", 555, "رمز root سرور web-prod-1 را عوض کن");
    const [ok, no] = buttonsOf(555);
    expect(ok.text).toContain("تأیید");
    expect(no.text).toContain("لغو");
    expect(ok.callback_data.length).toBeLessThanOrEqual(64);
    expect(ok.callback_data).not.toMatch(/srv-1042/);
    // the callback must come from the same chat and its person
    await tap("telegram", 999, ok.callback_data);
    await tap("telegram", 555, ok.callback_data, 12345);
    await tap("bale", 777, ok.callback_data);
    await tap("telegram", 555, "ok:forgedforgedforged");
    expect(answers().slice(-4).every((a) => a.includes("معتبر نیست"))).toBe(true);
    const [act] = await (await db()).select().from(assistantActions);
    expect(act.status).toBe("pending");
    // the real tap
    await tap("telegram", 555, ok.callback_data);
    expect((await (await db()).select().from(assistantActions))[0].status).toBe("done");
    const all = out(555).join("\n");
    expect(all).toContain("انجام شد");
    expect(all).toContain("رمز جدید در پنل نمایش داده می‌شود");
    expect(all).toContain("/panel/servers/srv-1042");
    const [cred] = await (await db()).select().from(serverCredentials).where(eq(serverCredentials.serverId, "srv-1042"));
    const pass = open(cred.passEnc)!;
    expect(pass.length).toBeGreaterThan(8);
    expect(api.calls.some((c) => JSON.stringify(c.body).includes(pass))).toBe(false);
    // replay: once only (both buttons are spent)
    await tap("telegram", 555, ok.callback_data);
    await tap("telegram", 555, no.callback_data);
    expect(answers().slice(-2).every((a) => a.includes("قبلاً"))).toBe(true);
    // an expired button
    resetSteps();
    await say("telegram", 555, "دوباره رمز را عوض کن");
    const [ok2] = buttonsOf(555);
    await (await db()).update(assistantBotButtons).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(assistantBotButtons.id, ok2.callback_data.slice(3)));
    await tap("telegram", 555, ok2.callback_data);
    expect(answers().at(-1)).toContain("مهلت");
  });

  it("cancel does nothing; actions that need a typed name are refused with a panel link", async () => {
    await asUser();
    await link("telegram", 555);
    resetSteps();
    await say("telegram", 555, "رمز root را عوض کن");
    const [, no] = buttonsOf(555);
    await tap("telegram", 555, no.callback_data);
    expect((await (await db()).select().from(assistantActions))[0].status).toBe("cancelled");
    expect(out(555).join("\n")).toContain("لغو شد");

    setAiUpstream(null);
    const before = api.calls.length;
    await say("telegram", 555, "سرور web-prod-1 را حذف کن");
    const sent = api.calls.slice(before).filter((c) => c.method === "sendMessage");
    expect(sent.some((c) => c.body.reply_markup && JSON.stringify(c.body.reply_markup).includes("ok:"))).toBe(false);
    expect(last(555)).toContain("فقط در پنل");
    expect(last(555)).toContain("/panel/servers/srv-1042");
    const del = (await (await db()).select().from(assistantActions)).find((a) => a.tool === "delete_server")!;
    expect(del.status).toBe("cancelled");
    expect((await (await db()).select().from(servers).where(eq(servers.id, "srv-1042")))).toHaveLength(1);
  });
});

describe("assistant bots: security", () => {
  it("credentials never reach the model or an outgoing message", async () => {
    expect(scrubSecrets({ password: "hunter2hunter2", db: { connection_string: "postgres://a:b@h/x", in_tokens: 12 }, note: "api_key=abcd1234efgh" })).toEqual({
      password: expect.stringContaining("پنهان"), db: { connection_string: expect.stringContaining("پنهان"), in_tokens: 12 }, note: "api_key=[REDACTED]",
    });
    await asUser();
    await link("telegram", 555);
    scripted([{ text: "رمز دیتابیس: password=Sup3rS3cretPw و اتصال postgres://app:Pa55word99@db:5432/shop" }]);
    await say("telegram", 555, "رمز دیتابیسم چیست؟");
    const all = out(555).join("\n");
    expect(all).not.toContain("Sup3rS3cretPw");
    expect(all).not.toContain("Pa55word99");
    // the bot token never shows up in a body sent anywhere
    expect(api.calls.some((c) => JSON.stringify(c.body).includes(TG_TOKEN))).toBe(false);
  });

  it("the webhook needs the path secret and the secret header", async () => {
    const { POST } = await import("@/app/api/bot/[kind]/[secret]/route");
    const post = (secret: string, header: string | null, text = "/help") => POST(new Request("http://x/api/bot/bale/" + secret, { method: "POST", headers: header ? { "x-telegram-bot-api-secret-token": header } : {}, body: JSON.stringify(message(321, text)) }), { params: Promise.resolve({ kind: "bale", secret }) } as never);
    expect((await post("wrong", hookSecret("bale"))).status).toBe(404);
    expect((await post(botSecret("bale"), null)).status).toBe(401);
    expect((await post(botSecret("bale"), "nope")).status).toBe(401);
    expect(out(321)).toHaveLength(0);
    expect((await post(botSecret("bale"), hookSecret("bale"))).status).toBe(200);
    expect(last(321)).toContain("وصل کنید");
  });

  it("rate limits per chat (one notice, then silence) and per person", async () => {
    for (let i = 0; i < 20; i++) await say("bale", 444, "سلام " + i);
    expect(out(444)).toHaveLength(20);
    await say("bale", 444, "سلام");
    expect(last(444)).toContain("زیاد است");
    await say("bale", 444, "سلام");
    expect(out(444)).toHaveLength(21);
  });

  it("unlinking from the panel, /unlink and a password change revoke the chat", async () => {
    await asUser();
    await link("telegram", 555);
    const [l] = await call<{ id: string }[]>("assistant.botChats");
    await call("assistant.botUnlink", l.id);
    await say("telegram", 555, "/balance");
    expect(last(555)).toContain("وصل کنید");

    await link("telegram", 555);
    await say("telegram", 555, "/unlink");
    expect(last(555)).toContain("قطع شد");
    await say("telegram", 555, "/status");
    expect(last(555)).toContain("وصل کنید");

    await link("telegram", 555);
    const [row] = await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.chatId, "555"));
    await (await db()).update(users).set({ passwordHash: "changed" }).where(eq(users.id, "u1"));
    // a notification to the revoked chat is not sent either
    await notify(await db(), "u1", "rocket", "نسخه جدید shop فعال شد");
    for (let i = 0; i < 4; i++) if (!(await drain(await db()))) break;
    expect(out(555).some((t) => t.includes("نسخه جدید shop"))).toBe(false);
    expect(await (await db()).select().from(assistantBotChats).where(eq(assistantBotChats.id, row.id))).toHaveLength(0);
    expect(await (await db()).select().from(notifyChannels).where(eq(notifyChannels.id, row.notifyChannelId!))).toHaveLength(0);
  });
});

describe("assistant bots: transport and receiving", () => {
  it("Telegram goes through the proxy, Bale directly; notifications reach a linked chat", async () => {
    await asUser();
    await link("telegram", 555);
    await link("bale", 777);
    const tg = api.calls.filter((c) => c.host === "api.telegram.org");
    const bale = api.calls.filter((c) => c.host === "tapi.bale.ai");
    expect(tg.length).toBeGreaterThan(0);
    expect(bale.length).toBeGreaterThan(0);
    expect(tg.every((c) => c.proxied)).toBe(true);
    expect(bale.every((c) => c.dispatcher === undefined)).toBe(true);
    // BOT_PROXY when the admin set none
    await saveBot(await db(), "telegram", { proxy: "" });
    process.env.BOT_PROXY = "http://env-proxy.example:8080";
    api.calls.length = 0;
    await notify(await db(), "u1", "rocket", "نسخه جدید shop فعال شد");
    for (let i = 0; i < 4; i++) if (!(await drain(await db()))) break;
    const n = api.calls.filter((c) => c.method === "sendMessage" && String(c.body.text).includes("نسخه جدید shop"));
    expect(n.map((c) => c.host).sort()).toEqual(["api.telegram.org", "tapi.bale.ai"]);
    expect(n.find((c) => c.host === "api.telegram.org")!.proxied).toBe(true);
    // the admin's «تست اتصال»
    await (await import("./helpers")).asAdmin();
    const r = await call<{ ok: boolean; detail: string }>("assistant.adminBotTest", "bale");
    expect(r.ok).toBe(true);
    const hook = api.calls.find((c) => c.method === "setWebhook")!;
    expect(hook.host).toBe("tapi.bale.ai");
    expect(hook.body.secret_token).toBe(hookSecret("bale"));
    expect(String(hook.body.url)).toContain("/api/bot/bale/" + botSecret("bale"));
    const views = await call<{ kind: string; tokenSet: boolean }[]>("assistant.adminBots");
    expect(JSON.stringify(views)).not.toContain(TG_TOKEN);
    expect(JSON.stringify(views)).not.toContain("user:pw");
  });

  it("long polling: offset kept in kv, a redelivered update runs once, one poller at a time", async () => {
    const d = await db();
    api.updates.push(message(800, "/help"), message(801, "/help"));
    const r = await pollOnce(d, "telegram", "A", 0);
    await r.done;
    expect(r).toMatchObject({ state: "ok", got: 2 });
    expect(out(800)).toHaveLength(1);
    expect(out(801)).toHaveLength(1);
    const first = api.calls.filter((c) => c.method === "getUpdates");
    expect(first[0].body.offset).toBe(0);
    expect(first[0].proxied).toBe(true);
    const [off] = await d.select().from(kv).where(eq(kv.key, "botoffset:telegram"));
    expect((off.value as { offset: number }).offset).toBe(uid + 1);
    // the same update again (e.g. after a crash) is not handled twice
    const again = message(800, "/help");
    api.updates.push(again, { ...again });
    await (await pollOnce(d, "telegram", "A", 0)).done;
    expect(out(800)).toHaveLength(2);
    expect(api.calls.filter((c) => c.method === "getUpdates").at(-1)!.body.offset).toBe(uid);
    // another process does not poll while A holds the lease; it takes over once the lease lapses
    expect((await pollOnce(d, "telegram", "B", 0)).state).toBe("busy");
    expect(await takeLease(d, "telegram", "A")).toBe(true);
    await d.update(kv).set({ value: { owner: "A", until: Date.now() - 1 } }).where(eq(kv.key, "botpoll:telegram"));
    expect((await pollOnce(d, "telegram", "B", 0)).state).toBe("ok");
    // Bale in webhook mode does not poll
    expect((await pollOnce(d, "bale", "A", 0)).state).toBe("idle");
  });

  it("markdown is escaped per platform, long answers are split, a parse error falls back to plain text", async () => {
    expect(toHtml("**a<b** `x&y` [لینک](https://e.com/?a=1&b=2)")).toBe("<b>a&lt;b</b> <code>x&amp;y</code> <a href=\"https://e.com/?a=1&amp;b=2\">لینک</a>");
    expect(toHtml("```\n<script>\n```")).toBe("<pre>&lt;script&gt;</pre>");
    expect(toHtml("# عنوان\n- مورد")).toBe("<b>عنوان</b>\n• مورد");
    expect(toBaleMd("srv_1 *x* **پررنگ** `a_b`")).toBe("srv\\_1 \\*x\\* *پررنگ* `a_b`");
    expect(toPlain("**a** [b](https://c.d)")).toBe("a b (https://c.d)");
    const long = Array.from({ length: 400 }, (_, i) => "خط شماره " + i + " با کمی متن برای پر کردن پیام").join("\n");
    const parts = splitText(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("\n")).toBe(long);

    await asUser();
    await link("telegram", 555);
    scripted([{ text: long.replace(/خط/g, "<b>خط") }]);
    api.calls.length = 0;
    await say("telegram", 555, "یک متن طولانی بنویس");
    const texts = api.calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").map((c) => String(c.body.text));
    expect(texts.filter((t) => t.includes("خط شماره")).length).toBeGreaterThan(1);
    expect(texts.every((t) => t.length <= 4096)).toBe(true);
    expect(texts.some((t) => t.includes("<b>خط"))).toBe(false); // the model's raw tag is escaped
    api.parseFailOnce = true;
    await say("telegram", 555, "/balance");
    const [bad, good] = api.calls.slice(-2);
    expect(bad.body.parse_mode).toBe("HTML");
    expect(good.body.parse_mode).toBeUndefined();
    expect(String(good.body.text)).toContain("موجودی");
  });
});

