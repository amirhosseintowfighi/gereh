import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { checkValue, DOMAIN_RE, GEO_TYPES, validName, type GeoRecordType } from "@/lib/geo";
import { fa, toman } from "@/lib/format";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { geoPlans, geoRecords, geoZones } from "../db/schema";
import { geoDriver } from "../geo/driver";
import { addMonth, charge, syncZone } from "../geo/service";
import { enqueue } from "../jobs";
import { fail, logActivity, logAudit, notify, rid } from "../util";

const rec = z.object({ name: z.string().trim().toLowerCase().max(120), type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX"]), iran: z.string().trim().max(255), world: z.string().trim().max(255).default(""), ttl: z.number().int().min(30).max(86400).default(60), priority: z.number().int().min(0).max(65535).nullable().default(null) });
type Rec = z.infer<typeof rec>;

function checkRecord(r: Rec) {
  if (!validName(r.name)) fail("نام رکورد «" + r.name + "» معتبر نیست (مثل @، www یا api).");
  const e1 = checkValue(r.type as GeoRecordType, r.iran);
  if (e1) fail("مقدار ایران: " + e1);
  if (r.world) {
    if (!GEO_TYPES.find((t) => t.id === r.type)!.geo) fail("رکورد " + r.type + " برای همه یکسان است؛ مقدار خارج را خالی بگذارید.");
    const e2 = checkValue(r.type as GeoRecordType, r.world);
    if (e2) fail("مقدار خارج: " + e2);
  }
  if (r.type === "MX" && r.priority === null) r.priority = 10;
  if (r.type === "CNAME" && r.name === "@") fail("رکورد CNAME روی ریشه دامنه (@) مجاز نیست؛ از A استفاده کنید.");
}

async function ownZone(ctx: Ctx, zoneId: string) {
  const a = needUser(ctx);
  const [zone] = await ctx.db.select().from(geoZones).where(and(eq(geoZones.id, zoneId), eq(geoZones.userId, a.uid)));
  if (!zone) fail("دامنه پیدا نشد.", 404);
  return { a, zone: zone! };
}
async function planOf(ctx: Ctx, id: string) {
  const [p] = await ctx.db.select().from(geoPlans).where(eq(geoPlans.id, id));
  if (!p || !p.active) fail("این پلن در دسترس نیست.");
  return p!;
}
async function guardCount(ctx: Ctx, zoneId: string, max: number) {
  const [{ n }] = await ctx.db.select({ n: count() }).from(geoRecords).where(eq(geoRecords.zoneId, zoneId));
  if (n >= max) fail("سقف " + fa(max) + " رکورد این پلن پر شده است؛ پلن را ارتقا دهید.");
}
const conflict = async (ctx: Ctx, zoneId: string, r: Rec, exceptId?: number) => {
  const same = (await ctx.db.select().from(geoRecords).where(and(eq(geoRecords.zoneId, zoneId), eq(geoRecords.name, r.name)))).filter((x) => x.id !== exceptId);
  if (r.type === "CNAME" && same.length) fail("برای «" + r.name + "» رکورد دیگری هست؛ CNAME نمی‌تواند کنار رکورد دیگری باشد.");
  if (same.some((x) => x.type === "CNAME")) fail("«" + r.name + "» یک رکورد CNAME دارد؛ رکورد دیگری کنارش مجاز نیست.");
  if (["A", "AAAA"].includes(r.type) && same.some((x) => x.type === r.type)) fail("برای «" + r.name + "» رکورد " + r.type + " وجود دارد؛ همان را ویرایش کنید.");
};

export const geoMethods = {
  /** creates a zone and charges the first month; it goes live once the domain's NS point to us */
  "geo.create": method(z.tuple([z.object({ domain: z.string().trim().toLowerCase().max(253), planId: z.string().max(40), iran: z.string().trim().max(45), world: z.string().trim().max(45) })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    const domain = i.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!DOMAIN_RE.test(domain)) fail("نام دامنه معتبر نیست (مثل example.ir).");
    if (/(^|\.)gereh\.(net|dev)$/.test(domain)) fail("این دامنه متعلق به گره است.");
    const [taken] = await ctx.db.select({ id: geoZones.id }).from(geoZones).where(eq(geoZones.domain, domain));
    if (taken) fail("این دامنه قبلاً در Geo DNS ثبت شده است.");
    const plan = await planOf(ctx, i.planId);
    for (const [label, v] of [["سرور ایران", i.iran], ["سرور خارج", i.world]]) { const e = checkValue("A", v); if (e) fail(label + ": " + e); }
    if (i.iran === i.world) fail("آدرس سرور ایران و خارج یکی است؛ Geo DNS برای دو سرور جدا کاربرد دارد.");
    const id = rid("geo");
    await ctx.db.transaction(async (tx) => {
      if (!(await charge(tx, a.uid, plan.price, "Geo DNS " + domain + " — ماه اول (" + plan.name + ")"))) fail("برای ماه اول به " + toman(plan.price) + " موجودی نیاز است؛ کیف پول را شارژ کنید.", 402);
      await tx.insert(geoZones).values({ id, userId: a.uid, domain, planId: plan.id, syncToken: randomBytes(24).toString("base64url"), paidUntil: addMonth(new Date()), syncStatus: plan.sync === "none" ? "none" : "setup" });
      await tx.insert(geoRecords).values([
        { zoneId: id, name: "@", type: "A", iran: i.iran, world: i.world },
        { zoneId: id, name: "www", type: "A", iran: i.iran, world: i.world },
      ]);
    });
    const [zone] = await ctx.db.select().from(geoZones).where(eq(geoZones.id, id));
    await syncZone(ctx.db, zone);
    await enqueue(ctx.db, "geo.ns", { zoneId: id });
    if (plan.sync !== "none") await enqueue(ctx.db, "notify.send", { to: process.env.CONTACT_INBOX || "hello@gereh.net", subject: "Geo DNS مدیریت‌شده جدید: " + domain, text: a.user.name + " <" + a.user.email + "> پلن " + plan.name + " را برای " + domain + " خرید؛ راه‌اندازی سرور خارج و همگام‌سازی را هماهنگ کنید." });
    await logActivity(ctx.db, a.uid, "globe", "ثبت Geo DNS برای " + domain, ctx.ip);
    return id;
  }),

  "geo.addRecord": method(z.tuple([z.string().max(40), rec]), async (ctx, [zoneId, r]) => {
    const { zone } = await ownZone(ctx, zoneId);
    checkRecord(r);
    const [plan] = await ctx.db.select().from(geoPlans).where(eq(geoPlans.id, zone.planId));
    await guardCount(ctx, zone.id, plan?.records ?? 10);
    await conflict(ctx, zone.id, r);
    await ctx.db.insert(geoRecords).values({ zoneId: zone.id, ...r });
    await syncZone(ctx.db, zone);
  }),

  "geo.updateRecord": method(z.tuple([z.string().max(40), z.number().int(), rec]), async (ctx, [zoneId, recId, r]) => {
    const { zone } = await ownZone(ctx, zoneId);
    checkRecord(r);
    await conflict(ctx, zone.id, r, recId);
    const u = await ctx.db.update(geoRecords).set({ ...r, iranUp: null, worldUp: null }).where(and(eq(geoRecords.id, recId), eq(geoRecords.zoneId, zone.id))).returning({ id: geoRecords.id });
    if (!u.length) fail("رکورد پیدا نشد.", 404);
    await syncZone(ctx.db, zone);
  }),

  "geo.removeRecord": method(z.tuple([z.string().max(40), z.number().int()]), async (ctx, [zoneId, recId]) => {
    const { zone } = await ownZone(ctx, zoneId);
    await ctx.db.delete(geoRecords).where(and(eq(geoRecords.id, recId), eq(geoRecords.zoneId, zone.id)));
    await syncZone(ctx.db, zone);
  }),

  "geo.checkNs": method(z.tuple([z.string().max(40)]), async (ctx, [zoneId]) => {
    const { zone } = await ownZone(ctx, zoneId);
    const { geoNsCheck } = await import("../worker/geo");
    await geoNsCheck(ctx.db, { zoneId: zone.id });
    const [next] = await ctx.db.select().from(geoZones).where(eq(geoZones.id, zone.id));
    return { ok: next.nsOk, seen: next.nsSeen };
  }),

  "geo.settings": method(z.tuple([z.string().max(40), z.object({ autoRenew: z.boolean().optional(), healthPath: z.string().trim().max(200).regex(/^\/[\w./?=&%-]*$/).optional() })]), async (ctx, [zoneId, patch]) => {
    const { zone } = await ownZone(ctx, zoneId);
    const [next] = await ctx.db.update(geoZones).set(patch).where(eq(geoZones.id, zone.id)).returning();
    if (patch.healthPath !== undefined) await syncZone(ctx.db, next);
  }),

  /** upgrades are charged pro rata for the rest of the paid month; downgrades apply at once with no refund */
  "geo.changePlan": method(z.tuple([z.string().max(40), z.string().max(40)]), async (ctx, [zoneId, planId]) => {
    const { a, zone } = await ownZone(ctx, zoneId);
    if (zone.planId === planId) return;
    const [cur] = await ctx.db.select().from(geoPlans).where(eq(geoPlans.id, zone.planId));
    const next = await planOf(ctx, planId);
    const [{ n }] = await ctx.db.select({ n: count() }).from(geoRecords).where(eq(geoRecords.zoneId, zone.id));
    if (n > next.records) fail("این دامنه " + fa(n) + " رکورد دارد و پلن " + next.name + " حداکثر " + fa(next.records) + " رکورد؛ ابتدا رکوردهای اضافه را حذف کنید.");
    const days = Math.max(0, (zone.paidUntil.getTime() - Date.now()) / 86400_000);
    const diff = Math.ceil(((next.price - (cur?.price ?? 0)) * Math.min(days, 31)) / 30 / 1000) * 1000;
    await ctx.db.transaction(async (tx) => {
      if (diff > 0 && !(await charge(tx, a.uid, diff, "ارتقای Geo DNS " + zone.domain + " به " + next.name + " (باقی‌مانده ماه)"))) fail("برای ارتقا به " + toman(diff) + " موجودی نیاز است.", 402);
      await tx.update(geoZones).set({ planId: next.id, syncStatus: next.sync === "none" ? "none" : zone.syncStatus === "none" ? "setup" : zone.syncStatus }).where(eq(geoZones.id, zone.id));
    });
    const [z2] = await ctx.db.select().from(geoZones).where(eq(geoZones.id, zone.id));
    await syncZone(ctx.db, z2);
    await logActivity(ctx.db, a.uid, "gauge", "تغییر پلن Geo DNS " + zone.domain + " به " + next.name, ctx.ip);
  }),

  "geo.delete": method(z.tuple([z.string().max(40), z.string().max(253)]), async (ctx, [zoneId, confirm]) => {
    const { a, zone } = await ownZone(ctx, zoneId);
    if (confirm.trim().toLowerCase() !== zone.domain) fail("برای حذف، نام دامنه را دقیق بنویسید.");
    await geoDriver().remove(zone.domain);
    await ctx.db.delete(geoZones).where(eq(geoZones.id, zone.id));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف Geo DNS " + zone.domain, ctx.ip);
  }),

  /* ---------- staff ---------- */
  "geo.adminPlan": method(z.tuple([z.string().max(40), z.object({ name: z.string().trim().min(2).max(40).optional(), price: z.number().int().min(0).max(1e10).optional(), records: z.number().int().min(1).max(1000).optional(), active: z.boolean().optional() })]), async (ctx, [planId, patch]) => {
    needStaff(ctx, "geo");
    const r = await ctx.db.update(geoPlans).set(patch).where(eq(geoPlans.id, planId)).returning({ id: geoPlans.id });
    if (!r.length) fail("پلن پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "ویرایش پلن Geo DNS", planId, ctx.ip);
  }),
  "geo.adminZone": method(z.tuple([z.string().max(40), z.object({ status: z.enum(["pending", "active", "suspended"]).optional(), syncStatus: z.enum(["none", "setup", "ok", "lagging", "failed"]).optional(), extendDays: z.number().int().min(1).max(366).optional() })]), async (ctx, [zoneId, patch]) => {
    needStaff(ctx, "geo");
    const [zone] = await ctx.db.select().from(geoZones).where(eq(geoZones.id, zoneId));
    if (!zone) fail("دامنه پیدا نشد.", 404);
    const set: Partial<typeof geoZones.$inferInsert> = {};
    if (patch.status) set.status = patch.status;
    if (patch.syncStatus) set.syncStatus = patch.syncStatus;
    if (patch.extendDays) set.paidUntil = new Date(Math.max(zone!.paidUntil.getTime(), Date.now()) + patch.extendDays * 86400_000);
    const [next] = await ctx.db.update(geoZones).set(set).where(eq(geoZones.id, zoneId)).returning();
    if (patch.status) await syncZone(ctx.db, next);
    if (patch.syncStatus === "ok" && zone!.syncStatus === "setup") await notify(ctx.db, zone!.userId, "refresh-cw", "همگام‌سازی سرور خارج " + zone!.domain + " راه‌اندازی شد");
    await logAudit(ctx.db, actor(ctx), "ویرایش Geo DNS", zone!.domain + " " + JSON.stringify(patch), ctx.ip);
  }),
  "geo.adminTest": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "geo");
    const d = geoDriver();
    return { driver: d.name, detail: await d.test() };
  }),
};
