/* Cloud-server extras: additional IPv4 with PTR, network reset, extra disks, snapshot schedules,
   the noVNC console, traffic packs, plan changes while stopped and reusable firewall groups. */
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, like, sql } from "drizzle-orm";
import { z } from "zod";
import { diskSizeError, PLAN_NUMS, TRAFFIC_STEP_GB, trafficError, type Plan } from "@/lib/catalog";
import { faDate, faDateTime } from "@/lib/jalali";
import { nextRun, type VpsExtrasView } from "@/lib/vps-billing";
import { debit, monthKey, needBudget, perHour, vpsPrices } from "../billing-extras";
import { method, needUser, type Ctx } from "../ctx";
import { fwGroups, fwGroupServers, plans, servers, snapshots, subWallets, users, vpsDisks, vpsIps, vpsSnapSchedules, vpsTraffic, vpsTrafficDaily, walletLinks } from "../db/schema";
import { virt } from "../virt/driver";
import { primaryFor, saveAllowance } from "../virt/layout";
import { markPushed, quotaOf, requestSync } from "../virt/sync";
import { addTask, fail, logActivity, rid } from "../util";
import { server, vps } from "./servers";

const id = z.string().max(40);
const FQDN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PORT_RE = /^(\d{1,5}(-\d{1,5})?)(,\d{1,5}(-\d{1,5})?)*$/;
const CIDR_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(\/(3[0-2]|[12]?\d))?$|^[0-9a-f:]+(\/\d{1,3})?$/i;
const DISK_NAME_RE = /^[a-z][a-z0-9-]{1,29}$/;
/** GB; the 10–500 / step-10 rule is checked with diskSizeError so the customer reads why */
const diskGb = z.number().int().min(1).max(100_000);

const ruleSchema = z.object({ proto: z.enum(["TCP", "UDP", "ICMP"]), port: z.string().max(100), source: z.string().max(60), action: z.enum(["allow", "deny"]), note: z.string().max(60) });
/** normalises and validates one firewall rule (same rules as the per-server firewall) */
export function checkRule(r: z.infer<typeof ruleSchema>) {
  const port = r.proto === "ICMP" ? "—" : r.port.replace(/\s/g, "");
  if (r.proto !== "ICMP" && (!PORT_RE.test(port) || port.split(/[,-]/).some((p) => +p < 1 || +p > 65535) || port.split(",").some((x) => { const [a, b] = x.split("-").map(Number); return b !== undefined && b < a; })))
    fail("پورت معتبر نیست؛ مثال: 22 یا 8000-8100 یا 80,443");
  if (!CIDR_RE.test(r.source.trim())) fail("مبدأ باید IP یا CIDR معتبر باشد؛ مثل 0.0.0.0/0");
  return { proto: r.proto, port, source: r.source.trim(), action: r.action, note: r.note.trim() };
}

/** adding something billed hourly needs 24 hours of its cost in the wallet */
async function needCredit(ctx: Ctx, uid: string, monthly: number) {
  const [u] = await ctx.db.select({ balance: users.balance }).from(users).where(eq(users.id, uid));
  const need = 24 * perHour(monthly);
  if ((u?.balance ?? 0) < need) fail("موجودی کیف پول کافی نیست؛ دست‌کم " + need.toLocaleString("fa-IR") + " تومان (هزینه ۲۴ ساعت) لازم است.", 402);
}
const log = (ctx: Ctx, uid: string, icon: string, text: string) => logActivity(ctx.db, uid, icon, text, ctx.ip);

