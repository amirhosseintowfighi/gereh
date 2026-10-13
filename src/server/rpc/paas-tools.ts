/* Gereh Apps operator tools: web console and one-off commands in a running instance, named disks with
   a file manager, SFTP accounts and backups, log search, the .env file, release history and metric
   history. Streams (console output, live log tail, file transfer) are HTTP routes under /api/paas. */
import "server-only";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { faDateTime } from "@/lib/jalali";
import { DISK_PRICE_GB } from "@/lib/paas";
import {
  commitLinks, DISK_NAME_RE, editable, LOG_DAYS, MAX_DISK_GB, MAX_DISKS, MAX_EDIT_BYTES, MAX_SFTP_USERS, METRIC_RANGES, mountError, mountsOverlap, nameError, relPath, SFTP_USER_RE, toDotenv,
} from "@/lib/paas-tools";
import { actor, method, needStaff, needUser, type Ctx } from "../ctx";
import { paasApps, paasConsoleSessions, paasDeployments, paasDiskBackups, paasDisks, paasEnv, paasLinks, paasPlans, paasSftpUsers } from "../db/schema";
import { enqueue } from "../jobs";
import { openCount, sessionOf, startSession } from "../paas/console";
import { appDisks, ensureDisks, sftpHostKey, syncDiskTotals } from "../paas/disks";
import { metricSeries, searchLogs } from "../paas/observe";
import { logEvent } from "../paas/runtime";
import { appSpec, appsDomain, redeployConfig } from "../paas/service";
import { paasTools, ToolError } from "../paas/tools";
import { open, seal } from "../secrets";
import { listZip, readEntry, ZIP_LIMITS, ZipError } from "../unzip";
import { tarEntries, tarSize } from "../paas/tar";
import { fail, logActivity, logAudit, rid } from "../util";
import { needCredit, ownApp } from "./paas";

const id = z.string().max(40);
const pathArg = z.string().max(1024);
const MAX_CONSOLES = 3;
export const RUN_TIMEOUT_MS = 60_000;

type AppRow = typeof paasApps.$inferSelect;
/** the app must be running a live release for anything that execs into it */
function needRunning(app: AppRow) {
  if (!app.liveDeployment || app.status !== "running") fail("اپ باید روشن و در حال اجرا باشد.");
}
/** driver errors carry the container's own message; show it instead of a generic server error */
async function tool<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) {
    if (e instanceof ToolError || (e instanceof Error && /exec|Kubernetes|timed out/.test(e.message))) fail("خطا در اجرای عملیات روی اپ: " + e.message.slice(0, 300));
    throw e;
  }
}
export async function ownDisk(ctx: Ctx, diskId: string) {
  const a = needUser(ctx);
  const [row] = await ctx.db.select({ d: paasDisks, app: paasApps }).from(paasDisks).innerJoin(paasApps, eq(paasApps.id, paasDisks.appId)).where(and(eq(paasDisks.id, diskId), eq(paasApps.userId, a.uid)));
  if (!row) fail("دیسک پیدا نشد.", 404);
  if (row!.app.status === "suspended") fail("این اپ معلق است.", 403);
  return { a, d: row!.d, app: row!.app, ref: { name: row!.d.name, mount: row!.d.mountPath } };
}
/** a disk path from the panel, inside the disk */
export function rel(p: string, root = true) {
  const r = relPath(p);
  if (r === null) fail("مسیر معتبر نیست.");
  if (!root && !r) fail("ریشه دیسک را نمی‌توان تغییر داد.");
  return r!;
}
const pick = async (ctx: Ctx, app: AppRow, instance?: string) => {
  const list = await tool(async () => paasTools().instances(await appSpec(ctx.db, app)));
  if (!list.length) fail("نمونه در حال اجرایی پیدا نشد.");
  if (instance && !list.some((x) => x.name === instance)) fail("این نمونه در حال اجرا نیست.");
  return instance || list[0].name;
};
const sftpHost = async (ctx: Ctx) => process.env.PAAS_SFTP_HOST || "sftp." + (await appsDomain(ctx.db));
const password = () => randomBytes(15).toString("base64url");

