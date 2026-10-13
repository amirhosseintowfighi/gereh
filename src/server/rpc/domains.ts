/* Domains: DNS records (all types, CDN proxy flag, zone files, DNSSEC, one-click sets), WHOIS,
   transfers in and out, the per-domain CDN and traffic alerts. Every method is scoped to the owner. */
import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  ALERT_METRICS, conflictOf, DNS_RECORD_TYPES, DOMAIN_NAME_RE, exportZone, HOST_RE, IRNIC_RE, isIpv4, isIpv6, isIr, parseZone, PROXIABLE, validateRecord, WITH_PRIORITY,
  type CdnPoint, type CdnRule, type CdnView, type DomainAlertView, type TransferView,
} from "@/lib/domains";
import { fa, toman } from "@/lib/format";
import { faDateTime } from "@/lib/jalali";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { cdnRules, cdnSettings, dnsRecords, domainAlerts, domainContacts, domainExtras, domains, domainTransfers, tlds, users } from "../db/schema";
import { cdnDriver, edgeIps } from "../domains/cdn";
import { applyRecords, cdnConfig, cdnSpec, completeTransfer, debit, originOf, refund, suggestRecords, type DomainRow } from "../domains/service";
import { whois } from "../domains/whois";
import { checkDelegation } from "../geo/service";
import { enqueue } from "../jobs";
import { htpasswdLine } from "../paas/runtime";
import { providers } from "../providers";
import { fail, logActivity, logAudit, notify, rid } from "../util";
import { managedHere, ownDomain } from "./services";

const id = z.string().max(40);
const MAX_RECORDS = 200;

async function managed(ctx: Ctx, did: string) {
  const d = await ownDomain(ctx, did);
  if (!managedHere(d.ns)) fail("DNS این دامنه در گره مدیریت نمی‌شود.");
  return d;
}
/** republishes the zone; with the CDN on, the edge too (proxied names and origin may have changed) */
async function syncZone(ctx: Ctx, d: DomainRow) {
  if ((await cdnConfig(ctx.db, d.id)).enabled) {
    const spec = await cdnSpec(ctx.db, d);
    if (spec.hosts.length && spec.origin) await cdnDriver().apply(spec); else await cdnDriver().remove(d.name);
  }
  await (await providers()).dns.sync(ctx.db, d.id);
}

/* ---------- records ---------- */
const recordSchema = z.object({
  id: z.string().max(40).optional(), type: z.enum(DNS_RECORD_TYPES), name: z.string().max(253), value: z.string().max(4096),
  ttl: z.number().int().min(60).max(604800), priority: z.number().int().min(0).max(65535).nullable().optional(), proxied: z.boolean().optional(),
});
type RecIn = z.infer<typeof recordSchema>;
function normalize(r: RecIn) {
  const type = r.type;
  const out = {
    type, name: r.name.trim().toLowerCase().replace(/\.$/, "") || "", value: r.value.trim(), ttl: r.ttl,
    priority: WITH_PRIORITY.includes(type) ? (r.priority ?? (type === "MX" ? undefined : 10)) : null, proxied: !!r.proxied && PROXIABLE.includes(type),
  };
  if (["CNAME", "ALIAS", "MX", "NS", "PTR"].includes(type)) out.value = out.value.toLowerCase().replace(/\.$/, "");
  const err = validateRecord({ ...out, proxied: !!r.proxied });
  if (err) fail(err);
  return { ...out, priority: out.priority ?? null };
}
async function siblings(ctx: Ctx, domainId: string, except?: string) {
  return (await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, domainId))).filter((x) => x.id !== except).map((x) => ({ ...x, priority: x.priority }));
}

