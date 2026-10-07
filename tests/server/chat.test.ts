import { beforeEach, describe, expect, it } from "vitest";
import { startChat, suggest, visitorClose, visitorSend, visitorView } from "@/server/chat";
import { context } from "@/server/ctx";
import { outbox } from "@/server/messaging";
import { buildState } from "@/server/state";
import { asAdmin, asUser, call, fails, fresh, jar } from "./helpers";

beforeEach(fresh);
const visitor = async () => { jar.clear(); return startChat(await context(), { name: "مهمان", email: "guest@example.com", text: "چطور با ssh به سرور وصل شوم؟" }, "http://localhost:3000"); };

describe("live chat", () => {
  it("a visitor starts a chat, gets KB suggestions and staff are emailed", async () => {
    const r = await visitor();
    expect(r.token).toMatch(/^[\w-]{40,}$/);
    expect(r.messages.map((m) => m.from)).toEqual(["visitor", "system"]);
    expect(r.messages[1].text).toContain("/kb/connect-to-server-ssh");
    expect(outbox.some((m) => m.subject?.startsWith("گفتگوی آنلاین جدید"))).toBe(true);
  });

  it("staff reply reaches the visitor; polling returns only newer messages", async () => {
    const { token, messages } = await visitor();
    const after = messages[messages.length - 1].id;
    await asAdmin();
    const s = await buildState((await context()).db, (await context()).auth, "admin");
    const chat = s.db.chats[0];
    expect(chat).toMatchObject({ name: "مهمان", status: "open", unread: true });
    await call("chat.reply", chat.id, "سلام، از دستور ssh root@IP استفاده کنید.");
    jar.clear();
    const v = await visitorView(await context(), token, after);
    expect(v.messages).toHaveLength(1);
    expect(v.messages[0]).toMatchObject({ from: "staff", author: "مدیر" });
    expect(v.agent).toBe("مدیر");
  });

  it("a wrong or malformed token sees nothing", async () => {
    await visitor();
    await expect(visitorView(await context(), "x".repeat(43), 0)).rejects.toMatchObject({ status: 404 });
    await expect(visitorView(await context(), null, 0)).rejects.toMatchObject({ status: 404 });
  });

  it("closing emails a transcript; a new visitor message reopens", async () => {
    const { token } = await visitor();
    await visitorClose(await context(), token);
    expect((await visitorView(await context(), token, 0)).status).toBe("closed");
    expect(outbox.some((m) => m.to === "guest@example.com" && m.text.includes("چطور با ssh"))).toBe(true);
    await visitorSend(await context(), token, { text: "یک سؤال دیگر" });
    expect((await visitorView(await context(), token, 0)).status).toBe("open");
  });

  it("customers cannot use staff chat methods", async () => {
    await visitor();
    await asUser();
    await fails("chat.reply", "chat-x", "hi");
    await fails("chat.close", "chat-x");
  });

  it("starting chats is rate-limited per IP", async () => {
    for (let i = 0; i < 5; i++) await visitor();
    await expect(visitor()).rejects.toMatchObject({ status: 429 });
  });

  it("suggest() matches knowledge-base articles by shared words", () => {
    expect(suggest("رکورد MX دامنه").map((a) => a.slug)).toContain("dns-records");
    expect(suggest("")).toEqual([]);
  });
});