async function ownDisk(ctx: Ctx, diskId: string) {
  const a = needUser(ctx);
  const [d] = await ctx.db.select().from(vpsDisks).where(and(eq(vpsDisks.id, diskId), eq(vpsDisks.userId, a.uid)));
  if (!d) fail("دیسک پیدا نشد.", 404);
  return d!;
}
async function ownGroup(ctx: Ctx, groupId: string) {
  const a = needUser(ctx);
  const [g] = await ctx.db.select().from(fwGroups).where(and(eq(fwGroups.id, groupId), eq(fwGroups.userId, a.uid)));
  if (!g) fail("گروه فایروال پیدا نشد.", 404);
  return g!;
}
/** this month's traffic row, reset when the month changed */
export async function trafficRow(db: Ctx["db"], serverId: string) {
  const month = monthKey();
  const [t] = await db.select().from(vpsTraffic).where(eq(vpsTraffic.serverId, serverId));
  if (t && t.month === month) return t;
  const fresh = { serverId, month, extraGb: 0, packs: 0, alerted: 0, usedGb: 0, autoBuy: t?.autoBuy ?? false, updatedAt: new Date() };
  await db.insert(vpsTraffic).values(fresh).onConflictDoUpdate({ target: vpsTraffic.serverId, set: { month, extraGb: 0, packs: 0, alerted: 0, usedGb: 0, updatedAt: new Date() } });
  return fresh;
}