export const paasToolsRpc = {
  /* ---------------- console ---------------- */
  "paas.instances": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    if (!app.liveDeployment || app.status !== "running") return [];
    return tool(async () => paasTools().instances(await appSpec(ctx.db, app)));
  }),

  /** opens an interactive shell; output streams from /api/paas/console/<id> */
  "paas.consoleOpen": method(z.tuple([id, z.object({ instance: z.string().max(80).optional(), cols: z.number().int().min(20).max(400).default(100), rows: z.number().int().min(5).max(200).default(30) })]), async (ctx, [appId, o]) => {
    const { a, app } = await ownApp(ctx, appId);
    needRunning(app);
    if (app.source === "compose") fail("کنسول برای اپ‌های Docker Compose پشتیبانی نمی‌شود.");
    if (openCount(app.id) >= MAX_CONSOLES) fail("حداکثر " + MAX_CONSOLES.toLocaleString("fa-IR") + " کنسول باز برای هر اپ؛ کنسول‌های دیگر را ببندید.");
    const instance = await pick(ctx, app, o.instance);
    const shell = await tool(async () => paasTools().shell(await appSpec(ctx.db, app), instance, { cols: o.cols, rows: o.rows }));
    const sid = rid("con") + randomBytes(6).toString("hex");
    await ctx.db.insert(paasConsoleSessions).values({ id: sid, appId: app.id, userId: a.user.id, kind: "shell", instance, ip: ctx.ip });
    startSession(ctx.db, { id: sid, appId: app.id, owner: a.uid, userId: a.user.id, shell });
    await logActivity(ctx.db, a.uid, "terminal", "کنسول وب " + app.name + " (" + instance + ")", ctx.ip);
    await logAudit(ctx.db, actor(ctx), "کنسول وب اپ " + app.name, app.id + "/" + instance, ctx.ip);
    return { sessionId: sid, instance };
  }),
  "paas.consoleInput": method(z.tuple([z.string().max(60), z.string().max(64 * 1024)]), async (ctx, [sid, data]) => {
    const s = sessionOf(sid, needUser(ctx).uid);
    if (!s || s.closed) fail("این کنسول بسته شده است.", 410);
    s!.lastInput = Date.now();
    s!.shell.write(data);
  }),
  "paas.consoleResize": method(z.tuple([z.string().max(60), z.number().int().min(20).max(400), z.number().int().min(5).max(200)]), async (ctx, [sid, cols, rows]) => {
    const s = sessionOf(sid, needUser(ctx).uid);
    if (s && !s.closed) s.shell.resize(cols, rows);
  }),
  "paas.consoleClose": method(z.tuple([z.string().max(60)]), async (ctx, [sid]) => {
    const s = sessionOf(sid, needUser(ctx).uid);
    if (s && !s.closed) s.shell.close();
  }),

  /** runs one command in a running instance and returns its output (60 s, 1 MB) */
  "paas.consoleRun": method(z.tuple([id, z.string().trim().min(1).max(2000), z.string().max(80).optional()]), async (ctx, [appId, command, inst]) => {
    const { a, app } = await ownApp(ctx, appId);
    needRunning(app);
    if (app.source === "compose") fail("اجرای دستور برای اپ‌های Docker Compose پشتیبانی نمی‌شود.");
    const instance = await pick(ctx, app, inst);
    const sid = rid("run") + randomBytes(4).toString("hex");
    await ctx.db.insert(paasConsoleSessions).values({ id: sid, appId: app.id, userId: a.user.id, kind: "run", instance, command, ip: ctx.ip });
    await logAudit(ctx.db, actor(ctx), "اجرای دستور در اپ " + app.name + ": " + command.slice(0, 120), app.id + "/" + instance, ctx.ip);
    let r: { code: number; output: string };
    try { r = await paasTools().exec(await appSpec(ctx.db, app), instance, command, RUN_TIMEOUT_MS); }
    catch (e) { r = { code: -1, output: (e as Error).message }; }
    await ctx.db.update(paasConsoleSessions).set({ exitCode: r.code, output: r.output.slice(-20_000), endedAt: new Date() }).where(eq(paasConsoleSessions.id, sid));
    await logActivity(ctx.db, a.uid, "terminal", "اجرای دستور در " + app.name + ": " + command.slice(0, 80), ctx.ip);
    return { instance, code: r.code, output: r.output.slice(-200_000) };
  }),
  "paas.consoleHistory": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    const rows = await ctx.db.select().from(paasConsoleSessions).where(eq(paasConsoleSessions.appId, app.id)).orderBy(desc(paasConsoleSessions.startedAt)).limit(50);
    return rows.map((r) => ({ id: r.id, kind: r.kind, instance: r.instance, command: r.command, exitCode: r.exitCode, at: faDateTime(r.startedAt), ended: r.endedAt ? faDateTime(r.endedAt) : "", minutes: r.endedAt ? Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60_000)) : null }));
  }),

  /* ---------------- disks ---------------- */
  "paas.disks": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    const disks = await ensureDisks(ctx.db, app);
    const ids = disks.map((d) => d.id);
    const [backups, users] = ids.length ? await Promise.all([
      ctx.db.select().from(paasDiskBackups).where(inArray(paasDiskBackups.diskId, ids)).orderBy(desc(paasDiskBackups.createdAt)),
      ctx.db.select().from(paasSftpUsers).where(inArray(paasSftpUsers.diskId, ids)).orderBy(paasSftpUsers.createdAt),
    ]) : [[], []];
    const t = paasTools(), running = !!app.liveDeployment && app.status === "running";
    const spec = disks.length ? await appSpec(ctx.db, app) : null;
    const usage = new Map<string, number | null>();
    if (running && spec) for (const d of disks) usage.set(d.id, await t.usage(spec, { name: d.name, mount: d.mountPath }).catch(() => null));
    return {
      running, diskPrice: DISK_PRICE_GB, maxDisks: MAX_DISKS,
      sftp: { host: await sftpHost(ctx), port: users.length && spec ? await t.sftpPort(spec).catch(() => null) : null },
      disks: disks.map((d) => ({
        id: d.id, name: d.name, mount: d.mountPath, sizeGb: d.sizeGb, backups: d.backups, usedBytes: usage.get(d.id) ?? null,
        backupList: backups.filter((b) => b.diskId === d.id).slice(0, 20).map((b) => ({ id: b.id, kind: b.kind, status: b.status, sizeMb: b.sizeMb, error: b.error, at: faDateTime(b.createdAt) })),
        sftpUsers: users.filter((u) => u.diskId === d.id).map((u) => ({ id: u.id, username: u.username, access: u.access, at: faDateTime(u.createdAt) })),
      })),
    };
  }),

  "paas.addDisk": method(z.tuple([id, z.object({ name: z.string().trim().toLowerCase().max(20), mount: z.string().trim().max(200), sizeGb: z.number().int().min(1).max(MAX_DISK_GB) })]), async (ctx, [appId, i]) => {
    const { a, app } = await ownApp(ctx, appId);
    if (!DISK_NAME_RE.test(i.name)) fail("نام دیسک فقط حروف کوچک انگلیسی، عدد و خط تیره (۲ تا ۲۰ نویسه).");
    const e = mountError(i.mount);
    if (e) fail(e);
    if (app.instances > 1 || app.autoscale) fail("اپ دارای دیسک فقط با یک نمونه اجرا می‌شود؛ اول تعداد نمونه را ۱ و مقیاس خودکار را خاموش کنید.");
    if (app.workerInstances > 0) fail("پردازش‌های پس‌زمینه به دیسک دسترسی ندارند؛ اول آن‌ها را صفر کنید.");
    const disks = await ensureDisks(ctx.db, app);
    if (disks.length >= MAX_DISKS) fail("حداکثر " + MAX_DISKS.toLocaleString("fa-IR") + " دیسک برای هر اپ.");
    if (disks.some((d) => d.name === i.name)) fail("دیسکی با این نام دارید.");
    const clash = disks.find((d) => mountsOverlap(d.mountPath, i.mount));
    if (clash) fail("مسیر " + i.mount + " با مسیر دیسک «" + clash.name + "» (" + clash.mountPath + ") هم‌پوشانی دارد.");
    if (disks.reduce((s, d) => s + d.sizeGb, 0) + i.sizeGb > MAX_DISK_GB * 2) fail("مجموع دیسک‌های یک اپ حداکثر " + (MAX_DISK_GB * 2).toLocaleString("fa-IR") + " گیگابایت است.");
    await needCredit(ctx, a.uid, i.sizeGb * DISK_PRICE_GB);
    const diskId = rid("dsk");
    await ctx.db.insert(paasDisks).values({ id: diskId, appId: app.id, name: i.name, mountPath: i.mount, sizeGb: i.sizeGb });
    const next = await syncDiskTotals(ctx.db, app.id);
    await logEvent(ctx.db, app.id, "scale", "دیسک " + i.name + " (" + i.sizeGb + " گیگ) در " + i.mount);
    await logActivity(ctx.db, a.uid, "hard-drive", "دیسک جدید " + i.name + " برای " + app.name, ctx.ip);
    await redeployConfig(ctx.db, next, "دیسک جدید " + i.name);
    return diskId;
  }),

  /** grow a disk, move its mount path or switch its daily backup */
  "paas.updateDisk": method(z.tuple([id, z.object({ sizeGb: z.number().int().min(1).max(MAX_DISK_GB).optional(), mount: z.string().trim().max(200).optional(), backups: z.boolean().optional() })]), async (ctx, [diskId, p]) => {
    const { a, d, app } = await ownDisk(ctx, diskId);
    if (p.sizeGb !== undefined && p.sizeGb < d.sizeGb) fail("حجم دیسک فقط قابل افزایش است.");
    if (p.mount !== undefined && p.mount !== d.mountPath) {
      const e = mountError(p.mount);
      if (e) fail(e);
      const others = (await appDisks(ctx.db, app)).filter((x) => x.id !== d.id);
      const clash = others.find((x) => mountsOverlap(x.mountPath, p.mount!));
      if (clash) fail("مسیر " + p.mount + " با مسیر دیسک «" + clash.name + "» هم‌پوشانی دارد.");
    }
    const grow = (p.sizeGb ?? d.sizeGb) - d.sizeGb;
    if (grow > 0) await needCredit(ctx, a.uid, grow * DISK_PRICE_GB);
    await ctx.db.update(paasDisks).set({ ...(p.sizeGb !== undefined ? { sizeGb: p.sizeGb } : {}), ...(p.mount !== undefined ? { mountPath: p.mount } : {}), ...(p.backups !== undefined ? { backups: p.backups } : {}) }).where(eq(paasDisks.id, d.id));
    const next = await syncDiskTotals(ctx.db, app.id);
    if (grow > 0 || (p.mount !== undefined && p.mount !== d.mountPath)) {
      await logEvent(ctx.db, app.id, "scale", "دیسک " + d.name + ": " + (p.sizeGb ?? d.sizeGb) + " گیگ در " + (p.mount ?? d.mountPath));
      await logActivity(ctx.db, a.uid, "hard-drive", "تغییر دیسک " + d.name + " اپ " + app.name, ctx.ip);
      return redeployConfig(ctx.db, next, "تغییر دیسک " + d.name);
    }
    return null;
  }),

  "paas.deleteDisk": method(z.tuple([id, z.string().max(20)]), async (ctx, [diskId, confirm]) => {
    const { a, d, app } = await ownDisk(ctx, diskId);
    if (confirm !== d.name) fail("برای حذف، نام دیسک را دقیق وارد کنید.");
    const backups = await ctx.db.select().from(paasDiskBackups).where(eq(paasDiskBackups.diskId, d.id));
    await ctx.db.delete(paasDisks).where(eq(paasDisks.id, d.id));
    const next = await syncDiskTotals(ctx.db, app.id);
    await redeployConfig(ctx.db, next, "حذف دیسک " + d.name);
    const t = paasTools(), spec = await appSpec(ctx.db, next);
    // the volume is released once no pod uses it (Kubernetes keeps it until the new release replaced the pod)
    await t.removeDisk(spec, d.name).catch(() => undefined);
    for (const b of backups) if (b.location) await t.deleteBackup(b.location).catch(() => undefined);
    await logEvent(ctx.db, app.id, "scale", "حذف دیسک " + d.name);
    await logActivity(ctx.db, a.uid, "trash-2", "حذف دیسک " + d.name + " اپ " + app.name, ctx.ip);
  }),

  /* ---------------- file manager ---------------- */
  "paas.fsList": method(z.tuple([id, pathArg]), async (ctx, [diskId, p]) => {
    const { app, ref } = await ownDisk(ctx, diskId);
    needRunning(app);
    const r = rel(p);
    const entries = await tool(async () => paasTools().list(await appSpec(ctx.db, app), ref, r));
    return { path: r, entries: entries.sort((x, y) => Number(y.dir) - Number(x.dir) || x.name.localeCompare(y.name)).map((e) => ({ ...e, editable: !e.dir && editable(e.name, e.size) })) };
  }),
  "paas.fsRead": method(z.tuple([id, pathArg]), async (ctx, [diskId, p]) => {
    const { app, ref } = await ownDisk(ctx, diskId);
    needRunning(app);
    const buf = await tool(async () => paasTools().readFile(await appSpec(ctx.db, app), ref, rel(p, false), MAX_EDIT_BYTES + 1));
    if (buf.length > MAX_EDIT_BYTES) fail("فایل‌های بزرگ‌تر از ۱ مگابایت را دانلود کنید.");
    if (buf.includes(0)) fail("این فایل متنی نیست؛ آن را دانلود کنید.");
    return buf.toString("utf8");
  }),
  "paas.fsWrite": method(z.tuple([id, pathArg, z.string().max(MAX_EDIT_BYTES)]), async (ctx, [diskId, p, content]) => {
    const { a, app, ref, d } = await ownDisk(ctx, diskId);
    needRunning(app);
    const r = rel(p, false);
    await tool(async () => paasTools().writeFile(await appSpec(ctx.db, app), ref, r, Buffer.from(content, "utf8")));
    await logActivity(ctx.db, a.uid, "file-pen", "ویرایش " + d.name + ":/" + r + " در " + app.name, ctx.ip);
  }),
  "paas.fsMkdir": method(z.tuple([id, pathArg]), async (ctx, [diskId, p]) => {
    const { app, ref } = await ownDisk(ctx, diskId);
    needRunning(app);
    const r = rel(p, false);
    const n = nameError(r.slice(r.lastIndexOf("/") + 1));
    if (n) fail(n);
    await tool(async () => paasTools().mkdir(await appSpec(ctx.db, app), ref, r));
  }),
  "paas.fsRename": method(z.tuple([id, pathArg, pathArg]), async (ctx, [diskId, from, to]) => {
    const { app, ref } = await ownDisk(ctx, diskId);
    needRunning(app);
    const f = rel(from, false), t = rel(to, false);
    if (t === f) return;
    if (t.startsWith(f + "/")) fail("پوشه را نمی‌توان به داخل خودش برد.");
    const n = nameError(t.slice(t.lastIndexOf("/") + 1));
    if (n) fail(n);
    await tool(async () => paasTools().rename(await appSpec(ctx.db, app), ref, f, t));
  }),
  "paas.fsDelete": method(z.tuple([id, z.array(pathArg).min(1).max(200)]), async (ctx, [diskId, paths]) => {
    const { a, app, ref, d } = await ownDisk(ctx, diskId);
    needRunning(app);
    const list = paths.map((p) => rel(p, false));
    await tool(async () => paasTools().remove(await appSpec(ctx.db, app), ref, list));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف " + list.length.toLocaleString("fa-IR") + " مورد از دیسک " + d.name + " اپ " + app.name, ctx.ip);
  }),
  "paas.fsSearch": method(z.tuple([id, pathArg, z.string().trim().min(1).max(100)]), async (ctx, [diskId, p, q]) => {
    const { app, ref } = await ownDisk(ctx, diskId);
    needRunning(app);
    return tool(async () => paasTools().search(await appSpec(ctx.db, app), ref, rel(p), q, 200));
  }),
  /** unpacks a ZIP on the disk into a folder (checked with the platform's ZIP reader: no unsafe paths, size caps) */
  "paas.fsExtract": method(z.tuple([id, pathArg, pathArg]), async (ctx, [diskId, zipPath, dest]) => {
    const { a, app, ref, d } = await ownDisk(ctx, diskId);
    needRunning(app);
    const zr = rel(zipPath, false), dr = rel(dest);
    const t = paasTools(), spec = await appSpec(ctx.db, app);
    const buf = await tool(() => t.readFile(spec, ref, zr, 200 * 1024 * 1024 + 1));
    if (buf.length > 200 * 1024 * 1024) fail("فایل ZIP باید کمتر از ۲۰۰ مگابایت باشد.");
    try {
      const entries = listZip(buf).filter((e) => !e.name.startsWith("__MACOSX/"));
      const sizes = entries.map((e) => ({ dir: e.dir, size: e.dir ? 0 : e.usize }));
      await tool(() => t.untar(spec, ref, dr, tarEntries(entries.map((e) => ({ name: e.name, dir: e.dir, data: () => readEntry(buf, e, ZIP_LIMITS.totalBytes) }))), tarSize(sizes)));
      await logActivity(ctx.db, a.uid, "file-archive", "باز کردن " + zr + " روی دیسک " + d.name + " اپ " + app.name, ctx.ip);
      return entries.filter((e) => !e.dir).length;
    } catch (e) {
      if (e instanceof ZipError) fail(e.message);
      throw e;
    }
  }),

  /* ---------------- SFTP ---------------- */
  "paas.sftpCreate": method(z.tuple([id, z.object({ username: z.string().trim().toLowerCase().max(31), access: z.enum(["ro", "rw"]) })]), async (ctx, [diskId, i]) => {
    const { a, d, app } = await ownDisk(ctx, diskId);
    if (!SFTP_USER_RE.test(i.username)) fail("نام کاربری: حروف کوچک انگلیسی، عدد و _؛ ۳ تا ۳۱ نویسه و با حرف شروع شود.");
    if (["root", "admin", "sftp", "sshd", "nobody", "daemon"].includes(i.username)) fail("این نام کاربری رزرو است.");
    if (app.source === "compose") fail("SFTP برای اپ‌های Docker Compose پشتیبانی نمی‌شود.");
    const [taken] = await ctx.db.select({ id: paasSftpUsers.id }).from(paasSftpUsers).where(eq(paasSftpUsers.username, i.username));
    if (taken) fail("این نام کاربری گرفته شده است.");
    const [n] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(paasSftpUsers).innerJoin(paasDisks, eq(paasDisks.id, paasSftpUsers.diskId)).where(eq(paasDisks.appId, app.id));
    if ((n?.n ?? 0) >= MAX_SFTP_USERS) fail("حداکثر " + MAX_SFTP_USERS.toLocaleString("fa-IR") + " حساب SFTP برای هر اپ.");
    const pw = password();
    await sftpHostKey(ctx.db, app.id);
    await ctx.db.insert(paasSftpUsers).values({ id: rid("sftp"), diskId: d.id, username: i.username, passwordEnc: seal(pw), access: i.access });
    await logActivity(ctx.db, a.uid, "key-round", "حساب SFTP " + i.username + " برای دیسک " + d.name + " اپ " + app.name, ctx.ip);
    await redeployConfig(ctx.db, app, "حساب SFTP " + i.username);
    return { password: pw };
  }),
  "paas.sftpUpdate": method(z.tuple([id, z.object({ access: z.enum(["ro", "rw"]).optional(), resetPassword: z.boolean().optional() })]), async (ctx, [userId, p]) => {
    const { a, u, app } = await ownSftp(ctx, userId);
    const pw = p.resetPassword ? password() : null;
    await ctx.db.update(paasSftpUsers).set({ ...(p.access ? { access: p.access } : {}), ...(pw ? { passwordEnc: seal(pw) } : {}) }).where(eq(paasSftpUsers.id, u.id));
    await logActivity(ctx.db, a.uid, "key-round", (pw ? "رمز جدید" : "تغییر دسترسی") + " حساب SFTP " + u.username, ctx.ip);
    await redeployConfig(ctx.db, app, "تغییر حساب SFTP " + u.username);
    return { password: pw };
  }),
  /** the password (sealed at rest; each reveal is logged) */
  "paas.sftpReveal": method(z.tuple([id]), async (ctx, [userId]) => {
    const { a, u } = await ownSftp(ctx, userId);
    await logActivity(ctx.db, a.uid, "key-round", "نمایش رمز حساب SFTP " + u.username, ctx.ip);
    return open(u.passwordEnc) ?? "";
  }),
  "paas.sftpDelete": method(z.tuple([id]), async (ctx, [userId]) => {
    const { a, u, app } = await ownSftp(ctx, userId);
    await ctx.db.delete(paasSftpUsers).where(eq(paasSftpUsers.id, u.id));
    await logActivity(ctx.db, a.uid, "trash-2", "حذف حساب SFTP " + u.username, ctx.ip);
    await redeployConfig(ctx.db, app, "حذف حساب SFTP " + u.username);
  }),

  /* ---------------- disk backups ---------------- */
  "paas.diskBackup": method(z.tuple([id]), async (ctx, [diskId]) => {
    const { a, d, app } = await ownDisk(ctx, diskId);
    needRunning(app);
    const [busy] = await ctx.db.select({ id: paasDiskBackups.id }).from(paasDiskBackups).where(and(eq(paasDiskBackups.diskId, d.id), inArray(paasDiskBackups.status, ["running", "restoring"])));
    if (busy) fail("یک پشتیبان‌گیری یا بازگردانی در جریان است.");
    const [n] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(paasDiskBackups).where(and(eq(paasDiskBackups.diskId, d.id), eq(paasDiskBackups.kind, "manual")));
    if ((n?.n ?? 0) >= 10) fail("حداکثر ۱۰ پشتیبان دستی؛ پشتیبان‌های قدیمی را حذف کنید.");
    const bid = rid("dbk");
    await ctx.db.insert(paasDiskBackups).values({ id: bid, diskId: d.id, kind: "manual" });
    await enqueue(ctx.db, "paas.diskBackup", { backupId: bid });
    await logActivity(ctx.db, a.uid, "archive", "پشتیبان‌گیری از دیسک " + d.name + " اپ " + app.name, ctx.ip);
    return bid;
  }),
  /** replaces the disk's files with the backup's */
  "paas.diskRestore": method(z.tuple([id]), async (ctx, [bid]) => {
    const { a, b, d, app } = await ownBackup(ctx, bid);
    needRunning(app);
    if (b.status !== "done" || !b.location) fail("پشتیبان آماده پیدا نشد.");
    const [busy] = await ctx.db.select({ id: paasDiskBackups.id }).from(paasDiskBackups).where(and(eq(paasDiskBackups.diskId, d.id), inArray(paasDiskBackups.status, ["running", "restoring"])));
    if (busy) fail("یک پشتیبان‌گیری یا بازگردانی در جریان است.");
    await ctx.db.update(paasDiskBackups).set({ status: "restoring", error: "" }).where(eq(paasDiskBackups.id, b.id));
    await enqueue(ctx.db, "paas.diskBackup", { backupId: b.id, restore: true });
    await logActivity(ctx.db, a.uid, "archive-restore", "بازگردانی دیسک " + d.name + " اپ " + app.name + " از پشتیبان " + b.createdAt.toISOString().slice(0, 16), ctx.ip);
  }),
  "paas.diskBackupLink": method(z.tuple([id]), async (ctx, [bid]) => {
    const { a, b, d, app } = await ownBackup(ctx, bid);
    if (b.status !== "done" || !b.location) fail("پشتیبان آماده پیدا نشد.");
    await logActivity(ctx.db, a.uid, "download", "دانلود پشتیبان دیسک " + d.name + " اپ " + app.name, ctx.ip);
    return tool(() => paasTools().backupLink(b.location, app.name + "-" + d.name + "-" + b.id + ".tar.gz"));
  }),
  "paas.diskBackupDelete": method(z.tuple([id]), async (ctx, [bid]) => {
    const { b } = await ownBackup(ctx, bid);
    if (b.status === "running" || b.status === "restoring") fail("این پشتیبان در حال استفاده است.");
    if (b.location) await paasTools().deleteBackup(b.location).catch(() => undefined);
    await ctx.db.delete(paasDiskBackups).where(eq(paasDiskBackups.id, b.id));
  }),

  /* ---------------- logs ---------------- */
  "paas.logSearch": method(z.tuple([id, z.object({
    q: z.string().trim().max(200).optional(), levels: z.array(z.enum(["debug", "info", "warn", "error"])).max(4).optional(),
    from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), before: z.number().int().positive().optional(), limit: z.number().int().min(10).max(1000).default(300),
  })]), async (ctx, [appId, o]) => {
    const { app } = await ownApp(ctx, appId);
    const [plan] = await ctx.db.select({ days: paasPlans.logDays }).from(paasPlans).where(eq(paasPlans.id, app.planId));
    const rows = await searchLogs(ctx.db, app.id, { q: o.q || undefined, levels: o.levels, from: o.from ? new Date(o.from) : undefined, to: o.to ? new Date(o.to) : undefined, before: o.before, limit: o.limit + 1 });
    const page = rows.slice(0, o.limit);
    return { retentionDays: plan?.days ?? 7, more: rows.length > o.limit, cursor: page.at(-1)?.id ?? null, lines: page.reverse().map((l) => ({ id: l.id, at: l.at.toISOString(), level: l.level, instance: l.instance, line: l.line })) };
  }),

  /* ---------------- env file ---------------- */
  /** the app's variables as a .env file, secret values included (logged) */
  "paas.envFile": method(z.tuple([id]), async (ctx, [appId]) => {
    const { a, app } = await ownApp(ctx, appId);
    const rows = await ctx.db.select().from(paasEnv).where(and(eq(paasEnv.appId, app.id), isNull(paasEnv.managedBy))).orderBy(paasEnv.key);
    const linked = new Set((await ctx.db.select({ k: paasLinks.envKey }).from(paasLinks).where(eq(paasLinks.appId, app.id))).map((l) => l.k));
    await logActivity(ctx.db, a.uid, "download", "خروجی ‎.env‎ اپ " + app.name, ctx.ip);
    return toDotenv(rows.filter((r) => !linked.has(r.key)).map((r) => ({ key: r.key, value: open(r.valueEnc) ?? "" })));
  }),

  /* ---------------- releases ---------------- */
  "paas.releases": method(z.tuple([id]), async (ctx, [appId]) => {
    const { app } = await ownApp(ctx, appId);
    const deps = await ctx.db.select().from(paasDeployments).where(and(eq(paasDeployments.appId, app.id), ne(paasDeployments.status, "cancelled"))).orderBy(desc(paasDeployments.createdAt)).limit(50);
    const out = [];
    for (const d of deps) {
      const links = app.source === "git" && d.ref ? commitLinks(app.gitUrl, d.ref) : null;
      const zip = d.uploadPath ? await access(d.uploadPath).then(() => true, () => false) : false;
      out.push({
        id: d.id, status: d.status, trigger: d.trigger, target: d.target, branch: d.branch || (app.source === "git" ? app.gitBranch : ""), ref: d.ref, message: d.message, at: faDateTime(d.createdAt), live: d.id === app.liveDeployment,
        image: d.image.startsWith("compose:") ? "compose" : d.image, commitUrl: links?.commit ?? "", archiveUrl: links?.archive ?? "", source: zip ? "/api/paas/release/" + d.id : "",
        seconds: d.startedAt && d.finishedAt ? Math.round((d.finishedAt.getTime() - d.startedAt.getTime()) / 1000) : null,
      });
    }
    return out;
  }),

  /* ---------------- metrics ---------------- */
  "paas.metrics": method(z.tuple([id, z.enum(Object.keys(METRIC_RANGES) as ["1h", "24h", "7d", "30d"])]), async (ctx, [appId, range]) => {
    const { app } = await ownApp(ctx, appId);
    const [plan] = await ctx.db.select({ ramMb: paasPlans.ramMb }).from(paasPlans).where(eq(paasPlans.id, app.planId));
    return { range, ramLimitMb: (plan?.ramMb ?? 256) * app.instances, points: await metricSeries(ctx.db, app.id, range) };
  }),

  /* ---------------- staff ---------------- */
  "paas.adminLogDays": method(z.tuple([]), async (ctx) => {
    needStaff(ctx, "products");
    return ctx.db.select({ id: paasPlans.id, name: paasPlans.name, logDays: paasPlans.logDays }).from(paasPlans).where(eq(paasPlans.kind, "app")).orderBy(paasPlans.position);
  }),
  "paas.adminSetLogDays": method(z.tuple([id, z.number().int()]), async (ctx, [planId, days]) => {
    needStaff(ctx, "products");
    if (!LOG_DAYS.includes(days)) fail("نگهداری لاگ باید ۷، ۳۰ یا ۶۰ روز باشد.");
    const r = await ctx.db.update(paasPlans).set({ logDays: days }).where(and(eq(paasPlans.id, planId), eq(paasPlans.kind, "app"))).returning({ id: paasPlans.id });
    if (!r.length) fail("پلن پیدا نشد.", 404);
    await logAudit(ctx.db, actor(ctx), "نگهداری لاگ پلن گره اپ: " + days + " روز", planId, ctx.ip);
  }),
};

