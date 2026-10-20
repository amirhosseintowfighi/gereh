/* Virtualizor → site sync. Admins edit VPSs by hand in the Virtualizor panel (resources, disks, IPs,
   traffic, hostname, OS, suspension, node), so the hypervisor is the source of truth: every few minutes
   (VIRT_SYNC_MINUTES, default 5), right after a site action that changes a VPS, and from the sync buttons,
   each VPS's detail is read and copied into `servers`, the extras tables and the traffic row. Every
   difference found is logged once in vps_sync_log (staff) and as one server task line (customer).
   Billing is untouched: the price never changes here; staff see a hint when resources differ from the plan. */
import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Plan } from "@/lib/catalog";
import { monthKey } from "../billing-extras";
import type { DB } from "../db/client";
import { osTemplates, plans, servers, vpsDisks, vpsIps, vpsLayouts, vpsSync, vpsSyncLog, vpsTraffic } from "../db/schema";
import { enqueue } from "../jobs";
import { addTask, rid } from "../util";
import { virt, type VirtDriver, type VpsDetail } from "./driver";
import { relayoutBusy } from "./layout";
import { confirmFromPoll, pendingPower } from "./power";

type Server = typeof servers.$inferSelect;
/** site statuses the hypervisor may overwrite; provisioning/building belong to the delivery flow */
export const SYNCABLE = ["running", "stopped", "suspended", "missing"];

const fa = (n: number) => n.toLocaleString("fa-IR");
/** 2000 → «۲ ترابایت», 500 → «۵۰۰ گیگ», 0 → «نامحدود» */
export const gbLabel = (gb: number) => (gb <= 0 ? "نامحدود" : gb >= 1000 && gb % 100 === 0 ? fa(gb / 1000) + " ترابایت" : fa(gb) + " گیگ");
const pair = (a: number, b: number) =>
  a > 0 && b > 0 && a >= 1000 && b >= 1000 && a % 100 === 0 && b % 100 === 0 ? fa(a / 1000) + "→" + fa(b / 1000) + " ترابایت"
    : a > 0 && b > 0 && a < 1000 && b < 1000 ? fa(a) + "→" + fa(b) + " گیگ" : gbLabel(a) + "→" + gbLabel(b);
const speed = (kb: number) => (kb <= 0 ? "نامحدود" : fa(Math.round((kb * 8) / 1024)) + " Mbps");

/** the traffic quota shown and enforced: plan base + this month's packs (0 base = unlimited) */
export const quotaOf = (base: number, extraGb: number) => (base <= 0 ? 0 : base + extraGb);

/** after the site itself sets the hypervisor's traffic limit (packs, provisioning) */
export async function markPushed(db: DB, serverId: string, gb: number) {
  await db.insert(vpsSync).values({ serverId, bwPushed: gb }).onConflictDoUpdate({ target: vpsSync.serverId, set: { bwPushed: gb } });
}

/** reconcile one server as soon as the worker gets to it (after a site action that changes the VPS) */
export const requestSync = (db: DB, serverId: string) => enqueue(db, "virt.sync", { serverId }, { dedupe: "virt.sync:" + serverId });

type Change = { field: string; before: string; after: string; text: string };

/** copies one VPS's hypervisor state into the site's rows; returns the changes (Persian lines), [] if none.
    d === null: the VPS is gone from Virtualizor; it is flagged "missing", never deleted. */
