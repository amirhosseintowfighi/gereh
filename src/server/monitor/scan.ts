/* «پایش هوشمند»: the monitor.scan job (every 5 minutes). Cloud servers and Gereh Apps are read in batches of 200
   with a handful of grouped queries per batch; a resource with no new sample (and, for apps, no new event) since the
   last scan only has its power state checked. The hour-of-week baseline is rebuilt at most once a day per resource
   (and for at most BASELINE_PER_RUN resources per run), the hourly trends once an hour. Each detector's result goes
   through the incident lifecycle: one live incident per resource and detector, updated while it lasts, resolved after
   MONITOR_RULES.resolveAfter clean scans; notifications only for a new incident (outside the cooldown) or an
   escalation, per the account's channel thresholds and mutes. Abuse alerts staff; nothing is ever suspended unless
   the admin setting monitor.autoSuspendAbuse is on. */
import "server-only";
import { and, asc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { DEFAULT_PREFS, MONITOR, MONITOR_RULES as R, SEVERITY_LABEL, SEVERITY_RANK, type ChannelPrefs, type Detector, type MonitorEvidence, type ResourceKind, type Sensitivity, type Severity } from "@/lib/monitor";
import { can } from "../ctx";
import type { DB } from "../db/client";
import {
  monitorIncidents, monitorScan, monitorSettings as settingsTable, notifications, paasAppTools, paasApps, paasEvents, paasLogs, paasMetrics, paasMetricsHourly, paasPlans,
  serverTasks, servers, usageHourly, usageSamples, users, vpsPower, vpsTraffic,
} from "../db/schema";
import { enqueue } from "../jobs";
import { monthKey } from "../billing-extras";
import { logAudit, rid } from "../util";
import { virt } from "../virt/driver";
import { quotaOf } from "../virt/sync";
import { detectApp, detectServer, minerProcesses, type Hit, type Result } from "./detect";
import { explainIncident, monitorSettings } from "./explain";
import { buildBaseline, type Baseline, type Point } from "./stats";

const MIN = 60_000, H = 3600_000, DAY = 86400_000;
const CHUNK = 200, BASELINE_PER_RUN = 100;
const SECURITY: Detector[] = ["miner", "outbound_abuse", "inbound_attack", "unusual_io", "brute_force"];
type Row = typeof monitorIncidents.$inferSelect;
type ScanRow = typeof monitorScan.$inferSelect;
export type Res = { kind: ResourceKind; id: string; userId: string; name: string };
export const hrefOf = (kind: ResourceKind, id: string) => (kind === "server" ? "/panel/servers/" : "/panel/apps/") + id;
const rank = (s: string) => SEVERITY_RANK[s as Severity] ?? 0;

/* ---------------- account settings ---------------- */
export type UserCfg = { prefs: ChannelPrefs; resources: Map<string, { sensitivity: Sensitivity; mutedUntil: Date | null }> };
export async function loadCfg(db: DB, userIds: string[]) {
  const out = new Map<string, UserCfg>();
  if (!userIds.length) return out;
  for (const r of await db.select().from(settingsTable).where(inArray(settingsTable.userId, userIds))) {
    const c = out.get(r.userId) ?? { prefs: { ...DEFAULT_PREFS }, resources: new Map() };
    if (!r.resourceKind) c.prefs = { ...DEFAULT_PREFS, ...(r.prefs as Partial<ChannelPrefs>) };
    else c.resources.set(r.resourceKind + ":" + r.resourceId, { sensitivity: r.sensitivity, mutedUntil: r.mutedUntil });
    out.set(r.userId, c);
  }
  return out;
}
const cfgOf = (m: Map<string, UserCfg>, uid: string) => m.get(uid) ?? { prefs: { ...DEFAULT_PREFS }, resources: new Map() };

/* ---------------- delivery ---------------- */
async function deliver(db: DB, inc: Row, severity: Severity, prefs: ChannelPrefs) {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, inc.userId));
  const security = SECURITY.includes(inc.detector as Detector);
  const subject = MONITOR.name + " — " + SEVERITY_LABEL[severity] + ": " + inc.title;
  const text = inc.explanation + "\n\nجزئیات و اقدام با یک کلیک: https://gereh.net/panel/monitor\nحساسیت و کانال‌های اعلان را در همان صفحه تنظیم کنید.";
  let sent = false;
  if (prefs.panel !== "off" && rank(severity) >= rank(prefs.panel)) { await db.insert(notifications).values({ id: rid("n"), userId: inc.userId, icon: security ? "shield-alert" : "activity", text: MONITOR.name + ": " + inc.title }); sent = true; }
  if (u && prefs.email !== "off" && rank(severity) >= Math.max(rank("warn"), rank(prefs.email))) { await enqueue(db, "notify.send", { to: u.email, subject, text }, { dedupe: "monitor:" + inc.id + ":" + severity }); sent = true; }
  if (prefs.channel !== "off" && rank(severity) >= rank(prefs.channel)) {
    const { fanout } = await import("../channels");
    await fanout(db, inc.userId, security ? "security" : "service", subject, text);
    sent = true;
  }
  return sent;
}

