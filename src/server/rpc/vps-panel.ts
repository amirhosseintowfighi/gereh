/* Cloud-server panel, Virtualizor enduser level: disk layout (split the plan's disk into several disks), usage
   charts (1h / 24h / 7d / 30d), one log timeline (Virtualizor's log and tasks + the site's task log + the sync's
   change log), Virtualizor backups, process and service managers, SSH keys on the VPS and IPv6 PTR.
   Every call checks ownership through server(); writes are rate limited and leave a task line. */
import "server-only";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { faDateTime } from "@/lib/jalali";
import { vpsPrices } from "../billing-extras";
import { actor, isStaff, method, type Ctx } from "../ctx";
import { osTemplates, serverTasks, servers, sshKeys, usageHourly, usageSamples, vpsDisks, vpsRelayout, vpsSync, vpsSyncLog } from "../db/schema";
import { rateLimit } from "../auth";
import { virt, type UsagePoint } from "../virt/driver";
import { layoutOf, planLayout, saveAllowance, writeLayoutDisks } from "../virt/layout";
import { startRelayout } from "../virt/relayout";
import { requestSync } from "../virt/sync";
import { notifyStaff } from "../worker/provision";
import { addTask, fail, logActivity, logAudit, rid } from "../util";
import { server, vps } from "./servers";

const id = z.string().max(40);
type Row = typeof servers.$inferSelect;
const fa = (n: number) => n.toLocaleString("fa-IR");
const log = (ctx: Ctx, s: Row, icon: string, text: string) => logActivity(ctx.db, s.userId, icon, text, ctx.ip);
const limit = (ctx: Ctx, s: Row, what: string, max: number, windowSec: number) => rateLimit(ctx.db, "vps:" + what + ":" + s.id, max, windowSec);
const FQDN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Virtualizor log/task action names (vps_start, addvs, editvs, rebuild…) in Persian; unknown ones are kept as is */
const ACTIONS: [RegExp, string][] = [
  [/poweroff/i, "قطع برق"], [/restart|reboot/i, "ری‌استارت"], [/start|boot/i, "روشن کردن"], [/stop|shutdown/i, "خاموش کردن"],
  [/unsuspend/i, "رفع تعلیق"], [/suspend/i, "تعلیق"], [/addvs|createvps|^create/i, "ساخت VPS"], [/rebuild|reinstall|ostemplate|reinsos/i, "نصب مجدد سیستم‌عامل"],
  [/hostname/i, "تغییر hostname"], [/vncpass/i, "تغییر رمز VNC"], [/changepass|password/i, "تغییر رمز root"], [/rescue/i, "حالت ریسکیو"],
  [/restore/i, "بازیابی بکاپ"], [/backup/i, "بکاپ"], [/migrat/i, "انتقال به نود دیگر"], [/clone/i, "کپی VPS"], [/rdns|ptr/i, "Reverse DNS"],
  [/editvs|managevps|edit/i, "ویرایش مشخصات"], [/disk|volume/i, "تغییر دیسک"], [/iso/i, "ISO"], [/ip/i, "تغییر IP"], [/delete|delvs/i, "حذف VPS"],
  [/controlpanel|webuzo/i, "نصب کنترل‌پنل"], [/sshkey/i, "کلید SSH"], [/process/i, "مدیریت پردازه"], [/service/i, "مدیریت سرویس"], [/bandwidth/i, "ترافیک"],
];
export const virtActionText = (action: string) => ACTIONS.find(([re]) => re.test(action))?.[1] ?? action;