export async function applyDetail(db: DB, v: VirtDriver, s: Server, d: VpsDetail | null, now = new Date()): Promise<string[]> {
  const [prev] = await db.select().from(vpsSync).where(eq(vpsSync.serverId, s.id));
  const changes: Change[] = [];
  const add = (field: string, before: string | number, after: string | number, text: string) => changes.push({ field, before: String(before), after: String(after), text });

  if (d === null) {
    if (s.status !== "missing") {
      await db.update(servers).set({ status: "missing" }).where(eq(servers.id, s.id));
      add("status", s.status, "missing", "VPS " + s.vpsid + " در Virtualizor پیدا نشد");
      const { notifyStaff } = await import("../worker/provision");
      await notifyStaff(db, "VPS " + s.vpsid + " (سرور " + s.name + ") در Virtualizor پیدا نشد؛ ردیف سرور با وضعیت «ناموجود» نگه داشته شد.");
    }
    await db.insert(vpsSync).values({ serverId: s.id, syncedAt: now, state: "missing", missingSince: now, lastError: "" })
      .onConflictDoUpdate({ target: vpsSync.serverId, set: { syncedAt: now, state: "missing", missingSince: prev?.missingSince ?? now, lastError: "" } });
    await record(db, s, changes);
    return changes.map((c) => c.text);
  }

  const patch: Partial<Server> = {};
  /* ---- resources ---- */
  if (d.cores > 0 && d.cores !== s.cpu) { patch.cpu = d.cores; add("cpu", s.cpu, d.cores, "پردازنده " + fa(s.cpu) + "→" + fa(d.cores) + " هسته"); }
  if (d.ramMb > 0) {
    const ramGb = Math.max(1, Math.round(d.ramMb / 1024));
    if (ramGb !== s.ram) { patch.ram = ramGb; add("ram", s.ram, ramGb, "رم " + fa(s.ram) + "→" + fa(ramGb) + " گیگ"); }
    else if (prev?.ramMb && prev.ramMb !== d.ramMb) add("ram", prev.ramMb, d.ramMb, "رم " + fa(prev.ramMb) + "→" + fa(d.ramMb) + " مگ");
  }

  /* ---- disks: the first is the primary (servers.disk), the rest are vps_disks rows by slot ---- */
  if (d.disks.length) {
    const [primary, ...extra] = d.disks;
    const rows = await db.select().from(vpsDisks).where(eq(vpsDisks.serverId, s.id));
    const live = rows.filter((r) => !r.goneAt).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const before = [s.disk, ...live.map((r) => r.sizeGb)], after = d.disks.map((x) => x.sizeGb);
    if (before.join("+") !== after.join("+")) add("disk", before.join("+"), after.join("+"), "دیسک " + before.map(fa).join("+") + "→" + after.map(fa).join("+") + " گیگ");
    if (primary.sizeGb !== s.disk) patch.disk = primary.sizeGb;
    for (const x of extra) {
      const row = rows.find((r) => r.slot === x.slot);
      if (row) { if (row.sizeGb !== x.sizeGb || row.goneAt) await db.update(vpsDisks).set({ sizeGb: x.sizeGb, goneAt: null }).where(eq(vpsDisks.id, row.id)); }
      // added by hand in Virtualizor: shown to the customer, never charged
      else await db.insert(vpsDisks).values({ id: rid("vd"), userId: s.userId, serverId: s.id, name: "disk-" + x.slot, loc: s.loc, sizeGb: x.sizeGb, slot: x.slot, billed: false });
    }
    for (const r of live) if (!extra.some((x) => x.slot === r.slot)) await db.update(vpsDisks).set({ goneAt: now }).where(eq(vpsDisks.id, r.id));
  }

  /* ---- addresses: the current primary stays primary while Virtualizor still has it ---- */
  if (d.ipv4.length) {
    const primary = d.ipv4.includes(s.ip) ? s.ip : d.ipv4[0];
    if (primary !== s.ip) { patch.ip = primary; add("ip", s.ip, primary, "IP اصلی " + (s.ip || "—") + "→" + primary); }
    const extra = d.ipv4.filter((x) => x !== primary);
    const rows = await db.select().from(vpsIps).where(eq(vpsIps.serverId, s.id));
    for (const ip of extra) {
      const row = rows.find((r) => r.ip === ip);
      if (row) {
        if (row.goneAt) { await db.update(vpsIps).set({ goneAt: null }).where(eq(vpsIps.id, row.id)); add("ip+", "", ip, "IP جدید " + ip); }
        continue;
      }
      const [other] = await db.select().from(vpsIps).where(eq(vpsIps.ip, ip));
      if (other && !other.goneAt) continue; // still another server's until that one is synced
      if (other) await db.update(vpsIps).set({ serverId: s.id, userId: s.userId, price: 0, rdns: "", goneAt: null }).where(eq(vpsIps.id, other.id));
      else await db.insert(vpsIps).values({ id: rid("ip"), serverId: s.id, userId: s.userId, ip, price: 0 });
      add("ip+", "", ip, "IP جدید " + ip);
    }
    for (const r of rows) {
      if (r.goneAt || extra.includes(r.ip)) continue;
      // an extra address that became the primary is no longer an add-on
      if (r.ip === primary) { await db.delete(vpsIps).where(eq(vpsIps.id, r.id)); continue; }
      await db.update(vpsIps).set({ goneAt: now }).where(eq(vpsIps.id, r.id));
      add("ip-", r.ip, "", "IP حذف‌شده " + r.ip);
    }
  }
  if (d.ipv6.length && !d.ipv6.includes(s.ipv6)) { patch.ipv6 = d.ipv6[0]; add("ipv6", s.ipv6, d.ipv6[0], "IPv6 " + (s.ipv6 || "—") + "→" + d.ipv6[0]); }
  else if (!d.ipv6.length && prev?.ipv6.length && s.ipv6) { patch.ipv6 = ""; add("ipv6", s.ipv6, "", "IPv6 " + s.ipv6 + " حذف شد"); }

  /* ---- identity and placement ---- */
  if (d.hostname && d.hostname !== s.hostname) { patch.hostname = d.hostname; add("hostname", s.hostname, d.hostname, "hostname " + s.hostname + "→" + d.hostname); }
  const [tpl] = d.osid ? await db.select().from(osTemplates).where(eq(osTemplates.osid, d.osid)) : [];
  const os = tpl?.name || d.osName;
  if (os && os !== s.os) { patch.os = os; add("os", s.os, os, "سیستم‌عامل " + s.os + "→" + os); }
  if (prev?.node && d.serverName && prev.node !== d.serverName) add("node", prev.node, d.serverName, "انتقال از نود " + prev.node + " به " + d.serverName);
  if (prev?.syncedAt && prev.state === "ok" && prev.netSpeed !== d.netSpeed) add("speed", prev.netSpeed, d.netSpeed, "سرعت شبکه " + speed(prev.netSpeed) + "→" + speed(d.netSpeed));
  if (d.vnc?.port && d.vnc.port !== s.vncPort) patch.vncPort = d.vnc.port;

  /* ---- status: power changes are quiet (the customer made them); suspension and reappearing are logged.
     No live reading ("unknown") never changes the power state, and neither does a reading taken while a power
     action is still being confirmed (./power.ts), unless it is the state that action was waiting for. ---- */
  const pending = (await pendingPower(db, [s.id])).get(s.id);
  const live = d.status === "unknown" ? (s.status === "missing" ? "running" : s.status) : d.status;
  const powerOnly = (live === "running" || live === "stopped") && (s.status === "running" || s.status === "stopped");
  if (pending && powerOnly) {
    if (live === pending.target) await confirmFromPoll(db, s, live, pending);
  } else if (SYNCABLE.includes(s.status) && live !== s.status) {
    const st = live;
    patch.status = st;
    if (s.status === "missing") add("status", "missing", st, "VPS دوباره در Virtualizor پیدا شد");
    else if (st === "suspended") add("status", s.status, "suspended", "تعلیق در Virtualizor" + (d.suspendReason ? " (" + d.suspendReason + ")" : ""));
    else if (s.status === "suspended") { patch.suspendedAt = null; add("status", "suspended", st, "رفع تعلیق در Virtualizor"); }
  }

  /* ---- traffic quota. The site pushes plan traffic + this month's packs and remembers what it pushed
     (bw_pushed). If Virtualizor now holds a different limit, an admin set it by hand: Virtualizor wins and
     its limit becomes the new base, with this month's packs counted as included (extra 0), so the quota
     shown and used for alerts and auto-purchase is exactly Virtualizor's. If Virtualizor still holds what
     the site pushed but the site's own figure moved (packs reset at the start of a month), it is pushed. ---- */
  const t = await trafficFor(db, s.id);
  const expected = quotaOf(s.bwLimit, t.extraGb);
  const pushed = prev?.bwPushed ?? expected;
  let bwPushed = pushed;
  let extraGb = t.extraGb;
  if (d.bwLimit !== pushed) {
    if (d.bwLimit !== expected) add("bw", expected, d.bwLimit, "سهمیه ترافیک " + pair(expected, d.bwLimit));
    patch.bwLimit = d.bwLimit;
    extraGb = 0;
    bwPushed = d.bwLimit;
  } else if (expected !== pushed && s.vpsid) {
    await v.manage(s.vpsid, { bandwidth: expected });
    bwPushed = expected;
  }
  const usedGb = d.bwUsed >= 0 ? d.bwUsed : t.usedGb;
  if (extraGb !== t.extraGb || usedGb !== t.usedGb) await db.update(vpsTraffic).set({ extraGb, usedGb, updatedAt: now }).where(eq(vpsTraffic.serverId, s.id));

  if (Object.keys(patch).length) await db.update(servers).set(patch).where(eq(servers.id, s.id));
  const row = {
    syncedAt: now, state: "ok", missingSince: null, node: d.serverName, nodeId: d.serverId, osid: d.osid, plid: d.plid, ramMb: d.ramMb, netSpeed: d.netSpeed,
    suspendReason: d.suspendReason, bwLimit: d.bwLimit, bwPushed, bwUsed: usedGb, ipv4: d.ipv4, ipv6: d.ipv6, disks: d.disks, lastError: "",
  };
  await db.insert(vpsSync).values({ serverId: s.id, ...row }).onConflictDoUpdate({ target: vpsSync.serverId, set: row });
  await record(db, s, changes);

  // alerts and auto-purchase run against the synced quota and usage
  const next = { ...s, ...patch };
  if (next.status === "running" || next.status === "stopped") {
    const { trafficAlerts } = await import("../worker/vps");
    const [cur] = await db.select().from(vpsTraffic).where(eq(vpsTraffic.serverId, s.id));
    if (cur) await trafficAlerts(db, next, cur);
  }
  return changes.map((c) => c.text);
}

