/* Cloud-server extras in the worker: hourly add-on charges (extra IPv4, disks, snapshot GB), traffic
   metering with 80% / 100% alerts and automatic packs, scheduled snapshots, budget and low-credit alerts. */
import "server-only";
import { and, asc, eq, inArray, isNotNull, like, lte, sql } from "drizzle-orm";
import { faDate } from "@/lib/jalali";
import { nextRun } from "@/lib/vps-billing";
import { budgetAlerts, debit, lowCreditAlerts, monthKey, perHour, vpsPrices } from "../billing-extras";
import type { DB } from "../db/client";
import { servers, snapshots, vpsDisks, vpsIps, vpsSnapSchedules, vpsTraffic, vpsTrafficDaily } from "../db/schema";
import { enqueue } from "../jobs";
import { buyPack, trafficRow } from "../rpc/vps";
import { virt } from "../virt/driver";
import { addTask, notify, rid } from "../util";

/** hourly */
export async function vpsBilling(db: DB) {
  await addonCharges(db);
  await meterTraffic(db);
  await budgetAlerts(db);
  await lowCreditAlerts(db);
}

async function addonCharges(db: DB) {
  const p = await vpsPrices(db);
  const [ips, disks, snaps] = await Promise.all([
    db.select().from(vpsIps),
    db.select().from(vpsDisks),
    db.select({ serverId: snapshots.serverId, gb: sql<number>`sum(${snapshots.size})::float` }).from(snapshots).groupBy(snapshots.serverId),
  ]);
  const sids = [...new Set([...ips.map((x) => x.serverId), ...disks.flatMap((d) => (d.serverId ? [d.serverId] : [])), ...snaps.map((x) => x.serverId)])];
  const list = sids.length ? await db.select().from(servers).where(and(inArray(servers.id, sids), inArray(servers.status, ["running", "stopped"]))) : [];
  for (const s of list) {
    const parts: string[] = [];
    let monthly = 0;
    const myIps = ips.filter((x) => x.serverId === s.id);
    if (myIps.length) { monthly += myIps.reduce((a, x) => a + x.price, 0); parts.push(myIps.length.toLocaleString("fa-IR") + " IPv4"); }
    const myDisks = disks.filter((d) => d.serverId === s.id);
    if (myDisks.length) { monthly += myDisks.reduce((a, d) => a + d.sizeGb * p.diskGb, 0); parts.push("دیسک اضافه"); }
    const gb = snaps.find((x) => x.serverId === s.id)?.gb ?? 0;
    // snapshots that only the plan's allowance covers (first 10% of the disk) are free
    const billableGb = Math.max(0, gb - s.disk * 0.1);
    if (billableGb > 0) { monthly += billableGb * p.snapshotGb; parts.push("اسنپ‌شات " + billableGb.toFixed(1) + " GB"); }
    if (monthly <= 0) continue;
    const ok = await db.transaction((tx) => debit(tx, s.userId, perHour(monthly), "افزونه‌های سرور " + s.name + ": " + parts.join("، "), { serverId: s.id }));
    if (!ok) await enqueue(db, "notify.send", { userId: s.userId, kind: "billing", subject: "موجودی کافی برای افزونه‌های سرور نیست", text: "هزینه ساعتی IPv4، دیسک یا اسنپ‌شات‌های سرور " + s.name + " از کیف پول کسر نشد. کیف پول را شارژ کنید تا افزونه‌ها حذف نشوند." }, { dedupe: "addon-low:" + s.id + ":" + new Date().toISOString().slice(0, 10) });
  }
  // detached volumes still cost storage
  const detached = disks.filter((d) => !d.serverId);
  for (const uid of new Set(detached.map((d) => d.userId))) {
    const mine = detached.filter((d) => d.userId === uid);
    await db.transaction((tx) => debit(tx, uid, perHour(mine.reduce((a, d) => a + d.sizeGb * p.diskGb, 0)), "دیسک اضافه جداشده: " + mine.map((d) => d.name).join("، ")));
  }
}