/** averages points into buckets of `ms` (for long ranges and over-long series) */
function bucket(points: UsagePoint[], ms: number): UsagePoint[] {
  const m = new Map<number, UsagePoint & { n: number }>();
  for (const p of points) {
    const k = Math.floor(p.t / ms) * ms;
    const b = m.get(k);
    if (!b) { m.set(k, { ...p, t: k, n: 1 }); continue; }
    for (const f of ["cpu", "ram", "disk", "netIn", "netOut", "ioRead", "ioWrite"] as const) b[f] = (b[f] * b.n + p[f]) / (b.n + 1);
    b.n++;
  }
  return [...m.values()].sort((a, b) => a.t - b.t).map(({ n: _n, ...p }) => ({ ...p, cpu: +p.cpu.toFixed(1), ram: +p.ram.toFixed(1), disk: +p.disk.toFixed(1), netIn: +p.netIn.toFixed(2), netOut: +p.netOut.toFixed(2), ioRead: +p.ioRead.toFixed(1), ioWrite: +p.ioWrite.toFixed(1) }));
}
const RANGES = { "1h": [3600_000, 0], "24h": [86400_000, 300_000], "7d": [7 * 86400_000, 3600_000], "30d": [30 * 86400_000, 4 * 3600_000] } as const;

export type VpsLogItem = { id: string; source: "virtualizor" | "site" | "sync"; at: string; ts: number; text: string; status: "done" | "running" | "failed" };