/** this month's traffic row (a new month starts with no packs) */
async function trafficFor(db: DB, serverId: string) {
  const { trafficRow } = await import("../rpc/vps");
  return trafficRow(db, serverId);
}

async function record(db: DB, s: Server, changes: Change[]) {
  if (!changes.length) return;
  await db.insert(vpsSyncLog).values(changes.map((c) => ({ serverId: s.id, userId: s.userId, ...c })));
  await addTask(db, s.id, "تغییر از Virtualizor: " + changes.map((c) => c.text).join("، "));
}

/** syncs these servers in batches of 25 (one status call + a few detail calls at a time per batch) */
export async function syncServers(db: DB, all: Server[]) {
  const v = await virt();
  // a VPS being recreated for a new disk layout (./relayout.ts) belongs to that job until it is done
  const busy = await relayoutBusy(db, all.map((s) => s.id));
  const list = all.filter((s) => s.vpsid && !busy.has(s.id));
  let changed = 0, missing = 0, unanswered = 0;
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    let answers: Map<number, VpsDetail | null>;
    try { answers = await v.details(chunk.map((s) => s.vpsid!)); }
    catch (e) { answers = new Map(); for (const s of chunk) await failed(db, s.id, e); unanswered += chunk.length; continue; }
    for (const s of chunk) {
      if (!answers.has(s.vpsid!)) { unanswered++; await failed(db, s.id, "پاسخی از Virtualizor نیامد"); continue; }
      const d = answers.get(s.vpsid!)!;
      try {
        if ((await applyDetail(db, v, s, d)).length) changed++;
        if (d === null) missing++;
      } catch (e) { await failed(db, s.id, e); }
    }
  }
  return { total: list.length, changed, missing, unanswered };
}
async function failed(db: DB, serverId: string, e: unknown) {
  const lastError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  // syncedAt moves on too, so a VPS that never answers does not hold the queue
  await db.insert(vpsSync).values({ serverId, syncedAt: new Date(), lastError }).onConflictDoUpdate({ target: vpsSync.serverId, set: { syncedAt: new Date(), lastError } });
}

