import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { faDate, faDateTime } from "@/lib/jalali";
import { DOMAIN_RE } from "@/lib/geo";
import { DMARC_DEFAULT, EMAIL_ADDR_RE, LOCAL_RE, LOG_DAYS, parseAddress } from "@/lib/mail";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { mailAliases, mailBlocks, mailDomains, mailEvents, mailMailboxes, mailMessages, mailPlans, mailRules, mailSmtpUsers, users } from "../db/schema";
import { enqueue } from "../jobs";
import { mailDriver, mailHosts } from "../mail/driver";
import { autoDns, checkDns, domainCounts, gerehZoneFor, mailHourly, newApiKey, newDkim, queueMessage, receiveMail, recordsOf, sendSchema, usageOf, type MailDomainRow } from "../mail/service";
import { hashPassword } from "../password";
import { open, seal } from "../secrets";
import { fail, genPassword, logActivity, logAudit, notify, randomSecret, rid } from "../util";

const id = z.string().max(40);

async function ownDomain(ctx: Ctx, domainId: string) {
  const a = needUser(ctx);
  const [d] = await ctx.db.select().from(mailDomains).where(and(eq(mailDomains.id, domainId), eq(mailDomains.userId, a.uid)));
  if (!d) fail("دامنه ایمیل پیدا نشد.", 404);
  return { a, d: d! };
}
async function planOf(ctx: Ctx, planId: string) {
  const [p] = await ctx.db.select().from(mailPlans).where(eq(mailPlans.id, planId));
  if (!p || !p.active) fail("این پلن در دسترس نیست.");
  return p!;
}
/** starting or growing the service needs 24 hours of its cost in the wallet */
async function needCredit(ctx: Ctx, uid: string, monthly: number) {
  const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
  const need = 24 * mailHourly(monthly);
  if ((u?.balance ?? 0) < need) fail("موجودی کیف پول کافی نیست؛ برای شروع دست‌کم " + need.toLocaleString("fa-IR") + " تومان (هزینه ۲۴ ساعت) لازم است.", 402);
}
function checkPassword(p: string) {
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) fail("رمز دست‌کم ۸ نویسه و شامل حرف و عدد باشد.");
}
const addr = (d: MailDomainRow, local: string) => local + "@" + d.domain;
function destinations(list: string[]) {
  const out = [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!out.length) fail("دست‌کم یک مقصد وارد کنید.");
  for (const x of out) if (!EMAIL_ADDR_RE.test(x)) fail("نشانی «" + x.slice(0, 80) + "» معتبر نیست.");
  return out;
}
const dmarcSchema = z.object({ p: z.enum(["none", "quarantine", "reject"]), pct: z.number().int().min(1).max(100), rua: z.string().trim().toLowerCase().max(254), adkim: z.enum(["r", "s"]), aspf: z.enum(["r", "s"]) });

function domainView(d: MailDomainRow) {
  return { id: d.id, domain: d.domain, planId: d.planId, mode: d.mode, status: d.status, suspendReason: d.suspendReason, apiKeyPrefix: d.apiKeyPrefix, dkimSelector: d.dkimSelector, returnPath: d.returnPath, dmarc: d.dmarc, catchAll: d.catchAll, spamThreshold: d.spamThreshold, dnsChecked: d.dnsCheckedAt ? faDateTime(d.dnsCheckedAt) : "", created: faDate(d.createdAt) };
}
const planView = (p: typeof mailPlans.$inferSelect) => ({ id: p.id, name: p.name, price: p.price, dailyLimit: p.dailyLimit, monthlyLimit: p.monthlyLimit, mailboxes: p.mailboxes, quotaMb: p.quotaMb, active: p.active });