/** staff who handle services: one notification each for an abuse incident (and again on escalation) */
async function alertStaff(db: DB, inc: Row) {
  const staff = (await db.select({ id: users.id, staffRole: users.staffRole }).from(users).where(eq(users.role, "admin"))).filter((s) => can(s.staffRole, "services"));
  for (const s of staff) await db.insert(notifications).values({ id: rid("n"), userId: s.id, icon: "shield-alert", text: MONITOR.name + " (سوءاستفاده): " + inc.title + " — حساب " + inc.userId }).onConflictDoNothing();
}

/** only with the admin setting on: the server is suspended at the hypervisor, the customer told, staff audit logged */
async function autoSuspend(db: DB, inc: Row) {
  const [s] = await db.select().from(servers).where(eq(servers.id, inc.resourceId));
  if (!s || s.status !== "running") return false;
  if (s.vpsid) await (await virt()).suspend(s.vpsid);
  await db.update(servers).set({ status: "suspended", suspendedAt: new Date() }).where(eq(servers.id, s.id));
  await logAudit(db, MONITOR.name + " (خودکار)", "تعلیق سرور به‌خاطر ترافیک خروجی مشکوک", s.id);
  await db.insert(notifications).values({ id: rid("n"), userId: s.userId, icon: "shield-alert", text: "سرور " + s.name + " به‌خاطر ترافیک خروجی مشکوک (حمله یا اسپم) معلق شد؛ برای بررسی و رفع تعلیق تیکت ثبت کنید." });
  await enqueue(db, "notify.send", { userId: s.userId, kind: "security", subject: "تعلیق سرور " + s.name, text: "ترافیک خروجی سرور " + s.name + " الگوی حمله یا ارسال اسپم داشت و برای جلوگیری از قرار گرفتن IPها در فهرست سیاه، سرور معلق شد. برای بررسی و رفع تعلیق تیکت ثبت کنید." });
  return true;
}

/* ---------------- the incident lifecycle ---------------- */
export type Tally = { opened: number; updated: number; resolved: number; notified: number; staff: number; suspended: number; explained: number };
const newTally = (): Tally => ({ opened: 0, updated: 0, resolved: 0, notified: 0, staff: 0, suspended: 0, explained: 0 });
/** AI wordings per run; a burst of incidents beyond it gets the template (the scan must stay short) */
const AI_PER_RUN = 20;

