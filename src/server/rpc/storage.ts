import "server-only";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { hourlyOf } from "@/lib/paas";
import { baseName, bucketNameError, bytes, CORS_METHODS, GB, keyError, MAX_BUCKETS_PER_USER, MAX_CORS_RULES, MAX_KEYS_PER_USER, MAX_SHARE_TTL, prefixError } from "@/lib/storage";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { storageBuckets, storageDomains, storageKeys, storagePlans, users } from "../db/schema";
import { seal } from "../secrets";
import { storage } from "../storage/driver";
import { applyBucket, bucketConfig, syncKey, verifyDomain } from "../storage/service";
import { fail, logActivity, logAudit, randomSecret, rid } from "../util";

const id = z.string().max(40);
const objKey = z.string().max(1024);
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const ORIGIN_RE = /^(\*|https?:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?)$/;
const ALNUM_UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const grantsSchema = z.array(z.object({ bucketId: id, perm: z.enum(["read", "write"]) })).max(MAX_BUCKETS_PER_USER);

async function ownBucket(ctx: Ctx, bucketId: string, o: { active?: boolean } = {}) {
  const a = needUser(ctx);
  const [b] = await ctx.db.select().from(storageBuckets).where(and(eq(storageBuckets.id, bucketId), eq(storageBuckets.userId, a.uid)));
  if (!b) fail("باکت پیدا نشد.", 404);
  if (o.active && b!.status === "suspended") fail("این باکت معلق است؛ کیف پول را شارژ کنید یا با پشتیبانی تماس بگیرید.", 403);
  return { a, b: b! };
}
async function ownKey(ctx: Ctx, keyId: string) {
  const a = needUser(ctx);
  const [k] = await ctx.db.select().from(storageKeys).where(and(eq(storageKeys.id, keyId), eq(storageKeys.userId, a.uid)));
  if (!k) fail("کلید دسترسی پیدا نشد.", 404);
  return { a, k: k! };
}
async function planOf(ctx: Ctx, planId: string) {
  const [p] = await ctx.db.select().from(storagePlans).where(eq(storagePlans.id, planId));
  if (!p || !p.active) fail("این پلن در دسترس نیست.");
  return p!;
}
/** creating or growing a bucket needs 24 hours of its cost in the wallet */
async function needCredit(ctx: Ctx, uid: string, monthly: number) {
  const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
  const need = 24 * hourlyOf(monthly);
  if ((u?.balance ?? 0) < need) fail("موجودی کیف پول کافی نیست؛ دست‌کم " + need.toLocaleString("fa-IR") + " تومان (هزینه ۲۴ ساعت) لازم است.", 402);
}
async function checkGrants(ctx: Ctx, uid: string, grants: z.infer<typeof grantsSchema>) {
  if (new Set(grants.map((g) => g.bucketId)).size !== grants.length) fail("هر باکت فقط یک بار انتخاب شود.");
  const mine = new Set((await ctx.db.select({ id: storageBuckets.id }).from(storageBuckets).where(eq(storageBuckets.userId, uid))).map((r) => r.id));
  if (grants.some((g) => !mine.has(g.bucketId))) fail("باکت انتخاب‌شده پیدا نشد.", 404);
}
const checkKey = (k: string) => { const e = keyError(k); if (e) fail(e); };
const checkPrefix = (p: string) => { const e = prefixError(p); if (e) fail(e); };

/** maps backend errors to customer messages */
async function drv<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    const m = (e as Error).message || "";
    if (/Quota/i.test(m)) fail("فضای این باکت پر است؛ پلن را ارتقا دهید یا فایل‌هایی را حذف کنید.", 413);
    if (/NoSuchKey/.test(m)) fail("فایل پیدا نشد.", 404);
    if (/AccessDenied/.test(m)) fail("دسترسی به این باکت متوقف است.", 403);
    if (/SimulatorFull/.test(m)) fail("فضای شبیه‌ساز پر است.", 507);
    console.error("[storage]", e);
    fail("ارتباط با سرویس ذخیره‌سازی برقرار نشد؛ چند لحظه دیگر دوباره تلاش کنید.", 502);
    throw e;
  }
}

const corsRule = z.object({ origins: z.array(z.string().trim().toLowerCase().max(200)).min(1).max(20), methods: z.array(z.enum(CORS_METHODS)).min(1).max(5), headers: z.array(z.string().trim().max(100)).max(20).default(["*"]), maxAge: z.number().int().min(0).max(86400).default(3600) });

