import "server-only";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { MAX_DOMAIN_YEARS } from "@/lib/catalog";
import { actor, isStaff, method, needStaff, needUser, type Ctx } from "../ctx";
import { dnsRecords, domains, hosting, tlds } from "../db/schema";
import { providers } from "../providers";
import { fail, logActivity, logAudit, randomSecret, rid } from "../util";
import { createInvoice } from "./billing";

const id = z.string().max(40);

async function ownHosting(ctx: Ctx, hid: string) {
  const a = needUser(ctx);
  const [h] = await ctx.db.select().from(hosting).where(isStaff(ctx, "services") ? eq(hosting.id, hid) : and(eq(hosting.id, hid), eq(hosting.userId, a.uid)));
  if (!h) fail("هاست پیدا نشد.", 404);
  return h!;
}
async function ownDomain(ctx: Ctx, did: string) {
  const a = needUser(ctx);
  const [d] = await ctx.db.select().from(domains).where(isStaff(ctx, "services") ? eq(domains.id, did) : and(eq(domains.id, did), eq(domains.userId, a.uid)));
  if (!d) fail("دامنه پیدا نشد.", 404);
  return d!;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^(?=.*:)[0-9a-f:]{2,39}$/i;
const HOST = /^(?=.{1,253}\.?$)([a-z0-9_](?:[a-z0-9-_]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}\.?$/i;
const recordSchema = z.object({ id: z.string().max(40).optional(), type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"]), name: z.string().max(253), value: z.string().max(2048), ttl: z.number().int().min(60).max(604800), priority: z.number().int().min(0).max(65535).optional() });
type Rec = z.infer<typeof recordSchema>;
export function validateRecord(r: Rec): string {
  const name = r.name.trim(), v = r.value.trim();
  if (!name) return "نام را وارد کنید (برای خود دامنه @).";
  if (!/^(@|\*|[a-z0-9_*]([a-z0-9-_.]*[a-z0-9_])?)$/i.test(name)) return "نام رکورد معتبر نیست.";
  if (!v) return "مقدار را وارد کنید.";
  if (r.type === "A" && !IPV4.test(v)) return "برای رکورد A یک آدرس IPv4 معتبر لازم است.";
  if (r.type === "AAAA" && !IPV6.test(v)) return "برای رکورد AAAA یک آدرس IPv6 معتبر لازم است.";
  if ((r.type === "CNAME" || r.type === "MX" || r.type === "NS") && !HOST.test(v)) return "مقدار باید یک نام میزبان معتبر باشد؛ مثل mail.example.com";
  if (r.type === "CNAME" && name === "@") return "رکورد CNAME روی ریشه دامنه مجاز نیست.";
  if (r.type === "MX" && r.priority === undefined) return "اولویت MX باید عددی بین ۰ تا ۶۵۵۳۵ باشد.";
  return "";
}
const managedHere = (ns: string[]) => ns.every((n) => /\.gereh\.net$/.test(n));

export const servicesRpc = {
  "hosting.resetPassword": method(z.tuple([id]), async (ctx, [hid]) => {
    const h = await ownHosting(ctx, hid);
    if (h.status === "suspended") fail("این هاست معلق است.");
    const pass = "Gh#" + randomSecret(13, "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    await (await providers()).hosting.setPassword(h, pass);
    await logActivity(ctx.db, h.userId, "key-round", "ساخت رمز جدید cPanel برای " + h.domain, ctx.ip);
    return pass;
  }),
  /** POST /hosting/:id/sso → one-time cPanel login URL */
  "hosting.sso": method(z.tuple([id]), async (ctx, [hid]) => {
    const h = await ownHosting(ctx, hid);
    if (h.status === "suspended") fail("این هاست معلق است.");
    return (await providers()).hosting.sso(h);
  }),
  "hosting.setStatus": method(z.tuple([id, z.enum(["active", "suspended"])]), async (ctx, [hid, status]) => {
    needStaff(ctx, "services");
    const h = await ownHosting(ctx, hid);
    const p = (await providers()).hosting;
    if (status === "suspended") await p.suspend(h); else await p.unsuspend(h);
    await ctx.db.update(hosting).set({ status }).where(eq(hosting.id, h.id));
    await logAudit(ctx.db, actor(ctx), "تغییر وضعیت هاست به " + status, h.id, ctx.ip);
  }),
  "hosting.renew": method(z.tuple([id, z.number().int().refine((m) => m === 1 || m === 12)]), async (ctx, [hid, months]) => {
    const h = await ownHosting(ctx, hid);
    const amount = months === 12 ? Math.round((h.price * 0.85) / 1000) * 1000 * 12 : h.price;
    const inv = await createInvoice(ctx.db, h.userId, [{ desc: "تمدید هاست " + h.domain + "، " + (months === 12 ? "یک سال" : "یک ماه"), amount }], { dueDays: 7, fulfil: [{ type: "renew", kind: "hosting", id: h.id, months }] });
    return { id: inv };
  }),
  "hosting.setAutoRenew": method(z.tuple([id, z.boolean()]), async (ctx, [hid, on]) => {
    const h = await ownHosting(ctx, hid);
    await ctx.db.update(hosting).set({ autoRenew: on }).where(eq(hosting.id, h.id));
  }),

  "domains.addRecord": method(z.tuple([id, recordSchema]), async (ctx, [did, r]) => {
    const d = await ownDomain(ctx, did);
    if (!managedHere(d.ns)) fail("DNS این دامنه در گره مدیریت نمی‌شود.");
    const err = validateRecord(r); if (err) fail(err);
    const [{ n }] = await ctx.db.select({ n: count() }).from(dnsRecords).where(eq(dnsRecords.domainId, d.id));
    if (n >= 200) fail("حداکثر ۲۰۰ رکورد برای هر دامنه.");
    const row = { id: rid("r"), domainId: d.id, type: r.type, name: r.name.trim(), value: r.value.trim(), ttl: r.ttl, priority: r.type === "MX" || r.type === "SRV" ? r.priority ?? 10 : null };
    await ctx.db.insert(dnsRecords).values(row);
    await (await providers()).dns.sync(ctx.db, d.id);
  }),
  "domains.updateRecord": method(z.tuple([id, recordSchema.required({ id: true })]), async (ctx, [did, r]) => {
    const d = await ownDomain(ctx, did);
    const err = validateRecord(r); if (err) fail(err);
    const res = await ctx.db.update(dnsRecords).set({ type: r.type, name: r.name.trim(), value: r.value.trim(), ttl: r.ttl, priority: r.type === "MX" || r.type === "SRV" ? r.priority ?? 10 : null })
      .where(and(eq(dnsRecords.id, r.id), eq(dnsRecords.domainId, d.id))).returning({ id: dnsRecords.id });
    if (!res.length) fail("رکورد پیدا نشد.", 404);
    await (await providers()).dns.sync(ctx.db, d.id);
  }),
  "domains.removeRecord": method(z.tuple([id, id]), async (ctx, [did, recId]) => {
    const d = await ownDomain(ctx, did);
    await ctx.db.delete(dnsRecords).where(and(eq(dnsRecords.id, recId), eq(dnsRecords.domainId, d.id)));
    await (await providers()).dns.sync(ctx.db, d.id);
  }),
  "domains.setNs": method(z.tuple([id, z.array(z.string().max(253)).min(2).max(4)]), async (ctx, [did, raw]) => {
    const d = await ownDomain(ctx, did);
    const ns = raw.map((x) => x.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
    if (ns.length < 2) fail("حداقل دو نام‌سرور لازم است.");
    if (ns.some((x) => !HOST.test(x))) fail("نام‌سرور معتبر نیست؛ مثل ns1.example.com");
    if (new Set(ns).size !== ns.length) fail("نام‌سرور تکراری است.");
    await (await providers()).registrar.setNameservers(d.name, ns);
    await ctx.db.update(domains).set({ ns }).where(eq(domains.id, d.id));
    await logActivity(ctx.db, d.userId, "settings-2", "تغییر نام‌سرورهای " + d.name, ctx.ip);
  }),
  "domains.toggle": method(z.tuple([id, z.enum(["autoRenew", "privacy", "locked"])]), async (ctx, [did, key]) => {
    const d = await ownDomain(ctx, did);
    const next = !d[key];
    const reg = (await providers()).registrar;
    if (key === "locked") await reg.setLock(d.name, next);
    if (key === "privacy") await reg.setPrivacy(d.name, next);
    await ctx.db.update(domains).set({ [key]: next }).where(eq(domains.id, d.id));
  }),
  "domains.renew": method(z.tuple([id, z.number().int().min(1).max(MAX_DOMAIN_YEARS)]), async (ctx, [did, years]) => {
    const d = await ownDomain(ctx, did);
    const all = await ctx.db.select().from(tlds);
    const t = all.sort((a, b) => b.tld.length - a.tld.length).find((x) => d.name.endsWith(x.tld));
    if (!t) fail("پسوند این دامنه پشتیبانی نمی‌شود.");
    const id = await createInvoice(ctx.db, d.userId, [{ desc: "تمدید دامنه " + d.name + "، " + years.toLocaleString("fa-IR") + " سال", amount: t!.renew * years }], { dueDays: 7, fulfil: [{ type: "renew", kind: "domain", id: d.id, months: years * 12 }] });
    return { id, userId: d.userId, date: "", due: "", status: "unpaid", items: [], tax: 0, official: null, paidAt: "" };
  }),
  /** GET /domains/check?name= — availability across all TLDs via the registrar */
  "domains.check": method(z.tuple([z.string().max(63)]), async (ctx, [name]) => {
    const all = await ctx.db.select().from(tlds);
    const taken = new Set((await ctx.db.select({ name: domains.name }).from(domains)).map((x) => x.name));
    const reg = (await providers()).registrar;
    const res = await reg.check(name, all.map((x) => x.tld));
    return res.map((r) => ({ ...r, available: r.available && !taken.has(name + r.tld) }));
  }),
};