export async function applyResult(db: DB, r: Res, res: Result, live: Row[], cfg: UserCfg, now: Date, tally: Tally = newTally()) {
  const t = now.getTime();
  const mine = live.filter((x) => x.resourceKind === r.kind && x.resourceId === r.id);
  const resMute = cfg.resources.get(r.kind + ":" + r.id)?.mutedUntil;
  const resourceMuted = !!resMute && resMute.getTime() > t;
  const hitBy = new Map(res.hits.map((h) => [h.detector, h]));
  const recent = res.hits.length ? await db.select().from(monitorIncidents).where(and(eq(monitorIncidents.resourceKind, r.kind), eq(monitorIncidents.resourceId, r.id), inArray(monitorIncidents.status, ["resolved", "false_positive"]), gt(monitorIncidents.updatedAt, new Date(t - Math.max(R.cooldownHours, R.falsePositiveHours) * H)))) : [];
  let settings: Awaited<ReturnType<typeof monitorSettings>> | null = null;

  for (const h of res.hits) {
    // «هشدار اشتباه بود»: the same detector stays quiet on this resource for a while
    if (recent.some((x) => x.detector === h.detector && x.status === "false_positive" && (x.feedbackAt?.getTime() ?? 0) > t - R.falsePositiveHours * H)) continue;
    let inc = mine.find((x) => x.detector === h.detector);
    let notifyAt: Severity | null = null;
    if (inc) {
      const status = inc.status === "muted" && (!inc.mutedUntil || inc.mutedUntil.getTime() <= t) ? "open" : inc.status;
      const escalated = rank(h.severity) > rank(inc.notifiedSeverity);
      const patch = { severity: h.severity, confidence: h.confidence, title: h.title, evidence: h.evidence as Record<string, unknown>, abuse: !!h.abuse || inc.abuse, cleanCount: 0, status, updatedAt: now, ...(status === "open" ? { mutedUntil: null } : {}) };
      if (escalated && rank(h.severity) > rank(inc.severity)) Object.assign(patch, await explained(db, r, h, tally));
      [inc] = await db.update(monitorIncidents).set(patch).where(eq(monitorIncidents.id, inc.id)).returning();
      tally.updated++;
      if (escalated) notifyAt = h.severity;
    } else {
      // within the cooldown of a recently notified incident of the same kind: quiet unless this one is worse
      const prev = recent.filter((x) => x.detector === h.detector && x.notifiedAt && x.notifiedAt.getTime() > t - R.cooldownHours * H).sort((a, b) => rank(b.notifiedSeverity) - rank(a.notifiedSeverity))[0];
      const quiet = !!prev && rank(h.severity) <= rank(prev.notifiedSeverity);
      [inc] = await db.insert(monitorIncidents).values({
        id: rid("inc"), userId: r.userId, resourceKind: r.kind, resourceId: r.id, resourceName: r.name, detector: h.detector, severity: h.severity, confidence: h.confidence,
        status: "open", title: h.title, evidence: h.evidence as Record<string, unknown>, abuse: !!h.abuse, startedAt: now, updatedAt: now,
        ...(quiet ? { notifiedSeverity: prev!.notifiedSeverity, notifiedAt: prev!.notifiedAt } : {}),
        ...(await explained(db, r, h, tally)),
      }).onConflictDoNothing().returning();
      if (!inc) continue;
      tally.opened++;
      if (!quiet) notifyAt = h.severity;
    }
    if (notifyAt && inc.status === "open" && !resourceMuted) {
      if (await deliver(db, inc, notifyAt, cfg.prefs)) tally.notified++;
      await db.update(monitorIncidents).set({ notifiedSeverity: notifyAt, notifiedAt: now }).where(eq(monitorIncidents.id, inc.id));
    }
    if (inc.abuse && r.kind === "server" && (!inc.staffNotifiedAt || notifyAt === "critical" && rank(inc.notifiedSeverity) < rank("critical"))) {
      await alertStaff(db, inc);
      await db.update(monitorIncidents).set({ staffNotifiedAt: now }).where(eq(monitorIncidents.id, inc.id));
      tally.staff++;
      settings ??= await monitorSettings(db);
      if (settings.autoSuspendAbuse && h.detector === "outbound_abuse" && h.severity === "critical" && (await autoSuspend(db, inc))) {
        tally.suspended++;
        await db.update(monitorIncidents).set({ taken: [...inc.taken, { action: "suspend", label: "تعلیق خودکار سرور", by: MONITOR.name, at: now.toISOString() }] }).where(eq(monitorIncidents.id, inc.id));
      }
    }
  }
  // detectors that ran and found nothing: count clean scans and resolve
  for (const d of res.ran) {
    if (hitBy.has(d)) continue;
    const inc = mine.find((x) => x.detector === d);
    if (!inc) continue;
    const clean = inc.cleanCount + 1;
    if (clean >= R.resolveAfter) { await db.update(monitorIncidents).set({ status: "resolved", cleanCount: clean, resolvedAt: now, updatedAt: now }).where(eq(monitorIncidents.id, inc.id)); tally.resolved++; }
    else await db.update(monitorIncidents).set({ cleanCount: clean }).where(eq(monitorIncidents.id, inc.id));
  }
  return tally;
}