export const vpsPanelRpc = {
  /* ---------- disk layout ---------- */
  "servers.layout": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid, { write: false });
    const [l, p, [r]] = await Promise.all([layoutOf(ctx.db, s), vpsPrices(ctx.db), ctx.db.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, s.id))]);
    return {
      allowanceGb: l.allowance, usedGb: l.used, maxDisks: p.maxDisks + 1,
      disks: [{ slot: 0, sizeGb: s.disk, primary: true }, ...l.free.map((d) => ({ slot: d.slot ?? 0, sizeGb: d.sizeGb, primary: false }))],
      billed: l.billed.map((d) => ({ name: d.name, sizeGb: d.sizeGb })),
      // a layout being applied by recreating the VPS: what it becomes and how far it got
      relayout: r ? { sizes: r.sizes, os: r.os, step: r.step, since: faDateTime(r.requestedAt) } : null,
    };
  }),

  /** sizes: GB per disk, primary first, summing to the allowance. Appending disks from unused allowance keeps every
      byte, and so does growing disks (Virtualizor's Edit VPS). A disk that shrinks or goes away cannot be edited:
      the VPS is recreated with `os` by the worker (../virt/relayout.ts), after the hostname is typed as confirmation;
      that answers { mode: "rebuild" } at once and the server shows the transition until it is done. */
  "servers.setLayout": method(z.tuple([id, z.object({ sizes: z.array(z.number().int().min(1).max(100_000)).min(1).max(16), os: z.string().max(80).optional(), confirm: z.string().max(253).optional() })]), async (ctx, [sid, req]) => {
    const s = await server(ctx, sid);
    const vpsid = vps(s);
    const [l, p] = await Promise.all([layoutOf(ctx.db, s), vpsPrices(ctx.db)]);
    const mode = planLayout(l.current, req.sizes, l.allowance, p.maxDisks + 1);
    const [tpl] = mode === "rebuild" && req.os ? await ctx.db.select().from(osTemplates).where(and(eq(osTemplates.name, req.os), eq(osTemplates.on, true))) : [];
    const billedMsg = "دیسک‌های اضافه خریداری‌شده (" + l.billed.map((d) => d.name).join("، ") + ") به سرور وصل‌اند؛ پیش از تغییر چیدمان آن‌ها را جدا کنید تا داده‌شان حفظ شود.";
    if (mode === "rebuild") {
      if ((req.confirm ?? "").trim().toLowerCase() !== s.hostname.toLowerCase()) fail("برای تأیید، hostname سرور را دقیق بنویسید: " + s.hostname);
      if (l.billed.length) fail(billedMsg);
      if (!tpl) fail("سیستم‌عاملی را که پس از تغییر چیدمان نصب می‌شود انتخاب کنید.");
      if (s.status !== "running" && s.status !== "stopped") fail("سرور باید روشن یا خاموش باشد تا دیسک‌هایش بازسازی شود.", 409);
    }
    // Edit VPS rewrites the whole disk list: a paid disk left out of it would be dropped
    if (mode === "grow" && l.billed.length) fail(billedMsg);
    await limit(ctx, s, "layout", 3, 600);
    const staffDid = isStaff(ctx, "services") && ctx.auth!.uid !== s.userId;
    const before = l.current.join("+"), after = req.sizes.join("+");
    if (mode === "rebuild") {
      await startRelayout(ctx.db, s, { sizes: req.sizes, before: l.current, allowance: l.allowance, osid: tpl!.osid, os: tpl!.name, by: staffDid ? "پشتیبانی" : "مشتری" });
      await log(ctx, s, "hard-drive", "درخواست چیدمان دیسک " + l.current.map(fa).join("+") + "→" + req.sizes.map(fa).join("+") + " گیگ (ساخت دوباره سرور) روی " + s.name);
      if (staffDid) await logAudit(ctx.db, actor(ctx), "تغییر چیدمان دیسک " + after + " (ساخت دوباره)", s.id, ctx.ip);
      return { mode };
    }
    const v = await virt();
    try {
      if (mode === "append") {
        for (const size of req.sizes.slice(l.current.length)) {
          const slot = await v.addDisk(vpsid, size);
          await ctx.db.insert(vpsDisks).values({ id: rid("vd"), userId: s.userId, serverId: s.id, name: "disk-" + slot, loc: s.loc, sizeGb: size, slot, billed: false });
        }
      } else {
        const slots = await v.setDiskLayout(vpsid, req.sizes);
        await writeLayoutDisks(ctx.db, s, req.sizes, slots);
      }
    } catch (e) {
      // the customer sees Virtualizor's reason; staff get the full error and the task log keeps it
      const why = (e as Error).message.slice(0, 500);
      console.error("[vps] layout " + s.id + " " + before + "→" + after, e);
      await addTask(ctx.db, s.id, "تغییر چیدمان دیسک " + before + "→" + after + " ناموفق: " + why, "failed", 0);
      await notifyStaff(ctx.db, "تغییر چیدمان دیسک " + s.name + " (vpsid " + vpsid + ") ناموفق بود: " + why);
      await requestSync(ctx.db, s.id);
      throw e;
    }
    await saveAllowance(ctx.db, s.id, l.allowance);
    const text = "چیدمان دیسک " + l.current.map(fa).join("+") + "→" + req.sizes.map(fa).join("+") + " گیگ" + (mode === "grow" ? " (بدون پاک شدن داده)" : "");
    await addTask(ctx.db, s.id, text);
    await ctx.db.insert(vpsSyncLog).values({ serverId: s.id, userId: s.userId, field: "layout", before, after, text: text + " توسط " + (staffDid ? "پشتیبانی" : "مشتری") });
    await log(ctx, s, "hard-drive", text + " روی " + s.name);
    if (staffDid) await logAudit(ctx.db, actor(ctx), "تغییر چیدمان دیسک " + after, s.id, ctx.ip);
    await requestSync(ctx.db, s.id);
    return { mode };
  }),

  /* ---------- usage charts ---------- */
  "servers.stats": method(z.tuple([id, z.enum(["1h", "24h", "7d", "30d"])]), async (ctx, [sid, range]) => {
    const s = await server(ctx, sid, { write: false });
    const [span, step] = RANGES[range];
    const since = new Date(Date.now() - span);
    let points: UsagePoint[];
    if (range === "1h" || range === "24h") {
      const rows = await ctx.db.select().from(usageSamples).where(and(eq(usageSamples.serverId, s.id), gte(usageSamples.createdAt, since))).orderBy(asc(usageSamples.createdAt));
      points = rows.map((r) => ({ t: r.createdAt.getTime(), cpu: r.cpu, ram: r.ram, disk: r.disk, netIn: r.netIn, netOut: r.netOut, ioRead: r.ioRead, ioWrite: r.ioWrite }));
    } else {
      const rows = await ctx.db.select().from(usageHourly).where(and(eq(usageHourly.serverId, s.id), gte(usageHourly.hour, since))).orderBy(asc(usageHourly.hour));
      points = rows.map((r) => ({ t: r.hour.getTime(), cpu: r.cpu, ram: r.ram, disk: r.disk, netIn: r.netIn, netOut: r.netOut, ioRead: r.ioRead, ioWrite: r.ioWrite }));
    }
    let source: "site" | "virtualizor" | "none" = points.length ? "site" : "none";
    // too little collected yet (new server, or collection just fixed): Virtualizor's own status log fills in
    if (points.length < 3 && s.vpsid) {
      const h = await (await virt()).history(s.vpsid, since.getTime()).catch(() => [] as UsagePoint[]);
      if (h.length > points.length) { points = h; source = "virtualizor"; }
    }
    if (step) points = bucket(points, step);
    return { range, source, points };
  }),

  /* ---------- logs: one timeline ---------- */
  "servers.logs": method(z.tuple([id, z.object({ page: z.number().int().min(1).max(500).default(1), source: z.enum(["all", "virtualizor", "site", "sync"]).default("all"), q: z.string().max(80).default("") })]), async (ctx, [sid, f]) => {
    const s = await server(ctx, sid, { write: false });
    await limit(ctx, s, "logs", 60, 60);
    const [tasks, changes] = await Promise.all([
      f.source === "all" || f.source === "site" ? ctx.db.select().from(serverTasks).where(eq(serverTasks.serverId, s.id)).orderBy(desc(serverTasks.createdAt)).limit(1000) : [],
      f.source === "all" || f.source === "sync" ? ctx.db.select().from(vpsSyncLog).where(eq(vpsSyncLog.serverId, s.id)).orderBy(desc(vpsSyncLog.createdAt)).limit(1000) : [],
    ]);
    let vzError = "";
    const vz = (f.source === "all" || f.source === "virtualizor") && s.vpsid ? await (await virt()).logs(s.vpsid).catch((e: Error) => { vzError = "لاگ Virtualizor خوانده نشد: " + e.message; return []; }) : [];
    const items: VpsLogItem[] = [
      ...vz.map((e) => ({ id: "vz-" + e.id, source: "virtualizor" as const, ts: e.at.getTime(), at: faDateTime(e.at), status: e.status,
        text: virtActionText(e.action) + (e.progress < 100 && e.status === "running" ? " (" + fa(e.progress) + "٪)" : "") + (e.text && e.text !== e.action ? " — " + e.text : "") })),
      ...tasks.map((t) => ({ id: "t-" + t.id, source: "site" as const, ts: t.createdAt.getTime(), at: faDateTime(t.createdAt), status: t.status, text: t.action })),
      ...changes.map((c) => ({ id: "c-" + c.id, source: "sync" as const, ts: c.createdAt.getTime(), at: faDateTime(c.createdAt), status: "done" as const, text: c.text })),
    ];
    const q = f.q.trim().toLowerCase();
    const hits = (q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items).sort((a, b) => b.ts - a.ts);
    const per = 20, pages = Math.max(1, Math.ceil(hits.length / per)), page = Math.min(f.page, pages);
    return { items: hits.slice((page - 1) * per, page * per), total: hits.length, page, pages, vzError };
  }),

  /* ---------- Virtualizor backups ---------- */
  "servers.vzBackups": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid, { write: false });
    try { return { enabled: true, error: "", list: await (await virt()).backups(vps(s)) }; }
    catch (e) { return { enabled: false, error: (e as Error).message.slice(0, 200), list: [] }; }
  }),
  "servers.vzBackup": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    await limit(ctx, s, "backup", 2, 3600);
    await (await virt()).createBackup(vps(s));
    await addTask(ctx.db, s.id, "ساخت بکاپ در Virtualizor", "running", 10);
    await log(ctx, s, "database-backup", "ساخت بکاپ سرور " + s.name);
  }),
  "servers.vzRestore": method(z.tuple([id, z.string().max(300), z.string().max(253)]), async (ctx, [sid, backupId, confirm]) => {
    const s = await server(ctx, sid);
    if (confirm.trim().toLowerCase() !== s.hostname.toLowerCase()) fail("برای تأیید، hostname سرور را دقیق بنویسید: " + s.hostname);
    await limit(ctx, s, "restore", 2, 3600);
    const v = await virt();
    const b = (await v.backups(vps(s))).find((x) => x.id === backupId);
    if (!b) fail("این بکاپ پیدا نشد.", 404);
    await v.restoreBackup(vps(s), { date: b!.date, file: b!.file });
    await addTask(ctx.db, s.id, "بازیابی بکاپ " + b!.date, "running", 10);
    await log(ctx, s, "refresh-cw", "بازیابی بکاپ " + b!.date + " روی " + s.name);
    await requestSync(ctx.db, s.id);
  }),

  /* ---------- process and service managers ---------- */
  "servers.processes": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور خاموش است.");
    await limit(ctx, s, "proc", 30, 60);
    return (await virt()).processes(vps(s));
  }),
  "servers.killProcesses": method(z.tuple([id, z.array(z.number().int().min(2).max(4_194_304)).min(1).max(20)]), async (ctx, [sid, pids]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور خاموش است.");
    await limit(ctx, s, "kill", 10, 60);
    await (await virt()).killProcesses(vps(s), pids);
    await addTask(ctx.db, s.id, "پایان دادن به پردازه " + pids.join("، "));
  }),
  "servers.services": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور خاموش است.");
    await limit(ctx, s, "svc", 30, 60);
    return (await virt()).services(vps(s));
  }),
  "servers.serviceAction": method(z.tuple([id, z.array(z.string().regex(/^[\w@.:-]{1,80}$/)).min(1).max(10), z.enum(["start", "stop", "restart"])]), async (ctx, [sid, names, action]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور خاموش است.");
    await limit(ctx, s, "svc-act", 10, 60);
    await (await virt()).serviceAction(vps(s), names, action);
    await addTask(ctx.db, s.id, { start: "شروع", stop: "توقف", restart: "راه‌اندازی دوباره" }[action] + " سرویس " + names.join("، "));
  }),

  /* ---------- SSH keys from the account, installed on the VPS ---------- */
  "servers.applySshKeys": method(z.tuple([id, z.array(id).min(1).max(10)]), async (ctx, [sid, keyIds]) => {
    const s = await server(ctx, sid);
    const keys = await ctx.db.select().from(sshKeys).where(and(eq(sshKeys.userId, s.userId), inArray(sshKeys.id, keyIds)));
    if (keys.length !== new Set(keyIds).size) fail("کلید SSH پیدا نشد.", 404);
    await limit(ctx, s, "ssh", 5, 600);
    await (await virt()).applySshKeys(vps(s), keys.map((k) => ({ name: k.name, publicKey: k.publicKey })));
    await addTask(ctx.db, s.id, "نصب کلید SSH: " + keys.map((k) => k.name).join("، "));
    await log(ctx, s, "key-round", "نصب کلید SSH روی " + s.name);
  }),

  /* ---------- IPv6 ---------- */
  "servers.ipv6": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid, { write: false });
    const [y] = await ctx.db.select({ ipv6: vpsSync.ipv6 }).from(vpsSync).where(eq(vpsSync.serverId, s.id));
    return [...new Set([s.ipv6, ...(y?.ipv6 ?? [])].filter(Boolean))];
  }),
  "servers.setPtr6": method(z.tuple([id, z.string().max(64), z.string().max(253)]), async (ctx, [sid, addr, raw]) => {
    const s = await server(ctx, sid);
    const [y] = await ctx.db.select({ ipv6: vpsSync.ipv6 }).from(vpsSync).where(eq(vpsSync.serverId, s.id));
    if (![s.ipv6, ...(y?.ipv6 ?? [])].includes(addr)) fail("این آدرس IPv6 متعلق به این سرور نیست.", 404);
    const host = raw.trim().toLowerCase().replace(/\.$/, "");
    if (host && !FQDN_RE.test(host)) fail("نام دامنه معتبر نیست.");
    await limit(ctx, s, "ptr", 20, 600);
    await (await virt()).setPtr(vps(s), addr, host);
    await addTask(ctx.db, s.id, (host ? "تنظیم" : "حذف") + " PTR برای " + addr);
  }),
};