/** the job: one server (payload.serverId), every server (payload.all, the admin button) or, on the schedule,
    the VIRT_SYNC_BATCH (default 500) least recently synced, so a large fleet is covered over a few runs */
export async function virtSync(db: DB, p: { serverId?: string; all?: boolean }) {
  if (p.serverId) {
    const [s] = await db.select().from(servers).where(and(eq(servers.id, p.serverId), isNotNull(servers.vpsid), inArray(servers.status, SYNCABLE)));
    return s ? syncServers(db, [s]) : null;
  }
  if (!p.all) {
    const { getVirt } = await import("../state");
    if ((await getVirt(db)).autoSync === false) return null;
  }
  const limit = p.all ? 100_000 : Math.max(1, Number(process.env.VIRT_SYNC_BATCH) || 500);
  const rows = await db.select({ s: servers }).from(servers).leftJoin(vpsSync, eq(vpsSync.serverId, servers.id))
    .where(and(isNotNull(servers.vpsid), inArray(servers.status, SYNCABLE))).orderBy(sql`${vpsSync.syncedAt} asc nulls first`, asc(servers.id)).limit(limit);
  return syncServers(db, rows.map((r) => r.s));
}

/** one server now (the sync buttons): its changes, or why it could not be read */
export async function syncNow(db: DB, s: Server): Promise<{ changes: string[]; state: "ok" | "missing" | "unanswered" }> {
  if (!s.vpsid || !SYNCABLE.includes(s.status) || (await relayoutBusy(db, [s.id])).size) return { changes: [], state: "unanswered" };
  const v = await virt();
  const answers = await v.details([s.vpsid]);
  if (!answers.has(s.vpsid)) { await failed(db, s.id, "پاسخی از Virtualizor نیامد"); return { changes: [], state: "unanswered" }; }
  const d = answers.get(s.vpsid)!;
  return { changes: await applyDetail(db, v, s, d), state: d ? "ok" : "missing" };
}