async function ownSftp(ctx: Ctx, userId: string) {
  const a = needUser(ctx);
  const [row] = await ctx.db.select({ u: paasSftpUsers, app: paasApps }).from(paasSftpUsers).innerJoin(paasDisks, eq(paasDisks.id, paasSftpUsers.diskId)).innerJoin(paasApps, eq(paasApps.id, paasDisks.appId))
    .where(and(eq(paasSftpUsers.id, userId), eq(paasApps.userId, a.uid)));
  if (!row) fail("حساب SFTP پیدا نشد.", 404);
  return { a, u: row!.u, app: row!.app };
}
async function ownBackup(ctx: Ctx, bid: string) {
  const a = needUser(ctx);
  const [row] = await ctx.db.select({ b: paasDiskBackups, d: paasDisks, app: paasApps }).from(paasDiskBackups).innerJoin(paasDisks, eq(paasDisks.id, paasDiskBackups.diskId)).innerJoin(paasApps, eq(paasApps.id, paasDisks.appId))
    .where(and(eq(paasDiskBackups.id, bid), eq(paasApps.userId, a.uid)));
  if (!row) fail("پشتیبان پیدا نشد.", 404);
  if (row!.app.status === "suspended") fail("این اپ معلق است.", 403);
  return { a, ...row! };
}
