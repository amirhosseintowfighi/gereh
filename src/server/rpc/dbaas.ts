/* Managed database extras (group "dbaas"): users and databases, temporary admin panels, firewall,
   tuning, PostgreSQL extensions, replica set, backups into a new database / download / import,
   the read-only data inspector and live stats. */
import "server-only";
import { randomBytes } from "node:crypto";
import { open as openFile, rm, stat } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  canManage, identError, IMPORT_FORMATS, INSPECT_ENGINES, MAX_ALLOW, MAX_DB_USERS, MAX_EXTRA_DBS, mongoFilterError, normCidr, PANEL_HOURS_DEFAULT, PANEL_HOURS_MAX,
  paramsError, pgExtension, publicAllowed, QUERY_ENGINES, readQueryError, sniffDump, toolsFor, type DbGrant,
} from "@/lib/dbaas";
import { engineOf } from "@/lib/paas";
import { rateLimit } from "../auth";
import { method, needUser, type Ctx } from "../ctx";
import { paasDbBackups, paasDbDatabases, paasDbImports, paasDbPanels, paasDbs, paasDbUsers } from "../db/schema";
import { enqueue } from "../jobs";
import { dbaas, type InspectReq } from "../paas/dbaas";
import { afterCreateDb, configOf, databasesOf, dbEvent, dumpPathFor, saveConfig } from "../paas/dbaas-service";
import { paas } from "../paas/driver";
import { appsDomain, connectionUrl, dbSpec } from "../paas/service";
import { open, seal } from "../secrets";
import { fail, logActivity, rid } from "../util";
import { checkName, needCredit, plan } from "./paas";

const id = z.string().max(40);
const grantList = z.array(z.object({ db: z.string().max(64), access: z.enum(["ro", "rw"]) })).max(MAX_EXTRA_DBS + 1);
const newPassword = (engine: string) => randomBytes(18).toString("base64url") + (engine === "mssql" ? "Aa1" : "");

/** the caller's database; `running` (default) also requires it to be up */
async function ownDb(ctx: Ctx, dbId: string, running = true) {
  const a = needUser(ctx);
  const [row] = await ctx.db.select().from(paasDbs).where(and(eq(paasDbs.id, dbId), eq(paasDbs.userId, a.uid)));
  if (!row) fail("پایگاه داده پیدا نشد.", 404);
  if (row!.status === "suspended") fail("این پایگاه داده معلق است.", 403);
  if (running && row!.status !== "running") fail("پایگاه داده باید روشن و آماده باشد.");
  return { a, row: row! };
}
/** driver errors come from the database itself; keep them short */
async function attempt<T>(what: string, f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) { return fail(what + ": " + (e as Error).message.slice(0, 400)); }
}
function checkGrants(grants: DbGrant[], all: string[]) {
  for (const g of grants) if (!all.includes(g.db)) fail("پایگاه داده «" + g.db + "» وجود ندارد.");
  if (new Set(grants.map((g) => g.db)).size !== grants.length) fail("هر پایگاه داده فقط یک بار.");
}
async function ownUser(ctx: Ctx, dbId: string, userId: string) {
  const { a, row } = await ownDb(ctx, dbId);
  const [u] = await ctx.db.select().from(paasDbUsers).where(and(eq(paasDbUsers.id, userId), eq(paasDbUsers.dbId, row.id)));
  if (!u) fail("کاربر پیدا نشد.", 404);
  return { a, row, u: u! };
}
const userUrl = (row: typeof paasDbs.$inferSelect, username: string, password: string, dbName: string) => connectionUrl({ ...row, username, dbName }, password);

