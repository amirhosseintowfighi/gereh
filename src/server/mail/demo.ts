/* Demo data for the mail service: novin.studio (verified, LIVE; the zone in Gereh DNS is left as is, so «auto-add» can be tried) with a mailbox,
   an alias, an SMTP login and two weeks of logs. */
import "server-only";
import { DMARC_DEFAULT } from "@/lib/mail";
import type { DB } from "../db/client";
import * as t from "../db/schema";
import { hashPassword } from "../password";
import { seal } from "../secrets";
import { genPassword } from "../util";
import { newApiKey, newDkim, recordsOf, simOutcome } from "./service";

export async function seedMailDemo(db: DB, now: number) {
  const k = await newDkim();
  const dom = { id: "mail-demo1", userId: "u1", domain: "novin.studio", planId: "mail-pro", mode: "live" as const, status: "active" as const, dkimSelector: k.selector, dkimPublic: k.publicKey, dkimPrivateEnc: seal(k.privateKey), returnPath: "bounces", dmarc: { ...DMARC_DEFAULT, rua: "dmarc@novin.studio" }, apiKeyHash: newApiKey().hash, apiKeyPrefix: "gm_demo000", dnsCheckedAt: new Date(now - 3600_000), createdAt: new Date(now - 40 * 86400_000) };
  const recs = recordsOf(dom);
  const at = new Date(now - 3600_000).toISOString();
  await db.insert(t.mailDomains).values({ ...dom, dnsStatus: Object.fromEntries(recs.map((r) => [r.key, { ok: true, seen: [r.value], at }])) }).onConflictDoNothing();
  await db.insert(t.mailSmtpUsers).values({ id: "smtp-demo1", domainId: dom.id, username: "novin-studio-a1b2", passwordEnc: seal(genPassword()) }).onConflictDoNothing();
  await db.insert(t.mailMailboxes).values([
    { id: "mbx-demo1", domainId: dom.id, local: "info", name: "اطلاعات", passwordHash: await hashPassword("Demo1234!"), quotaMb: 2048, usedMb: 312.4 },
    { id: "mbx-demo2", domainId: dom.id, local: "sara", name: "سارا رضایی", passwordHash: await hashPassword("Demo1234!"), quotaMb: 5120, usedMb: 1180 },
  ]).onConflictDoNothing();
  await db.insert(t.mailAliases).values({ id: "als-demo1", domainId: dom.id, local: "support", destinations: ["info@novin.studio", "sara@novin.studio"] }).onConflictDoNothing();
  await db.insert(t.mailBlocks).values({ id: "blk-demo1", domainId: dom.id, pattern: "@spam-offers.example" }).onConflictDoNothing();
  await db.insert(t.mailRules).values({ id: "rul-demo1", domainId: dom.id, field: "subject", op: "contains", value: "[newsletter]", action: "drop" }).onConflictDoNothing();

  const tags = ["welcome", "otp", "invoice", "reset-password"];
  const people = ["ali@example.com", "maryam@example.org", "bounce@example.net", "reza@example.com", "neda@example.ir", "fail@example.org"];
  const msgs: (typeof t.mailMessages.$inferInsert)[] = [];
  const evs: (typeof t.mailEvents.$inferInsert)[] = [];
  for (let i = 0; i < 48; i++) {
    const id = "msg-demo" + String(i).padStart(4, "0");
    const to = people[(i * 5) % people.length], tag = tags[i % tags.length], when = new Date(now - (i * 7 + 1) * 3600_000);
    const o = simOutcome(to);
    const subject = tag === "otp" ? "کد ورود شما" : tag === "invoice" ? "صورتحساب سفارش " + (1200 + i) : tag === "welcome" ? "به استودیو نوین خوش آمدید" : "بازیابی رمز عبور";
    const text = subject + "\n\nاین یک پیام نمونه است.";
    msgs.push({ id, domainId: dom.id, userId: "u1", direction: "out", status: o, source: i % 3 ? "api" : "smtp", from: "استودیو نوین <no-reply@novin.studio>", to: [to], recipients: 1, subject, tag, text, html: "<p>" + subject + "</p><p>این یک پیام نمونه است.</p>", raw: "From: no-reply@novin.studio\r\nTo: " + to + "\r\nSubject: " + subject + "\r\nMessage-ID: <" + id + "@novin.studio>\r\n\r\n" + text, size: 900 + i * 13, messageId: "<" + id + "@novin.studio>", createdAt: when });
    evs.push({ messageId: id, type: "queued", createdAt: when }, { messageId: id, type: "sent", recipient: to, detail: "250 2.0.0 OK", createdAt: new Date(when.getTime() + 2000) }, { messageId: id, type: o, recipient: to, detail: o === "delivered" ? "250 OK" : o === "bounced" ? "550 5.1.1 user unknown" : "421 timeout", createdAt: new Date(when.getTime() + 9000) });
  }
  const inbound = [["مریم احمدی <maryam@example.org>", "info@novin.studio", "درخواست همکاری", "سلام، درباره همکاری در پروژه جدید سؤال داشتم.", "mbx-demo1", "received", 0.4], ["Lucky Draw <win@promo.example>", "sara@novin.studio", "YOU WON THE LOTTERY JACKPOT", "Claim your free money, click here now", "mbx-demo2", "spam", 9.5], ["علی کریمی <ali@example.com>", "sara@novin.studio", "فایل‌های طراحی", "فایل‌های نهایی پیوست شد.", "mbx-demo2", "received", 0.1]] as const;
  inbound.forEach(([from, to, subject, text, box, status, score], i) => {
    const id = "msg-demoin" + i, when = new Date(now - (i * 5 + 2) * 3600_000);
    msgs.push({ id, domainId: dom.id, userId: "u1", direction: "in", status, source: "inbound", from, to: [to], recipients: 1, subject, text, raw: "From: " + from + "\r\nTo: " + to + "\r\nSubject: " + subject + "\r\n\r\n" + text, size: 1200, mailboxId: box, spamScore: score, read: i === 2, createdAt: when });
    evs.push({ messageId: id, type: "received", recipient: to, createdAt: when });
  });
  await db.insert(t.mailMessages).values(msgs).onConflictDoNothing();
  await db.insert(t.mailEvents).values(evs);
}