/* ---------- CDN rule input ---------- */
const PATH = /^\/[A-Za-z0-9._~\-/%]{0,200}\*?$/;
const HEADER_VALUE = /^[\x20-\x7e]{0,256}$/;
const BAD_VALUE = /["\\;{}$`']/;
const URL_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~\-/%?=&+#:@]*)?$/i;
const RESERVED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "set-cookie", "strict-transport-security", "x-cache-status", "content-type"]);
function isCidr(s: string) {
  const [ip, bits, ...rest] = s.split("/");
  if (rest.length) return false;
  if (isIpv4(ip)) return bits === undefined || (/^\d+$/.test(bits) && +bits >= 8 && +bits <= 32);
  if (isIpv6(ip)) return bits === undefined || (/^\d+$/.test(bits) && +bits >= 16 && +bits <= 128);
  return false;
}
const isPrivate = (h: string) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^(::1|f[cd][0-9a-f]{2}:|fe80:)/i.test(h) || h === "localhost";
const ruleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cache"), path: z.string().max(220), action: z.enum(["cache", "bypass"]), ttl: z.number().int().min(0).max(31536000) }),
  z.object({ kind: z.literal("redirect"), path: z.string().max(220), to: z.string().max(500), code: z.union([z.literal(301), z.literal(302)]) }),
  z.object({ kind: z.literal("header"), name: z.string().max(64), value: z.string().max(256) }),
  z.object({ kind: z.literal("auth"), path: z.string().max(220), user: z.string().max(64), password: z.string().max(128) }),
  z.object({ kind: z.literal("access"), action: z.enum(["allow", "deny"]), ip: z.string().max(50).optional(), country: z.string().max(2).optional() }),
  z.object({ kind: z.literal("ratelimit"), path: z.string().max(220), rps: z.number().int().min(1).max(10000), burst: z.number().int().min(1).max(100000) }),
]);
function checkRule(r: z.infer<typeof ruleSchema>): CdnRule {
  if ("path" in r && !PATH.test(r.path)) fail("مسیر باید با / شروع شود و فقط حروف، عدد و - _ . / داشته باشد؛ * در انتها یعنی همه زیرمسیرها.");
  switch (r.kind) {
    case "cache": if (r.action === "cache" && r.ttl < 1) fail("مدت کش را وارد کنید."); return { kind: "cache", path: r.path, action: r.action, ttl: r.action === "bypass" ? 0 : r.ttl };
    case "redirect": if (!URL_RE.test(r.to) || BAD_VALUE.test(r.to)) fail("مقصد ریدایرکت باید یک آدرس کامل http(s) باشد."); return { kind: "redirect", path: r.path, to: r.to, code: r.code };
    case "header":
      if (!/^[A-Za-z0-9-]{1,64}$/.test(r.name) || RESERVED_HEADERS.has(r.name.toLowerCase())) fail("نام هدر معتبر نیست یا این هدر را گره تنظیم می‌کند.");
      if (!HEADER_VALUE.test(r.value) || BAD_VALUE.test(r.value)) fail("مقدار هدر نمی‌تواند نویسه‌های \" ; { } $ \\ ` ' داشته باشد.");
      return { kind: "header", name: r.name, value: r.value };
    case "auth":
      if (!/^[a-zA-Z0-9._-]{1,64}$/.test(r.user)) fail("نام کاربری فقط حروف انگلیسی، عدد و . _ - است.");
      if (r.password.length < 8) fail("رمز حداقل ۸ نویسه است.");
      return { kind: "auth", path: r.path, user: r.user };
    case "access":
      if (!!r.ip === !!r.country) fail("یک IP/CIDR یا یک کد کشور (مثل IR) وارد کنید.");
      if (r.ip && !isCidr(r.ip.trim())) fail("IP یا بازه CIDR معتبر نیست؛ مثل 5.160.0.0/16");
      if (r.country && !/^[A-Za-z]{2}$/.test(r.country)) fail("کد کشور دوحرفی است؛ مثل IR یا DE.");
      return { kind: "access", action: r.action, ...(r.ip ? { ip: r.ip.trim() } : { country: r.country!.toUpperCase() }) };
    case "ratelimit": if (r.burst < r.rps) fail("ظرفیت انفجاری نباید از نرخ مجاز کمتر باشد."); return { kind: "ratelimit", path: r.path, rps: r.rps, burst: r.burst };
  }
}

const cdnPatch = z.object({
  enabled: z.boolean(), originHost: z.string().trim().toLowerCase().max(253), originHostHeader: z.string().trim().toLowerCase().max(253), originHttps: z.boolean(),
  forceHttps: z.boolean(), hstsMaxAge: z.number().int().min(0).max(63072000), hstsSub: z.boolean(), hstsPreload: z.boolean(), minTls: z.enum(["1.0", "1.1", "1.2", "1.3"]),
  browserTtl: z.number().int().min(0).max(31536000), devMode: z.boolean(), underAttack: z.boolean(),
}).partial();