/** staff hint per server when the synced resources differ from the plan it is billed for */
export async function planHints(db: DB, list: Server[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!list.length) return out;
  const { planResources } = await import("../worker/provision");
  const rows = await db.select().from(plans).where(sql`${plans.kind} <> 'hosting'`);
  // a split disk (./layout.ts) counts as one: the primary plus the plan's other, unbilled disks
  const split = await db.select({ serverId: vpsLayouts.serverId }).from(vpsLayouts).where(inArray(vpsLayouts.serverId, list.map((s) => s.id)));
  const extra = new Map<string, number>();
  if (split.length) for (const d of await db.select().from(vpsDisks).where(and(inArray(vpsDisks.serverId, split.map((x) => x.serverId)), eq(vpsDisks.billed, false), isNull(vpsDisks.goneAt))))
    extra.set(d.serverId!, (extra.get(d.serverId!) ?? 0) + d.sizeGb);
  for (const s0 of list) {
    const s = { ...s0, disk: s0.disk + (extra.get(s0.id) ?? 0) };
    const p = rows.find((r) => (r.data as Plan).name === s.plan);
    const res = p ? planResources(p.id, p.data as Plan) : null;
    if (!res) continue;
    const diff: string[] = [];
    if (res.cpu !== s.cpu) diff.push("پردازنده " + fa(res.cpu) + "/" + fa(s.cpu));
    if (res.ram !== s.ram) diff.push("رم " + fa(res.ram) + "/" + fa(s.ram));
    if (res.disk !== s.disk) diff.push("دیسک " + fa(res.disk) + "/" + fa(s.disk));
    if (diff.length) out.set(s.id, "منابع با پلن فرق دارد (پلن/فعلی: " + diff.join("، ") + ")");
  }
  return out;
}

/** what staff and the customer see about the sync of each server */
export async function syncInfo(db: DB, ids: string[]) {
  if (!ids.length) return { sync: new Map<string, typeof vpsSync.$inferSelect>(), traffic: new Map<string, typeof vpsTraffic.$inferSelect>() };
  const [rows, traffic] = await Promise.all([
    db.select().from(vpsSync).where(inArray(vpsSync.serverId, ids)),
    db.select().from(vpsTraffic).where(inArray(vpsTraffic.serverId, ids)),
  ]);
  const month = monthKey();
  return { sync: new Map(rows.map((r) => [r.serverId, r])), traffic: new Map(traffic.filter((t) => t.month === month).map((t) => [t.serverId, t])) };
}
