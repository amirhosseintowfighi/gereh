import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/bot/[kind]/[secret]/route";
import { botSecret, checkWebhookUrl, signBody } from "@/server/channels";
import { context } from "@/server/ctx";
import { notifyChannels } from "@/server/db/schema";
import { outbox } from "@/server/messaging";
import { buildState } from "@/server/state";
import { notify } from "@/server/util";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeEach(async () => { await fresh(); process.env.BALE_BOT_USERNAME = "gereh_bot"; outbox.length = 0; });
afterEach(() => { delete process.env.BALE_BOT_USERNAME; });
const settle = async () => { for (let i = 0; i < 6; i++) if (!(await drain(await db()))) break; };
const bot = (kind: string, secret: string, text: string, chat = 777) =>
  POST(new Request("http://x/api/bot/" + kind + "/" + secret, { method: "POST", body: JSON.stringify({ message: { chat: { id: chat }, text } }) }), { params: Promise.resolve({ kind, secret }) } as never);

describe("notification channels", () => {
  it("links a Bale chat through the bot, then delivers notifications there", async () => {
    await asUser();
    const url = await call<string>("notify.botLink", "bale");
    expect(url).toMatch(/^https:\/\/ble\.ir\/gereh_bot\?start=/);
    expect((await bot("bale", "wrong", "/start x")).status).toBe(404);
    await bot("bale", botSecret("bale"), "/start " + url.split("start=")[1]);
    expect(outbox[0]).toMatchObject({ channel: "bale", to: "777" });
    expect(outbox[0].text).toContain("✅");
    const [ch] = await (await db()).select().from(notifyChannels).where(eq(notifyChannels.userId, "u1"));
    expect(ch).toMatchObject({ kind: "bale", target: "777", active: true });

    await notify(await db(), "u1", "rocket", "نسخه جدید shop فعال شد");
    await settle();
    expect(outbox.some((m) => m.channel === "bale" && m.text.includes("نسخه جدید shop"))).toBe(true);
    await bot("bale", botSecret("bale"), "/balance");
    expect(outbox[0].text).toContain("موجودی");
    await bot("bale", botSecret("bale"), "/stop");
    expect((await (await db()).select().from(notifyChannels).where(eq(notifyChannels.id, ch.id)))[0].active).toBe(false);
  });

  it("webhooks: https and public addresses only, signed bodies, per-kind filtering", async () => {
    expect(await checkWebhookUrl("http://example.com/x")).toContain("https");
    expect(await checkWebhookUrl("https://127.0.0.1/x")).toContain("خصوصی");
    expect(await checkWebhookUrl("https://10.1.2.3/x")).toContain("خصوصی");
    expect(await checkWebhookUrl("https://localhost/x")).toContain("داخلی");
    expect(await checkWebhookUrl("https://u:p@8.8.8.8/x")).toContain("رمز");
    expect(await checkWebhookUrl("https://8.8.8.8/hook")).toBeNull();
    expect(signBody("k", "{}")).toBe("sha256=" + createHmac("sha256", "k").update("{}").digest("hex"));
    await asUser();
    expect(await fails("notify.addWebhook", { url: "https://192.168.1.5/h", label: "", events: ["billing"] })).toContain("خصوصی");
    const secret = await call<string>("notify.addWebhook", { url: "https://8.8.8.8/hook", label: "ci", events: ["billing"] });
    expect(secret).toMatch(/^whsec_/);
    await notify(await db(), "u1", "rocket", "service event");
    await notify(await db(), "u1", "wallet", "billing event");
    await settle();
    const hooks = outbox.filter((m) => m.channel === "webhook");
    expect(hooks).toHaveLength(1);
    expect(JSON.parse(hooks[0].text)).toMatchObject({ event: "notification.billing", subject: "billing event" });
    const c = await context();
    const st = (await buildState(c.db, c.auth, "customer")).db;
    expect(st.channels[0]).toMatchObject({ kind: "webhook", label: "ci", events: ["billing"] });
    expect(JSON.stringify(st.channels)).not.toContain(secret);
    expect(st.bots.bale).toBe(true);
    await call("notify.testChannel", st.channels[0].id);
  });
});