const transferView = (t: typeof domainTransfers.$inferSelect, user?: string): TransferView => ({
  id: t.id, userId: t.userId, domain: t.domain, direction: t.direction, status: t.status, price: t.price, note: t.note, irnicHandle: t.irnicHandle, domainId: t.domainId,
  at: faDateTime(t.createdAt), updated: faDateTime(t.updatedAt), ...(user !== undefined ? { user } : {}),
});
async function tldOf(ctx: Ctx, domain: string) {
  const all = (await ctx.db.select().from(tlds)).sort((a, b) => b.tld.length - a.tld.length);
  return all.find((t) => domain.endsWith(t.tld) && domain.length > t.tld.length) ?? null;
}

export const domainsRpc = {
  "domains.addRecord": method(z.tuple([id, recordSchema]), async (ctx, [did, raw]) => {
    const d = await managed(ctx, did);
    const r = normalize(raw);
    const sib = await siblings(ctx, d.id);
    const c = conflictOf(r, sib); if (c) fail(c);
    if (sib.length >= MAX_RECORDS) fail("حداکثر ۲۰۰ رکورد برای هر دامنه.");
    const rec = { id: rid("r"), domainId: d.id, ...r };
    await ctx.db.insert(dnsRecords).values(rec);
    await syncZone(ctx, d);
    return rec.id;
  }),
  "domains.updateRecord": method(z.tuple([id, recordSchema.required({ id: true })]), async (ctx, [did, raw]) => {
    const d = await managed(ctx, did);
    const r = normalize(raw);
    const c = conflictOf(r, await siblings(ctx, d.id, raw.id)); if (c) fail(c);
    const res = await ctx.db.update(dnsRecords).set(r).where(and(eq(dnsRecords.id, raw.id), eq(dnsRecords.domainId, d.id))).returning({ id: dnsRecords.id });
    if (!res.length) fail("رکورد پیدا نشد.", 404);
    await syncZone(ctx, d);
  }),
  "domains.removeRecord": method(z.tuple([id, id]), async (ctx, [did, recId]) => {
    const d = await ownDomain(ctx, did);
    await ctx.db.delete(dnsRecords).where(and(eq(dnsRecords.id, recId), eq(dnsRecords.domainId, d.id)));
    await syncZone(ctx, d);
  }),
  "domains.setProxied": method(z.tuple([id, id, z.boolean()]), async (ctx, [did, recId, on]) => {
    const d = await managed(ctx, did);
    const [r] = await ctx.db.select().from(dnsRecords).where(and(eq(dnsRecords.id, recId), eq(dnsRecords.domainId, d.id)));
    if (!r) fail("رکورد پیدا نشد.", 404);
    if (on && !PROXIABLE.includes(r!.type)) fail("فقط رکوردهای A، AAAA، CNAME و ALIAS از CDN عبور می‌کنند.");
    await ctx.db.update(dnsRecords).set({ proxied: on }).where(eq(dnsRecords.id, r!.id));
    await syncZone(ctx, d);
  }),

  /** BIND zone file → records; "replace" swaps the whole zone, "merge" adds what is new */
  "domains.importZone": method(z.tuple([id, z.string().max(200_000), z.enum(["merge", "replace"])]), async (ctx, [did, text, mode]) => {
    const d = await managed(ctx, did);
    const parsed = parseZone(text, d.name, MAX_RECORDS);
    if (!parsed.records.length) fail(parsed.errors[0] ?? "رکوردی در فایل پیدا نشد.");
    const existing = mode === "replace" ? [] : await siblings(ctx, d.id);
    const add: (typeof dnsRecords.$inferInsert)[] = [];
    const errors = [...parsed.errors];
    for (const r of parsed.records) {
      const name = r.name.toLowerCase();
      const value = ["CNAME", "ALIAS", "MX", "NS", "PTR"].includes(r.type) ? r.value.toLowerCase() : r.value;
      const rec = { ...r, name, value };
      const all = [...existing, ...add.map((a) => ({ type: a.type, name: a.name, value: a.value, ttl: a.ttl ?? 3600 }))];
      if (all.some((x) => x.type === rec.type && x.name === rec.name && x.value === rec.value)) continue;
      const c = conflictOf(rec, all);
      if (c) { errors.push(rec.type + " " + rec.name + ": " + c); continue; }
      if (existing.length + add.length >= MAX_RECORDS) { errors.push("سقف ۲۰۰ رکورد پر شد؛ بقیه وارد نشد."); break; }
      add.push({ id: rid("r"), domainId: d.id, ...rec });
    }
    await ctx.db.transaction(async (tx) => {
      if (mode === "replace") await tx.delete(dnsRecords).where(eq(dnsRecords.domainId, d.id));
      if (add.length) await tx.insert(dnsRecords).values(add);
    });
    await syncZone(ctx, d);
    await logActivity(ctx.db, d.userId, "upload", "ورود فایل زون برای " + d.name + " (" + fa(add.length) + " رکورد)", ctx.ip);
    return { added: add.length, skipped: parsed.skipped, errors: errors.slice(0, 50) };
  }),
  "domains.exportZone": method(z.tuple([id]), async (ctx, [did]) => {
    const d = await ownDomain(ctx, did);
    const recs = await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, d.id)).orderBy(asc(dnsRecords.position));
    return exportZone(d.name, recs, { ns: d.ns });
  }),

  /** are the registry's NS the ones set for this domain? */
  "domains.nsCheck": method(z.tuple([id]), async (ctx, [did]) => {
    const d = await ownDomain(ctx, did);
    const { seen } = await checkDelegation(d.name);
    const want = d.ns.map((n) => n.toLowerCase().replace(/\.$/, "")).sort();
    return { ok: seen.length === want.length && seen.every((n, i) => n === want[i]), seen, expected: want, managed: managedHere(d.ns) };
  }),
  "domains.extras": method(z.tuple([id]), async (ctx, [did]) => {
    const d = await ownDomain(ctx, did);
    const [x] = await ctx.db.select().from(domainExtras).where(eq(domainExtras.domainId, d.id));
    return { dnssec: x?.dnssec ?? false, ds: x?.ds ?? [], irnicHandle: x?.irnicHandle ?? "", ir: isIr(d.name) };
  }),
  "domains.setDnssec": method(z.tuple([id, z.boolean()]), async (ctx, [did, on]) => {
    const d = await managed(ctx, did);
    const ds = await (await providers()).dns.dnssec(d.name, on);
    if (on && !ds.length) fail("کلید امضای زون ساخته نشد؛ کمی بعد دوباره تلاش کنید.", 502);
    await ctx.db.insert(domainExtras).values({ domainId: d.id, dnssec: on, ds }).onConflictDoUpdate({ target: domainExtras.domainId, set: { dnssec: on, ds } });
    await logActivity(ctx.db, d.userId, "shield-check", (on ? "فعال‌سازی" : "غیرفعال‌سازی") + " DNSSEC برای " + d.name, ctx.ip);
    return ds;
  }),

  /** one-click record sets for the customer's apps, servers and mail domains */
  "domains.suggestions": method(z.tuple([id]), async (ctx, [did]) => {
    const d = await ownDomain(ctx, did);
    return suggestRecords(ctx.db, d.userId, d);
  }),
  "domains.applySuggestion": method(z.tuple([id, z.string().max(80)]), async (ctx, [did, key]) => {
    const d = await managed(ctx, did);
    const s = (await suggestRecords(ctx.db, d.userId, d)).find((x) => x.key === key);
    if (!s) fail("این پیشنهاد دیگر در دسترس نیست.", 404);
    const r = await applyRecords(ctx.db, d.id, s!.records);
    await syncZone(ctx, d);
    await logActivity(ctx.db, d.userId, "settings-2", "اتصال " + d.name + " به " + s!.label, ctx.ip);
    return r;
  }),

  "domains.whois": method(z.tuple([z.string().trim().toLowerCase().max(253), z.boolean().optional()]), async (ctx, [raw, fresh]) => {
    needUser(ctx);
    const name = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
    if (!DOMAIN_NAME_RE.test(name)) fail("نام دامنه معتبر نیست (مثل example.ir).");
    try { return await whois(ctx.db, name, { fresh }); } catch { return fail("سرور WHOIS پاسخ نداد؛ کمی بعد دوباره تلاش کنید.", 502); }
  }),

  /* ---------- registrant (IRNIC) ---------- */
  "domains.contact": method(z.tuple([]), async (ctx) => {
    const a = needUser(ctx);
    const [c] = await ctx.db.select().from(domainContacts).where(eq(domainContacts.userId, a.uid));
    return { irnicHandle: c?.irnicHandle ?? "" };
  }),
  "domains.setContact": method(z.tuple([z.object({ irnicHandle: z.string().trim().toLowerCase().max(40) })]), async (ctx, [c]) => {
    const a = needUser(ctx);
    if (c.irnicHandle && !IRNIC_RE.test(c.irnicHandle)) fail("شناسه ایرنیک به شکل ab1234-irnic است.");
    await ctx.db.insert(domainContacts).values({ userId: a.uid, irnicHandle: c.irnicHandle }).onConflictDoUpdate({ target: domainContacts.userId, set: { irnicHandle: c.irnicHandle, updatedAt: new Date() } });
  }),

  /* ---------- transfers ---------- */
  "domains.transfers": method(z.tuple([]), async (ctx) => {
    const a = needUser(ctx);
    return (await ctx.db.select().from(domainTransfers).where(eq(domainTransfers.userId, a.uid)).orderBy(desc(domainTransfers.createdAt)).limit(100)).map((t) => transferView(t));
  }),
  /** transfer-in: the transfer fee leaves the wallet now and comes back if staff reject it or the registry refuses */
  "domains.transferIn": method(z.tuple([z.object({ domain: z.string().trim().toLowerCase().max(253), authCode: z.string().trim().max(64).default(""), irnicHandle: z.string().trim().toLowerCase().max(40).default("") })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    const domain = i.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!DOMAIN_NAME_RE.test(domain)) fail("نام دامنه معتبر نیست (مثل example.com).");
    const t = await tldOf(ctx, domain);
    if (!t) fail("انتقال این پسوند در گره پشتیبانی نمی‌شود.");
    if (domain.slice(0, -t!.tld.length).includes(".")) fail("فقط دامنه اصلی منتقل می‌شود، نه زیردامنه.");
    const [own] = await ctx.db.select({ id: domains.id }).from(domains).where(eq(domains.name, domain));
    if (own) fail("این دامنه همین حالا در گره ثبت است.");
    const [open] = await ctx.db.select({ id: domainTransfers.id }).from(domainTransfers).where(and(eq(domainTransfers.domain, domain), eq(domainTransfers.direction, "in"), inArray(domainTransfers.status, ["pending", "processing"])));
    if (open) fail("درخواست انتقال این دامنه در جریان است.");
    let handle = i.irnicHandle;
    if (isIr(domain)) {
      if (!handle) handle = (await ctx.db.select().from(domainContacts).where(eq(domainContacts.userId, a.uid)))[0]?.irnicHandle ?? "";
      if (!IRNIC_RE.test(handle)) fail("برای انتقال دامنه .ir شناسه ایرنیک مالک (مثل ab1234-irnic) لازم است.");
    } else if (!/^\S{6,64}$/.test(i.authCode)) fail("کد انتقال (EPP) را از ثبت‌کننده فعلی بگیرید و وارد کنید؛ حداقل ۶ نویسه.");
    const tid = rid("dtr");
    const ok = await ctx.db.transaction(async (tx) => {
      if (!(await debit(tx, a.uid, t!.transfer, "انتقال دامنه " + domain + " به گره"))) return false;
      await tx.insert(domainTransfers).values({ id: tid, userId: a.uid, domain, direction: "in", status: "pending", authCode: i.authCode, irnicHandle: isIr(domain) ? handle : "", price: t!.transfer });
      return true;
    });
    if (!ok) fail("برای انتقال به " + toman(t!.transfer) + " موجودی نیاز است؛ کیف پول را شارژ کنید.", 402);
    await logActivity(ctx.db, a.uid, "arrow-left-right", "درخواست انتقال دامنه " + domain, ctx.ip);
    await enqueue(ctx.db, "notify.send", { to: process.env.CONTACT_INBOX || "hello@gereh.net", subject: "درخواست انتقال دامنه: " + domain, text: a.user.name + " <" + a.user.email + "> انتقال " + domain + " را درخواست کرد؛ از بخش مدیریت دامنه‌ها تأیید کنید." });
    return tid;
  }),
  "domains.cancelTransfer": method(z.tuple([id]), async (ctx, [tid]) => {
    const a = needUser(ctx);
    const done = await ctx.db.transaction(async (tx) => {
      const [t] = await tx.update(domainTransfers).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(domainTransfers.id, tid), eq(domainTransfers.userId, a.uid), eq(domainTransfers.status, "pending"))).returning();
      if (t) await refund(tx, t.userId, t.price, "بازگشت هزینه انتقال دامنه " + t.domain);
      return t;
    });
    if (!done) fail("فقط درخواست در انتظار تأیید لغو می‌شود.");
  }),
  /** transfer-out: unlock at the registry and hand over the EPP code */
  "domains.transferOut": method(z.tuple([id]), async (ctx, [did]) => {
    const d = await ownDomain(ctx, did);
    if (d.status === "expired") fail("دامنه منقضی شده است؛ ابتدا آن را تمدید کنید.");
    if (Date.now() - d.registeredAt.getTime() < 60 * 86400_000) fail("تا ۶۰ روز پس از ثبت یا انتقال، انتقال به ثبت‌کننده دیگر ممکن نیست.");
    const reg = (await providers()).registrar;
    if (d.locked) await reg.setLock(d.name, false);
    const code = isIr(d.name) ? "" : await reg.authCode(d.name);
    await ctx.db.update(domains).set({ locked: false, authCode: code || d.authCode }).where(eq(domains.id, d.id));
    await ctx.db.insert(domainTransfers).values({ id: rid("dtr"), userId: d.userId, domain: d.name, direction: "out", status: "auth_sent" });
    await logActivity(ctx.db, d.userId, "lock", "قفل " + d.name + " برداشته شد و کد انتقال صادر شد", ctx.ip);
    await notify(ctx.db, d.userId, "lock", "کد انتقال دامنه " + d.name + " صادر شد؛ اگر این درخواست از شما نبوده، قفل دامنه را دوباره فعال کنید");
    return { authCode: code || d.authCode, ir: isIr(d.name) };
  }),

  /* ---------- CDN ---------- */
  "domains.cdn": method(z.tuple([id]), async (ctx, [did]): Promise<CdnView> => {
    const d = await ownDomain(ctx, did);
    const [config, rules, recs] = await Promise.all([
      cdnConfig(ctx.db, d.id), ctx.db.select().from(cdnRules).where(eq(cdnRules.domainId, d.id)).orderBy(asc(cdnRules.position)), ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, d.id)),
    ]);
    return { config, rules: rules.map((r) => ({ ...(r.data as CdnRule), id: r.id })), edge: edgeIps(), origin: originOf(recs, config), driver: cdnDriver().name, proxied: recs.filter((r) => r.proxied).length };
  }),
  "domains.cdnUpdate": method(z.tuple([id, cdnPatch]), async (ctx, [did, p]) => {
    const d = await managed(ctx, did);
    const cur = await cdnConfig(ctx.db, d.id);
    if (p.originHost) {
      if (!(isIpv4(p.originHost) || isIpv6(p.originHost) || HOST_RE.test(p.originHost))) fail("آدرس مبدأ باید IP یا نام میزبان باشد.");
      if (isPrivate(p.originHost)) fail("آدرس مبدأ نمی‌تواند خصوصی یا محلی باشد.");
      if (p.originHost === d.name || p.originHost.endsWith("." + d.name)) {
        const proxiedHere = (await ctx.db.select().from(dnsRecords).where(and(eq(dnsRecords.domainId, d.id), eq(dnsRecords.proxied, true)))).some((r) => (r.name === "@" ? d.name : r.name + "." + d.name) === p.originHost);
        if (proxiedHere) fail("مبدأ نمی‌تواند نامی باشد که خودش از CDN عبور می‌کند (حلقه).");
      }
    }
    if (p.originHostHeader && !HOST_RE.test(p.originHostHeader)) fail("هدر Host باید یک نام میزبان باشد.");
    const next = { ...cur, ...p };
    if (next.hstsPreload && (next.hstsMaxAge < 31536000 || !next.hstsSub)) fail("برای preload باید max-age حداقل یک سال و includeSubDomains روشن باشد.");
    if (next.hstsMaxAge > 0 && !next.forceHttps) fail("HSTS بدون اجبار HTTPS معنا ندارد؛ ابتدا «اجبار HTTPS» را روشن کنید.");
    if (p.enabled && !cur.enabled) {
      const recs = await ctx.db.select().from(dnsRecords).where(eq(dnsRecords.domainId, d.id));
      if (!originOf(recs, next)) fail("ابتدا دست‌کم یک رکورد A یا CNAME را از CDN عبور دهید یا آدرس مبدأ را وارد کنید.");
    }
    const { devMode, ...cols } = p;
    const set = { ...cols, ...(devMode !== undefined ? { devUntil: devMode ? new Date(Date.now() + 3 * 3600_000) : null } : {}), updatedAt: new Date() };
    await ctx.db.insert(cdnSettings).values({ domainId: d.id, ...set }).onConflictDoUpdate({ target: cdnSettings.domainId, set });
    if (next.enabled || cur.enabled) {
      const spec = await cdnSpec(ctx.db, d);
      if (next.enabled && spec.hosts.length && spec.origin) await cdnDriver().apply(spec); else await cdnDriver().remove(d.name);
      await (await providers()).dns.sync(ctx.db, d.id);
    }
    if (p.enabled !== undefined && p.enabled !== cur.enabled) await logActivity(ctx.db, d.userId, "cloud", (p.enabled ? "فعال‌سازی" : "غیرفعال‌سازی") + " CDN برای " + d.name, ctx.ip);
    if (p.underAttack && !cur.underAttack) await logActivity(ctx.db, d.userId, "shield-alert", "حالت زیر حمله برای " + d.name + " روشن شد", ctx.ip);
  }),
  "domains.cdnAddRule": method(z.tuple([id, ruleSchema]), async (ctx, [did, raw]) => {
    const d = await managed(ctx, did);
    const rule = checkRule(raw);
    const [{ n }] = await ctx.db.select({ n: count() }).from(cdnRules).where(eq(cdnRules.domainId, d.id));
    if (n >= 50) fail("حداکثر ۵۰ قانون CDN برای هر دامنه.");
    const rows = await ctx.db.select().from(cdnRules).where(eq(cdnRules.domainId, d.id));
    if (rule.kind === "ratelimit" && rows.some((r) => r.kind === "ratelimit" && (r.data as { path: string }).path === rule.path)) fail("برای این مسیر محدودیت نرخ هست.");
    if ((rule.kind === "cache" || rule.kind === "auth" || rule.kind === "redirect") && rows.some((r) => r.kind === rule.kind && (r.data as { path: string }).path === rule.path)) fail("برای این مسیر قانون مشابه هست؛ همان را حذف و دوباره بسازید.");
    const ruleId = rid("cr");
    await ctx.db.insert(cdnRules).values({ id: ruleId, domainId: d.id, kind: rule.kind, data: rule as unknown as Record<string, unknown>, secret: raw.kind === "auth" ? htpasswdLine(raw.user, raw.password) : "" });
    await syncZone(ctx, d);
    return ruleId;
  }),
  "domains.cdnRemoveRule": method(z.tuple([id, id]), async (ctx, [did, ruleId]) => {
    const d = await ownDomain(ctx, did);
    await ctx.db.delete(cdnRules).where(and(eq(cdnRules.id, ruleId), eq(cdnRules.domainId, d.id)));
    await syncZone(ctx, d);
  }),
  "domains.cdnPurge": method(z.tuple([id, z.union([z.object({ all: z.literal(true) }), z.object({ urls: z.array(z.string().max(1000)).min(1).max(30) }), z.object({ prefix: z.string().max(1000) })])]), async (ctx, [did, target]) => {
    const d = await ownDomain(ctx, did);
    const cfg = await cdnConfig(ctx.db, d.id);
    if (!cfg.enabled) fail("CDN این دامنه خاموش است.");
    const ofDomain = (u: string) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && (x.hostname === d.name || x.hostname.endsWith("." + d.name)); } catch { return false; } };
    if ("urls" in target && !target.urls.every(ofDomain)) fail("هر آدرس باید کامل و روی همین دامنه باشد؛ مثل https://" + d.name + "/style.css");
    if ("prefix" in target && !ofDomain(target.prefix)) fail("پیشوند باید یک آدرس کامل روی همین دامنه باشد؛ مثل https://" + d.name + "/images/");
    const precise = "all" in target ? false : await cdnDriver().purge(d.name, target);
    if (!precise) {
      await ctx.db.update(cdnSettings).set({ cacheVersion: cfg.cacheVersion + 1, updatedAt: new Date() }).where(eq(cdnSettings.domainId, d.id));
      await cdnDriver().apply(await cdnSpec(ctx.db, d));
      if ("all" in target) await cdnDriver().purge(d.name, target);
    }
    await logActivity(ctx.db, d.userId, "refresh-cw", "پاک کردن کش CDN " + d.name + ("all" in target || !precise ? " (همه)" : ""), ctx.ip);
    return { all: !precise };
  }),
  "domains.cdnAnalytics": method(z.tuple([id, z.number().int().min(1).max(24 * 30)]), async (ctx, [did, hours]): Promise<CdnPoint[]> => {
    const d = await ownDomain(ctx, did);
    return cdnDriver().analytics(d.name, hours);
  }),

  /* ---------- traffic alerts ---------- */
  "domains.alerts": method(z.tuple([id]), async (ctx, [did]): Promise<DomainAlertView[]> => {
    const d = await ownDomain(ctx, did);
    return (await ctx.db.select().from(domainAlerts).where(eq(domainAlerts.domainId, d.id)).orderBy(asc(domainAlerts.createdAt)))
      .map((a) => ({ id: a.id, metric: a.metric, threshold: a.threshold, enabled: a.enabled, lastValue: a.lastValue, fired: a.firedAt ? faDateTime(a.firedAt) : "" }));
  }),
  "domains.addAlert": method(z.tuple([id, z.object({ metric: z.enum(Object.keys(ALERT_METRICS) as [keyof typeof ALERT_METRICS]), threshold: z.number().positive().max(1e12) })]), async (ctx, [did, a]) => {
    const d = await ownDomain(ctx, did);
    const [{ n }] = await ctx.db.select({ n: count() }).from(domainAlerts).where(eq(domainAlerts.domainId, d.id));
    if (n >= 10) fail("حداکثر ۱۰ هشدار برای هر دامنه.");
    await ctx.db.insert(domainAlerts).values({ id: rid("dal"), domainId: d.id, metric: a.metric, threshold: a.threshold });
  }),
  "domains.toggleAlert": method(z.tuple([id, id, z.boolean()]), async (ctx, [did, aid, on]) => {
    const d = await ownDomain(ctx, did);
    await ctx.db.update(domainAlerts).set({ enabled: on }).where(and(eq(domainAlerts.id, aid), eq(domainAlerts.domainId, d.id)));
  }),
  "domains.removeAlert": method(z.tuple([id, id]), async (ctx, [did, aid]) => {
    const d = await ownDomain(ctx, did);
    await ctx.db.delete(domainAlerts).where(and(eq(domainAlerts.id, aid), eq(domainAlerts.domainId, d.id)));
  }),

  /* ---------- staff ---------- */
  "domains.adminTransfers": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "services");
    const rows = await ctx.db.select({ t: domainTransfers, name: users.name }).from(domainTransfers).innerJoin(users, eq(users.id, domainTransfers.userId)).orderBy(desc(domainTransfers.createdAt)).limit(300);
    return rows.map((r) => transferView(r.t, r.name));
  }),
  "domains.adminApprove": method(z.tuple([id]), async (ctx, [tid]) => {
    needStaff(ctx, "services");
    const [t] = await ctx.db.select().from(domainTransfers).where(and(eq(domainTransfers.id, tid), eq(domainTransfers.direction, "in")));
    if (!t || t.status !== "pending") fail("این درخواست در انتظار تأیید نیست.");
    const r = await completeTransfer(ctx.db, t!);
    await logAudit(ctx.db, actor(ctx), "تأیید انتقال دامنه " + t!.domain + (r.ok ? "" : " (رد از سوی رجیستری)"), t!.id, ctx.ip);
    return r;
  }),
  "domains.adminReject": method(z.tuple([id, z.string().trim().max(300)]), async (ctx, [tid, reason]) => {
    needStaff(ctx, "services");
    const t = await ctx.db.transaction(async (tx) => {
      const [row] = await tx.update(domainTransfers).set({ status: "rejected", note: reason, updatedAt: new Date() }).where(and(eq(domainTransfers.id, tid), eq(domainTransfers.status, "pending"))).returning();
      if (row) await refund(tx, row.userId, row.price, "بازگشت هزینه انتقال دامنه " + row.domain);
      return row;
    });
    if (!t) fail("این درخواست در انتظار تأیید نیست.");
    await notify(ctx.db, t!.userId, "circle-alert", "درخواست انتقال دامنه " + t!.domain + " رد شد" + (reason ? ": " + reason : "") + "؛ مبلغ به کیف پول بازگشت");
    await logAudit(ctx.db, actor(ctx), "رد انتقال دامنه " + t!.domain, t!.id, ctx.ip);
  }),
};
