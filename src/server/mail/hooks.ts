/* Calls from the mail server: the MTA hook (inbound mail and SMTP submissions, stage DATA) and
   delivery webhooks. Both authenticate with MAIL_HOOK_SECRET (Bearer, or the webhook HMAC). */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { domainOf, parseAddress } from "@/lib/mail";
import type { DB } from "../db/client";
import { mailDomains, mailEvents, mailMessages, mailPlans, mailSmtpUsers, users } from "../db/schema";
import { rid } from "../util";
import { parseMime, receiveMail, recordEvent, usageOf } from "./service";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Bearer secret, Basic with the secret as password, or X-Signature = base64(HMAC-SHA256(body)) */
export function hookAuthorized(req: Request, body: string) {
  const secret = process.env.MAIL_HOOK_SECRET;
  if (!secret || secret.length < 16) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  if (bearer && same(bearer, secret)) return true;
  const basic = /^Basic\s+(\S+)$/i.exec(auth)?.[1];
  if (basic) { const s = Buffer.from(basic, "base64").toString("utf8"); if (same(s.slice(s.indexOf(":") + 1), secret)) return true; }
  const sig = req.headers.get("x-signature");
  return !!sig && same(sig, createHmac("sha256", secret).update(body).digest("base64"));
}

type HookBody = {
  context?: { stage?: string; sasl?: { login?: string } | null };
  envelope?: { from?: { address?: string }; to?: { address?: string }[] };
  message?: { headers?: [string, string][]; contents?: string; size?: number };
};
type HookReply = { action: "accept" | "reject" | "discard" | "quarantine"; response?: { status: number; enhancedStatus: string; message: string }; modifications?: { type: string; value: string }[] };
const reject = (status: number, enhanced: string, message: string): HookReply => ({ action: "reject", response: { status, enhancedStatus: enhanced, message } });

/** Stalwart MTA hook at the DATA stage */
export async function mtaHook(db: DB, b: HookBody): Promise<HookReply> {
  const from = b.envelope?.from?.address ?? "";
  const to = (b.envelope?.to ?? []).map((t) => t.address ?? "").filter(Boolean);
  const headers = b.message?.headers ?? [];
  const contents = b.message?.contents ?? "";
  const raw = headers.length && !/^[\w-]+:/.test(contents) ? headers.map(([k, v]) => k + ":" + v).join("\r\n") + "\r\n\r\n" + contents : contents;
  const login = b.context?.sasl?.login;
  if (!login) {
    const r = await receiveMail(db, { from, to, raw });
    return r.action === "reject" ? reject(550, "5.1.1", "Recipient not found") : { action: r.action };
  }
  // our own relay (API-sent mail is already logged and counted)
  if (login === process.env.MAIL_SMTP_USER) return { action: "accept" };
  const [u] = await db.select({ s: mailSmtpUsers, d: mailDomains }).from(mailSmtpUsers).innerJoin(mailDomains, eq(mailDomains.id, mailSmtpUsers.domainId)).where(eq(mailSmtpUsers.username, login));
  if (!u) return reject(535, "5.7.8", "Unknown SMTP login");
  const dom = u.d;
  const sender = parseAddress(from)?.address ?? "";
  if (domainOf(sender) !== dom.domain && !sender.endsWith("." + dom.domain)) return reject(550, "5.7.1", "Sender must be on " + dom.domain);
  if (dom.status === "suspended") return reject(554, "5.7.1", dom.suspendReason === "credit" ? "Sending suspended: no credit" : "Sending suspended");
  if (dom.mode === "live" && dom.status !== "active") return reject(451, "4.7.1", "DNS records not verified yet");
  const [[plan], [owner], used] = await Promise.all([db.select().from(mailPlans).where(eq(mailPlans.id, dom.planId)), db.select({ balance: users.balance }).from(users).where(eq(users.id, dom.userId)), usageOf(db, dom.id)]);
  if ((owner?.balance ?? 0) <= 0) return reject(554, "5.7.1", "Sending suspended: no credit");
  if (plan && (used.today + to.length > plan.dailyLimit || used.month + to.length > plan.monthlyLimit)) return reject(452, "4.5.3", "Sending limit reached");
  const p = parseMime(raw);
  const id = rid("msg"), dev = dom.mode === "dev";
  await db.insert(mailMessages).values({ id, domainId: dom.id, userId: dom.userId, direction: "out", status: dev ? "dev" : "sent", source: "smtp", from: p.from || sender, to, recipients: to.length, subject: p.subject.slice(0, 998), tag: (p.headers.get("x-gereh-tag") ?? "").replace(/[^\w.:-]/g, "").slice(0, 64), html: p.html, text: p.text, raw, size: b.message?.size ?? Buffer.byteLength(raw), attachments: p.attachments, messageId: (p.headers.get("message-id") ?? "").slice(0, 300) });
  await db.insert(mailEvents).values([{ messageId: id, type: "queued", detail: dev ? "حالت DEV: پیام ثبت شد و ارسال نمی‌شود" : "SMTP " + login }, ...(dev ? [] : to.map((r) => ({ messageId: id, type: "sent" as const, recipient: r })))]);
  // VERP return path so bounces and delivery reports find this message
  return dev ? { action: "discard" } : { action: "accept", modifications: [{ type: "changeFrom", value: "b-" + id + "@" + dom.returnPath + "." + dom.domain }] };
}

type EventBody = { events?: { type?: string; messageId?: string; recipient?: string; detail?: string; data?: Record<string, unknown> }[] };
/** delivery webhooks: Stalwart's events, or the normalized { messageId, type, recipient, detail } */
export async function deliveryEvents(db: DB, b: EventBody) {
  let n = 0;
  for (const e of (b.events ?? []).slice(0, 500)) {
    const t = (e.type ?? "").toLowerCase();
    const type = /delivered/.test(t) ? "delivered" : /perm|bounce/.test(t) ? "bounced" : /fail|temp|error/.test(t) ? "failed" : null;
    if (!type) continue;
    const data = e.data ?? {};
    const rcpt = String(e.recipient ?? data.to ?? data.rcpt ?? data.recipient ?? "").replace(/^\[|\]$/g, "").split(",")[0].replace(/"/g, "");
    const ok = await recordEvent(db, { ref: (e.messageId ?? "") + " " + JSON.stringify(data), type, recipient: rcpt, detail: String(e.detail ?? data.details ?? data.reason ?? data.response ?? "").slice(0, 500) });
    if (ok) n++;
  }
  return n;
}
