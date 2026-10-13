/* Mail service: domains (keys, DNS records, verification), sending (limits, MIME, queue), delivery,
   inbound processing (blocklist, spam threshold, rules, routing) and billing helpers. */
import "server-only";
import { generateKeyPair, randomBytes } from "node:crypto";
import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";
import { and, asc, count, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { hourlyOf } from "@/lib/paas";
import { domainOf, MAIL_PLAN_DEFAULTS, mailRecords, MAX_ATTACHMENTS_BYTES, MAX_RECIPIENTS, parseAddress, TAG_RE, tehranPeriods, type MailRecord } from "@/lib/mail";
import type { DB, Tx } from "../db/client";
import { dnsRecords, domains, mailAliases, mailBlocks, mailDomains, mailEvents, mailMailboxes, mailMessages, mailPlans, mailRules, mailSmtpUsers, users, type MailDnsCheck } from "../db/schema";
import { enqueue } from "../jobs";
import { open } from "../secrets";
import { AppError, notify, rid, sha256 } from "../util";
import { mailDriver, mailHosts } from "./driver";

export type MailDomainRow = typeof mailDomains.$inferSelect;
export type MailMessageRow = typeof mailMessages.$inferSelect;

export const seedMailPlans = (db: DB | Tx) => db.insert(mailPlans).values(MAIL_PLAN_DEFAULTS.map((p, i) => ({ ...p, position: i }))).onConflictDoNothing();
export const mailHourly = (price: number) => hourlyOf(price);

/* ---------- keys ---------- */
export async function newDkim() {
  const { publicKey, privateKey } = await new Promise<{ publicKey: Buffer; privateKey: string }>((res, rej) =>
    generateKeyPair("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }, (e, pub, priv) => (e ? rej(e) : res({ publicKey: pub, privateKey: priv }))));
  const d = new Date();
  // selectors carry the month so a rotated key never collides with a cached old one
  return { selector: "gereh" + d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0"), publicKey: publicKey.toString("base64"), privateKey };
}
export function newApiKey() {
  const key = "gm_" + randomBytes(24).toString("base64url");
  return { key, hash: sha256(key), prefix: key.slice(0, 10) };
}
export const recordsOf = (d: Pick<MailDomainRow, "domain" | "dkimSelector" | "dkimPublic" | "returnPath" | "dmarc">) => mailRecords(d, mailHosts());

/* ---------- DNS verification ---------- */
type Resolver = { txt: (n: string) => Promise<string[][]>; mx: (n: string) => Promise<{ exchange: string; priority: number }[]>; cname: (n: string) => Promise<string[]> };
let resolver: Resolver = { txt: resolveTxt, mx: resolveMx, cname: resolveCname };
/** tests swap the DNS lookups */
export const setMailResolver = (r: Partial<Resolver>) => { resolver = { ...resolver, ...r }; };
export const resetMailResolver = () => { resolver = { txt: resolveTxt, mx: resolveMx, cname: resolveCname }; };

const host = (s: string) => s.toLowerCase().replace(/\.$/, "");
const squash = (s: string) => s.replace(/\s+/g, "").replace(/"/g, "").toLowerCase();
/** does an observed value satisfy the record? */
function matches(r: MailRecord, seen: string) {
  switch (r.key) {
    case "dkim": return squash(seen).includes("p=" + squash(r.value.split("p=")[1]));
    case "spf": return /^v=spf1\b/i.test(seen.trim()) && squash(seen).includes(squash("include:" + mailHosts().spf));
    case "returnPath": case "mx": return host(seen) === host(r.value);
    case "dmarc": return /^v=dmarc1\b/i.test(seen.trim());
  }
}
async function lookup(r: MailRecord): Promise<string[]> {
  try {
    if (r.type === "TXT") return (await resolver.txt(r.name)).map((parts) => parts.join(""));
    if (r.type === "MX") return (await resolver.mx(r.name)).map((m) => m.exchange);
    return await resolver.cname(r.name);
  } catch { return []; }
}

/** the customer's zone in Gereh DNS that holds this mail domain (exact or parent) */
export async function gerehZoneFor(db: DB | Tx, userId: string, domain: string) {
  const own = await db.select().from(domains).where(eq(domains.userId, userId));
  return own.filter((z) => domain === z.name || domain.endsWith("." + z.name)).sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}
const relName = (fqdn: string, zone: string) => (fqdn === zone ? "@" : fqdn.slice(0, -(zone.length + 1)));
const fqdnOf = (name: string, zone: string) => (name === "@" ? zone : name.replace(/\.$/, "") + "." + zone);

/** resolves every record; records already in the customer's Gereh DNS zone count as published */
export async function checkDns(db: DB, d: MailDomainRow) {
  const zone = await gerehZoneFor(db, d.userId, d.domain);
  const local = zone ? await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, zone.id)) : [];
  const at = new Date().toISOString();
  const status: Record<string, MailDnsCheck> = {};
  for (const r of recordsOf(d)) {
    const seen = await lookup(r);
    let ok = seen.some((s) => matches(r, s));
    if (!ok && zone) ok = local.some((x) => x.type === r.type && fqdnOf(x.name, zone.name) === r.name && matches(r, x.value));
    status[r.key] = { ok, seen: seen.slice(0, 5).map((s) => s.slice(0, 300)), at };
  }
  const verified = status.dkim.ok && status.spf.ok && status.returnPath.ok;
  const next = d.status === "suspended" ? "suspended" : verified ? "active" : "pending";
  await db.update(mailDomains).set({ dnsStatus: status, dnsCheckedAt: new Date(), status: next }).where(eq(mailDomains.id, d.id));
  if (d.status === "pending" && next === "active") await notify(db, d.userId, "mail", "رکوردهای DNS دامنه ایمیل " + d.domain + " تأیید شد؛ حالت LIVE در دسترس است");
  if (d.status === "active" && next === "pending") {
    await notify(db, d.userId, "circle-alert", "رکوردهای DNS ایمیل " + d.domain + " دیگر درست نیستند؛ ارسال واقعی تا اصلاح متوقف است");
  }
  return { status, verified };
}

/** writes the records into the customer's Gereh DNS zone (one SPF, one DMARC, our MX at that name) */
export async function autoDns(db: DB, d: MailDomainRow) {
  const zone = await gerehZoneFor(db, d.userId, d.domain);
  if (!zone) throw new AppError("این دامنه در DNS گره میزبانی نمی‌شود؛ رکوردها را دستی در سرویس DNS خود وارد کنید.");
  const existing = await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, zone.id));
  const drop: string[] = [];
  const add: (typeof dnsRecords.$inferInsert)[] = [];
  for (const r of recordsOf(d)) {
    const name = relName(r.name, zone.name);
    const same = existing.filter((x) => x.name === name);
    if (same.some((x) => x.type === r.type && matches(r, x.value))) continue;
    if (r.key === "spf") drop.push(...same.filter((x) => x.type === "TXT" && /^v=spf1/i.test(x.value)).map((x) => x.id));
    if (r.key === "dmarc" || r.key === "dkim") drop.push(...same.filter((x) => x.type === "TXT").map((x) => x.id));
    if (r.key === "mx") drop.push(...same.filter((x) => x.type === "MX").map((x) => x.id));
    if (r.key === "returnPath") drop.push(...same.map((x) => x.id)); // CNAME cannot sit beside anything
    add.push({ id: rid("dns"), domainId: zone.id, type: r.type, name, value: r.value, ttl: 3600, priority: r.priority ?? null });
  }
  if (drop.length) await db.delete(dnsRecords).where(inArray(dnsRecords.id, drop));
  if (add.length) await db.insert(dnsRecords).values(add);
  const { providers } = await import("../providers");
  await (await providers()).dns.sync(db, zone.id);
  return { zone: zone.name, added: add.length, replaced: drop.length };
}

/* ---------- limits ---------- */
export async function usageOf(db: DB | Tx, domainId: string) {
  const { day, month } = tehranPeriods();
  const q = (since: Date) => db.select({ n: sum(mailMessages.recipients) }).from(mailMessages).where(and(eq(mailMessages.domainId, domainId), eq(mailMessages.direction, "out"), gte(mailMessages.createdAt, since), sql`${mailMessages.status} not in ('failed')`));
  const [[d], [m]] = await Promise.all([q(day), q(month)]);
  return { today: Number(d.n ?? 0), month: Number(m.n ?? 0) };
}

/* ---------- sending ---------- */
const addrList = z.union([z.string().max(4000), z.array(z.string().max(320)).max(MAX_RECIPIENTS)]).optional();
export const sendSchema = z.object({
  from: z.string().trim().min(3).max(320),
  to: addrList, cc: addrList, bcc: addrList,
  replyTo: z.string().trim().max(320).optional(),
  subject: z.string().max(998).default(""),
  html: z.string().max(2_000_000).optional(),
  text: z.string().max(1_000_000).optional(),
  tag: z.string().trim().max(64).optional(),
  listUnsubscribe: z.string().trim().max(2000).optional(),
  headers: z.record(z.string().max(100), z.string().max(2000)).optional(),
  attachments: z.array(z.object({ filename: z.string().trim().min(1).max(255), content: z.string().max(15_000_000), contentType: z.string().max(100).optional() })).max(20).optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

const bad = (m: string, status = 400): never => { throw new AppError(m, status); };
function addresses(v: string | string[] | undefined, label: string) {
  const list = (Array.isArray(v) ? v : (v ?? "").split(/[,;\n]/)).map((s) => s.trim()).filter(Boolean);
  return list.map((s) => parseAddress(s)?.address ?? bad("نشانی «" + s.slice(0, 80) + "» در " + label + " معتبر نیست."));
}
const noBreak = (s: string) => !/[\r\n]/.test(s);

/** validates, enforces mode/status/limits, builds the MIME message and queues it; returns the message id */
export async function queueMessage(db: DB, dom: MailDomainRow, input: SendInput, source: "api" | "console") {
  const from = parseAddress(input.from) ?? bad("فرستنده (from) معتبر نیست.");
  if (domainOf(from.address) !== dom.domain) bad("فرستنده باید از دامنه " + dom.domain + " باشد.");
  const to = addresses(input.to, "to"), cc = addresses(input.cc, "cc"), bcc = addresses(input.bcc, "bcc");
  const all = [...new Set([...to, ...cc, ...bcc])];
  if (!to.length) bad("دست‌کم یک گیرنده (to) لازم است.");
  if (all.length > MAX_RECIPIENTS) bad("حداکثر " + MAX_RECIPIENTS.toLocaleString("fa-IR") + " گیرنده در هر پیام مجاز است.");
  if (!input.html && !input.text) bad("متن پیام (html یا text) خالی است.");
  const tag = input.tag?.trim() ?? "";
  if (tag && !TAG_RE.test(tag)) bad("برچسب فقط حروف انگلیسی، عدد و _ . : - تا ۶۴ نویسه.");
  const replyTo = input.replyTo ? parseAddress(input.replyTo)?.address ?? bad("reply-to معتبر نیست.") : undefined;
  if (!noBreak(input.subject)) bad("موضوع نباید چند خطی باشد.");

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (!/^(X-[A-Za-z0-9-]{1,60}|List-Unsubscribe|List-Unsubscribe-Post|List-Id)$/i.test(k) || /^X-Gereh-/i.test(k)) bad("سربرگ «" + k.slice(0, 60) + "» مجاز نیست؛ فقط X-*، List-Unsubscribe و List-Id.");
    if (!noBreak(v)) bad("مقدار سربرگ " + k + " نباید چند خطی باشد.");
    headers[k] = v;
  }
  const unsub = input.listUnsubscribe ?? Object.entries(headers).find(([k]) => k.toLowerCase() === "list-unsubscribe")?.[1];
  if (unsub !== undefined) {
    const parts = unsub.split(",").map((s) => s.trim().replace(/^<|>$/g, "")).filter(Boolean);
    if (!parts.length || !parts.every((p) => /^(https:\/\/\S+|mailto:\S+@\S+)$/i.test(p)) || !noBreak(unsub)) bad("List-Unsubscribe باید نشانی https:// یا mailto: باشد.");
    for (const k of Object.keys(headers)) if (/^list-unsubscribe/i.test(k)) delete headers[k];
    headers["List-Unsubscribe"] = parts.map((p) => "<" + p + ">").join(", ");
    if (parts.some((p) => p.startsWith("https://"))) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  let attBytes = 0;
  const atts = (input.attachments ?? []).map((a) => {
    if (!/^[A-Za-z0-9+/=\s]*$/.test(a.content)) bad("محتوای پیوست " + a.filename + " باید base64 باشد.");
    const content = Buffer.from(a.content, "base64");
    attBytes += content.length;
    return { filename: a.filename.replace(/[\\/\r\n"]/g, "_"), content, contentType: a.contentType && /^[\w.+-]+\/[\w.+-]+$/.test(a.contentType) ? a.contentType : undefined };
  });
  if (attBytes > MAX_ATTACHMENTS_BYTES) bad("حجم پیوست‌ها بیش از ۱۰ مگابایت است.", 413);

  if (dom.status === "suspended") bad(dom.suspendReason === "credit" ? "ارسال به دلیل اتمام موجودی کیف پول معلق است؛ کیف پول را شارژ کنید." : "ارسال این دامنه توسط پشتیبانی معلق شده است.", 403);
  if (dom.mode === "live" && dom.status !== "active") bad("رکوردهای DKIM، SPF و Return-Path هنوز تأیید نشده‌اند؛ تا آن زمان فقط حالت DEV در دسترس است.", 409);
  const [u] = await db.select({ balance: users.balance, status: users.status }).from(users).where(eq(users.id, dom.userId));
  if (!u || u.status === "suspended") bad("حساب کاربری معلق است.", 403);
  if (u!.balance <= 0) bad("موجودی کیف پول تمام شده و ارسال متوقف است؛ کیف پول را شارژ کنید.", 402);
  const [plan] = await db.select().from(mailPlans).where(eq(mailPlans.id, dom.planId));
  const used = await usageOf(db, dom.id);
  if (plan && used.today + all.length > plan.dailyLimit) bad("سقف ارسال روزانه پلن (" + plan.dailyLimit.toLocaleString("fa-IR") + " گیرنده) پر شده است.", 429);
  if (plan && used.month + all.length > plan.monthlyLimit) bad("سقف ارسال ماهانه پلن (" + plan.monthlyLimit.toLocaleString("fa-IR") + " گیرنده) پر شده است.", 429);

  const id = rid("msg");
  const messageId = "<" + id + "@" + dom.domain + ">";
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer");
  const raw = (await new MailComposer({
    from: from.name ? { name: from.name, address: from.address } : from.address, to, cc, bcc, replyTo, subject: input.subject, html: input.html, text: input.text,
    messageId, headers: { ...headers, "X-Gereh-Id": id }, attachments: atts, disableFileAccess: true, disableUrlAccess: true,
  }).compile().build()).toString("utf8");

  const dev = dom.mode === "dev";
  await db.transaction(async (tx) => {
    await tx.insert(mailMessages).values({
      id, domainId: dom.id, userId: dom.userId, direction: "out", status: dev ? "dev" : "queued", source, from: input.from.trim(), to, cc, bcc, recipients: all.length,
      subject: input.subject, tag, html: input.html ?? "", text: input.text ?? "", raw, size: Buffer.byteLength(raw), messageId,
      attachments: atts.map((a) => ({ name: a.filename, type: a.contentType ?? "application/octet-stream", size: a.content.length })),
    });
    await tx.insert(mailEvents).values({ messageId: id, type: "queued", detail: dev ? "حالت DEV: پیام ثبت شد و ارسال نمی‌شود" : "" });
    if (!dev) await enqueue(tx, "mail.deliver", { id });
  });
  return { id, status: dev ? "dev" : "queued" };
}

/** the simulator's outcome for a recipient: bounce@… bounces, fail@… fails, the rest arrive */
export const simOutcome = (rcpt: string): "delivered" | "bounced" | "failed" => (/^bounce/.test(rcpt) ? "bounced" : /^fail/.test(rcpt) ? "failed" : "delivered");
const finalStatus = (outcomes: string[]) => (outcomes.includes("bounced") ? "bounced" : outcomes.includes("failed") ? "failed" : outcomes.every((o) => o === "delivered") ? "delivered" : "sent");

/** worker: hands a queued message to the driver; the simulator also produces the delivery events */
export async function deliverMessage(db: DB, p: { id: string }) {
  const [m] = await db.select().from(mailMessages).where(eq(mailMessages.id, p.id));
  if (!m || m.status !== "queued") return;
  const [dom] = await db.select().from(mailDomains).where(eq(mailDomains.id, m.domainId));
  if (!dom) return;
  if (dom.status === "suspended") {
    await db.update(mailMessages).set({ status: "failed", error: "ارسال دامنه معلق است" }).where(eq(mailMessages.id, m.id));
    await db.insert(mailEvents).values({ messageId: m.id, type: "failed", detail: "ارسال دامنه معلق است" });
    return;
  }
  const rcpts = [...new Set([...m.to, ...m.cc, ...m.bcc])];
  const d = mailDriver();
  let res;
  try {
    res = await d.send({ id: m.id, domain: dom.domain, envelopeFrom: "b-" + m.id + "@" + dom.returnPath + "." + dom.domain, recipients: rcpts, raw: m.raw, dkim: { selector: dom.dkimSelector, privateKey: open(dom.dkimPrivateEnc) ?? "" } });
  } catch (e) {
    await db.update(mailMessages).set({ error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).where(eq(mailMessages.id, m.id));
    throw e; // the queue retries with backoff
  }
  const events: (typeof mailEvents.$inferInsert)[] = [];
  const outcomes: string[] = [];
  for (const r of res.accepted) events.push({ messageId: m.id, type: "sent", recipient: r, detail: res.response.slice(0, 300) });
  for (const r of res.rejected) { events.push({ messageId: m.id, type: "failed", recipient: r, detail: "رد شد توسط سرور" }); outcomes.push("failed"); }
  if (d.name === "simulator") {
    for (const r of res.accepted) {
      const o = simOutcome(r);
      outcomes.push(o);
      events.push({ messageId: m.id, type: o, recipient: r, detail: o === "bounced" ? "550 5.1.1 mailbox does not exist (شبیه‌سازی)" : o === "failed" ? "421 connection timed out (شبیه‌سازی)" : "250 OK (شبیه‌سازی)" });
    }
  } else outcomes.push(...res.accepted.map(() => "sent"));
  if (events.length) await db.insert(mailEvents).values(events);
  await db.update(mailMessages).set({ status: finalStatus(outcomes), error: "" }).where(eq(mailMessages.id, m.id));
}

/** a delivery event reported by the mail server (webhook); the message is found by its VERP return path or id */
export async function recordEvent(db: DB, e: { ref: string; type: "delivered" | "bounced" | "failed"; recipient: string; detail: string }) {
  const id = /\bb-(msg-[a-z0-9]+)@/i.exec(e.ref)?.[1] ?? /(msg-[a-z0-9]{8})/.exec(e.ref)?.[1];
  if (!id) return false;
  const [m] = await db.select().from(mailMessages).where(eq(mailMessages.id, id.toLowerCase()));
  if (!m || m.direction !== "out") return false;
  await db.insert(mailEvents).values({ messageId: m.id, type: e.type, recipient: e.recipient.slice(0, 320), detail: e.detail.slice(0, 500) });
  const evs = await db.select().from(mailEvents).where(eq(mailEvents.messageId, m.id));
  const rcpts = [...new Set([...m.to, ...m.cc, ...m.bcc])];
  const last = rcpts.map((r) => evs.filter((x) => x.recipient === r && ["delivered", "bounced", "failed"].includes(x.type)).pop()?.type ?? "sent");
  await db.update(mailMessages).set({ status: finalStatus(last) }).where(eq(mailMessages.id, m.id));
  return true;
}

/* ---------- inbound ---------- */
export type ParsedMail = { headers: Map<string, string>; subject: string; from: string; to: string[]; text: string; html: string; attachments: { name: string; type: string; size: number }[] };

function decodeWords(s: string) {
  return s.replace(/=\?([\w-]+)\?([bq])\?([^?]*)\?=/gi, (_, cs: string, enc: string, data: string) => {
    try {
      const buf = enc.toLowerCase() === "b" ? Buffer.from(data, "base64") : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return new TextDecoder(/utf-?8/i.test(cs) ? "utf-8" : cs).decode(buf);
    } catch { return data; }
  });
}
function splitHead(raw: string) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = i < 0 ? raw : raw.slice(0, i), body = i < 0 ? "" : raw.slice(i).replace(/^\r?\n\r?\n/, "");
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const c = line.indexOf(":");
    if (c > 0) { const k = line.slice(0, c).trim().toLowerCase(); if (!headers.has(k)) headers.set(k, line.slice(c + 1).trim()); }
  }
  return { headers, body };
}
function decodeBody(body: string, cte: string, ctype: string) {
  const charset = /charset="?([\w-]+)"?/i.exec(ctype)?.[1] ?? "utf-8";
  let buf: Buffer;
  if (/base64/i.test(cte)) buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
  else if (/quoted-printable/i.test(cte)) buf = Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
  else buf = Buffer.from(body, "utf8");
  try { return new TextDecoder(charset).decode(buf); } catch { return buf.toString("utf8"); }
}
/** enough MIME to show a received message: headers, text and html parts, attachment names */
export function parseMime(raw: string): ParsedMail {
  const { headers, body } = splitHead(raw);
  const out: ParsedMail = { headers, subject: decodeWords(headers.get("subject") ?? ""), from: decodeWords(headers.get("from") ?? ""), to: (headers.get("to") ?? "").split(",").map((s) => parseAddress(decodeWords(s))?.address ?? "").filter(Boolean), text: "", html: "", attachments: [] };
  const walk = (h: Map<string, string>, b: string, depth: number) => {
    const ct = h.get("content-type") ?? "text/plain";
    const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
    if (/^multipart\//i.test(ct) && boundary && depth < 5) {
      for (const part of b.split("--" + boundary).slice(1)) {
        if (part.startsWith("--")) break;
        const p = splitHead(part.replace(/^\r?\n/, ""));
        walk(p.headers, p.body, depth + 1);
      }
      return;
    }
    const disp = h.get("content-disposition") ?? "";
    const name = /(?:file)?name\*?="?([^";]+)"?/i.exec(disp + ";" + ct)?.[1];
    if (/attachment/i.test(disp) || (name && !/^text\//i.test(ct))) { out.attachments.push({ name: decodeWords(name ?? "attachment"), type: ct.split(";")[0].trim(), size: Math.round(b.replace(/\s+/g, "").length * (/base64/i.test(h.get("content-transfer-encoding") ?? "") ? 0.75 : 1)) }); return; }
    if (/^text\/html/i.test(ct) && !out.html) out.html = decodeBody(b, h.get("content-transfer-encoding") ?? "", ct);
    else if (/^text\/plain/i.test(ct) && !out.text) out.text = decodeBody(b, h.get("content-transfer-encoding") ?? "", ct);
  };
  walk(headers, body, 0);
  return out;
}

const SPAMMY = [/viagra/i, /lottery|jackpot/i, /bitcoin.*(double|giveaway)/i, /قرعه[‌ ]?کشی/, /برنده.*(جایزه|میلیون)/, /\bfree money\b/i, /click here now/i];
/** server-provided score when the MTA has one; otherwise a small heuristic (simulator) */
export function spamScore(p: ParsedMail, given?: number | null) {
  if (typeof given === "number" && Number.isFinite(given)) return given;
  const h = Number(p.headers.get("x-spam-score") ?? NaN);
  if (Number.isFinite(h)) return h;
  const body = p.subject + " " + p.text + " " + p.html;
  let s = SPAMMY.reduce((n, re) => n + (re.test(body) ? 2.5 : 0), 0);
  if (p.subject.length > 8 && p.subject === p.subject.toUpperCase() && /[A-Z]/.test(p.subject)) s += 1.5;
  return Math.round(s * 10) / 10;
}

const ruleHit = (r: typeof mailRules.$inferSelect, v: { from: string; to: string; subject: string }) => {
  const hay = v[r.field].toLowerCase(), needle = r.value.toLowerCase();
  return r.op === "equals" ? hay === needle : r.op === "ends" ? hay.endsWith(needle) : hay.includes(needle);
};
export const blocked = (pattern: string, sender: string) => (pattern.startsWith("@") ? sender.endsWith(pattern) || sender.endsWith("." + pattern.slice(1)) : sender === pattern);

export type InboundResult = { action: "accept" | "discard" | "reject" | "quarantine"; id?: string; reason?: string };
/** inbound mail for a hosted domain: blocklist → rules → spam threshold → mailbox / alias / catch-all */
export async function receiveMail(db: DB, m: { from: string; to: string[]; raw: string; spamScore?: number | null }): Promise<InboundResult> {
  const p = parseMime(m.raw);
  const sender = (parseAddress(m.from)?.address ?? parseAddress(p.from)?.address ?? "").toLowerCase();
  const rcpts = m.to.map((t) => parseAddress(t)?.address).filter((x): x is string => !!x);
  const doms = rcpts.length ? await db.select().from(mailDomains).where(inArray(mailDomains.domain, [...new Set(rcpts.map(domainOf))])) : [];
  const dom = doms[0];
  if (!dom) return { action: "reject", reason: "relay not permitted" };
  const mine = rcpts.filter((r) => domainOf(r) === dom.domain);
  const id = rid("msg");
  const base = { id, domainId: dom.id, userId: dom.userId, direction: "in" as const, source: "inbound" as const, from: p.from || sender, to: mine, recipients: mine.length, subject: p.subject.slice(0, 998), html: p.html.slice(0, 2_000_000), text: p.text.slice(0, 1_000_000), raw: m.raw.slice(0, 15_000_000), size: Buffer.byteLength(m.raw), attachments: p.attachments, messageId: (p.headers.get("message-id") ?? "").slice(0, 300) };
  const log = async (status: MailMessageRow["status"], ev: (typeof mailEvents.$inferInsert)[], extra: Partial<typeof mailMessages.$inferInsert> = {}) => {
    await db.insert(mailMessages).values({ ...base, status, ...extra });
    if (ev.length) await db.insert(mailEvents).values(ev);
  };
  const [blocks, rules] = await Promise.all([
    db.select().from(mailBlocks).where(eq(mailBlocks.domainId, dom.id)),
    db.select().from(mailRules).where(eq(mailRules.domainId, dom.id)).orderBy(asc(mailRules.position)),
  ]);
  const hit = blocks.find((b) => blocked(b.pattern, sender));
  if (hit) { await log("dropped", [{ messageId: id, type: "dropped", detail: "فرستنده در فهرست مسدود: " + hit.pattern }]); return { action: "discard", id, reason: "blocked" }; }
  const score = spamScore(p, m.spamScore);
  const rule = rules.find((r) => ruleHit(r, { from: sender, to: mine.join(","), subject: p.subject }));
  if (rule?.action === "drop") { await log("dropped", [{ messageId: id, type: "dropped", detail: "قانون: " + rule.field + " " + rule.op + " «" + rule.value + "»" }], { spamScore: score }); return { action: "discard", id, reason: "rule" }; }
  if (score >= dom.spamThreshold) { await log("spam", [{ messageId: id, type: "received", detail: "امتیاز هرزنامه " + score + " ≥ " + dom.spamThreshold }], { spamScore: score }); return { action: "quarantine", id, reason: "spam" }; }

  const [boxes, aliases] = await Promise.all([db.select().from(mailMailboxes).where(eq(mailMailboxes.domainId, dom.id)), db.select().from(mailAliases).where(eq(mailAliases.domainId, dom.id))]);
  const events: (typeof mailEvents.$inferInsert)[] = [];
  let mailboxId: string | null = null;
  for (const r of mine) {
    const local = r.slice(0, r.lastIndexOf("@"));
    const box = boxes.find((b) => b.local === local && b.active);
    const alias = aliases.find((a) => a.local === local);
    if (box) { mailboxId ??= box.id; events.push({ messageId: id, type: "received", recipient: r, detail: "صندوق " + r }); }
    else if (alias) events.push({ messageId: id, type: "forwarded", recipient: r, detail: "به " + alias.destinations.join("، ") });
    else if (dom.catchAll) events.push({ messageId: id, type: "forwarded", recipient: r, detail: "catch-all به " + dom.catchAll });
  }
  if (rule?.action === "forward") events.push({ messageId: id, type: "forwarded", recipient: rule.target, detail: "قانون هدایت" });
  if (!events.length) { await log("rejected", [{ messageId: id, type: "dropped", detail: "گیرنده وجود ندارد" }], { spamScore: score }); return { action: "reject", id, reason: "no such user" }; }
  await log("received", events, { spamScore: score, mailboxId });
  return { action: "accept", id };
}

/* ---------- stats ---------- */
export async function domainCounts(db: DB, ids: string[]) {
  if (!ids.length) return new Map<string, { mailboxes: number; smtp: number }>();
  const [b, s] = await Promise.all([
    db.select({ id: mailMailboxes.domainId, n: count() }).from(mailMailboxes).where(inArray(mailMailboxes.domainId, ids)).groupBy(mailMailboxes.domainId),
    db.select({ id: mailSmtpUsers.domainId, n: count() }).from(mailSmtpUsers).where(inArray(mailSmtpUsers.domainId, ids)).groupBy(mailSmtpUsers.domainId),
  ]);
  return new Map(ids.map((id) => [id, { mailboxes: b.find((x) => x.id === id)?.n ?? 0, smtp: s.find((x) => x.id === id)?.n ?? 0 }]));
}