/** daily usage from the hypervisor, quota = plan traffic + packs; alerts at 80% and 100% */
export async function meterTraffic(db: DB) {
  const list = await db.select().from(servers).where(and(isNotNull(servers.vpsid), inArray(servers.status, ["running", "stopped"])));
  if (!list.length) return;
  const v = await virt();
  const now = new Date();
  const month = monthKey(now);
  const today = now.toISOString().slice(0, 10);
  for (const s of list) {
    let days: { day: number; inMb: number; outMb: number }[];
    try { days = await v.bandwidth(s.vpsid!, month.replace("-", "")); } catch { continue; }
    const rows = days.map((d) => ({ serverId: s.id, day: month + "-" + String(d.day).padStart(2, "0"), inMb: d.inMb, outMb: d.outMb })).filter((r) => r.day <= today);
    for (const r of rows) await db.insert(vpsTrafficDaily).values(r).onConflictDoUpdate({ target: [vpsTrafficDaily.serverId, vpsTrafficDaily.day], set: { inMb: r.inMb, outMb: r.outMb } });
    const usedGb = rows.reduce((a, r) => a + r.inMb + r.outMb, 0) / 1024;
    const t = await trafficRow(db, s.id);
    await db.update(vpsTraffic).set({ usedGb, updatedAt: now }).where(eq(vpsTraffic.serverId, s.id));
    await trafficAlerts(db, s, { ...t, usedGb });
  }
  await db.delete(vpsTrafficDaily).where(lte(vpsTrafficDaily.day, new Date(now.getTime() - 400 * 86400_000).toISOString().slice(0, 10)));
}

export async function trafficAlerts(db: DB, s: typeof servers.$inferSelect, t: typeof vpsTraffic.$inferSelect) {
  const quota = s.bwLimit + t.extraGb;
  const pct = quota > 0 ? (t.usedGb / quota) * 100 : 0;
  if (pct >= 100 && t.autoBuy) {
    try {
      await buyPack(db, s, "خرید خودکار");
      await notify(db, s.userId, "activity", "سهمیه ترافیک " + s.name + " تمام شد و یک بسته ترافیک خودکار خریداری شد");
      return;
    } catch { /* no credit or over budget: fall through to the plain alert */ }
  }
  const level = pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
  if (!level || level <= t.alerted) return;
  await db.update(vpsTraffic).set({ alerted: level }).where(eq(vpsTraffic.serverId, s.id));
  const text = level === 100
    ? "سهمیه ترافیک ماهانه سرور " + s.name + " تمام شد (" + Math.round(t.usedGb).toLocaleString("fa-IR") + " از " + quota.toLocaleString("fa-IR") + " گیگابایت). برای جلوگیری از محدودیت سرعت، بسته ترافیک بخرید یا خرید خودکار را روشن کنید."
    : "۸۰٪ سهمیه ترافیک ماهانه سرور " + s.name + " مصرف شده است (" + Math.round(t.usedGb).toLocaleString("fa-IR") + " از " + quota.toLocaleString("fa-IR") + " گیگابایت).";
  await notify(db, s.userId, "activity", text);
  await enqueue(db, "notify.send", { userId: s.userId, kind: "service", subject: "ترافیک سرور " + s.name + ": " + level + "٪", text }, { dedupe: "traffic:" + s.id + ":" + t.month + ":" + level });
}

/** every 15 minutes: due snapshot schedules → new snapshot, then prune past the retention */
export async function vpsSnapshots(db: DB) {
  const now = new Date();
  const due = await db.select().from(vpsSnapSchedules).where(and(eq(vpsSnapSchedules.active, true), lte(vpsSnapSchedules.nextRunAt, now)));
  for (const sc of due) {
    const [s] = await db.select().from(servers).where(eq(servers.id, sc.serverId));
    const next = nextRun(now, sc.frequency, sc.hour, sc.weekday);
    // claim the run first so a second worker does not take it too
    const claimed = await db.update(vpsSnapSchedules).set({ nextRunAt: next, lastRunAt: now }).where(and(eq(vpsSnapSchedules.serverId, sc.serverId), eq(vpsSnapSchedules.nextRunAt, sc.nextRunAt))).returning();
    if (!claimed.length || !s || s.status === "suspended" || s.status === "building") continue;
    const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
    await db.insert(snapshots).values({ id: rid("snap"), serverId: s.id, name: "auto-" + stamp, size: +(s.disk * 0.08).toFixed(1) });
    const autos = await db.select({ id: snapshots.id }).from(snapshots).where(and(eq(snapshots.serverId, s.id), like(snapshots.name, "auto-%"))).orderBy(asc(snapshots.createdAt), asc(snapshots.name));
    const drop = autos.slice(0, Math.max(0, autos.length - sc.retention)).map((x) => x.id);
    if (drop.length) await db.delete(snapshots).where(inArray(snapshots.id, drop));
    await addTask(db, s.id, "اسنپ‌شات زمان‌بندی‌شده (" + faDate(now) + ")");
  }
}
