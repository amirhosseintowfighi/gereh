import { createPublicKey, createSign, createVerify } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as SEND } from "@/app/api/mail/v1/send/route";
import { POST as HOOK } from "@/app/api/mail/hook/route";
import { POST as EVENTS } from "@/app/api/mail/events/route";
import { dmarcValue, parseAddress, tehranPeriods } from "@/lib/mail";
import { dnsRecords, mailDomains, mailEvents, mailMessages, mailPlans, transactions, users } from "@/server/db/schema";
import { SimMail } from "@/server/mail/driver";
import { parseMime, resetMailResolver, setMailResolver } from "@/server/mail/service";
import { open } from "@/server/secrets";
import { mailBilling } from "@/server/worker/mail";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(async () => {
  await fresh();
  SimMail.reset();
  // nothing resolves unless a test says so
  setMailResolver({ txt: async () => { throw new Error("ENOTFOUND"); }, mx: async () => { throw new Error("ENOTFOUND"); }, cname: async () => { throw new Error("ENOTFOUND"); } });
});
afterEach(() => { resetMailResolver(); delete process.env.MAIL_HOOK_SECRET; });

type Rec = { key: string; type: string; name: string; value: string; ok: boolean };
type Detail = { id: string; status: string; mode: string; records: Rec[]; gerehZone: string; mailboxes: { id: string; local: string }[]; usage: { today: number; month: number } };
const detail = (id: string) => call<Detail>("mail.domain", id);
/** answer DNS lookups with exactly the records the panel asks for */
const publish = (recs: Rec[]) => setMailResolver({
  txt: async (n) => recs.filter((r) => r.type === "TXT" && r.name === n).map((r) => [r.value.slice(0, 200), r.value.slice(200)]),
  mx: async (n) => recs.filter((r) => r.type === "MX" && r.name === n).map((r) => ({ exchange: r.value + ".", priority: 10 })),
  cname: async (n) => recs.filter((r) => r.type === "CNAME" && r.name === n).map((r) => r.value),
});
const send = (key: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  SEND(new Request("http://x/api/mail/v1/send", { method: "POST", headers: { authorization: "Bearer " + key, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
async function liveDomain(domain = "shop-mail.ir") {
  await asUser();
  const { id, apiKey } = await call<{ id: string; apiKey: string }>("mail.create", { domain, planId: "mail-start" });
  publish((await detail(id)).records);
  expect(await call("mail.checkDns", id)).toMatchObject({ verified: true });
  await call("mail.setMode", id, "live");
  return { id, apiKey };
}
const stranger = async () => { jar.clear(); await call("auth.register", { name: "کاربر دیگر", email: "other@example.com", phone: "09351112299", password: "Abcdefg1" }); };
const settle = async () => { for (let i = 0; i < 5; i++) if (!(await drain(await db()))) break; };

describe("mail domains", () => {
  it("generates a sealed DKIM key and the five DNS records", async () => {
    await asUser();
    expect(await fails("mail.create", { domain: "not a domain", planId: "mail-start" })).toContain("دامنه");
    expect(await fails("mail.create", { domain: "novin.studio", planId: "mail-start" })).toContain("قبلاً");
    const { id, apiKey } = await call<{ id: string; apiKey: string }>("mail.create", { domain: "News.Example.IR", planId: "mail-start" });
    expect(apiKey).toMatch(/^gm_/);
    const d = await detail(id);
    expect(d).toMatchObject({ status: "pending", mode: "dev" });
    expect(d.records.map((r) => [r.key, r.type, r.name])).toEqual([
      ["dkim", "TXT", expect.stringMatching(/^gereh\d{6}\._domainkey\.news\.example\.ir$/)], ["spf", "TXT", "news.example.ir"], ["returnPath", "CNAME", "bounces.news.example.ir"], ["mx", "MX", "news.example.ir"], ["dmarc", "TXT", "_dmarc.news.example.ir"],
    ]);
    expect(d.records.find((r) => r.key === "spf")!.value).toBe("v=spf1 include:_spf.gereh.net ~all");
    // the stored private key is sealed and matches the published public key
    const [row] = await (await db()).select().from(mailDomains).where(eq(mailDomains.id, id));
    expect(row.dkimPrivateEnc).not.toContain("PRIVATE KEY");
    const pem = open(row.dkimPrivateEnc)!;
    const sig = createSign("sha256").update("hello").sign(pem);
    const pub = createPublicKey({ key: Buffer.from(d.records[0].value.split("p=")[1], "base64"), format: "der", type: "spki" });
    expect(createVerify("sha256").update("hello").verify(pub, sig)).toBe(true);
    expect(SimMail.state.domains.has("news.example.ir")).toBe(true);
  });

  it("verifies each record; LIVE needs DKIM, SPF and return-path", async () => {
    await asUser();
    const { id } = await call<{ id: string }>("mail.create", { domain: "example.ir", planId: "mail-start" });
    const recs = (await detail(id)).records;
    expect(await fails("mail.setMode", id, "live")).toContain("DKIM");
    publish(recs.filter((r) => r.key !== "returnPath"));
    expect(await call("mail.checkDns", id)).toEqual({ verified: false, ok: { dkim: true, spf: true, returnPath: false, mx: true, dmarc: true } });
    publish(recs);
    expect(await call("mail.checkDns", id)).toMatchObject({ verified: true });
    await call("mail.setMode", id, "live");
    expect(await detail(id)).toMatchObject({ status: "active", mode: "live" });
  });

  it("DMARC editor builds the record", async () => {
    expect(dmarcValue({ p: "quarantine", pct: 50, rua: "r@x.ir", adkim: "s", aspf: "r" })).toBe("v=DMARC1; p=quarantine; pct=50; rua=mailto:r@x.ir; adkim=s");
    await asUser();
    expect(await fails("mail.setDmarc", "mail-demo1", { p: "reject", pct: 100, rua: "not-an-email", adkim: "r", aspf: "r" })).toContain("rua");
    await call("mail.setDmarc", "mail-demo1", { p: "reject", pct: 100, rua: "", adkim: "r", aspf: "r" });
    expect((await detail("mail-demo1")).records.find((r) => r.key === "dmarc")!.value).toBe("v=DMARC1; p=reject");
  });

  it("one-click records for a domain hosted in Gereh DNS", async () => {
    await asUser();
    const { id } = await call<{ id: string }>("mail.create", { domain: "news.cafeland.ir", planId: "mail-start" });
    expect((await detail(id)).gerehZone).toBe("cafeland.ir");
    const r = await call<{ zone: string; added: number; verified: boolean }>("mail.autoDns", id);
    expect(r).toMatchObject({ zone: "cafeland.ir", added: 5, verified: true });
    const zone = await (await db()).select().from(dnsRecords).where(eq(dnsRecords.domainId, "dom-502"));
    expect(zone.find((x) => x.name === "bounces.news" && x.type === "CNAME")?.value).toBe("return.gereh.net");
    expect(zone.filter((x) => x.name === "@" && /^v=spf1/.test(x.value))).toHaveLength(1); // the apex SPF is untouched
    expect((await call<{ added: number }>("mail.autoDns", id)).added).toBe(0);
    const other = await call<{ id: string }>("mail.create", { domain: "elsewhere.ir", planId: "mail-start" });
    expect(await fails("mail.autoDns", other.id)).toContain("DNS گره");
  });

  it("is scoped to its owner", async () => {
    await stranger();
    expect(await fails("mail.domain", "mail-demo1")).toContain("پیدا نشد");
    expect(await fails("mail.send", "mail-demo1", { from: "a@novin.studio", to: "x@y.ir", subject: "x", text: "x" })).toContain("پیدا نشد");
    expect((await call<{ domains: unknown[] }>("mail.overview")).domains).toEqual([]);
  });
});

describe("sending", () => {
  it("DEV mode accepts and logs without delivering", async () => {
    await asUser();
    const { id, apiKey } = await call<{ id: string; apiKey: string }>("mail.create", { domain: "dev-only.ir", planId: "mail-start" });
    const res = await send(apiKey, { from: "App <app@dev-only.ir>", to: ["ali@example.com"], subject: "سلام", text: "متن" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, status: "dev", mode: "dev" });
    await settle();
    expect(SimMail.state.sent).toHaveLength(0);
    const list = await call<{ rows: { status: string }[] }>("mail.messages", id, { direction: "out" });
    expect(list.rows.map((r) => r.status)).toEqual(["dev"]);
  });

  it("HTTP API: auth, validation, attachments, tag header, List-Unsubscribe and simulated delivery", async () => {
    const { id, apiKey } = await liveDomain();
    expect((await send("gm_wrongwrongwrongwrongwrong", { from: "a@shop-mail.ir", to: "b@x.ir", subject: "x", text: "x" })).status).toBe(401);
    expect(await (await send(apiKey, { from: "a@other.ir", to: "b@x.ir", subject: "x", text: "x" })).json()).toMatchObject({ error: { message: expect.stringContaining("shop-mail.ir") } });
    expect((await send(apiKey, { from: "a@shop-mail.ir", to: "b@x.ir", subject: "x", text: "x", headers: { "Content-Type": "evil" } })).status).toBe(400);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    expect((await send(apiKey, { from: "a@shop-mail.ir", to: "b@x.ir", subject: "x", text: "x", attachments: [{ filename: "a.bin", content: big }] })).status).toBe(413);

    const res = await send(apiKey, {
      from: "فروشگاه <shop@shop-mail.ir>", to: ["ali@example.com", "bounce@example.org"], cc: "fail@example.net", bcc: ["boss@example.com"], subject: "سفارش شما", html: "<b>سلام</b>", text: "سلام",
      listUnsubscribe: "https://shop-mail.ir/unsub?u=1", attachments: [{ filename: "factor.txt", content: Buffer.from("hello").toString("base64"), contentType: "text/plain" }],
    }, { "x-gereh-tag": "order" });
    expect(res.status).toBe(202);
    const { id: msgId, status } = (await res.json()) as { id: string; status: string };
    expect(status).toBe("queued");
    await settle();
    expect(SimMail.state.sent[0]).toMatchObject({ domain: "shop-mail.ir", envelopeFrom: "b-" + msgId + "@bounces.shop-mail.ir", recipients: ["ali@example.com", "bounce@example.org", "fail@example.net", "boss@example.com"] });
    const m = await call<{ status: string; tag: string; raw: string; attachments: { name: string; size: number }[]; events: { type: string; recipient: string }[] }>("mail.message", id, msgId);
    expect(m).toMatchObject({ status: "bounced", tag: "order", attachments: [{ name: "factor.txt", size: 5 }] });
    expect(m.raw).toContain("List-Unsubscribe: <https://shop-mail.ir/unsub?u=1>");
    expect(m.raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    expect(m.raw).toMatch(new RegExp("^X-Gereh-Id: " + msgId + "$", "im"));
    expect(m.raw).not.toMatch(/^Bcc:/m);
    expect(m.events.map((e) => e.type + ":" + e.recipient)).toEqual(expect.arrayContaining(["queued:", "delivered:ali@example.com", "bounced:bounce@example.org", "failed:fail@example.net", "delivered:boss@example.com"]));
    expect((await detail(id)).usage.today).toBe(4);
    // stats and tags
    const stats = await call<{ days: { sent: number; bounced: number }[]; tags: { tag: string; total: number; delivered: number }[] }>("mail.stats", id);
    expect(stats.days).toHaveLength(90);
    expect(stats.days.at(-1)).toMatchObject({ sent: 4, delivered: 2, bounced: 1, failed: 1 });
    expect(stats.tags).toEqual([{ tag: "order", total: 4, delivered: 2, bounced: 1, failed: 1, dev: 0 }]);
  });

  it("console send, daily limit per plan, and the console needs the domain's address", async () => {
    const { id } = await liveDomain();
    await (await db()).update(mailPlans).set({ dailyLimit: 3 }).where(eq(mailPlans.id, "mail-start"));
    expect(await fails("mail.send", id, { from: "x@gmail.com", to: "a@b.ir", subject: "s", text: "t" })).toContain("shop-mail.ir");
    await call("mail.send", id, { from: "x@shop-mail.ir", to: "a@b.ir, c@d.ir", subject: "s", text: "t", tag: "test" });
    expect(await fails("mail.send", id, { from: "x@shop-mail.ir", to: "a@b.ir, c@d.ir", subject: "s", text: "t" })).toContain("روزانه");
  });

  it("hourly billing; no credit suspends sending until the wallet is topped up", async () => {
    const { id, apiKey } = await liveDomain();
    const d = await db();
    const before = (await d.select().from(users).where(eq(users.id, "u1")))[0].balance;
    await mailBilling(d);
    const tx = (await d.select().from(transactions).where(eq(transactions.userId, "u1"))).find((t) => t.desc.startsWith("مصرف ساعتی سرویس ایمیل"))!;
    expect(-tx.amount).toBe(Math.ceil(290_000 / 720) + Math.ceil(790_000 / 720)); // the new domain + the demo domain
    expect((await d.select().from(users).where(eq(users.id, "u1")))[0].balance).toBe(before + tx.amount);
    await d.update(users).set({ balance: 10 }).where(eq(users.id, "u1"));
    await mailBilling(d);
    expect((await d.select().from(mailDomains).where(eq(mailDomains.id, id)))[0]).toMatchObject({ status: "suspended", suspendReason: "credit" });
    const r = await send(apiKey, { from: "a@shop-mail.ir", to: "b@x.ir", subject: "x", text: "x" });
    expect(r.status).toBe(403);
    expect(await call("mail.setMode", id, "live").catch((e: Error) => e.message)).toContain("معلق");
    await d.update(users).set({ balance: 5_000_000 }).where(eq(users.id, "u1"));
    await mailBilling(d);
    expect((await d.select().from(mailDomains).where(eq(mailDomains.id, id)))[0]).toMatchObject({ status: "active", suspendReason: "" });
    expect((await send(apiKey, { from: "a@shop-mail.ir", to: "b@x.ir", subject: "x", text: "x" })).status).toBe(202);
  });

  it("delivery webhooks update the message by its return path", async () => {
    process.env.MAIL_HOOK_SECRET = "hook-secret-hook-secret-1234";
    const { id } = await liveDomain();
    const { id: msgId } = await call<{ id: string }>("mail.send", id, { from: "a@shop-mail.ir", to: "z@x.ir", subject: "s", text: "t" });
    const d = await db();
    await d.update(mailMessages).set({ status: "sent" }).where(eq(mailMessages.id, msgId)); // as if a real server took it
    const post = (secret: string, body: unknown) => EVENTS(new Request("http://x/api/mail/events", { method: "POST", headers: { authorization: "Bearer " + secret }, body: JSON.stringify(body) }));
    expect((await post("wrong", { events: [] })).status).toBe(401);
    const r = await post("hook-secret-hook-secret-1234", { events: [{ type: "delivery.dsn-perm-fail", data: { from: "b-" + msgId + "@bounces.shop-mail.ir", to: "z@x.ir", details: "550 no such user" } }] });
    expect(await r.json()).toEqual({ ok: true, recorded: 1 });
    expect((await d.select().from(mailMessages).where(eq(mailMessages.id, msgId)))[0].status).toBe("bounced");
    expect((await d.select().from(mailEvents).where(and(eq(mailEvents.messageId, msgId), eq(mailEvents.type, "bounced"))))[0].detail).toBe("550 no such user");
  });
});

describe("SMTP users and mailboxes", () => {
  it("SMTP logins with sealed passwords: reveal and regenerate", async () => {
    await asUser();
    const u = await call<{ username: string; password: string }>("mail.smtpCreate", "mail-demo1");
    expect(u.username).toMatch(/^novin-studio-/);
    expect(SimMail.state.smtp.get(u.username)).toBe(u.password);
    const list = (await call<{ smtp: { id: string; username: string }[] }>("mail.domain", "mail-demo1")).smtp;
    const sid = list.find((s) => s.username === u.username)!.id;
    expect(await call("mail.smtpReveal", "mail-demo1", sid)).toBe(u.password);
    const next = await call<string>("mail.smtpRegenerate", "mail-demo1", sid);
    expect(next).not.toBe(u.password);
    expect(SimMail.state.smtp.get(u.username)).toBe(next);
    await call("mail.smtpRemove", "mail-demo1", sid);
    expect(SimMail.state.smtp.has(u.username)).toBe(false);
  });

  it("mailboxes respect the plan; aliases, forwards and catch-all", async () => {
    await asUser();
    const { id } = await call<{ id: string }>("mail.create", { domain: "team.ir", planId: "mail-start" });
    expect(await fails("mail.mailboxCreate", id, { local: "Info!", password: "abc12345", quotaMb: 1024 })).toContain("نام صندوق");
    expect(await fails("mail.mailboxCreate", id, { local: "info", password: "short", quotaMb: 1024 })).toContain("۸");
    expect(await fails("mail.mailboxCreate", id, { local: "info", password: "abc12345", quotaMb: 4096 })).toContain("حداکثر");
    for (const l of ["a", "b", "c", "d", "e"]) await call("mail.mailboxCreate", id, { local: l, name: l, password: "abc12345", quotaMb: 1024 });
    expect(await fails("mail.mailboxCreate", id, { local: "f", password: "abc12345", quotaMb: 1024 })).toContain("سقف");
    expect(SimMail.state.mailboxes.get("a@team.ir")).toMatchObject({ quotaMb: 1024, password: "abc12345", active: true });
    expect(await fails("mail.aliasSave", id, { local: "a", destinations: ["b@team.ir"] })).toContain("صندوق");
    await call("mail.aliasSave", id, { local: "sales", destinations: ["a@team.ir", "Owner@Gmail.com"] });
    expect(SimMail.state.forwards.get("sales@team.ir")).toEqual(["a@team.ir", "owner@gmail.com"]);
    await call("mail.setInbound", id, { catchAll: "a@team.ir", spamThreshold: 4 });
    expect(SimMail.state.forwards.get("@team.ir")).toEqual(["a@team.ir"]);
    await call("mail.setPlan", id, "mail-pro");
    const box = (await detail(id)).mailboxes.find((b) => b.local === "e")!;
    await call("mail.mailboxUpdate", id, box.id, { quotaMb: 8192, active: false });
    expect(SimMail.state.mailboxes.get("e@team.ir")).toMatchObject({ quotaMb: 8192, active: false });
    expect(await fails("mail.setPlan", id, "mail-start")).toContain("فضای");
    await call("mail.mailboxRemove", id, box.id);
    expect(SimMail.state.mailboxes.has("e@team.ir")).toBe(false);
  });
});

describe("inbound", () => {
  const raw = (from: string, to: string, subject: string, body = "hi") => "From: " + from + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\nMessage-ID: <x" + Math.random() + "@x>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body;
  const hook = (body: unknown, secret = "hook-secret-hook-secret-1234") => HOOK(new Request("http://x/api/mail/hook", { method: "POST", headers: { authorization: "Bearer " + secret, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const inbound = (from: string, to: string, subject: string, body?: string) => hook({ context: { stage: "data" }, envelope: { from: { address: from }, to: [{ address: to }] }, message: { contents: raw(from, to, subject, body) } }).then((r) => r.json() as Promise<{ action: string }>);

  it("MTA hook: blocklist, rules, spam threshold, mailboxes, aliases and unknown users", async () => {
    process.env.MAIL_HOOK_SECRET = "hook-secret-hook-secret-1234";
    expect((await hook({}, "nope-nope-nope-nope")).status).toBe(401);
    expect(await inbound("a@x.com", "someone@not-hosted.ir", "hi")).toMatchObject({ action: "reject" });
    expect(await inbound("ali@example.com", "info@novin.studio", "سلام")).toEqual({ action: "accept" });
    expect(await inbound("deals@spam-offers.example", "info@novin.studio", "offer")).toEqual({ action: "discard" });
    expect(await inbound("news@site.com", "info@novin.studio", "Weekly [newsletter] issue")).toEqual({ action: "discard" });
    expect(await inbound("x@lucky.example", "sara@novin.studio", "YOU WON THE LOTTERY", "free money, click here now")).toEqual({ action: "quarantine" });
    expect(await inbound("a@b.com", "support@novin.studio", "alias")).toEqual({ action: "accept" });
    expect(await inbound("a@b.com", "nobody@novin.studio", "who")).toMatchObject({ action: "reject", response: { status: 550 } });
    await asUser();
    await call("mail.ruleAdd", "mail-demo1", { field: "from", op: "ends", value: "@partner.ir", action: "forward", target: "ops@partner-hq.ir" });
    await call("mail.blockAdd", "mail-demo1", "@nasty.example");
    expect(await inbound("a@nasty.example", "info@novin.studio", "x")).toEqual({ action: "discard" });
    expect(await inbound("hi@partner.ir", "info@novin.studio", "x")).toEqual({ action: "accept" });
    const inbox = await call<{ rows: { status: string; subject: string }[] }>("mail.messages", "mail-demo1", { direction: "in", q: "" });
    expect(inbox.rows.slice(0, 7).map((r) => r.status)).toEqual(["received", "dropped", "rejected", "received", "spam", "dropped", "dropped"]);
    // catch-all takes unknown recipients
    await call("mail.setInbound", "mail-demo1", { catchAll: "info@novin.studio" });
    expect(await inbound("a@b.com", "nobody@novin.studio", "who")).toEqual({ action: "accept" });
  });

  it("MTA hook: SMTP submissions are logged and limited; DEV mode discards", async () => {
    process.env.MAIL_HOOK_SECRET = "hook-secret-hook-secret-1234";
    await asUser();
    const u = await call<{ username: string }>("mail.smtpCreate", "mail-demo1");
    const submit = (from: string, to: string[]) => hook({ context: { stage: "data", sasl: { login: u.username } }, envelope: { from: { address: from }, to: to.map((address) => ({ address })) }, message: { headers: [["From", " " + from], ["Subject", " smtp test"], ["X-Gereh-Tag", " smtp"]], contents: "body" } }).then((r) => r.json() as Promise<{ action: string; modifications?: { value: string }[] }>);
    expect(await submit("a@elsewhere.com", ["x@y.ir"])).toMatchObject({ action: "reject" });
    const r = await submit("app@novin.studio", ["x@y.ir"]);
    expect(r.action).toBe("accept");
    expect(r.modifications?.[0].value).toMatch(/^b-msg-\w+@bounces\.novin\.studio$/);
    const out = await call<{ rows: { source: string; tag: string; subject: string }[] }>("mail.messages", "mail-demo1", { direction: "out", q: "smtp test" });
    expect(out.rows[0]).toMatchObject({ source: "smtp", tag: "smtp", subject: "smtp test" });
    await call("mail.setMode", "mail-demo1", "dev");
    expect(await submit("app@novin.studio", ["x@y.ir"])).toEqual({ action: "discard" });
  });

  it("console test message lands in the mailbox; MIME parsing decodes parts", async () => {
    await asUser();
    expect(await call("mail.testInbound", "mail-demo1", { from: "Ali <ali@example.com>", to: "info@novin.studio", subject: "آزمایش", text: "متن فارسی" })).toMatchObject({ action: "accept" });
    const box = (await detail("mail-demo1")).mailboxes.find((b) => b.local === "info")!;
    const list = await call<{ rows: { id: string; subject: string; read: boolean }[] }>("mail.messages", "mail-demo1", { direction: "in", mailboxId: box.id });
    expect(list.rows[0]).toMatchObject({ subject: "آزمایش", read: false });
    const m = await call<{ text: string }>("mail.message", "mail-demo1", list.rows[0].id);
    expect(m.text).toBe("متن فارسی");
    const p = parseMime("Subject: =?UTF-8?B?" + Buffer.from("سلام").toString("base64") + "?=\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nhello=20world\r\n--b1\r\nContent-Type: text/html\r\n\r\n<p>hi</p>\r\n--b1\r\nContent-Type: application/pdf; name=\"a.pdf\"\r\nContent-Disposition: attachment; filename=\"a.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAAA\r\n--b1--");
    expect(p).toMatchObject({ subject: "سلام", text: "hello world\r\n", html: "<p>hi</p>\r\n", attachments: [{ name: "a.pdf", type: "application/pdf", size: 3 }] });
  });
});

describe("staff", () => {
  it("edits plans and suspends a domain", async () => {
    await asAdmin();
    const list = await call<{ domains: { id: string; owner: string }[]; plans: unknown[] }>("mail.adminList");
    expect(list.domains.find((d) => d.id === "mail-demo1")).toMatchObject({ owner: "امیر رضایی" });
    await call("mail.adminPlan", "mail-pro", { price: 800_000, dailyLimit: 6000 });
    await call("mail.adminDomain", "mail-demo1", { suspend: true });
    await asUser();
    expect(await fails("mail.send", "mail-demo1", { from: "a@novin.studio", to: "b@x.ir", subject: "s", text: "t" })).toContain("پشتیبانی");
    await stranger();
    expect(await fails("mail.adminList")).toBeTruthy();
  });
});

describe("helpers", () => {
  it("addresses and Tehran periods", () => {
    expect(parseAddress("Ali <Ali@Example.COM>")).toEqual({ name: "Ali", address: "ali@example.com" });
    expect(parseAddress("bad@")).toBeNull();
    const { day, month } = tehranPeriods(new Date("2026-03-20T21:00:00Z")); // 00:30 on 21 March in Tehran
    expect(day.toISOString()).toBe("2026-03-20T20:30:00.000Z");
    expect(month.toISOString()).toBe("2026-02-28T20:30:00.000Z");
  });
});