async function explained(db: DB, r: Res, h: Hit, tally: Tally) {
  const e = await explainIncident(db, r.userId, { detector: h.detector, kind: r.kind, severity: h.severity, title: h.title, evidence: h.evidence }, tally.explained++ < AI_PER_RUN);
  return { explanation: e.text, explanationAi: e.ai };
}

/* ---------------- loading ---------------- */
/** one upsert per batch */
const COLS = ["last_sample_at", "baseline", "baseline_at", "trend_at", "last_status", "down_since", "proc_at", "scanned_at"] as const;
const FIELD = { last_sample_at: "lastSampleAt", baseline: "baseline", baseline_at: "baselineAt", trend_at: "trendAt", last_status: "lastStatus", down_since: "downSince", proc_at: "procAt", scanned_at: "scannedAt" } as const;
async function saveScans(db: DB, rows: ScanRow[]) {
  if (!rows.length) return;
  await db.insert(monitorScan).values(rows).onConflictDoUpdate({ target: monitorScan.key, set: Object.fromEntries(COLS.map((c) => [FIELD[c], sql.raw("excluded." + c)])) });
}

const asPoint = (r: { cpu: number; ram: number; disk: number; netIn: number; netOut: number; ioRead: number; ioWrite: number }, at: Date): Point => ({ at, cpu: r.cpu, ram: r.ram, disk: r.disk, netIn: r.netIn, netOut: r.netOut, ioRead: r.ioRead, ioWrite: r.ioWrite });
const STOP_TASK = /^(خاموش کردن|قطع برق|ری‌استارت)/;