export const vpsRpc = {
  /** everything the extra server tabs show */
  "servers.extras": method(z.tuple([id]), async (ctx, [sid]): Promise<VpsExtrasView> => {
    const s = await server(ctx, sid, { write: false });
    const prices = await vpsPrices(ctx.db);
    const [ips, disks, spare, [sched], snaps, groups, links, [link]] = await Promise.all([
      ctx.db.select().from(vpsIps).where(and(eq(vpsIps.serverId, s.id), isNull(vpsIps.goneAt))).orderBy(asc(vpsIps.createdAt)),
      ctx.db.select().from(vpsDisks).where(and(eq(vpsDisks.serverId, s.id), isNull(vpsDisks.goneAt))).orderBy(asc(vpsDisks.slot), asc(vpsDisks.createdAt)),
      ctx.db.select().from(vpsDisks).where(and(eq(vpsDisks.userId, s.userId), isNull(vpsDisks.serverId), eq(vpsDisks.loc, s.loc))),
      ctx.db.select().from(vpsSnapSchedules).where(eq(vpsSnapSchedules.serverId, s.id)),
      ctx.db.select({ size: snapshots.size }).from(snapshots).where(eq(snapshots.serverId, s.id)),
      ctx.db.select().from(fwGroups).where(eq(fwGroups.userId, s.userId)).orderBy(asc(fwGroups.createdAt)),
      ctx.db.select().from(fwGroupServers).innerJoin(fwGroups, eq(fwGroups.id, fwGroupServers.groupId)).where(eq(fwGroups.userId, s.userId)),
      ctx.db.select({ id: subWallets.id, name: subWallets.name }).from(walletLinks).innerJoin(subWallets, eq(subWallets.id, walletLinks.walletId)).where(eq(walletLinks.serverId, s.id)),
    ]);
    const t = await trafficRow(ctx.db, s.id);
    const days = await ctx.db.select().from(vpsTrafficDaily).where(and(eq(vpsTrafficDaily.serverId, s.id), like(vpsTrafficDaily.day, t.month + "-%"))).orderBy(asc(vpsTrafficDaily.day));
    const snapshotGb = snaps.reduce((a, x) => a + x.size, 0);
    const addonsMonthly = ips.reduce((a, x) => a + x.price, 0) + disks.reduce((a, d) => a + (d.billed ? d.sizeGb * prices.diskGb : 0), 0) + Math.round(snapshotGb * prices.snapshotGb);
    return {
      prices,
      ips: [{ id: "primary", ip: s.ip, rdns: s.rdns, price: 0, primary: true }, ...ips.map((x) => ({ id: x.id, ip: x.ip, rdns: x.rdns, price: x.price, primary: false }))],
      disks: disks.map((d) => ({ id: d.id, name: d.name, sizeGb: d.sizeGb, slot: d.slot, serverId: d.serverId, at: faDate(d.createdAt), billed: d.billed })),
      spareDisks: spare.map((d) => ({ id: d.id, name: d.name, sizeGb: d.sizeGb })),
      schedule: sched ? { frequency: sched.frequency, retention: sched.retention, hour: sched.hour, weekday: sched.weekday, active: sched.active, next: faDateTime(sched.nextRunAt), last: sched.lastRunAt ? faDateTime(sched.lastRunAt) : "" } : null,
      snapshotGb: +snapshotGb.toFixed(1),
      // the synced quota: Virtualizor's limit (see ../virt/sync.ts), never the catalog's text
      traffic: { month: t.month, planGb: s.bwLimit, extraGb: t.extraGb, quotaGb: quotaOf(s.bwLimit, t.extraGb), packs: t.packs, usedGb: +t.usedGb.toFixed(1), autoBuy: t.autoBuy, days: days.map((d) => ({ day: d.day, inGb: +(d.inMb / 1024).toFixed(2), outGb: +(d.outMb / 1024).toFixed(2) })) },
      groups: groups.map((g) => ({ id: g.id, name: g.name, rules: g.rules, attached: links.some((l) => l.fw_group_servers.groupId === g.id && l.fw_group_servers.serverId === s.id), servers: links.filter((l) => l.fw_group_servers.groupId === g.id).length })),
      wallet: link ?? null,
      addonsMonthly,
    };
  }),

  /* ---------- network ---------- */
  "servers.addIp": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    const p = await vpsPrices(ctx.db);
    const extra = await ctx.db.select().from(vpsIps).where(and(eq(vpsIps.serverId, s.id), isNull(vpsIps.goneAt)));
    if (extra.length >= p.maxIps) fail("حداکثر " + p.maxIps.toLocaleString("fa-IR") + " IPv4 اضافه برای هر سرور.");
    await needCredit(ctx, s.userId, p.ip);
    await needBudget(ctx.db, s.userId, "vps", perHour(p.ip) * 24);
    const keep = [s.ip, ...extra.map((x) => x.ip)];
    const all = await (await virt()).setIps(vps(s), keep, keep.length + 1);
    const ip = all.find((x) => !keep.includes(x));
    if (!ip) fail("آدرس آزادی در این موقعیت باقی نمانده است؛ با پشتیبانی تماس بگیرید.");
    // an address that was on another VPS and removed there by hand (kept as a "gone" row) is taken over
    await ctx.db.delete(vpsIps).where(and(eq(vpsIps.ip, ip!), isNotNull(vpsIps.goneAt)));
    await ctx.db.insert(vpsIps).values({ id: rid("ip"), serverId: s.id, userId: s.userId, ip: ip!, price: p.ip });
    await addTask(ctx.db, s.id, "افزودن IPv4 " + ip);
    await log(ctx, s.userId, "hash", "افزودن IPv4 اضافه " + ip + " به " + s.name);
    await requestSync(ctx.db, s.id);
    return ip!;
  }),

  "servers.removeIp": method(z.tuple([id, id]), async (ctx, [sid, ipId]) => {
    const s = await server(ctx, sid);
    const extra = await ctx.db.select().from(vpsIps).where(and(eq(vpsIps.serverId, s.id), isNull(vpsIps.goneAt)));
    const row = extra.find((x) => x.id === ipId);
    if (!row) fail("آدرس پیدا نشد.", 404);
    const keep = [s.ip, ...extra.filter((x) => x.id !== ipId).map((x) => x.ip)];
    await (await virt()).setIps(vps(s), keep, keep.length);
    await ctx.db.delete(vpsIps).where(eq(vpsIps.id, row!.id));
    await addTask(ctx.db, s.id, "حذف IPv4 " + row!.ip);
    await log(ctx, s.userId, "hash", "حذف IPv4 اضافه " + row!.ip + " از " + s.name);
    await requestSync(ctx.db, s.id);
  }),

  /** PTR for the primary address ("primary") or an extra one; empty clears it */
  "servers.setPtr": method(z.tuple([id, id, z.string().max(253)]), async (ctx, [sid, ipId, raw]) => {
    const s = await server(ctx, sid);
    const host = raw.trim().toLowerCase().replace(/\.$/, "");
    if (host && !FQDN_RE.test(host)) fail("نام دامنه معتبر نیست.");
    const ip = ipId === "primary" ? s.ip : (await ctx.db.select().from(vpsIps).where(and(eq(vpsIps.id, ipId), eq(vpsIps.serverId, s.id))))[0]?.ip;
    if (!ip) fail("آدرس پیدا نشد.", 404);
    await (await virt()).setPtr(vps(s), ip!, host);
    if (ipId === "primary") await ctx.db.update(servers).set({ rdns: host }).where(eq(servers.id, s.id));
    else await ctx.db.update(vpsIps).set({ rdns: host }).where(eq(vpsIps.id, ipId));
    await addTask(ctx.db, s.id, "تنظیم PTR برای " + ip);
  }),

  "servers.networkReset": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    await (await virt()).networkReset(vps(s));
    await addTask(ctx.db, s.id, "بازنشانی تنظیمات شبکه");
    await log(ctx, s.userId, "network", "بازنشانی شبکه سرور " + s.name);
  }),

  /* ---------- extra disks (GB-month, billed hourly) ---------- */
  "servers.addDisk": method(z.tuple([id, z.object({ name: z.string().trim().toLowerCase().max(30), sizeGb: diskGb })]), async (ctx, [sid, d]) => {
    const s = await server(ctx, sid);
    const p = await vpsPrices(ctx.db);
    if (!DISK_NAME_RE.test(d.name)) fail("نام دیسک: حروف کوچک انگلیسی، عدد و خط تیره؛ ۲ تا ۳۰ نویسه.");
    const bad = diskSizeError(d.sizeGb, p.maxDiskGb);
    if (bad) fail(bad);
    const [{ n }] = await ctx.db.select({ n: count() }).from(vpsDisks).where(and(eq(vpsDisks.serverId, s.id), isNull(vpsDisks.goneAt)));
    if (n >= p.maxDisks) fail("حداکثر " + p.maxDisks.toLocaleString("fa-IR") + " دیسک اضافه برای هر سرور.");
    await needCredit(ctx, s.userId, d.sizeGb * p.diskGb);
    await needBudget(ctx.db, s.userId, "vps", perHour(d.sizeGb * p.diskGb) * 24);
    const slot = await (await virt()).addDisk(vps(s), d.sizeGb);
    const diskId = rid("vd");
    await ctx.db.insert(vpsDisks).values({ id: diskId, userId: s.userId, serverId: s.id, name: d.name, loc: s.loc, sizeGb: d.sizeGb, slot });
    await addTask(ctx.db, s.id, "افزودن دیسک " + d.name + " (" + d.sizeGb + " GB)");
    await log(ctx, s.userId, "hard-drive", "افزودن دیسک " + d.sizeGb.toLocaleString("fa-IR") + " گیگابایتی به " + s.name);
    await requestSync(ctx.db, s.id);
    return diskId;
  }),

  /** grows a disk; shrinking is refused (the filesystem would be cut) */
  "servers.resizeDisk": method(z.tuple([id, diskGb]), async (ctx, [diskId, sizeGb]) => {
    const d = await ownDisk(ctx, diskId);
    const p = await vpsPrices(ctx.db);
    // the new size is a new choice: a disk bought at 25 GB grows to 30, 40 …
    const bad = diskSizeError(sizeGb, p.maxDiskGb);
    if (bad) fail(bad);
    if (sizeGb <= d.sizeGb) fail("اندازه دیسک فقط افزایش می‌یابد.");
    await needCredit(ctx, d.userId, (sizeGb - d.sizeGb) * p.diskGb);
    if (d.serverId) {
      const s = await server(ctx, d.serverId);
      await (await virt()).resizeDisk(vps(s), d.slot ?? 1, sizeGb);
      await addTask(ctx.db, s.id, "افزایش دیسک " + d.name + " به " + sizeGb + " GB");
    }
    await ctx.db.update(vpsDisks).set({ sizeGb }).where(eq(vpsDisks.id, d.id));
    if (d.serverId) await requestSync(ctx.db, d.serverId);
  }),

  "servers.detachDisk": method(z.tuple([id]), async (ctx, [diskId]) => {
    const d = await ownDisk(ctx, diskId);
    if (!d.serverId) fail("این دیسک به سروری وصل نیست.");
    const s = await server(ctx, d.serverId!);
    await (await virt()).detachDisk(vps(s), d.slot ?? 1);
    await ctx.db.update(vpsDisks).set({ serverId: null, slot: null }).where(eq(vpsDisks.id, d.id));
    await addTask(ctx.db, s.id, "جدا کردن دیسک " + d.name);
    await requestSync(ctx.db, s.id);
  }),

  "servers.attachDisk": method(z.tuple([id, id]), async (ctx, [diskId, sid]) => {
    const d = await ownDisk(ctx, diskId);
    if (d.serverId) fail("این دیسک به سرور دیگری وصل است؛ ابتدا آن را جدا کنید.");
    const s = await server(ctx, sid);
    if (s.userId !== d.userId) fail("دیسک و سرور باید متعلق به یک حساب باشند.", 403);
    if (s.loc !== d.loc) fail("دیسک فقط به سرورهای همان موقعیت وصل می‌شود.");
    const p = await vpsPrices(ctx.db);
    const [{ n }] = await ctx.db.select({ n: count() }).from(vpsDisks).where(and(eq(vpsDisks.serverId, s.id), isNull(vpsDisks.goneAt)));
    if (n >= p.maxDisks) fail("حداکثر " + p.maxDisks.toLocaleString("fa-IR") + " دیسک اضافه برای هر سرور.");
    const slot = await (await virt()).addDisk(vps(s), d.sizeGb);
    await ctx.db.update(vpsDisks).set({ serverId: s.id, slot }).where(eq(vpsDisks.id, d.id));
    await addTask(ctx.db, s.id, "اتصال دیسک " + d.name);
    await requestSync(ctx.db, s.id);
  }),

  "servers.deleteDisk": method(z.tuple([id, z.string().max(30)]), async (ctx, [diskId, confirm]) => {
    const d = await ownDisk(ctx, diskId);
    if (d.serverId) fail("ابتدا دیسک را از سرور جدا کنید.");
    if (confirm !== d.name) fail("برای تأیید، نام دیسک را بنویسید.");
    await ctx.db.delete(vpsDisks).where(eq(vpsDisks.id, d.id));
    await log(ctx, d.userId, "trash-2", "حذف دیسک " + d.name);
  }),

  /* ---------- snapshots ---------- */
  "servers.setSnapSchedule": method(z.tuple([id, z.object({ frequency: z.enum(["daily", "weekly"]), retention: z.number().int().min(1).max(14), hour: z.number().int().min(0).max(23), weekday: z.number().int().min(0).max(6) }).nullable()]), async (ctx, [sid, sc]) => {
    const s = await server(ctx, sid);
    if (!sc) {
      await ctx.db.delete(vpsSnapSchedules).where(eq(vpsSnapSchedules.serverId, s.id));
      await addTask(ctx.db, s.id, "حذف زمان‌بندی اسنپ‌شات");
      return;
    }
    const next = nextRun(new Date(), sc.frequency, sc.hour, sc.weekday);
    await ctx.db.insert(vpsSnapSchedules).values({ serverId: s.id, ...sc, active: true, nextRunAt: next })
      .onConflictDoUpdate({ target: vpsSnapSchedules.serverId, set: { ...sc, active: true, nextRunAt: next } });
    await addTask(ctx.db, s.id, "زمان‌بندی اسنپ‌شات " + (sc.frequency === "daily" ? "روزانه" : "هفتگی"));
  }),

  /* ---------- console ---------- */
  "servers.vnc": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور خاموش است؛ برای کنسول آن را روشن کنید.");
    const v = await (await virt()).vnc(vps(s));
    await log(ctx, s.userId, "monitor-smartphone", "باز کردن کنسول VNC " + s.name);
    return v;
  }),

  /* ---------- traffic ---------- */
  "servers.setTrafficAutoBuy": method(z.tuple([id, z.boolean()]), async (ctx, [sid, on]) => {
    const s = await server(ctx, sid);
    await trafficRow(ctx.db, s.id);
    await ctx.db.update(vpsTraffic).set({ autoBuy: on, updatedAt: new Date() }).where(eq(vpsTraffic.serverId, s.id));
  }),

  /** gb: any multiple of 500 GB (default: the admin's pack); bought as often as wanted, each adds to this month */
  "servers.buyTraffic": method(z.tuple([id, z.number().int().min(1).max(1_000_000).optional()]), async (ctx, [sid, gb]) => {
    const s = await server(ctx, sid);
    if (gb !== undefined) { const bad = trafficError(gb); if (bad) fail(bad); }
    await buyPack(ctx.db, s, "خرید دستی", gb);
  }),

  /* ---------- plan change (up or down) while stopped ---------- */
  "servers.changePlan": method(z.tuple([id, z.string().max(20)]), async (ctx, [sid, planId]) => {
    const s = await server(ctx, sid);
    if (s.status !== "stopped") fail("برای تغییر پلن ابتدا سرور را خاموش کنید.");
    const [p] = await ctx.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.kind, "cloud")));
    const nums = PLAN_NUMS[planId];
    if (!p || !nums) fail("پلن پیدا نشد.");
    const plan = p!.data as Plan;
    if (plan.active === false) fail("این پلن فعلا ارائه نمی‌شود.");
    if (plan.name === s.plan) fail("سرور همین حالا روی این پلن است.");
    const [cpu, ram, planDisk] = nums;
    // the disk never shrinks: a smaller plan keeps the current disk and pays for the difference; a split disk
    // (../virt/layout.ts) keeps its other disks and the primary takes the change
    const cur = await primaryFor(ctx.db, s, 0);
    const disk = Math.max(planDisk, cur.allowance);
    const lay = await primaryFor(ctx.db, s, disk);
    const prices = await vpsPrices(ctx.db);
    const price = plan.price + (disk - planDisk) * prices.diskGb;
    await (await virt()).manage(vps(s), { cores: cpu, ram: ram * 1024, space: lay.primary });
    await ctx.db.update(servers).set({ plan: plan.name, cpu, ram, disk: lay.primary, price }).where(eq(servers.id, s.id));
    if (lay.split) await saveAllowance(ctx.db, s.id, disk);
    if (s.billing === "monthly" && s.paidUntil) {
      const days = Math.max(0, Math.ceil((s.paidUntil.getTime() - Date.now()) / 86400_000));
      const diff = Math.round(((price - s.price) * days) / 30 / 1000) * 1000;
      if (diff > 0) {
        const { createInvoice } = await import("./billing");
        await createInvoice(ctx.db, s.userId, [{ desc: "مابه‌التفاوت تغییر پلن " + s.name + " به " + plan.name + " (" + days.toLocaleString("fa-IR") + " روز)", amount: diff }], { dueDays: 3 });
      } else if (diff < 0) {
        const { transactions } = await import("../db/schema");
        await ctx.db.transaction(async (tx) => {
          await tx.update(users).set({ balance: sql`${users.balance} + ${-diff}` }).where(eq(users.id, s.userId));
          await tx.insert(transactions).values({ id: rid("TX"), userId: s.userId, type: "refund", amount: -diff, method: "کیف پول", desc: "بازگشت مابه‌التفاوت تغییر پلن " + s.name });
        });
      }
    }
    await addTask(ctx.db, s.id, "تغییر پلن به " + plan.name);
    await log(ctx, s.userId, plan.price >= s.price ? "trending-up" : "trending-down", "تغییر پلن سرور " + s.name + " به " + plan.name);
    await requestSync(ctx.db, s.id);
  }),

  /* ---------- firewall groups ---------- */
  "servers.fwGroupSave": method(z.tuple([z.object({ id: id.optional(), name: z.string().trim().max(40), rules: z.array(ruleSchema).max(50) })]), async (ctx, [g]) => {
    const a = needUser(ctx);
    if (g.name.length < 2) fail("نام گروه را بنویسید.");
    const rules = g.rules.map(checkRule);
    if (g.id) {
      await ownGroup(ctx, g.id);
      await ctx.db.update(fwGroups).set({ name: g.name, rules }).where(eq(fwGroups.id, g.id));
      const attached = await ctx.db.select({ serverId: fwGroupServers.serverId }).from(fwGroupServers).where(eq(fwGroupServers.groupId, g.id));
      for (const x of attached) await addTask(ctx.db, x.serverId, "به‌روزرسانی گروه فایروال " + g.name);
      return g.id;
    }
    const [{ n }] = await ctx.db.select({ n: count() }).from(fwGroups).where(eq(fwGroups.userId, a.uid));
    if (n >= 20) fail("حداکثر ۲۰ گروه فایروال.");
    const gid = rid("fwg");
    await ctx.db.insert(fwGroups).values({ id: gid, userId: a.uid, name: g.name, rules });
    await log(ctx, a.uid, "shield-check", "ساخت گروه فایروال " + g.name);
    return gid;
  }),

  "servers.fwGroupDelete": method(z.tuple([id]), async (ctx, [gid]) => {
    const g = await ownGroup(ctx, gid);
    const attached = await ctx.db.select({ serverId: fwGroupServers.serverId }).from(fwGroupServers).where(eq(fwGroupServers.groupId, g.id));
    await ctx.db.delete(fwGroups).where(eq(fwGroups.id, g.id));
    for (const x of attached) await addTask(ctx.db, x.serverId, "حذف گروه فایروال " + g.name);
  }),

  "servers.fwGroupAttach": method(z.tuple([id, id, z.boolean()]), async (ctx, [gid, sid, on]) => {
    const g = await ownGroup(ctx, gid);
    const s = await server(ctx, sid);
    if (s.userId !== g.userId) fail("گروه و سرور باید متعلق به یک حساب باشند.", 403);
    if (on) await ctx.db.insert(fwGroupServers).values({ groupId: g.id, serverId: s.id }).onConflictDoNothing();
    else await ctx.db.delete(fwGroupServers).where(and(eq(fwGroupServers.groupId, g.id), eq(fwGroupServers.serverId, s.id)));
    await addTask(ctx.db, s.id, (on ? "اعمال" : "برداشتن") + " گروه فایروال " + g.name);
  }),
};