export const storageRpc = {
  /* ---------------- buckets ---------------- */
  "storage.create": method(z.tuple([z.object({ name: z.string().trim().toLowerCase().max(63), planId: id, access: z.enum(["private", "public"]).default("private") })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    const err = bucketNameError(i.name);
    if (err) fail(err);
    const plan = await planOf(ctx, i.planId);
    const [{ n }] = await ctx.db.select({ n: count() }).from(storageBuckets).where(eq(storageBuckets.userId, a.uid));
    if (n >= MAX_BUCKETS_PER_USER) fail("حداکثر " + MAX_BUCKETS_PER_USER.toLocaleString("fa-IR") + " باکت برای هر حساب؛ برای بیشتر با پشتیبانی تماس بگیرید.");
    const [taken] = await ctx.db.select({ id: storageBuckets.id }).from(storageBuckets).where(eq(storageBuckets.name, i.name));
    if (taken) fail("این نام قبلاً گرفته شده است؛ نام باکت در کل سرویس یکتاست.");
    await needCredit(ctx, a.uid, plan.price);
    const bid = rid("bkt");
    const [row] = await ctx.db.insert(storageBuckets).values({ id: bid, userId: a.uid, name: i.name, planId: plan.id, access: i.access }).returning();
    try { await (await storage()).createBucket(await bucketConfig(ctx.db, row)); }
    catch (e) {
      await ctx.db.delete(storageBuckets).where(eq(storageBuckets.id, bid));
      if (/BucketAlready/.test((e as Error).message)) fail("این نام قبلاً گرفته شده است.");
      await drv(Promise.reject(e));
    }
    await logActivity(ctx.db, a.uid, "hard-drive", "ساخت باکت " + i.name + " (" + plan.name + ")", ctx.ip);
    return bid;
  }),

  "storage.remove": method(z.tuple([id, z.string().max(63)]), async (ctx, [bucketId, confirm]) => {
    const { a, b } = await ownBucket(ctx, bucketId);
    if (confirm.trim().toLowerCase() !== b.name) fail("برای حذف، نام باکت را دقیق بنویسید.");
    await drv((await storage()).deleteBucket(b.name));
    await ctx.db.delete(storageBuckets).where(eq(storageBuckets.id, b.id));
    for (const k of await ctx.db.select().from(storageKeys).where(eq(storageKeys.userId, a.uid))) {
      if (!k.grants.some((g) => g.bucketId === b.id)) continue;
      const [next] = await ctx.db.update(storageKeys).set({ grants: k.grants.filter((g) => g.bucketId !== b.id) }).where(eq(storageKeys.id, k.id)).returning();
      await drv(syncKey(ctx.db, next));
    }
    await logActivity(ctx.db, a.uid, "trash-2", "حذف باکت " + b.name, ctx.ip);
  }),

  "storage.setAccess": method(z.tuple([id, z.enum(["private", "public"])]), async (ctx, [bucketId, access]) => {
    const { a, b } = await ownBucket(ctx, bucketId, { active: true });
    if (b.access === access) return;
    const [next] = await ctx.db.update(storageBuckets).set({ access }).where(eq(storageBuckets.id, b.id)).returning();
    await drv(applyBucket(ctx.db, next));
    await logActivity(ctx.db, a.uid, access === "public" ? "globe" : "lock", "دسترسی باکت " + b.name + (access === "public" ? " عمومی شد" : " خصوصی شد"), ctx.ip);
  }),

  /** larger plans only: shrinking below stored data is not possible on S3 quotas */
  "storage.changePlan": method(z.tuple([id, id]), async (ctx, [bucketId, planId]) => {
    const { a, b } = await ownBucket(ctx, bucketId);
    if (b.planId === planId) return;
    const [cur] = await ctx.db.select().from(storagePlans).where(eq(storagePlans.id, b.planId));
    const next = await planOf(ctx, planId);
    if (cur && next.sizeGb <= cur.sizeGb) fail("فقط ارتقا به پلن بزرگ‌تر ممکن است؛ کاهش حجم باکت پشتیبانی نمی‌شود.");
    await needCredit(ctx, a.uid, Math.max(0, next.price - (cur?.price ?? 0)));
    const [row] = await ctx.db.update(storageBuckets).set({ planId: next.id }).where(eq(storageBuckets.id, b.id)).returning();
    await drv(applyBucket(ctx.db, row));
    await logActivity(ctx.db, a.uid, "gauge", "ارتقای باکت " + b.name + " به " + next.name, ctx.ip);
  }),

  "storage.setVersioning": method(z.tuple([id, z.boolean()]), async (ctx, [bucketId, on]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    const [row] = await ctx.db.update(storageBuckets).set({ versioning: on }).where(eq(storageBuckets.id, b.id)).returning();
    await drv(applyBucket(ctx.db, row));
  }),

  "storage.setCors": method(z.tuple([id, z.array(corsRule).max(MAX_CORS_RULES)]), async (ctx, [bucketId, rules]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    for (const r of rules) {
      for (const o of r.origins) if (!ORIGIN_RE.test(o)) fail("Origin «" + o + "» معتبر نیست؛ مثل https://example.com یا *");
      for (const h of r.headers) if (!/^[\w*-]{1,100}$/.test(h)) fail("نام هدر «" + h + "» معتبر نیست.");
    }
    const [row] = await ctx.db.update(storageBuckets).set({ cors: rules.map((r) => ({ ...r, methods: [...new Set(r.methods)] })) }).where(eq(storageBuckets.id, b.id)).returning();
    return drv(applyBucket(ctx.db, row));
  }),

  "storage.setLifecycle": method(z.tuple([id, z.object({ days: z.number().int().min(1).max(3650), prefix: z.string().trim().max(1024).default("") }).nullable()]), async (ctx, [bucketId, rule]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    if (rule?.prefix) checkKey(rule.prefix);
    const [row] = await ctx.db.update(storageBuckets).set({ lifecycle: rule }).where(eq(storageBuckets.id, b.id)).returning();
    await drv(applyBucket(ctx.db, row));
  }),

  /* ---------------- custom domains ---------------- */
  "storage.addDomain": method(z.tuple([id, z.string().trim().toLowerCase().max(253)]), async (ctx, [bucketId, raw]) => {
    const { a, b } = await ownBucket(ctx, bucketId, { active: true });
    const host = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
    if (!HOST_RE.test(host)) fail("نام دامنه معتبر نیست؛ مثل cdn.example.ir");
    if (/(^|\.)gereh\.(net|dev)$/.test(host)) fail("این دامنه متعلق به گره است.");
    const [{ n }] = await ctx.db.select({ n: count() }).from(storageDomains).where(eq(storageDomains.bucketId, b.id));
    if (n >= 5) fail("حداکثر ۵ دامنه برای هر باکت.");
    const [taken] = await ctx.db.select({ id: storageDomains.id }).from(storageDomains).where(eq(storageDomains.host, host));
    if (taken) fail("این دامنه قبلاً به باکتی متصل شده است.");
    const did = rid("sdm");
    const [dm] = await ctx.db.insert(storageDomains).values({ id: did, bucketId: b.id, host }).returning();
    await verifyDomain(ctx.db, dm, b);
    await logActivity(ctx.db, a.uid, "globe", "افزودن دامنه " + host + " به باکت " + b.name, ctx.ip);
    return did;
  }),
  "storage.verifyDomain": method(z.tuple([id, id]), async (ctx, [bucketId, domainId]) => {
    const { b } = await ownBucket(ctx, bucketId);
    const [dm] = await ctx.db.select().from(storageDomains).where(and(eq(storageDomains.id, domainId), eq(storageDomains.bucketId, b.id)));
    if (!dm) fail("دامنه پیدا نشد.", 404);
    const next = await verifyDomain(ctx.db, { ...dm!, status: dm!.status === "failed" ? "pending" : dm!.status }, b);
    return { status: next.status, ssl: next.ssl };
  }),
  "storage.removeDomain": method(z.tuple([id, id]), async (ctx, [bucketId, domainId]) => {
    const { a, b } = await ownBucket(ctx, bucketId);
    const r = await ctx.db.delete(storageDomains).where(and(eq(storageDomains.id, domainId), eq(storageDomains.bucketId, b.id))).returning({ host: storageDomains.host });
    if (!r.length) fail("دامنه پیدا نشد.", 404);
    await logActivity(ctx.db, a.uid, "trash-2", "حذف دامنه " + r[0].host + " از باکت " + b.name, ctx.ip);
  }),

  /* ---------------- access keys ---------------- */
  /** the secret is returned once and kept sealed */
  "storage.createKey": method(z.tuple([z.object({ name: z.string().trim().min(1).max(60), grants: grantsSchema })]), async (ctx, [i]) => {
    const a = needUser(ctx);
    await checkGrants(ctx, a.uid, i.grants);
    const [{ n }] = await ctx.db.select({ n: count() }).from(storageKeys).where(eq(storageKeys.userId, a.uid));
    if (n >= MAX_KEYS_PER_USER) fail("حداکثر " + MAX_KEYS_PER_USER.toLocaleString("fa-IR") + " کلید دسترسی؛ کلیدهای بلااستفاده را باطل کنید.");
    const accessKey = "GRH" + randomSecret(17, ALNUM_UP), secretKey = randomSecret(40, ALNUM);
    const kid = rid("sk");
    const [row] = await ctx.db.insert(storageKeys).values({ id: kid, userId: a.uid, name: i.name, accessKey, secretEnc: seal(secretKey), grants: i.grants }).returning();
    try { await drv(syncKey(ctx.db, row)); } catch (e) { await ctx.db.delete(storageKeys).where(eq(storageKeys.id, kid)); throw e; }
    await logActivity(ctx.db, a.uid, "key-round", "ساخت کلید دسترسی فضای ذخیره‌سازی «" + i.name + "»", ctx.ip);
    return { id: kid, accessKey, secretKey };
  }),
  "storage.updateKey": method(z.tuple([id, z.object({ name: z.string().trim().min(1).max(60).optional(), grants: grantsSchema.optional() })]), async (ctx, [keyId, patch]) => {
    const { a, k } = await ownKey(ctx, keyId);
    if (patch.grants) await checkGrants(ctx, a.uid, patch.grants);
    const [row] = await ctx.db.update(storageKeys).set(patch).where(eq(storageKeys.id, k.id)).returning();
    if (patch.grants) await drv(syncKey(ctx.db, row));
    await logActivity(ctx.db, a.uid, "key-round", "ویرایش دسترسی کلید «" + row.name + "»", ctx.ip);
  }),
  "storage.revokeKey": method(z.tuple([id]), async (ctx, [keyId]) => {
    const { a, k } = await ownKey(ctx, keyId);
    await drv((await storage()).removeKey(k.accessKey));
    await ctx.db.delete(storageKeys).where(eq(storageKeys.id, k.id));
    await logActivity(ctx.db, a.uid, "trash-2", "ابطال کلید دسترسی «" + k.name + "»", ctx.ip);
  }),
  "storage.regenerateKey": method(z.tuple([id]), async (ctx, [keyId]) => {
    const { a, k } = await ownKey(ctx, keyId);
    const secretKey = randomSecret(40, ALNUM);
    const [row] = await ctx.db.update(storageKeys).set({ secretEnc: seal(secretKey), rotatedAt: new Date() }).where(eq(storageKeys.id, k.id)).returning();
    await drv(syncKey(ctx.db, row));
    await logActivity(ctx.db, a.uid, "refresh-cw", "تعویض کلید مخفی «" + k.name + "»", ctx.ip);
    return { id: k.id, accessKey: k.accessKey, secretKey };
  }),

  /* ---------------- file browser ---------------- */
  "storage.objects": method(z.tuple([id, z.string().max(1024).default(""), z.string().max(1024).nullable().default(null)]), async (ctx, [bucketId, prefix, cursor]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    checkPrefix(prefix);
    const l = await drv((await storage()).list(b.name, prefix, cursor, 500));
    return { folders: l.folders.map((p) => ({ prefix: p, name: baseName(p) })), objects: l.objects.map((o) => ({ key: o.key, name: baseName(o.key), size: o.size, modified: o.modified })), next: l.next };
  }),
  "storage.mkdir": method(z.tuple([id, z.string().max(1024), z.string().trim().min(1).max(255)]), async (ctx, [bucketId, prefix, name]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    checkPrefix(prefix);
    if (name.includes("/")) fail("نام پوشه نباید / داشته باشد.");
    const key = prefix + name + "/";
    checkKey(key);
    await drv((await storage()).putObject(b.name, key, Buffer.alloc(0), "application/x-directory"));
    return key;
  }),
  /** presigned PUT the browser uploads to directly (quota is enforced by the backend as well) */
  "storage.uploadUrl": method(z.tuple([id, objKey, z.number().int().min(0).max(5 * GB), z.string().max(200).default("application/octet-stream")]), async (ctx, [bucketId, key, size]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    checkKey(key);
    if (key.endsWith("/")) fail("نام فایل نمی‌تواند با / تمام شود.");
    const [plan] = await ctx.db.select().from(storagePlans).where(eq(storagePlans.id, b.planId));
    if (plan && b.usedBytes + size > plan.sizeGb * GB) fail("فضای باکت کافی نیست (" + bytes(plan.sizeGb * GB - b.usedBytes) + " باقی مانده)؛ پلن را ارتقا دهید.", 413);
    return { url: (await storage()).presign("PUT", b.name, key, 3600), method: "PUT" as const };
  }),
  "storage.downloadUrl": method(z.tuple([id, objKey]), async (ctx, [bucketId, key]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    checkKey(key);
    return (await storage()).presign("GET", b.name, key, 600, { download: baseName(key) });
  }),
  /** temporary share link (presigned GET) valid up to 7 days */
  "storage.share": method(z.tuple([id, objKey, z.number().int().min(60).max(MAX_SHARE_TTL)]), async (ctx, [bucketId, key, ttl]) => {
    const { a, b } = await ownBucket(ctx, bucketId, { active: true });
    checkKey(key);
    if (key.endsWith("/")) fail("برای پوشه لینک اشتراک ساخته نمی‌شود.");
    const url = (await storage()).presign("GET", b.name, key, ttl);
    await logActivity(ctx.db, a.uid, "share-2", "لینک اشتراک موقت برای " + b.name + "/" + key, ctx.ip);
    return { url, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
  }),
  /** files and whole folders (keys ending in "/") */
  "storage.deleteObjects": method(z.tuple([id, z.array(objKey).min(1).max(1000)]), async (ctx, [bucketId, keys]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    keys.forEach(checkKey);
    const d = await storage();
    const all = new Set<string>();
    for (const k of keys) {
      all.add(k);
      if (k.endsWith("/")) for (const o of await drv(d.listKeys(b.name, k, 20_000))) all.add(o.key);
    }
    await drv(d.deleteObjects(b.name, [...all]));
    return all.size;
  }),
  /** rename or move a file, or a folder with everything in it (copy, then delete) */
  "storage.move": method(z.tuple([id, objKey, objKey]), async (ctx, [bucketId, from, to]) => {
    const { b } = await ownBucket(ctx, bucketId, { active: true });
    checkKey(from); checkKey(to);
    if (from === to) return 0;
    const folder = from.endsWith("/");
    if (folder !== to.endsWith("/")) fail(folder ? "مقصد پوشه باید با / تمام شود." : "نام فایل نمی‌تواند با / تمام شود.");
    if (folder && to.startsWith(from)) fail("پوشه را نمی‌توان به داخل خودش منتقل کرد.");
    const d = await storage();
    if ((await drv(d.listKeys(b.name, to, 1))).some((o) => o.key === to || folder)) fail("فایل یا پوشه‌ای با این نام وجود دارد.");
    const items = folder ? await drv(d.listKeys(b.name, from, 2001)) : [{ key: from }];
    if (items.length > 2000) fail("این پوشه بیش از ۲۰۰۰ فایل دارد؛ با rclone یا aws-cli جابه‌جا کنید.");
    if (!folder && !(await drv(d.listKeys(b.name, from, 1))).some((o) => o.key === from)) fail("فایل پیدا نشد.", 404);
    for (const o of items) await drv(d.copyObject(b.name, o.key, to + o.key.slice(from.length)));
    await drv(d.deleteObjects(b.name, items.map((o) => o.key)));
    return items.length;
  }),

  /* ---------------- staff ---------------- */
  "storage.adminPlan": method(z.tuple([id, z.object({ name: z.string().trim().min(2).max(40).optional(), price: z.number().int().min(1000).max(1e10).optional(), active: z.boolean().optional() })]), async (ctx, [planId, patch]) => {
    needStaff(ctx, "products");
    const r = await ctx.db.update(storagePlans).set(patch).where(eq(storagePlans.id, planId)).returning({ id: storagePlans.id });
    if (!r.length) fail("پلن پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "ویرایش پلن فضای ذخیره‌سازی", planId + " " + JSON.stringify(patch), ctx.ip);
  }),
  "storage.adminSuspend": method(z.tuple([id, z.boolean()]), async (ctx, [bucketId, on]) => {
    needStaff(ctx, "services");
    const [b] = await ctx.db.select().from(storageBuckets).where(eq(storageBuckets.id, bucketId));
    if (!b) fail("باکت پیدا نشد.", 404);
    const [next] = await ctx.db.update(storageBuckets).set(on ? { status: "suspended", suspendedAt: new Date(), suspendReason: "staff" } : { status: "active", suspendedAt: null, suspendReason: "" }).where(eq(storageBuckets.id, bucketId)).returning();
    await drv(applyBucket(ctx.db, next));
    await logAudit(ctx.db, actor(ctx), (on ? "تعلیق" : "رفع تعلیق") + " باکت", b!.name, ctx.ip);
  }),
  "storage.adminTest": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "infra");
    const d = await storage();
    return { driver: d.name, ...(await d.test()) };
  }),
};