async function scanServers(db: DB, now: Date, tally: Tally) {
  const t = now.getTime();
  const all = await db.select({ id: servers.id, userId: servers.userId, name: servers.name, status: servers.status, createdAt: servers.createdAt, vpsid: servers.vpsid, bwLimit: servers.bwLimit })
    .from(servers).where(inArray(servers.status, ["running", "stopped"]));
  let scanned = 0, baselines = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK), ids = chunk.map((s) => s.id);
    const scans = new Map((await db.select().from(monitorScan).where(inArray(monitorScan.key, ids.map((x) => "server:" + x)))).map((r) => [r.key, r]));
    const latest = new Map((await db.select({ id: usageSamples.serverId, at: sql<Date>`max(${usageSamples.createdAt})` }).from(usageSamples)
      .where(and(inArray(usageSamples.serverId, ids), gt(usageSamples.createdAt, new Date(t - 20 * MIN)))).groupBy(usageSamples.serverId)).map((r) => [r.id, new Date(r.at)]));
    const fresh = chunk.filter((s) => { const l = latest.get(s.id), sc = scans.get("server:" + s.id); return l && (!sc?.lastSampleAt || l.getTime() > sc.lastSampleAt.getTime()); });
    const freshIds = fresh.map((s) => s.id);
    const samples = freshIds.length ? await db.select().from(usageSamples).where(and(inArray(usageSamples.serverId, freshIds), gt(usageSamples.createdAt, new Date(t - 150 * MIN)))).orderBy(asc(usageSamples.createdAt)) : [];
    // baselines older than a day (or missing) are rebuilt, a bounded number per run
    const stale = fresh.filter((s) => { const sc = scans.get("server:" + s.id); return !sc?.baselineAt || sc.baselineAt.getTime() < t - R.baselineEveryHours * H; }).slice(0, Math.max(0, BASELINE_PER_RUN - baselines)).map((s) => s.id);
    const built = new Map<string, Baseline>();
    if (stale.length) {
      const rows = await db.select().from(usageHourly).where(and(inArray(usageHourly.serverId, stale), gte(usageHourly.hour, new Date(t - R.baselineDays * DAY)), sql`${usageHourly.hour} < ${new Date(t - 3 * H)}`));
      for (const id of stale) built.set(id, buildBaseline(rows.filter((r) => r.serverId === id).map((r) => asPoint(r, r.hour)), t));
      baselines += stale.length;
    }
    // the hourly trends once per clock hour
    const hourStart = Math.floor(t / H) * H;
    const due = fresh.filter((s) => { const sc = scans.get("server:" + s.id); return !sc?.trendAt || sc.trendAt.getTime() < hourStart; }).map((s) => s.id);
    const hourly = due.length ? await db.select().from(usageHourly).where(and(inArray(usageHourly.serverId, due), gte(usageHourly.hour, new Date(t - 72 * H)))).orderBy(asc(usageHourly.hour)) : [];
    const traffic = due.length ? await db.select().from(vpsTraffic).where(and(inArray(vpsTraffic.serverId, due), eq(vpsTraffic.month, monthKey(now)))) : [];
    // a stop nobody asked for: the server was running at the last scan and no power action was requested since
    const stopped = chunk.filter((s) => s.status === "stopped" && scans.get("server:" + s.id)?.lastStatus === "running").map((s) => s.id);
    const asked = new Set<string>();
    if (stopped.length) {
      for (const r of await db.select({ id: serverTasks.serverId, action: serverTasks.action }).from(serverTasks).where(and(inArray(serverTasks.serverId, stopped), gt(serverTasks.createdAt, new Date(t - 30 * MIN))))) if (STOP_TASK.test(r.action)) asked.add(r.id);
      for (const r of await db.select({ id: vpsPower.serverId }).from(vpsPower).where(inArray(vpsPower.serverId, stopped))) asked.add(r.id);
    }
    const live = await db.select().from(monitorIncidents).where(and(eq(monitorIncidents.resourceKind, "server"), inArray(monitorIncidents.resourceId, ids), inArray(monitorIncidents.status, ["open", "muted"])));
    const cfg = await loadCfg(db, [...new Set(chunk.map((s) => s.userId))]);
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

    const save: ScanRow[] = [];
    for (const s of chunk) {
      const key = "server:" + s.id, sc = scans.get(key);
      const isFresh = freshIds.includes(s.id), isDue = due.includes(s.id);
      const downSince = s.status === "running" ? null : sc?.downSince ?? (stopped.includes(s.id) && !asked.has(s.id) ? now : null);
      const baseline = built.get(s.id) ?? (sc?.baseline as Baseline | null | undefined) ?? null;
      const c = cfgOf(cfg, s.userId);
      const tr = traffic.find((x) => x.serverId === s.id);
      const res = detectServer({
        name: s.name, createdAt: s.createdAt, now: t, sensitivity: c.resources.get(key)?.sensitivity ?? "normal",
        samples: isFresh ? samples.filter((x) => x.serverId === s.id).map((x) => asPoint(x, x.createdAt)) : [],
        baseline, hourly: isDue ? hourly.filter((x) => x.serverId === s.id).map((x) => asPoint(x, x.hour)) : null,
        traffic: isDue && s.bwLimit > 0 ? { usedGb: tr?.usedGb ?? 0, quota: quotaOf(s.bwLimit, tr?.extraGb ?? 0), autoBuy: !!tr?.autoBuy, elapsedHours: (t - monthStart) / H, leftHours: (monthEnd - t) / H } : null,
        downSince,
      });
      // the miner pattern fired: look for known miner names in the process list (rate-limited)
      let procAt = sc?.procAt ?? null;
      const miner = res.hits.find((h) => h.detector === "miner");
      if (miner && s.vpsid && s.status === "running" && (!procAt || procAt.getTime() < t - R.miner.procEveryHours * H)) {
        procAt = now;
        try {
          const names = minerProcesses(await (await virt()).processes(s.vpsid));
          if (names.length) {
            miner.confidence = 0.97;
            miner.evidence = { ...miner.evidence, processes: names, lines: [...miner.evidence.lines, "در فهرست پردازه‌ها نام شناخته‌شده استخراج رمزارز پیدا شد: " + names.slice(0, 3).join("، ")] } satisfies MonitorEvidence;
          }
        } catch { /* the process list is optional evidence */ }
      }
      await applyResult(db, { kind: "server", id: s.id, userId: s.userId, name: s.name }, res, live, c, now, tally);
      const row: Omit<ScanRow, "key"> = {
        lastSampleAt: latest.get(s.id) ?? sc?.lastSampleAt ?? null,
        baseline: (built.has(s.id) ? built.get(s.id) : sc?.baseline ?? null) as Record<string, unknown> | null,
        baselineAt: built.has(s.id) ? now : sc?.baselineAt ?? null,
        trendAt: isDue ? now : sc?.trendAt ?? null,
        lastStatus: s.status, downSince, procAt, scannedAt: now,
      };
      save.push({ key, ...row });
      if (isFresh) scanned++;
    }
    await saveScans(db, save);
  }
  return { servers: all.length, scanned, baselines };
}