export const mailRpc = {
  /* ---------- reads ---------- */
  "mail.overview": method(z.tuple([]), async (ctx) => {
    const a = needUser(ctx);
    const [plans, doms] = await Promise.all([
      ctx.db.select().from(mailPlans).orderBy(asc(mailPlans.position)),
      ctx.db.select().from(mailDomains).where(eq(mailDomains.userId, a.uid)).orderBy(desc(mailDomains.createdAt)),
    ]);
    const counts = await domainCounts(ctx.db, doms.map((d) => d.id));
    const domains = [];
    for (const d of doms) domains.push({ ...domainView(d), ...counts.get(d.id)!, usage: await usageOf(ctx.db, d.id) });
    const h = mailHosts();
    return { plans: plans.filter((p) => p.active).map(planView), domains, hosts: { imap: h.imap, smtp: h.smtp }, driver: mailDriver().name };
  }),

  "mail.domain": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { d } = await ownDomain(ctx, domainId);
    const [[plan], smtp, boxes, aliases, rules, blocks, usage, zone] = await Promise.all([
      ctx.db.select().from(mailPlans).where(eq(mailPlans.id, d.planId)),
      ctx.db.select().from(mailSmtpUsers).where(eq(mailSmtpUsers.domainId, d.id)).orderBy(asc(mailSmtpUsers.createdAt)),
      ctx.db.select().from(mailMailboxes).where(eq(mailMailboxes.domainId, d.id)).orderBy(asc(mailMailboxes.local)),
      ctx.db.select().from(mailAliases).where(eq(mailAliases.domainId, d.id)).orderBy(asc(mailAliases.local)),
      ctx.db.select().from(mailRules).where(eq(mailRules.domainId, d.id)).orderBy(asc(mailRules.position)),
      ctx.db.select().from(mailBlocks).where(eq(mailBlocks.domainId, d.id)).orderBy(asc(mailBlocks.pattern)),
      usageOf(ctx.db, d.id),
      gerehZoneFor(ctx.db, d.userId, d.domain),
    ]);
    const unread = await ctx.db.select({ box: mailMessages.mailboxId, n: count() }).from(mailMessages).where(and(eq(mailMessages.domainId, d.id), eq(mailMessages.direction, "in"), eq(mailMessages.read, false), eq(mailMessages.status, "received"))).groupBy(mailMessages.mailboxId);
    const h = mailHosts();
    return {
      ...domainView(d), plan: plan ? planView(plan) : null, usage, gerehZone: zone?.name ?? "",
      records: recordsOf(d).map((r) => ({ ...r, ok: d.dnsStatus[r.key]?.ok ?? false, seen: d.dnsStatus[r.key]?.seen ?? [] })),
      smtp: smtp.map((s) => ({ id: s.id, username: s.username, created: faDate(s.createdAt) })),
      mailboxes: boxes.map((b) => ({ id: b.id, local: b.local, address: addr(d, b.local), name: b.name, quotaMb: b.quotaMb, usedMb: b.usedMb, active: b.active, unread: unread.find((u) => u.box === b.id)?.n ?? 0, created: faDate(b.createdAt) })),
      aliases: aliases.map((x) => ({ id: x.id, local: x.local, address: addr(d, x.local), destinations: x.destinations })),
      rules: rules.map((r) => ({ id: r.id, field: r.field, op: r.op, value: r.value, action: r.action, target: r.target })),
      blocks: blocks.map((b) => ({ id: b.id, pattern: b.pattern })),
      hosts: { imap: h.imap, smtp: h.smtp, mx: h.mx },
      apiUrl: (process.env.NEXT_PUBLIC_SITE_URL || "https://gereh.net").replace(/\/$/, "") + "/api/mail/v1/send",
      simulator: mailDriver().name === "simulator",
    };
  }),

  "mail.messages": method(z.tuple([id, z.object({ direction: z.enum(["out", "in"]), status: z.string().max(20).optional(), tag: z.string().max(64).optional(), q: z.string().trim().max(120).optional(), mailboxId: z.string().max(40).optional(), offset: z.number().int().min(0).max(100_000).default(0) })]), async (ctx, [domainId, f]) => {
    const { d } = await ownDomain(ctx, domainId);
    const like = f.q ? "%" + f.q.replace(/[%_\\]/g, (c) => "\\" + c) + "%" : "";
    const where = and(
      eq(mailMessages.domainId, d.id), eq(mailMessages.direction, f.direction),
      f.status ? eq(mailMessages.status, f.status as "sent") : undefined,
      f.tag ? eq(mailMessages.tag, f.tag) : undefined,
      f.mailboxId ? eq(mailMessages.mailboxId, f.mailboxId) : undefined,
      like ? or(ilike(mailMessages.subject, like), ilike(mailMessages.from, like), sql`${mailMessages.to}::text ilike ${like}`) : undefined,
    );
    const [rows, [{ n }]] = await Promise.all([
      ctx.db.select({ id: mailMessages.id, status: mailMessages.status, source: mailMessages.source, from: mailMessages.from, to: mailMessages.to, subject: mailMessages.subject, tag: mailMessages.tag, size: mailMessages.size, read: mailMessages.read, spamScore: mailMessages.spamScore, attachments: mailMessages.attachments, createdAt: mailMessages.createdAt })
        .from(mailMessages).where(where).orderBy(desc(mailMessages.createdAt)).limit(50).offset(f.offset),
      ctx.db.select({ n: count() }).from(mailMessages).where(where),
    ]);
    return { total: n, rows: rows.map((r) => ({ ...r, attachments: r.attachments.length, at: faDateTime(r.createdAt), createdAt: undefined })) };
  }),

  "mail.message": method(z.tuple([id, id]), async (ctx, [domainId, msgId]) => {
    const { d } = await ownDomain(ctx, domainId);
    const [m] = await ctx.db.select().from(mailMessages).where(and(eq(mailMessages.id, msgId), eq(mailMessages.domainId, d.id)));
    if (!m) fail("پیام پیدا نشد.", 404);
    const events = await ctx.db.select().from(mailEvents).where(eq(mailEvents.messageId, m!.id)).orderBy(asc(mailEvents.id));
    if (m!.direction === "in" && !m!.read) await ctx.db.update(mailMessages).set({ read: true }).where(eq(mailMessages.id, m!.id));
    const LIMIT = 256 * 1024;
    return {
      id: m!.id, direction: m!.direction, status: m!.status, source: m!.source, from: m!.from, to: m!.to, cc: m!.cc, bcc: m!.bcc, subject: m!.subject, tag: m!.tag, html: m!.html, text: m!.text,
      raw: m!.raw.length > LIMIT ? m!.raw.slice(0, LIMIT) + "\n\n[… " + (m!.raw.length - LIMIT).toLocaleString("fa-IR") + " نویسه دیگر نمایش داده نشد]" : m!.raw,
      size: m!.size, attachments: m!.attachments, messageId: m!.messageId, spamScore: m!.spamScore, error: m!.error, at: faDateTime(m!.createdAt),
      events: events.map((e) => ({ id: e.id, type: e.type, recipient: e.recipient, detail: e.detail, at: faDateTime(e.createdAt) })),
    };
  }),

  /** daily counts for the last 90 days (Tehran days) and per-tag totals */
  "mail.stats": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { d } = await ownDomain(ctx, domainId);
    const since = new Date(Date.now() - LOG_DAYS * 86400_000);
    const day = sql<string>`to_char(${mailMessages.createdAt} at time zone 'Asia/Tehran', 'YYYY-MM-DD')`;
    const scope = and(eq(mailMessages.domainId, d.id), gte(mailMessages.createdAt, since));
    // messages count recipients; outcomes count per-recipient delivery events
    const [msgs, evs] = await Promise.all([
      ctx.db.select({ day, tag: mailMessages.tag, direction: mailMessages.direction, dev: sql<boolean>`${mailMessages.status} = 'dev'`, n: sql<number>`sum(${mailMessages.recipients})::int` }).from(mailMessages).where(scope).groupBy(day, mailMessages.tag, mailMessages.direction, sql`${mailMessages.status} = 'dev'`),
      ctx.db.select({ day, tag: mailMessages.tag, type: mailEvents.type, n: sql<number>`count(*)::int` }).from(mailEvents).innerJoin(mailMessages, eq(mailMessages.id, mailEvents.messageId))
        .where(and(scope, eq(mailMessages.direction, "out"), inArray(mailEvents.type, ["delivered", "bounced", "failed"]))).groupBy(day, mailMessages.tag, mailEvents.type),
    ]);
    const outcome = (rows: typeof evs, type: string) => rows.filter((r) => r.type === type).reduce((t, r) => t + r.n, 0);
    const days: { date: string; sent: number; delivered: number; bounced: number; failed: number; received: number }[] = [];
    const off = 3.5 * 3600_000;
    for (let i = LOG_DAYS - 1; i >= 0; i--) {
      const date = new Date(Date.now() + off - i * 86400_000).toISOString().slice(0, 10);
      const m = msgs.filter((r) => r.day === date), e = evs.filter((r) => r.day === date);
      days.push({ date, sent: m.filter((r) => r.direction === "out" && !r.dev).reduce((t, r) => t + r.n, 0), delivered: outcome(e, "delivered"), bounced: outcome(e, "bounced"), failed: outcome(e, "failed"), received: m.filter((r) => r.direction === "in").reduce((t, r) => t + r.n, 0) });
    }
    const tags = [...new Set(msgs.filter((r) => r.direction === "out").map((r) => r.tag))].map((tag) => {
      const m = msgs.filter((r) => r.direction === "out" && r.tag === tag), e = evs.filter((r) => r.tag === tag);
      return { tag, total: m.reduce((t, r) => t + r.n, 0), delivered: outcome(e, "delivered"), bounced: outcome(e, "bounced"), failed: outcome(e, "failed"), dev: m.filter((r) => r.dev).reduce((t, r) => t + r.n, 0) };
    }).sort((a, b) => b.total - a.total);
    return { days, tags };
  }),

  "mail.smtpReveal": method(z.tuple([id, id]), async (ctx, [domainId, smtpId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const [s] = await ctx.db.select().from(mailSmtpUsers).where(and(eq(mailSmtpUsers.id, smtpId), eq(mailSmtpUsers.domainId, d.id)));
    if (!s) fail("کاربر SMTP پیدا نشد.", 404);
    await logActivity(ctx.db, a.uid, "eye", "نمایش رمز SMTP " + s!.username, ctx.ip);
    return open(s!.passwordEnc) ?? "";
  }),

  /* ---------- domains ---------- */
  "mail.create": method(z.tuple([z.object({ domain: z.string().trim().toLowerCase().max(253), planId: id })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    const domain = i.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
    if (!DOMAIN_RE.test(domain)) fail("نام دامنه معتبر نیست (مثل example.ir یا mail.example.ir).");
    if (/(^|\.)gereh\.(net|dev)$/.test(domain)) fail("این دامنه متعلق به گره است.");
    const [taken] = await ctx.db.select({ id: mailDomains.id }).from(mailDomains).where(eq(mailDomains.domain, domain));
    if (taken) fail("این دامنه قبلاً در سرویس ایمیل ثبت شده است.");
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailDomains).where(eq(mailDomains.userId, a.uid));
    if (n >= 20) fail("حداکثر ۲۰ دامنه ایمیل در هر حساب؛ برای بیشتر با پشتیبانی تماس بگیرید.");
    const plan = await planOf(ctx, i.planId);
    await needCredit(ctx, a.uid, plan.price);
    const dkim = await newDkim(), key = newApiKey();
    const did = rid("mail");
    await mailDriver().addDomain(domain);
    await ctx.db.insert(mailDomains).values({ id: did, userId: a.uid, domain, planId: plan.id, dkimSelector: dkim.selector, dkimPublic: dkim.publicKey, dkimPrivateEnc: seal(dkim.privateKey), dmarc: DMARC_DEFAULT, apiKeyHash: key.hash, apiKeyPrefix: key.prefix });
    await enqueue(ctx.db, "mail.dns", { domainId: did }, { runAt: new Date(Date.now() + 60_000) });
    await logActivity(ctx.db, a.uid, "mail", "افزودن دامنه ایمیل " + domain, ctx.ip);
    return { id: did, apiKey: key.key };
  }),

  "mail.remove": method(z.tuple([id, z.string().max(253)]), async (ctx, [domainId, confirm]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    if (confirm.trim().toLowerCase() !== d.domain) fail("برای حذف، نام دامنه را دقیق بنویسید.");
    const drv = mailDriver();
    for (const s of await ctx.db.select().from(mailSmtpUsers).where(eq(mailSmtpUsers.domainId, d.id))) await drv.removeSmtpUser(s.username);
    await drv.removeDomain(d.domain);
    await ctx.db.delete(mailDomains).where(eq(mailDomains.id, d.id));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف دامنه ایمیل " + d.domain, ctx.ip);
  }),

  "mail.setMode": method(z.tuple([id, z.enum(["dev", "live"])]), async (ctx, [domainId, mode]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    if (mode === "live" && d.status !== "active") fail(d.status === "suspended" ? "دامنه معلق است." : "برای حالت LIVE ابتدا رکوردهای DKIM، SPF و Return-Path را ثبت و تأیید کنید.");
    await ctx.db.update(mailDomains).set({ mode }).where(eq(mailDomains.id, d.id));
    await logActivity(ctx.db, a.uid, "mail", "حالت " + mode.toUpperCase() + " برای ایمیل " + d.domain, ctx.ip);
  }),

  "mail.setPlan": method(z.tuple([id, id]), async (ctx, [domainId, planId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    if (d.planId === planId) return;
    const [cur] = await ctx.db.select().from(mailPlans).where(eq(mailPlans.id, d.planId));
    const next = await planOf(ctx, planId);
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailMailboxes).where(eq(mailMailboxes.domainId, d.id));
    if (n > next.mailboxes) fail("این دامنه " + n.toLocaleString("fa-IR") + " صندوق دارد و پلن " + next.name + " حداکثر " + next.mailboxes.toLocaleString("fa-IR") + "؛ ابتدا صندوق‌های اضافه را حذف کنید.");
    const [{ big }] = await ctx.db.select({ big: count() }).from(mailMailboxes).where(and(eq(mailMailboxes.domainId, d.id), sql`${mailMailboxes.quotaMb} > ${next.quotaMb}`));
    if (big) fail("فضای برخی صندوق‌ها از سقف پلن " + next.name + " بیشتر است؛ ابتدا فضای آن‌ها را کم کنید.");
    if (next.price > (cur?.price ?? 0)) await needCredit(ctx, a.uid, next.price);
    await ctx.db.update(mailDomains).set({ planId: next.id }).where(eq(mailDomains.id, d.id));
    await logActivity(ctx.db, a.uid, "gauge", "تغییر پلن ایمیل " + d.domain + " به " + next.name, ctx.ip);
  }),

  "mail.checkDns": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { d } = await ownDomain(ctx, domainId);
    const r = await checkDns(ctx.db, d);
    return { verified: r.verified, ok: Object.fromEntries(Object.entries(r.status).map(([k, v]) => [k, v.ok])) };
  }),

  "mail.autoDns": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const r = await autoDns(ctx.db, d);
    await logActivity(ctx.db, a.uid, "globe", "ثبت خودکار رکوردهای ایمیل " + d.domain + " در DNS " + r.zone, ctx.ip);
    const c = await checkDns(ctx.db, d);
    return { ...r, verified: c.verified };
  }),

  "mail.setDmarc": method(z.tuple([id, dmarcSchema]), async (ctx, [domainId, dm]) => {
    const { d } = await ownDomain(ctx, domainId);
    if (dm.rua && !EMAIL_ADDR_RE.test(dm.rua)) fail("نشانی گزارش DMARC (rua) معتبر نیست.");
    await ctx.db.update(mailDomains).set({ dmarc: dm, dnsStatus: { ...d.dnsStatus, dmarc: { ok: false, seen: [], at: new Date().toISOString() } } }).where(eq(mailDomains.id, d.id));
  }),

  "mail.rotateKey": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const key = newApiKey();
    await ctx.db.update(mailDomains).set({ apiKeyHash: key.hash, apiKeyPrefix: key.prefix }).where(eq(mailDomains.id, d.id));
    await logActivity(ctx.db, a.uid, "key-round", "کلید API تازه برای ایمیل " + d.domain, ctx.ip);
    return key.key;
  }),

  /** new DKIM key under a new selector; LIVE sending pauses until the new record is published */
  "mail.rotateDkim": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const k = await newDkim();
    const selector = k.selector === d.dkimSelector ? k.selector + "b" : k.selector;
    await ctx.db.update(mailDomains).set({ dkimSelector: selector, dkimPublic: k.publicKey, dkimPrivateEnc: seal(k.privateKey), status: d.status === "suspended" ? "suspended" : "pending", mode: "dev", dnsStatus: { ...d.dnsStatus, dkim: { ok: false, seen: [], at: new Date().toISOString() } } }).where(eq(mailDomains.id, d.id));
    await logActivity(ctx.db, a.uid, "key-round", "کلید DKIM تازه برای " + d.domain, ctx.ip);
  }),

  /* ---------- SMTP users ---------- */
  "mail.smtpCreate": method(z.tuple([id]), async (ctx, [domainId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailSmtpUsers).where(eq(mailSmtpUsers.domainId, d.id));
    if (n >= 10) fail("حداکثر ۱۰ کاربر SMTP برای هر دامنه.");
    const username = d.domain.replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + randomSecret(6, "abcdefghjkmnpqrstuvwxyz23456789");
    const password = genPassword().replace(/[!@#%]/g, "x") + randomSecret(8, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789");
    await mailDriver().setSmtpUser({ username, password, domain: d.domain });
    await ctx.db.insert(mailSmtpUsers).values({ id: rid("smtp"), domainId: d.id, username, passwordEnc: seal(password) });
    await logActivity(ctx.db, a.uid, "key-round", "کاربر SMTP " + username + " برای " + d.domain, ctx.ip);
    return { username, password };
  }),
  "mail.smtpRegenerate": method(z.tuple([id, id]), async (ctx, [domainId, smtpId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const [s] = await ctx.db.select().from(mailSmtpUsers).where(and(eq(mailSmtpUsers.id, smtpId), eq(mailSmtpUsers.domainId, d.id)));
    if (!s) fail("کاربر SMTP پیدا نشد.", 404);
    const password = genPassword().replace(/[!@#%]/g, "x") + randomSecret(8, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789");
    await mailDriver().setSmtpUser({ username: s!.username, password, domain: d.domain });
    await ctx.db.update(mailSmtpUsers).set({ passwordEnc: seal(password) }).where(eq(mailSmtpUsers.id, s!.id));
    await logActivity(ctx.db, a.uid, "key-round", "رمز تازه برای SMTP " + s!.username, ctx.ip);
    return password;
  }),
  "mail.smtpRemove": method(z.tuple([id, id]), async (ctx, [domainId, smtpId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const [s] = await ctx.db.delete(mailSmtpUsers).where(and(eq(mailSmtpUsers.id, smtpId), eq(mailSmtpUsers.domainId, d.id))).returning();
    if (!s) fail("کاربر SMTP پیدا نشد.", 404);
    await mailDriver().removeSmtpUser(s!.username);
    await logActivity(ctx.db, a.uid, "trash-2", "حذف کاربر SMTP " + s!.username, ctx.ip);
  }),

  /* ---------- mailboxes, aliases, catch-all ---------- */
  "mail.mailboxCreate": method(z.tuple([id, z.object({ local: z.string().trim().toLowerCase().max(64), name: z.string().trim().max(80).default(""), password: z.string().max(128), quotaMb: z.number().int().min(100).max(1_048_576) })]), async (ctx, [domainId, i]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    if (!LOCAL_RE.test(i.local)) fail("نام صندوق فقط حروف کوچک انگلیسی، عدد و . _ + - (مثل info یا sara.k).");
    checkPassword(i.password);
    const [plan] = await ctx.db.select().from(mailPlans).where(eq(mailPlans.id, d.planId));
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailMailboxes).where(eq(mailMailboxes.domainId, d.id));
    if (plan && n >= plan.mailboxes) fail("سقف " + plan.mailboxes.toLocaleString("fa-IR") + " صندوق پلن پر شده است؛ پلن را ارتقا دهید.");
    if (plan && i.quotaMb > plan.quotaMb) fail("فضای هر صندوق در این پلن حداکثر " + plan.quotaMb.toLocaleString("fa-IR") + " مگابایت است.");
    const [dupA] = await ctx.db.select({ id: mailAliases.id }).from(mailAliases).where(and(eq(mailAliases.domainId, d.id), eq(mailAliases.local, i.local)));
    const [dupB] = await ctx.db.select({ id: mailMailboxes.id }).from(mailMailboxes).where(and(eq(mailMailboxes.domainId, d.id), eq(mailMailboxes.local, i.local)));
    if (dupA || dupB) fail("نشانی " + addr(d, i.local) + " قبلاً ساخته شده است.");
    await mailDriver().setMailbox({ address: addr(d, i.local), name: i.name, password: i.password, quotaMb: i.quotaMb, active: true });
    await ctx.db.insert(mailMailboxes).values({ id: rid("mbx"), domainId: d.id, local: i.local, name: i.name, passwordHash: await hashPassword(i.password), quotaMb: i.quotaMb });
    await logActivity(ctx.db, a.uid, "mail", "ساخت صندوق " + addr(d, i.local), ctx.ip);
  }),
  "mail.mailboxUpdate": method(z.tuple([id, id, z.object({ name: z.string().trim().max(80).optional(), password: z.string().max(128).optional(), quotaMb: z.number().int().min(100).max(1_048_576).optional(), active: z.boolean().optional() })]), async (ctx, [domainId, boxId, p]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const [b] = await ctx.db.select().from(mailMailboxes).where(and(eq(mailMailboxes.id, boxId), eq(mailMailboxes.domainId, d.id)));
    if (!b) fail("صندوق پیدا نشد.", 404);
    if (p.password !== undefined) checkPassword(p.password);
    if (p.quotaMb !== undefined) {
      const [plan] = await ctx.db.select().from(mailPlans).where(eq(mailPlans.id, d.planId));
      if (plan && p.quotaMb > plan.quotaMb) fail("فضای هر صندوق در این پلن حداکثر " + plan.quotaMb.toLocaleString("fa-IR") + " مگابایت است.");
      if (p.quotaMb < b!.usedMb) fail("فضای جدید از حجم فعلی صندوق کمتر است.");
    }
    const next = { name: p.name ?? b!.name, quotaMb: p.quotaMb ?? b!.quotaMb, active: p.active ?? b!.active };
    await mailDriver().setMailbox({ address: addr(d, b!.local), ...next, password: p.password });
    await ctx.db.update(mailMailboxes).set({ ...next, ...(p.password ? { passwordHash: await hashPassword(p.password) } : {}) }).where(eq(mailMailboxes.id, b!.id));
    if (p.password) await logActivity(ctx.db, a.uid, "key-round", "تغییر رمز صندوق " + addr(d, b!.local), ctx.ip);
  }),
  "mail.mailboxRemove": method(z.tuple([id, id]), async (ctx, [domainId, boxId]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const [b] = await ctx.db.delete(mailMailboxes).where(and(eq(mailMailboxes.id, boxId), eq(mailMailboxes.domainId, d.id))).returning();
    if (!b) fail("صندوق پیدا نشد.", 404);
    await mailDriver().removeMailbox(addr(d, b!.local));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف صندوق " + addr(d, b!.local), ctx.ip);
  }),
  /** alias (to mailboxes here) or forward (to outside addresses); saving an existing local replaces it */
  "mail.aliasSave": method(z.tuple([id, z.object({ local: z.string().trim().toLowerCase().max(64), destinations: z.array(z.string().max(254)).max(20) })]), async (ctx, [domainId, i]) => {
    const { d } = await ownDomain(ctx, domainId);
    if (!LOCAL_RE.test(i.local)) fail("نام نشانی فقط حروف کوچک انگلیسی، عدد و . _ + -.");
    const dests = destinations(i.destinations);
    if (dests.includes(addr(d, i.local))) fail("نشانی نمی‌تواند به خودش هدایت شود.");
    const [box] = await ctx.db.select({ id: mailMailboxes.id }).from(mailMailboxes).where(and(eq(mailMailboxes.domainId, d.id), eq(mailMailboxes.local, i.local)));
    if (box) fail("برای " + addr(d, i.local) + " صندوق وجود دارد؛ نام دیگری انتخاب کنید.");
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailAliases).where(eq(mailAliases.domainId, d.id));
    if (n >= 200) fail("حداکثر ۲۰۰ نشانی مستعار برای هر دامنه.");
    await mailDriver().setForward(addr(d, i.local), dests);
    await ctx.db.insert(mailAliases).values({ id: rid("als"), domainId: d.id, local: i.local, destinations: dests }).onConflictDoUpdate({ target: [mailAliases.domainId, mailAliases.local], set: { destinations: dests } });
  }),
  "mail.aliasRemove": method(z.tuple([id, id]), async (ctx, [domainId, aliasId]) => {
    const { d } = await ownDomain(ctx, domainId);
    const [x] = await ctx.db.delete(mailAliases).where(and(eq(mailAliases.id, aliasId), eq(mailAliases.domainId, d.id))).returning();
    if (!x) fail("نشانی پیدا نشد.", 404);
    await mailDriver().removeForward(addr(d, x!.local));
  }),
  "mail.setInbound": method(z.tuple([id, z.object({ catchAll: z.string().trim().toLowerCase().max(254).optional(), spamThreshold: z.number().min(1).max(30).optional() })]), async (ctx, [domainId, p]) => {
    const { d } = await ownDomain(ctx, domainId);
    if (p.catchAll !== undefined) {
      if (p.catchAll && !EMAIL_ADDR_RE.test(p.catchAll)) fail("نشانی catch-all معتبر نیست.");
      if (p.catchAll) await mailDriver().setForward("@" + d.domain, [p.catchAll]); else await mailDriver().removeForward("@" + d.domain);
    }
    await ctx.db.update(mailDomains).set({ ...(p.catchAll !== undefined ? { catchAll: p.catchAll } : {}), ...(p.spamThreshold !== undefined ? { spamThreshold: Math.round(p.spamThreshold * 10) / 10 } : {}) }).where(eq(mailDomains.id, d.id));
  }),

  /* ---------- inbound rules and blocklist ---------- */
  "mail.ruleAdd": method(z.tuple([id, z.object({ field: z.enum(["from", "to", "subject"]), op: z.enum(["contains", "equals", "ends"]), value: z.string().trim().min(1).max(200), action: z.enum(["forward", "drop"]), target: z.string().trim().toLowerCase().max(254).default("") })]), async (ctx, [domainId, r]) => {
    const { d } = await ownDomain(ctx, domainId);
    if (r.action === "forward" && !EMAIL_ADDR_RE.test(r.target)) fail("برای هدایت، نشانی مقصد معتبر وارد کنید.");
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailRules).where(eq(mailRules.domainId, d.id));
    if (n >= 50) fail("حداکثر ۵۰ قانون برای هر دامنه.");
    await ctx.db.insert(mailRules).values({ id: rid("rul"), domainId: d.id, ...r, target: r.action === "forward" ? r.target : "" });
  }),
  "mail.ruleRemove": method(z.tuple([id, id]), async (ctx, [domainId, ruleId]) => {
    const { d } = await ownDomain(ctx, domainId);
    await ctx.db.delete(mailRules).where(and(eq(mailRules.id, ruleId), eq(mailRules.domainId, d.id)));
  }),
  "mail.blockAdd": method(z.tuple([id, z.string().trim().toLowerCase().max(254)]), async (ctx, [domainId, pattern]) => {
    const { d } = await ownDomain(ctx, domainId);
    if (!(EMAIL_ADDR_RE.test(pattern) || DOMAIN_RE.test(pattern.replace(/^@/, "")))) fail("یک نشانی ایمیل یا دامنه (مثل @spam.example) وارد کنید.");
    const p = EMAIL_ADDR_RE.test(pattern) ? pattern : "@" + pattern.replace(/^@/, "");
    const [{ n }] = await ctx.db.select({ n: count() }).from(mailBlocks).where(eq(mailBlocks.domainId, d.id));
    if (n >= 500) fail("حداکثر ۵۰۰ مورد در فهرست مسدود.");
    await ctx.db.insert(mailBlocks).values({ id: rid("blk"), domainId: d.id, pattern: p }).onConflictDoNothing();
  }),
  "mail.blockRemove": method(z.tuple([id, id]), async (ctx, [domainId, blockId]) => {
    const { d } = await ownDomain(ctx, domainId);
    await ctx.db.delete(mailBlocks).where(and(eq(mailBlocks.id, blockId), eq(mailBlocks.domainId, d.id)));
  }),

  /* ---------- sending from the console ---------- */
  "mail.send": method(z.tuple([id, sendSchema]), async (ctx, [domainId, input]) => {
    const { a, d } = await ownDomain(ctx, domainId);
    const r = await queueMessage(ctx.db, d, input, "console");
    await logActivity(ctx.db, a.uid, "send", "ارسال ایمیل از پنل (" + d.domain + ")", ctx.ip);
    return r;
  }),
  /** a test message into the inbox (simulator, or a domain in DEV mode) */
  "mail.testInbound": method(z.tuple([id, z.object({ from: z.string().trim().max(320), to: z.string().trim().toLowerCase().max(320), subject: z.string().max(300), text: z.string().max(20_000) })]), async (ctx, [domainId, i]) => {
    const { d } = await ownDomain(ctx, domainId);
    if (mailDriver().name !== "simulator" && d.mode !== "dev") fail("پیام آزمایشی ورودی فقط در حالت DEV ممکن است.");
    const from = parseAddress(i.from) ?? fail("فرستنده معتبر نیست.");
    const to = parseAddress(i.to) ?? fail("گیرنده معتبر نیست.");
    if (!to!.address.endsWith("@" + d.domain)) fail("گیرنده باید از دامنه " + d.domain + " باشد.");
    const raw = "From: " + i.from + "\r\nTo: " + to!.address + "\r\nSubject: =?UTF-8?B?" + Buffer.from(i.subject).toString("base64") + "?=\r\nMessage-ID: <test-" + Date.now() + "@" + from!.address.split("@")[1] + ">\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + Buffer.from(i.text).toString("base64");
    return receiveMail(ctx.db, { from: from!.address, to: [to!.address], raw });
  }),

  /* ---------- staff ---------- */
  "mail.adminList": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "mail");
    const [plans, doms] = await Promise.all([
      ctx.db.select().from(mailPlans).orderBy(asc(mailPlans.position)),
      ctx.db.select({ d: mailDomains, owner: users.name, email: users.email }).from(mailDomains).innerJoin(users, eq(users.id, mailDomains.userId)).orderBy(desc(mailDomains.createdAt)).limit(500),
    ]);
    const counts = await domainCounts(ctx.db, doms.map((x) => x.d.id));
    const since = new Date(Date.now() - 30 * 86400_000);
    const sent = doms.length ? await ctx.db.select({ id: mailMessages.domainId, n: sql<number>`sum(${mailMessages.recipients})::int` }).from(mailMessages).where(and(eq(mailMessages.direction, "out"), gte(mailMessages.createdAt, since))).groupBy(mailMessages.domainId) : [];
    return {
      plans: plans.map(planView), driver: mailDriver().name,
      domains: doms.map(({ d, owner, email }) => ({ ...domainView(d), userId: d.userId, owner, email, ...counts.get(d.id)!, sent30: sent.find((s) => s.id === d.id)?.n ?? 0 })),
    };
  }),
  "mail.adminPlan": method(z.tuple([id, z.object({ name: z.string().trim().min(2).max(40).optional(), price: z.number().int().min(0).max(1e10).optional(), dailyLimit: z.number().int().min(1).max(10_000_000).optional(), monthlyLimit: z.number().int().min(1).max(100_000_000).optional(), mailboxes: z.number().int().min(0).max(100_000).optional(), quotaMb: z.number().int().min(100).max(1_048_576).optional(), active: z.boolean().optional() })]), async (ctx, [planId, patch]) => {
    needStaff(ctx, "mail");
    const r = await ctx.db.update(mailPlans).set(patch).where(eq(mailPlans.id, planId)).returning({ id: mailPlans.id });
    if (!r.length) fail("پلن پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "ویرایش پلن ایمیل", planId + " " + JSON.stringify(patch), ctx.ip);
  }),
  "mail.adminDomain": method(z.tuple([id, z.object({ suspend: z.boolean() })]), async (ctx, [domainId, p]) => {
    needStaff(ctx, "mail");
    const [d] = await ctx.db.select().from(mailDomains).where(eq(mailDomains.id, domainId));
    if (!d) fail("دامنه پیدا نشد.", 404);
    if (p.suspend) await ctx.db.update(mailDomains).set({ status: "suspended", suspendReason: "staff" }).where(eq(mailDomains.id, d!.id));
    else {
      await ctx.db.update(mailDomains).set({ status: "pending", suspendReason: "" }).where(eq(mailDomains.id, d!.id));
      await checkDns(ctx.db, { ...d!, status: "pending", suspendReason: "" });
    }
    await notify(ctx.db, d!.userId, p.suspend ? "ban" : "play", p.suspend ? "ارسال ایمیل دامنه " + d!.domain + " توسط پشتیبانی معلق شد" : "تعلیق ایمیل دامنه " + d!.domain + " برداشته شد");
    await logAudit(ctx.db, actor(ctx), p.suspend ? "تعلیق دامنه ایمیل" : "رفع تعلیق دامنه ایمیل", d!.domain, ctx.ip);
  }),
  "mail.adminTest": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "mail");
    const d = mailDriver();
    return { driver: d.name, detail: await d.test() };
  }),
};