export const dbaasRpc = {
  /* ---------------- users ---------------- */
  /** a new login with its own password and read-only / read-write access per database */
  "dbaas.createUser": method(z.tuple([id, z.object({ username: z.string().trim().toLowerCase().max(31), grants: grantList })]), async (ctx, [dbId, i]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (!canManage(row.engine)) fail("مدیریت کاربران برای این موتور پشتیبانی نمی‌شود.");
    const err = identError(i.username, "user");
    if (err) fail(err);
    if (i.username === row.username) fail("این نام کاربر اصلی است.");
    const all = await databasesOf(ctx.db, row);
    checkGrants(i.grants, all);
    const users = await ctx.db.select({ username: paasDbUsers.username }).from(paasDbUsers).where(eq(paasDbUsers.dbId, row.id));
    if (users.some((u) => u.username === i.username)) fail("کاربری با این نام دارید.");
    if (users.length >= MAX_DB_USERS) fail("حداکثر " + MAX_DB_USERS.toLocaleString("fa-IR") + " کاربر برای هر پایگاه داده.");
    const password = newPassword(row.engine);
    await attempt("ساخت کاربر انجام نشد", async () => dbaas().createUser(await dbSpec(ctx.db, row), i.username, password, i.grants, all));
    const uid = rid("dbu");
    await ctx.db.insert(paasDbUsers).values({ id: uid, dbId: row.id, username: i.username, passwordEnc: seal(password), grants: i.grants });
    await dbEvent(ctx.db, row.id, "کاربر " + i.username + " ساخته شد");
    await logActivity(ctx.db, a.uid, "user-plus", "ساخت کاربر " + i.username + " در پایگاه داده " + row.name, ctx.ip);
    return { id: uid, password, url: userUrl(row, i.username, password, i.grants[0]?.db ?? row.dbName) };
  }),
  "dbaas.setGrants": method(z.tuple([id, id, grantList]), async (ctx, [dbId, userId, grants]) => {
    const { row, u } = await ownUser(ctx, dbId, userId);
    const all = await databasesOf(ctx.db, row);
    checkGrants(grants, all);
    await attempt("تغییر دسترسی انجام نشد", async () => dbaas().setGrants(await dbSpec(ctx.db, row), u.username, grants, all));
    await ctx.db.update(paasDbUsers).set({ grants }).where(eq(paasDbUsers.id, u.id));
    await dbEvent(ctx.db, row.id, "دسترسی کاربر " + u.username + " تغییر کرد");
  }),
  /** the user's password and connection URL (logged) */
  "dbaas.userCredentials": method(z.tuple([id, id]), async (ctx, [dbId, userId]) => {
    const { a, row, u } = await ownUser(ctx, dbId, userId);
    const password = open(u.passwordEnc) ?? "";
    await logActivity(ctx.db, a.uid, "key-round", "نمایش رمز کاربر " + u.username + " پایگاه داده " + row.name, ctx.ip);
    return { password, url: userUrl(row, u.username, password, u.grants[0]?.db ?? row.dbName) };
  }),
  "dbaas.resetUserPassword": method(z.tuple([id, id]), async (ctx, [dbId, userId]) => {
    const { a, row, u } = await ownUser(ctx, dbId, userId);
    const password = newPassword(row.engine);
    await attempt("تغییر رمز انجام نشد", async () => dbaas().setUserPassword(await dbSpec(ctx.db, row), u.username, password));
    await ctx.db.update(paasDbUsers).set({ passwordEnc: seal(password) }).where(eq(paasDbUsers.id, u.id));
    await logActivity(ctx.db, a.uid, "key-round", "رمز جدید برای کاربر " + u.username + " پایگاه داده " + row.name, ctx.ip);
    return { password, url: userUrl(row, u.username, password, u.grants[0]?.db ?? row.dbName) };
  }),
  "dbaas.dropUser": method(z.tuple([id, id]), async (ctx, [dbId, userId]) => {
    const { a, row, u } = await ownUser(ctx, dbId, userId);
    const all = await databasesOf(ctx.db, row);
    await attempt("حذف کاربر انجام نشد", async () => dbaas().dropUser(await dbSpec(ctx.db, row), u.username, all));
    await ctx.db.delete(paasDbUsers).where(eq(paasDbUsers.id, u.id));
    await dbEvent(ctx.db, row.id, "کاربر " + u.username + " حذف شد", "warn");
    await logActivity(ctx.db, a.uid, "trash-2", "حذف کاربر " + u.username + " از پایگاه داده " + row.name, ctx.ip);
  }),

  /* ---------------- databases (RabbitMQ: vhosts) ---------------- */
  "dbaas.createDatabase": method(z.tuple([id, z.string().trim().toLowerCase().max(31)]), async (ctx, [dbId, name]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (!canManage(row.engine)) fail("ساخت پایگاه داده اضافه برای این موتور پشتیبانی نمی‌شود.");
    const err = identError(name, "db");
    if (err) fail(err);
    const all = await databasesOf(ctx.db, row);
    if (all.includes(name)) fail("این نام وجود دارد.");
    if (all.length > MAX_EXTRA_DBS) fail("حداکثر " + MAX_EXTRA_DBS.toLocaleString("fa-IR") + " پایگاه داده اضافه.");
    await attempt("ساخت پایگاه داده انجام نشد", async () => dbaas().createDatabase(await dbSpec(ctx.db, row), name));
    await ctx.db.insert(paasDbDatabases).values({ id: rid("dbd"), dbId: row.id, name });
    await dbEvent(ctx.db, row.id, "پایگاه داده " + name + " ساخته شد");
    await logActivity(ctx.db, a.uid, "database", "ساخت " + name + " در " + row.name, ctx.ip);
  }),
  "dbaas.dropDatabase": method(z.tuple([id, z.string().max(31), z.string().max(31)]), async (ctx, [dbId, name, confirm]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (confirm !== name) fail("برای حذف، نام را دقیق وارد کنید.");
    if (name === row.dbName) fail("پایگاه داده اصلی را نمی‌توان حذف کرد.");
    const [x] = await ctx.db.select().from(paasDbDatabases).where(and(eq(paasDbDatabases.dbId, row.id), eq(paasDbDatabases.name, name)));
    if (!x) fail("پایگاه داده پیدا نشد.", 404);
    await attempt("حذف انجام نشد", async () => dbaas().dropDatabase(await dbSpec(ctx.db, row), name));
    await ctx.db.delete(paasDbDatabases).where(eq(paasDbDatabases.id, x!.id));
    // grants on it are gone with it
    for (const u of await ctx.db.select().from(paasDbUsers).where(eq(paasDbUsers.dbId, row.id)))
      if (u.grants.some((g) => g.db === name)) await ctx.db.update(paasDbUsers).set({ grants: u.grants.filter((g) => g.db !== name) }).where(eq(paasDbUsers.id, u.id));
    await dbEvent(ctx.db, row.id, "پایگاه داده " + name + " حذف شد", "warn");
    await logActivity(ctx.db, a.uid, "trash-2", "حذف " + name + " از " + row.name, ctx.ip);
  }),

  /* ---------------- temporary web admin panels ---------------- */
  "dbaas.openPanel": method(z.tuple([id, z.string().max(30), z.number().int().min(1).max(PANEL_HOURS_MAX).default(PANEL_HOURS_DEFAULT)]), async (ctx, [dbId, tool, hours]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (!toolsFor(row.engine).some((t) => t.id === tool)) fail("این ابزار برای این موتور در دسترس نیست.");
    const live = await ctx.db.select({ id: paasDbPanels.id }).from(paasDbPanels).where(and(eq(paasDbPanels.dbId, row.id), eq(paasDbPanels.status, "ready")));
    if (live.length >= 3) fail("حداکثر ۳ پنل هم‌زمان؛ یکی را ببندید.");
    const pid = rid("dbp");
    const host = pid + "." + (await appsDomain(ctx.db));
    const password = randomBytes(15).toString("base64url");
    const username = "gereh";
    await attempt("راه‌اندازی پنل انجام نشد", async () => dbaas().openPanel(await dbSpec(ctx.db, row), { id: pid, tool, host, username, password, email: "admin@" + (await appsDomain(ctx.db)) }));
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    await ctx.db.insert(paasDbPanels).values({ id: pid, dbId: row.id, tool, host, username, passwordEnc: seal(password), expiresAt });
    await dbEvent(ctx.db, row.id, "پنل " + tool + " برای " + hours.toLocaleString("fa-IR") + " ساعت باز شد");
    await logActivity(ctx.db, a.uid, "external-link", "پنل مدیریت " + tool + " برای " + row.name, ctx.ip);
    return { id: pid, url: "https://" + host + "/", username, password, expiresAt: expiresAt.toISOString() };
  }),
  "dbaas.panelCredentials": method(z.tuple([id]), async (ctx, [panelId]) => {
    const a = needUser(ctx);
    const [r] = await ctx.db.select({ p: paasDbPanels }).from(paasDbPanels).innerJoin(paasDbs, eq(paasDbs.id, paasDbPanels.dbId)).where(and(eq(paasDbPanels.id, panelId), eq(paasDbs.userId, a.uid)));
    if (!r || r.p.status !== "ready") fail("پنل پیدا نشد.", 404);
    return { url: "https://" + r!.p.host + "/", username: r!.p.username, password: open(r!.p.passwordEnc) ?? "" };
  }),
  "dbaas.closePanel": method(z.tuple([id]), async (ctx, [panelId]) => {
    const a = needUser(ctx);
    const [r] = await ctx.db.select({ p: paasDbPanels, d: paasDbs }).from(paasDbPanels).innerJoin(paasDbs, eq(paasDbs.id, paasDbPanels.dbId)).where(and(eq(paasDbPanels.id, panelId), eq(paasDbs.userId, a.uid)));
    if (!r) fail("پنل پیدا نشد.", 404);
    if (r!.p.status === "expired") return;
    await dbaas().closePanel(await dbSpec(ctx.db, r!.d), { id: r!.p.id, tool: r!.p.tool });
    await ctx.db.update(paasDbPanels).set({ status: "expired", expiresAt: new Date() }).where(eq(paasDbPanels.id, panelId));
    await dbEvent(ctx.db, r!.d.id, "پنل " + r!.p.tool + " بسته شد");
  }),

  /* ---------------- firewall, tuning, extensions, replica set ---------------- */
  /** public access only from these IPv4 addresses / CIDRs (empty = from anywhere) */
  "dbaas.setAllowlist": method(z.tuple([id, z.array(z.string().max(20)).max(MAX_ALLOW)]), async (ctx, [dbId, list]) => {
    const { a, row } = await ownDb(ctx, dbId, false);
    if (!publicAllowed(row.engine)) fail("این موتور دسترسی عمومی ندارد.");
    const cidrs = list.map((x) => { const n = normCidr(x); if (!n) fail("«" + x + "» نشانی IPv4 یا CIDR معتبر (‎/8 تا ‎/32) نیست."); return n!; });
    const uniq = [...new Set(cidrs)];
    await saveConfig(ctx.db, row.id, { allowlist: uniq });
    if (row.publicAccess && row.status !== "creating") {
      const r = await (await paas()).updateDb(await dbSpec(ctx.db, row));
      await ctx.db.update(paasDbs).set({ publicPort: r.publicPort ?? null }).where(eq(paasDbs.id, row.id));
    }
    await dbEvent(ctx.db, row.id, uniq.length ? "فهرست مجاز دسترسی عمومی: " + uniq.join("، ") : "دسترسی عمومی از همه نشانی‌ها");
    await logActivity(ctx.db, a.uid, "shield", "فایروال پایگاه داده " + row.name, ctx.ip);
    return uniq;
  }),
  /** engine parameters; applying them restarts the server */
  "dbaas.setParams": method(z.tuple([id, z.record(z.string().max(60), z.string().max(40))]), async (ctx, [dbId, values]) => {
    const { a, row } = await ownDb(ctx, dbId, false);
    if (row.status === "creating") fail("پایگاه داده هنوز آماده نشده است.");
    const spec = await dbSpec(ctx.db, row);
    const err = paramsError(row.engine, values, spec.ramMb);
    if (err) fail(err);
    await saveConfig(ctx.db, row.id, { params: values });
    if (row.status === "running") await (await paas()).updateDb({ ...spec, params: values });
    await dbEvent(ctx.db, row.id, "پارامترها تغییر کرد" + (row.status === "running" ? "؛ پایگاه داده ری‌استارت می‌شود" : ""));
    await logActivity(ctx.db, a.uid, "sliders-horizontal", "تغییر پارامترهای " + row.name, ctx.ip);
  }),
  /** PostgreSQL extensions to have; a change of preloaded libraries restarts the server first */
  "dbaas.setExtensions": method(z.tuple([id, z.array(z.string().max(40)).max(30)]), async (ctx, [dbId, list]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (row.engine !== "postgres") fail("افزونه‌ها فقط برای PostgreSQL هستند.");
    const conf = await configOf(ctx.db, row.id);
    const want = [...new Set(list)];
    for (const e of want) {
      const x = pgExtension(e);
      if (!x) fail("افزونه «" + e + "» پشتیبانی نمی‌شود.");
      if (x!.image && !conf.extImage) fail(x!.label + " روی ایمیج قدیمی این پایگاه داده نصب نیست؛ یک پشتیبان بگیرید و آن را در پایگاه داده جدید بازگردانی کنید.");
      if (x!.minVersion && Number(row.version) < x!.minVersion) fail(x!.label + " به PostgreSQL " + x!.minVersion + " یا جدیدتر نیاز دارد.");
    }
    const enable = want.filter((e) => !conf.extensions.includes(e)), disable = conf.extensions.filter((e) => !want.includes(e));
    if (!enable.length && !disable.length) return;
    const preload = (l: string[]) => l.filter((e) => pgExtension(e)?.preload).sort().join(",");
    const spec = { ...(await dbSpec(ctx.db, row)), extensions: want };
    if (preload(want) !== preload(conf.extensions)) {
      // restart with the new shared_preload_libraries; the worker creates the extensions once it is back
      if (disable.length) await attempt("حذف افزونه انجام نشد", () => dbaas().applyExtensions(spec, [], disable));
      await saveConfig(ctx.db, row.id, { extensions: want });
      await (await paas()).updateDb(spec);
      await enqueue(ctx.db, "dbaas.init", { dbId: row.id, since: Date.now() }, { runAt: new Date(Date.now() + Number(process.env.PAAS_POLL_MS ?? 3000)) });
    } else {
      await attempt("تغییر افزونه‌ها انجام نشد", () => dbaas().applyExtensions(spec, enable, disable));
      await saveConfig(ctx.db, row.id, { extensions: want });
    }
    await dbEvent(ctx.db, row.id, "افزونه‌ها: " + (want.join("، ") || "هیچ"));
    await logActivity(ctx.db, a.uid, "layers", "تغییر افزونه‌های " + row.name, ctx.ip);
  }),
  /** MongoDB: run as a one-member replica set (transactions, change streams); restarts the server */
  "dbaas.setReplicaSet": method(z.tuple([id, z.boolean()]), async (ctx, [dbId, on]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (row.engine !== "mongodb") fail("Replica Set فقط برای MongoDB است.");
    const conf = await configOf(ctx.db, row.id);
    if (conf.replicaSet === on) return;
    await saveConfig(ctx.db, row.id, { replicaSet: on, initialized: on ? false : conf.initialized });
    await (await paas()).updateDb({ ...(await dbSpec(ctx.db, row)), replicaSet: on });
    if (on) await enqueue(ctx.db, "dbaas.init", { dbId: row.id, since: Date.now() }, { runAt: new Date(Date.now() + Number(process.env.PAAS_POLL_MS ?? 3000)) });
    await dbEvent(ctx.db, row.id, on ? "Replica Set روشن شد؛ پایگاه داده ری‌استارت می‌شود" : "Replica Set خاموش شد");
    await logActivity(ctx.db, a.uid, "database", "Replica Set " + (on ? "روشن" : "خاموش") + " برای " + row.name, ctx.ip);
  }),

  /* ---------------- backups: into a new database, download, import ---------------- */
  "dbaas.restoreToNew": method(z.tuple([id, z.string().trim().toLowerCase().max(30)]), async (ctx, [backupId, name]) => {
    const a = needUser(ctx);
    const [r] = await ctx.db.select({ b: paasDbBackups, d: paasDbs }).from(paasDbBackups).innerJoin(paasDbs, eq(paasDbs.id, paasDbBackups.dbId)).where(and(eq(paasDbBackups.id, backupId), eq(paasDbs.userId, a.uid)));
    if (!r || r.b.status !== "done") fail("پشتیبان آماده پیدا نشد.", 404);
    const src = r!.d;
    checkName(name);
    const [dup] = await ctx.db.select({ id: paasDbs.id }).from(paasDbs).where(and(eq(paasDbs.userId, a.uid), eq(paasDbs.name, name)));
    if (dup) fail("پایگاه داده‌ای با این نام دارید.");
    const p = await plan(ctx, src.planId, "db");
    await needCredit(ctx, a.uid, p.price);
    const newId = rid("pdb");
    // same user, password and database name as the source: the dump refers to them
    await ctx.db.insert(paasDbs).values({ id: newId, userId: a.uid, name, engine: src.engine, version: src.version, planId: src.planId, port: src.port, username: src.username, passwordEnc: src.passwordEnc, dbName: src.dbName, publicAccess: false, backups: src.backups });
    const conf = await configOf(ctx.db, src.id);
    await afterCreateDb(ctx.db, { id: newId, engine: src.engine }, { replicaSet: conf.replicaSet, seed: { location: r!.b.location, from: src.name, status: "pending" } });
    await enqueue(ctx.db, "paas.db", { dbId: newId });
    await dbEvent(ctx.db, newId, "ساخته شده از پشتیبان " + src.name);
    await logActivity(ctx.db, a.uid, "database-backup", "بازگردانی پشتیبان " + src.name + " در پایگاه داده جدید " + name, ctx.ip);
    return newId;
  }),
  /** a 30-minute download link of a finished backup */
  "dbaas.backupLink": method(z.tuple([id]), async (ctx, [backupId]) => {
    const a = needUser(ctx);
    const [r] = await ctx.db.select({ b: paasDbBackups, d: paasDbs }).from(paasDbBackups).innerJoin(paasDbs, eq(paasDbs.id, paasDbBackups.dbId)).where(and(eq(paasDbBackups.id, backupId), eq(paasDbs.userId, a.uid)));
    if (!r || r.b.status !== "done" || !r.b.location) fail("پشتیبان آماده پیدا نشد.", 404);
    await rateLimit(ctx.db, "dbaas-link:" + a.uid, 30, 3600);
    const url = await attempt("ساخت لینک دانلود انجام نشد", async () => dbaas().backupLink(await dbSpec(ctx.db, r!.d), r!.b.location));
    await logActivity(ctx.db, a.uid, "download", "دانلود پشتیبان " + r!.d.name, ctx.ip);
    return url;
  }),
  /** loads a dump uploaded with PUT /api/dbaas/upload */
  "dbaas.importDump": method(z.tuple([id, z.string().max(64)]), async (ctx, [dbId, uploadId]) => {
    const { a, row } = await ownDb(ctx, dbId);
    const formats = IMPORT_FORMATS[row.engine];
    if (!formats) fail("ورود فایل پشتیبان برای این موتور پشتیبانی نمی‌شود.");
    const path = await dumpPathFor(a.uid, uploadId);
    if (!path) fail("فایل بارگذاری‌شده نامعتبر است.");
    const size = await stat(path!).then((s) => s.size).catch(() => -1);
    if (size <= 0) fail("فایل بارگذاری‌شده پیدا نشد؛ دوباره بارگذاری کنید.");
    const fh = await openFile(path!, "r");
    const head = Buffer.alloc(64);
    try { await fh.read(head, 0, 64, 0); } finally { await fh.close(); }
    const format = sniffDump(head.subarray(0, Math.min(64, size)), row.engine);
    if (!format || !formats!.includes(format)) { await rm(path!, { force: true }); fail("قالب فایل برای " + (engineOf(row.engine)?.label ?? row.engine) + " مناسب نیست."); }
    const [busy] = await ctx.db.select({ id: paasDbImports.id }).from(paasDbImports).where(and(eq(paasDbImports.dbId, row.id), inArray(paasDbImports.status, ["queued", "running"])));
    if (busy) fail("یک ورود داده در جریان است.");
    const impId = rid("dbi");
    await ctx.db.insert(paasDbImports).values({ id: impId, dbId: row.id, format: format!, filePath: path!, sizeBytes: size });
    await enqueue(ctx.db, "dbaas.import", { importId: impId });
    await dbEvent(ctx.db, row.id, "ورود فایل پشتیبان (" + format + ") شروع شد");
    await logActivity(ctx.db, a.uid, "upload", "ورود داده به " + row.name, ctx.ip);
    return impId;
  }),

  /* ---------------- data inspector and stats ---------------- */
  "dbaas.inspect": method(z.tuple([id, z.discriminatedUnion("op", [
    z.object({ op: z.literal("databases") }),
    z.object({ op: z.literal("tables"), db: z.string().max(64) }),
    z.object({ op: z.literal("rows"), db: z.string().max(64), table: z.string().max(130), page: z.number().int().min(0).max(10_000).default(0) }),
    z.object({ op: z.literal("query"), db: z.string().max(64), sql: z.string().max(10_000) }),
    z.object({ op: z.literal("find"), db: z.string().max(64), collection: z.string().max(120), filter: z.string().max(5000).default("{}"), page: z.number().int().min(0).max(10_000).default(0) }),
  ])]), async (ctx, [dbId, req]) => {
    const { a, row } = await ownDb(ctx, dbId);
    if (!INSPECT_ENGINES.includes(row.engine)) fail("مرورگر داده برای این موتور در دسترس نیست.");
    await rateLimit(ctx.db, "dbaas-inspect:" + a.uid, 120, 60);
    if (req.op !== "databases" && !/^[\w$-]{1,64}$/.test(req.db)) fail("نام پایگاه داده معتبر نیست.");
    if (req.op === "rows" && !/^[\w$.-]{1,130}$/.test(req.table)) fail("نام جدول معتبر نیست.");
    if (req.op === "find") {
      if (row.engine !== "mongodb") fail("جست‌وجوی سند فقط برای MongoDB است.");
      if (!/^[\w$.-]{1,120}$/.test(req.collection)) fail("نام مجموعه معتبر نیست.");
      const err = mongoFilterError(req.filter);
      if (err) fail(err);
    }
    if (req.op === "rows" && row.engine === "mongodb") fail("برای MongoDB از جست‌وجوی سند استفاده کنید.");
    if (req.op === "query") {
      if (!QUERY_ENGINES.includes(row.engine)) fail("کوئری دلخواه فقط برای PostgreSQL و MySQL/MariaDB است.");
      const err = readQueryError(req.sql);
      if (err) fail(err);
      await logActivity(ctx.db, a.uid, "terminal", "کوئری خواندنی روی " + row.name + ": " + req.sql.trim().slice(0, 80), ctx.ip);
    }
    return attempt("خطای پایگاه داده", async () => dbaas().inspect(await dbSpec(ctx.db, row), req as InspectReq));
  }),
  "dbaas.stats": method(z.tuple([id]), async (ctx, [dbId]) => {
    const { row } = await ownDb(ctx, dbId);
    return dbaas().stats(await dbSpec(ctx.db, row));
  }),
};