const AUTH_FAIL = `(failed password|authentication fail|invalid (user|password)|login failed|unauthori[sz]ed|[" ]401[ "]|status[=:" ]+401)`;

async function scanApps(db: DB, now: Date, tally: Tally) {
  const t = now.getTime();
  const all = await db.select({ id: paasApps.id, userId: paasApps.userId, name: paasApps.name, createdAt: paasApps.createdAt, planId: paasApps.planId, instances: paasApps.instances }).from(paasApps).where(eq(paasApps.status, "running"));
  if (!all.length) return { apps: 0, scanned: 0 };
  const plans = new Map((await db.select({ id: paasPlans.id, ramMb: paasPlans.ramMb }).from(paasPlans)).map((p) => [p.id, p.ramMb]));
  let scanned = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const chunk = all.slice(i, i + CHUNK), ids = chunk.map((a) => a.id);
    const scans = new Map((await db.select().from(monitorScan).where(inArray(monitorScan.key, ids.map((x) => "app:" + x)))).map((r) => [r.key, r]));
    const latest = new Map((await db.select({ id: paasMetrics.target, at: sql<Date>`max(${paasMetrics.createdAt})` }).from(paasMetrics)
      .where(and(inArray(paasMetrics.target, ids), gt(paasMetrics.createdAt, new Date(t - 20 * MIN)))).groupBy(paasMetrics.target)).map((r) => [r.id, new Date(r.at)]));
    const events = await db.select().from(paasEvents).where(and(inArray(paasEvents.appId, ids), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]), gt(paasEvents.createdAt, new Date(t - R.flap.windowMinutes * MIN)))).orderBy(asc(paasEvents.createdAt), asc(paasEvents.id));
    const live = await db.select().from(monitorIncidents).where(and(eq(monitorIncidents.resourceKind, "app"), inArray(monitorIncidents.resourceId, ids), inArray(monitorIncidents.status, ["open", "muted"])));
    const fresh = chunk.filter((a) => {
      const sc = scans.get("app:" + a.id), l = latest.get(a.id);
      const newMetric = l && (!sc?.lastSampleAt || l.getTime() > sc.lastSampleAt.getTime());
      const newEvent = events.some((e) => e.appId === a.id && (!sc?.scannedAt || e.createdAt.getTime() > sc.scannedAt.getTime()));
      // an open incident is re-checked every scan so it can resolve
      return newMetric || newEvent || live.some((x) => x.resourceId === a.id);
    });
    const freshIds = fresh.map((a) => a.id);
    if (!freshIds.length) continue;
    const metrics = await db.select().from(paasMetrics).where(and(inArray(paasMetrics.target, freshIds), gt(paasMetrics.createdAt, new Date(t - 150 * MIN)))).orderBy(asc(paasMetrics.createdAt));
    const stale = fresh.filter((a) => { const sc = scans.get("app:" + a.id); return !sc?.baselineAt || sc.baselineAt.getTime() < t - R.baselineEveryHours * H; }).map((a) => a.id);
    const built = new Map<string, { median: number; days: number }>();
    if (stale.length) {
      for (const r of await db.select({ id: paasMetricsHourly.target, median: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${paasMetricsHourly.cpu}), 0)::float`, days: sql<number>`count(distinct date_trunc('day', ${paasMetricsHourly.hour}))::int` })
        .from(paasMetricsHourly).where(and(inArray(paasMetricsHourly.target, stale), gte(paasMetricsHourly.hour, new Date(t - R.baselineDays * DAY)), sql`${paasMetricsHourly.hour} < ${new Date(t - 3 * H)}`)).groupBy(paasMetricsHourly.target))
        built.set(r.id, { median: Number(r.median), days: Number(r.days) });
      for (const id of stale) if (!built.has(id)) built.set(id, { median: 0, days: 0 });
    }
    const hourStart = Math.floor(t / H) * H;
    const due = fresh.filter((a) => { const sc = scans.get("app:" + a.id); return !sc?.trendAt || sc.trendAt.getTime() < hourStart; }).map((a) => a.id);
    const hourly = due.length ? await db.select().from(paasMetricsHourly).where(and(inArray(paasMetricsHourly.target, due), gte(paasMetricsHourly.hour, new Date(t - 48 * H)))).orderBy(asc(paasMetricsHourly.hour)) : [];
    // auth failures in the apps' own logs (only for apps whose logs are collected)
    const collected = new Set((await db.select({ id: paasAppTools.appId }).from(paasAppTools).where(and(inArray(paasAppTools.appId, freshIds), sql`${paasAppTools.logsCursor} is not null`))).map((r) => r.id));
    const fails = new Map((await db.select({ id: paasLogs.appId, n: sql<number>`count(*) filter (where ${paasLogs.line} ~* ${AUTH_FAIL})::int`, all: sql<number>`count(*)::int` }).from(paasLogs)
      .where(and(inArray(paasLogs.appId, freshIds), gt(paasLogs.at, new Date(t - R.brute.windowMinutes * MIN)))).groupBy(paasLogs.appId)).map((r) => [r.id, Number(r.n)]));
    const cfg = await loadCfg(db, [...new Set(fresh.map((a) => a.userId))]);

    const save: ScanRow[] = [];
    for (const a of fresh) {
      const key = "app:" + a.id, sc = scans.get(key), c = cfgOf(cfg, a.userId);
      const isDue = due.includes(a.id);
      const base = built.get(a.id) ?? (sc?.baseline as { median: number; days: number } | null | undefined) ?? null;
      const res = detectApp({
        name: a.name, createdAt: a.createdAt, now: t, sensitivity: c.resources.get(key)?.sensitivity ?? "normal",
        metrics: metrics.filter((m) => m.target === a.id).map((m) => ({ at: m.createdAt, cpu: m.cpu, ramMb: m.ramMb, rpm: m.rpm })),
        cpuBaseline: base, hourly: isDue ? hourly.filter((m) => m.target === a.id).map((m) => ({ at: m.hour, cpu: m.cpu, ramMb: m.ramMb })) : null,
        ramMb: (plans.get(a.planId) ?? 0) * Math.max(1, a.instances),
        events: events.filter((e) => e.appId === a.id).map((e) => ({ id: e.id, kind: e.kind, at: e.createdAt, message: e.message })),
        authFailures: fails.has(a.id) ? fails.get(a.id)! : collected.has(a.id) ? 0 : null,
      });
      await applyResult(db, { kind: "app", id: a.id, userId: a.userId, name: a.name }, res, live, c, now, tally);
      const row: Omit<ScanRow, "key"> = {
        lastSampleAt: latest.get(a.id) ?? sc?.lastSampleAt ?? null,
        baseline: (built.has(a.id) ? built.get(a.id) : sc?.baseline ?? null) as Record<string, unknown> | null,
        baselineAt: built.has(a.id) ? now : sc?.baselineAt ?? null,
        trendAt: isDue ? now : sc?.trendAt ?? null,
        lastStatus: "running", downSince: null, procAt: null, scannedAt: now,
      };
      save.push({ key, ...row });
      scanned++;
    }
    await saveScans(db, save);
  }
  return { apps: all.length, scanned };
}

/** the job: servers then apps; muted incidents whose mute ran out are reopened by the next hit */
export async function monitorScanJob(db: DB, o: { now?: Date } = {}) {
  const now = o.now ?? new Date();
  const tally = newTally();
  const s = await scanServers(db, now, tally);
  const a = await scanApps(db, now, tally);
  // a resource deleted (or an app stopped) since: its live incidents are closed, they can no longer be checked
  const liveRows = await db.select({ id: monitorIncidents.id, kind: monitorIncidents.resourceKind, rid: monitorIncidents.resourceId }).from(monitorIncidents).where(inArray(monitorIncidents.status, ["open", "muted"]));
  if (liveRows.length) {
    const sIds = [...new Set(liveRows.filter((r) => r.kind === "server").map((r) => r.rid))], aIds = [...new Set(liveRows.filter((r) => r.kind === "app").map((r) => r.rid))];
    const okS = new Set(sIds.length ? (await db.select({ id: servers.id }).from(servers).where(and(inArray(servers.id, sIds), inArray(servers.status, ["running", "stopped", "suspended"])))).map((r) => r.id) : []);
    const okA = new Set(aIds.length ? (await db.select({ id: paasApps.id }).from(paasApps).where(and(inArray(paasApps.id, aIds), eq(paasApps.status, "running")))).map((r) => r.id) : []);
    const gone = liveRows.filter((r) => !(r.kind === "server" ? okS : okA).has(r.rid)).map((r) => r.id);
    if (gone.length) { await db.update(monitorIncidents).set({ status: "resolved", resolvedAt: now, updatedAt: now }).where(inArray(monitorIncidents.id, gone)); tally.resolved += gone.length; }
  }
  // a mute that ran out: the incident is open again (and notifies on its next escalation)
  await db.update(monitorIncidents).set({ status: "open", mutedUntil: null }).where(and(eq(monitorIncidents.status, "muted"), sql`${monitorIncidents.mutedUntil} <= ${now}`));
  // history is kept 90 days
  await db.delete(monitorIncidents).where(and(inArray(monitorIncidents.status, ["resolved", "false_positive"]), sql`${monitorIncidents.updatedAt} < ${new Date(now.getTime() - 90 * DAY)}`));
  return { ...s, ...a, ...tally };
}