/** buys traffic from the wallet (the admin's pack, or `gb` in 500 GB units at the same per-GB price) and raises the
    hypervisor limit; the quota stays plan base + this month's packs (../virt/sync.ts) */
export async function buyPack(db: Ctx["db"], s: typeof servers.$inferSelect, why: string, gb?: number) {
  if (s.bwLimit <= 0) fail("ترافیک این سرور نامحدود است و به بسته نیاز ندارد.");
  const p = await vpsPrices(db);
  const size = gb ?? p.packGb;
  const price = gb === undefined ? p.packPrice : (gb / TRAFFIC_STEP_GB) * p.pack500Price;
  const t = await trafficRow(db, s.id);
  await needBudget(db, s.userId, "vps", price);
  const ok = await db.transaction((tx) => debit(tx, s.userId, price, "بسته ترافیک " + size.toLocaleString("fa-IR") + " گیگابایتی سرور " + s.name + " (" + why + ")", { serverId: s.id }));
  if (!ok) fail("موجودی کیف پول برای بسته ترافیک (" + price.toLocaleString("fa-IR") + " تومان) کافی نیست.", 402);
  const extraGb = t.extraGb + size;
  await db.update(vpsTraffic).set({ extraGb, packs: t.packs + 1, alerted: Math.min(t.alerted, 80), updatedAt: new Date() }).where(eq(vpsTraffic.serverId, s.id));
  if (s.vpsid) {
    await (await virt()).manage(s.vpsid, { bandwidth: quotaOf(s.bwLimit, extraGb) });
    // the sync then knows this limit is the site's own, not an admin's edit
    await markPushed(db, s.id, quotaOf(s.bwLimit, extraGb));
    await requestSync(db, s.id);
  }
  await addTask(db, s.id, "افزودن " + size.toLocaleString("fa-IR") + " گیگابایت ترافیک");
}

/** servers that a list of ids covers and the caller may touch (team transfer, wallet links) */
export async function ownServers(ctx: Ctx, ids: string[]) {
  const a = needUser(ctx);
  if (!ids.length) return [];
  return ctx.db.select().from(servers).where(and(eq(servers.userId, a.uid), inArray(servers.id, ids))).orderBy(desc(servers.createdAt));
}
