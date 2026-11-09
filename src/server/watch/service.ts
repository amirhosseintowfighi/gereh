/* «پایش پیشرفته»: plans (trial, monthly renewal from the wallet, upgrades prorated, downgrades at renewal), the
   on-demand check, the schedule (watch.tick, every 5 minutes) and the uptime ping (watch.ping, every minute).
   بافت projects' apps are checked by their maintenance agent (../builder/maintain.ts builderMaintain); everything
   else here. Notifications go out only when a check finds something (or for the trial and billing). */
import "server-only";
import { and, desc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { faDateTime } from "@/lib/jalali";
import { upgradeDue, WATCH, WATCH_HEALTH_LABEL, WATCH_MODE_LABEL, type WatchAdminView, type WatchCheckView, type WatchHistory, type WatchKind, type WatchPlanMode, type WatchReport, type WatchResourceView } from "@/lib/watch";
import { needUser, type Ctx } from "../ctx";
import { debit } from "../billing-extras";
import type { DB } from "../db/client";
import { builderProjects, kv, paasApps, paasEvents, monitorIncidents, servers, transactions, users, watchChecks, watchPings, watchPlans } from "../db/schema";
import { demoMode } from "../demo";
import { enqueue } from "../jobs";
import { appsDomain, defaultHost } from "../paas/service";
import { AppError, notify, rid } from "../util";
import { ERROR_RE, gatherFacts, runCheck, type CheckResult } from "./check";
import { watchQuote, watchSettings } from "./settings";
import { createHash } from "node:crypto";

type Plan = typeof watchPlans.$inferSelect;
const MIN = 60_000, H = 3600_000, DAY = 86400_000;
const LIVE = ["trial", "active"] as const;
const COOLDOWN_MS = 30 * MIN;
const PING_KEEP_DAYS = 35;
const sig = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const hrefOf = (kind: WatchKind, id: string) => (kind === "server" ? "/panel/servers/" : "/panel/apps/") + id;
const daysLeft = (d: Date | null, now = Date.now()) => (d ? Math.max(0, Math.ceil((d.getTime() - now) / DAY)) : 0);

/* ---------------- resources ---------------- */
type Res = { kind: WatchKind; id: string; userId: string; name: string; running: boolean; createdAt: Date; builder: boolean };
async function resourcesOf(db: DB, userId: string): Promise<Res[]> {
  const ss = await db.select().from(servers).where(and(eq(servers.userId, userId), inArray(servers.status, ["running", "stopped"])));
  const as = await db.select().from(paasApps).where(and(eq(paasApps.userId, userId), inArray(paasApps.status, ["running", "stopped", "building", "failed"])));
  const bp = new Set(as.length ? (await db.select({ appId: builderProjects.appId }).from(builderProjects).where(inArray(builderProjects.appId, as.map((a) => a.id)))).map((r) => r.appId) : []);
  return [
    ...ss.map((s) => ({ kind: "server" as const, id: s.id, userId, name: s.name, running: s.status === "running", createdAt: s.createdAt, builder: false })),
    ...as.map((a) => ({ kind: "app" as const, id: a.id, userId, name: a.name, running: a.status === "running", createdAt: a.createdAt, builder: bp.has(a.id) })),
  ];
}
async function ownResource(db: DB, userId: string, kind: WatchKind, id: string) {
  const r = (await resourcesOf(db, userId)).find((x) => x.kind === kind && x.id === id);
  if (!r) throw new AppError("سرویس پیدا نشد.", 404);
  return r;
}
const planOf = async (db: DB, kind: WatchKind, id: string) => (await db.select().from(watchPlans).where(and(eq(watchPlans.resourceKind, kind), eq(watchPlans.resourceId, id))))[0] ?? null;
const isLive = (p: Plan | null): p is Plan => !!p && (LIVE as readonly string[]).includes(p.status);

/** the address the ping checks: the plan's own, else an app's public address */
async function pingUrl(db: DB, p: Plan): Promise<string> {
  if (p.uptimeUrl) return p.uptimeUrl;
  if (p.resourceKind !== "app") return "";
  const [a] = await db.select({ name: paasApps.name }).from(paasApps).where(eq(paasApps.id, p.resourceId));
  return a ? "https://" + defaultHost(a.name, await appsDomain(db)) + "/" : "";
}

/** when the account has never had a plan, its first one is a free trial */
async function trialAvailable(db: DB, userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(watchPlans).where(eq(watchPlans.userId, userId));
  return (r?.n ?? 0) === 0;
}

const view = (c: typeof watchChecks.$inferSelect): WatchCheckView => ({ id: c.id, trigger: c.trigger, status: c.status, summary: c.summary, charged: c.charged, at: faDateTime(c.createdAt) });

async function uptimeOf(db: DB, planIds: string[]) {
  if (!planIds.length) return new Map<string, number>();
  const rows = await db.select({ id: watchPings.planId, ok: sql<number>`count(*) filter (where ${watchPings.ok})::int`, all: sql<number>`count(*)::int` }).from(watchPings)
    .where(and(inArray(watchPings.planId, planIds), gte(watchPings.at, new Date(Date.now() - 30 * DAY)))).groupBy(watchPings.planId);
  return new Map(rows.filter((r) => r.all >= 30).map((r) => [r.id, Math.round((r.ok / r.all) * 10_000) / 100]));
}

/** «الان بررسی کن» right now: free within the plan's daily allowance, else the on-demand price */
async function manualPrice(db: DB, plan: Plan | null) {
  const [s, q] = await Promise.all([watchSettings(db), watchQuote(db)]);
  if (!isLive(plan)) return q.onDemand;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(watchChecks).where(and(eq(watchChecks.planId, plan.id), eq(watchChecks.trigger, "manual"), eq(watchChecks.charged, 0), gte(watchChecks.createdAt, new Date(Date.now() - DAY))));
  return (r?.n ?? 0) < s.freeManualPerDay ? 0 : q.onDemand;
}

/* ---------------- the customer's page ---------------- */
export async function watchReport(ctx: Ctx): Promise<WatchReport> {
  const a = needUser(ctx), db = ctx.db;
  const res = await resourcesOf(db, a.uid);
  const plans = await db.select().from(watchPlans).where(eq(watchPlans.userId, a.uid));
  const ups = await uptimeOf(db, plans.filter(isLive).map((p) => p.id));
  const last = res.length ? await db.select().from(watchChecks).where(and(eq(watchChecks.userId, a.uid), gte(watchChecks.createdAt, new Date(Date.now() - 30 * DAY)))).orderBy(desc(watchChecks.createdAt)) : [];
  const [q, s, u] = await Promise.all([watchQuote(db), watchSettings(db), db.select({ balance: users.balance }).from(users).where(eq(users.id, a.uid))]);
  const out: WatchResourceView[] = [];
  for (const r of res) {
    const p = plans.find((x) => x.resourceKind === r.kind && x.resourceId === r.id) ?? null;
    const live = isLive(p) ? p : null;
    const l = last.find((c) => c.resourceKind === r.kind && c.resourceId === r.id);
    out.push({
      kind: r.kind, id: r.id, name: r.name, href: hrefOf(r.kind, r.id), running: r.running, builder: r.builder,
      plan: live ? { mode: live.mode, status: live.status, renew: live.renew, nextMode: live.nextMode, price: live.price, paidUntil: live.paidUntil ? faDateTime(live.paidUntil) : "", trialEnds: live.trialEnds ? faDateTime(live.trialEnds) : "", daysLeft: daysLeft(live.status === "trial" ? live.trialEnds : live.paidUntil), uptimeUrl: live.uptimeUrl, autoFix: live.autoFix } : null,
      uptime: live ? ups.get(live.id) ?? null : null, down: !!live?.downSince,
      last: l ? view(l) : null,
      checkPrice: await manualPrice(db, p),
    });
  }
  return { resources: out, prices: { onDemand: q.onDemand, every3h: q.every3h, continuous: q.continuous }, trialDays: s.trialDays, trialAvailable: await trialAvailable(db, a.uid), balance: u[0]?.balance ?? 0 };
}

export async function watchHistory(ctx: Ctx, kind: WatchKind, id: string): Promise<WatchHistory> {
  const a = needUser(ctx);
  await ownResource(ctx.db, a.uid, kind, id);
  const checks = await ctx.db.select().from(watchChecks).where(and(eq(watchChecks.resourceKind, kind), eq(watchChecks.resourceId, id), eq(watchChecks.userId, a.uid))).orderBy(desc(watchChecks.createdAt)).limit(50);
  const p = await planOf(ctx.db, kind, id);
  const pings = p ? await ctx.db.select().from(watchPings).where(and(eq(watchPings.planId, p.id), gte(watchPings.at, new Date(Date.now() - DAY)))).orderBy(desc(watchPings.at)).limit(1440) : [];
  return { checks: checks.map(view), pings: pings.reverse().map((x) => ({ at: x.at.toISOString(), ok: x.ok, ms: x.ms })) };
}

const priceOfMode = async (db: DB, mode: WatchPlanMode) => { const q = await watchQuote(db); return mode === "every3h" ? q.every3h : q.continuous; };
const NO_BALANCE = "موجودی کیف پول کافی نیست؛ ابتدا کیف پول را شارژ کنید.";

/** turns «پایش پیشرفته» on, or changes its mode: the first plan of an account is a free trial; a move up is charged
    for the days left; a move down waits for the renewal */
export async function watchEnable(ctx: Ctx, kind: WatchKind, id: string, mode: WatchPlanMode) {
  const a = needUser(ctx), db = ctx.db;
  const r = await ownResource(db, a.uid, kind, id);
  const s = await watchSettings(db);
  const price = await priceOfMode(db, mode);
  const now = new Date();
  const p = await planOf(db, kind, id);
  if (isLive(p)) {
    if (p.mode === mode) { await db.update(watchPlans).set({ nextMode: null, updatedAt: now }).where(eq(watchPlans.id, p.id)); return { message: "حالت «" + WATCH_MODE_LABEL[mode] + "» از قبل فعال است." }; }
    if (p.status === "trial") { await db.update(watchPlans).set({ mode, nextMode: null, updatedAt: now }).where(eq(watchPlans.id, p.id)); return { message: "حالت آزمایشی به «" + WATCH_MODE_LABEL[mode] + "» تغییر کرد." }; }
    if (price > p.price) {
      const due = upgradeDue(p.price, price, daysLeft(p.paidUntil));
      if (due && !(await debit(db, a.uid, due, WATCH.name + " «" + r.name + "»: ارتقا به «" + WATCH_MODE_LABEL[mode] + "»", kind === "server" ? { serverId: id } : {}))) throw new AppError(NO_BALANCE, 402);
      await db.update(watchPlans).set({ mode, price, nextMode: null, updatedAt: now }).where(eq(watchPlans.id, p.id));
      return { message: "به «" + WATCH_MODE_LABEL[mode] + "» ارتقا یافت" + (due ? "؛ " + due.toLocaleString("fa-IR") + " تومان برای روزهای باقی‌مانده کسر شد." : ".") };
    }
    await db.update(watchPlans).set({ nextMode: mode, updatedAt: now }).where(eq(watchPlans.id, p.id));
    return { message: "از تمدید بعدی (" + (p.paidUntil ? faDateTime(p.paidUntil) : "") + ") حالت «" + WATCH_MODE_LABEL[mode] + "» می‌شود." };
  }
  if (s.trialDays > 0 && (await trialAvailable(db, a.uid))) {
    await insertPlan(db, { userId: a.uid, kind, id, mode, status: "trial", renew: false, price: 0, trialEnds: new Date(now.getTime() + s.trialDays * DAY) });
    return { message: WATCH.name + " برای «" + r.name + "» " + s.trialDays.toLocaleString("fa-IR") + " روز رایگان روشن شد." };
  }
  if (!(await debit(db, a.uid, price, WATCH.name + " «" + r.name + "» — «" + WATCH_MODE_LABEL[mode] + "»، یک ماه", kind === "server" ? { serverId: id } : {}))) throw new AppError(NO_BALANCE, 402);
  await insertPlan(db, { userId: a.uid, kind, id, mode, status: "active", renew: true, price, paidUntil: new Date(now.getTime() + 30 * DAY) });
  return { message: WATCH.name + " «" + WATCH_MODE_LABEL[mode] + "» برای «" + r.name + "» فعال شد." };
}

async function insertPlan(db: DB, o: { userId: string; kind: WatchKind; id: string; mode: WatchPlanMode; status: "trial" | "active"; renew: boolean; price: number; trialEnds?: Date; paidUntil?: Date }) {
  const values = { userId: o.userId, mode: o.mode, status: o.status, renew: o.renew, price: o.price, trialEnds: o.trialEnds ?? null, paidUntil: o.paidUntil ?? null, nextMode: null, trialNoticeAt: null, pingFails: 0, downSince: null, lastCheckAt: null, lastDailyAt: null, updatedAt: new Date() };
  await db.insert(watchPlans).values({ id: rid("wpl"), resourceKind: o.kind, resourceId: o.id, ...values })
    .onConflictDoUpdate({ target: [watchPlans.resourceKind, watchPlans.resourceId], set: values });
}

/** renew on/off: after a trial, on means "continue and pay"; on a paid plan, off means it ends at paidUntil */
export async function watchRenew(ctx: Ctx, kind: WatchKind, id: string, renew: boolean) {
  const a = needUser(ctx);
  await ownResource(ctx.db, a.uid, kind, id);
  const p = await planOf(ctx.db, kind, id);
  if (!isLive(p)) throw new AppError("پایش پیشرفته برای این سرویس فعال نیست.");
  await ctx.db.update(watchPlans).set({ renew, updatedAt: new Date() }).where(eq(watchPlans.id, p.id));
  return { message: renew ? (p.status === "trial" ? "پس از پایان دوره آزمایشی، پایش با هزینه ماهانه ادامه می‌یابد." : "تمدید خودکار روشن شد.") : "پایش پیشرفته در پایان دوره (" + faDateTime((p.status === "trial" ? p.trialEnds : p.paidUntil) ?? new Date()) + ") خاموش می‌شود." };
}

export async function watchOptions(ctx: Ctx, kind: WatchKind, id: string, o: { autoFix?: boolean; uptimeUrl?: string }) {
  const a = needUser(ctx);
  await ownResource(ctx.db, a.uid, kind, id);
  const p = await planOf(ctx.db, kind, id);
  if (!isLive(p)) throw new AppError("پایش پیشرفته برای این سرویس فعال نیست.");
  if (o.uptimeUrl !== undefined && o.uptimeUrl !== "" && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(o.uptimeUrl)) throw new AppError("نشانی پینگ باید با http:// یا https:// شروع شود.");
  await ctx.db.update(watchPlans).set({ ...(o.autoFix !== undefined ? { autoFix: o.autoFix } : {}), ...(o.uptimeUrl !== undefined ? { uptimeUrl: o.uptimeUrl, pingFails: 0, downSince: null } : {}), updatedAt: new Date() }).where(eq(watchPlans.id, p.id));
  return { message: "ذخیره شد." };
}

/** «الان بررسی کن»: one check now; charged (on-demand price) only when the AI wrote the report */
export async function watchCheckNow(ctx: Ctx, kind: WatchKind, id: string): Promise<WatchCheckView & { ai: boolean }> {
  const a = needUser(ctx), db = ctx.db;
  const r = await ownResource(db, a.uid, kind, id);
  const p = await planOf(db, kind, id);
  const price = await manualPrice(db, p);
  if (price > 0) {
    const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, a.uid));
    if ((u?.balance ?? 0) < price) throw new AppError(NO_BALANCE + " (هزینه این بررسی: " + price.toLocaleString("fa-IR") + " تومان)", 402);
  }
  const f = await gatherFacts(db, kind, id);
  if (!f) throw new AppError("سرویس پیدا نشد.", 404);
  const res = await runCheck(db, f, { trigger: "manual", planId: isLive(p) ? p.id : null });
  let charged = 0;
  if (price > 0 && res.ai && (await debit(db, a.uid, price, WATCH.name + ": بررسی «" + r.name + "»", kind === "server" ? { serverId: id } : {}))) {
    charged = price;
    await db.update(watchChecks).set({ charged }).where(eq(watchChecks.id, res.id));
  }
  return { id: res.id, trigger: "manual", status: res.status, summary: res.summary, charged, at: faDateTime(new Date()), ai: res.ai };
}

/* ---------------- the schedule ---------------- */
async function tell(db: DB, userId: string, icon: string, subject: string, text: string, dedupe?: string) {
  await notify(db, userId, icon, subject);
  await enqueue(db, "notify.send", { userId, kind: "service", subject, text }, dedupe ? { dedupe } : {});
}
async function reportCheck(db: DB, p: Plan, name: string, r: CheckResult) {
  if (r.status !== "warn" && r.status !== "critical") return;
  await tell(db, p.userId, r.status === "critical" ? "shield-alert" : "activity", WATCH.name + " «" + name + "»: " + WATCH_HEALTH_LABEL[r.status], r.summary + "\n\nجزئیات: https://gereh.net/panel/monitor", "watch:" + r.id);
}

/** the first running service of an account that never had a plan gets the trial by itself (new services only) */
async function autoTrials(db: DB, now: Date) {
  const s = await watchSettings(db);
  if (!s.trialDays) return 0;
  let [since] = await db.select().from(kv).where(eq(kv.key, "watch_since"));
  if (!since) { await db.insert(kv).values({ key: "watch_since", value: { at: now.toISOString() } }).onConflictDoNothing(); [since] = await db.select().from(kv).where(eq(kv.key, "watch_since")); }
  const from = new Date((since.value as { at: string }).at);
  const used = sql`not exists (select 1 from watch_plans w where w.user_id = `;
  const apps = await db.select({ id: paasApps.id, userId: paasApps.userId, name: paasApps.name }).from(paasApps)
    .where(and(eq(paasApps.status, "running"), sql`${paasApps.liveDeployment} is not null`, gte(paasApps.createdAt, from), lte(paasApps.createdAt, now), sql`${used}${paasApps.userId})`));
  const srvs = await db.select({ id: servers.id, userId: servers.userId, name: servers.name }).from(servers)
    .where(and(eq(servers.status, "running"), gte(servers.createdAt, from), lte(servers.createdAt, now), sql`${used}${servers.userId})`));
  const seen = new Set<string>();
  let n = 0;
  for (const r of [...apps.map((x) => ({ ...x, kind: "app" as const })), ...srvs.map((x) => ({ ...x, kind: "server" as const }))]) {
    if (seen.has(r.userId)) continue;
    seen.add(r.userId);
    await insertPlan(db, { userId: r.userId, kind: r.kind, id: r.id, mode: "continuous", status: "trial", renew: false, price: 0, trialEnds: new Date(now.getTime() + s.trialDays * DAY) });
    await tell(db, r.userId, "heart-pulse", WATCH.name + " برای «" + r.name + "» " + s.trialDays.toLocaleString("fa-IR") + " روز رایگان روشن شد",
      "«" + r.name + "» بالا آمد. از این به بعد " + s.trialDays.toLocaleString("fa-IR") + " روز، رایگان و «همیشه روشن» حواسمان به آن است: لاگ‌ها، کرش‌ها، مصرف و دسترس‌پذیری. پس از آن می‌توانید ادامه دهید یا خاموشش کنید: https://gereh.net/panel/monitor", "watch-trial:" + r.userId);
    n++;
  }
  return n;
}

/** trials that end, renewals and their notices */
async function billingPass(db: DB, now: Date) {
  const t = now.getTime();
  for (const p of await db.select().from(watchPlans).where(inArray(watchPlans.status, [...LIVE]))) {
    const name = await nameOf(db, p);
    if (p.status === "trial" && p.trialEnds) {
      if (!p.trialNoticeAt && p.trialEnds.getTime() - t < 2 * DAY && p.trialEnds.getTime() > t) {
        await db.update(watchPlans).set({ trialNoticeAt: now }).where(eq(watchPlans.id, p.id));
        await tell(db, p.userId, "clock", WATCH.name + " آزمایشی «" + name + "» به‌زودی تمام می‌شود",
          "دوره آزمایشی پایش «" + name + "» " + faDateTime(p.trialEnds) + " تمام می‌شود. برای ادامه، در پنل › پایش هوشمند «ادامه پایش» را بزنید (" + (await priceOfMode(db, p.mode)).toLocaleString("fa-IR") + " تومان در ماه)؛ وگرنه به پایش پایه برمی‌گردد.");
      }
      if (p.trialEnds.getTime() <= t) await renewOrEnd(db, p, name, now);
      continue;
    }
    if (p.paidUntil && p.paidUntil.getTime() <= t) await renewOrEnd(db, p, name, now);
  }
}
async function renewOrEnd(db: DB, p: Plan, name: string, now: Date) {
  const mode = p.nextMode ?? p.mode;
  if (p.renew) {
    const price = await priceOfMode(db, mode);
    if (await debit(db, p.userId, price, WATCH.name + " «" + name + "» — «" + WATCH_MODE_LABEL[mode] + "»، یک ماه", p.resourceKind === "server" ? { serverId: p.resourceId } : {})) {
      await db.update(watchPlans).set({ status: "active", mode, nextMode: null, price, paidUntil: new Date(now.getTime() + 30 * DAY), updatedAt: now }).where(eq(watchPlans.id, p.id));
      return;
    }
    await db.update(watchPlans).set({ status: "expired", updatedAt: now }).where(eq(watchPlans.id, p.id));
    await tell(db, p.userId, "circle-alert", WATCH.name + " «" + name + "» تمدید نشد", "موجودی کیف پول برای تمدید پایش «" + name + "» (" + price.toLocaleString("fa-IR") + " تومان) کافی نبود؛ سرویس به پایش پایه برگشت. پس از شارژ کیف پول می‌توانید دوباره روشنش کنید.");
    return;
  }
  await db.update(watchPlans).set({ status: p.status === "trial" ? "expired" : "cancelled", updatedAt: now }).where(eq(watchPlans.id, p.id));
  await tell(db, p.userId, "info", WATCH.name + " «" + name + "» خاموش شد", "پایش پیشرفته «" + name + "» به پایان رسید و سرویس به پایش پایه برگشت. هر وقت خواستید از پنل › پایش هوشمند دوباره روشنش کنید.");
}
async function nameOf(db: DB, p: Plan) {
  if (p.resourceKind === "server") return (await db.select({ n: servers.name }).from(servers).where(eq(servers.id, p.resourceId)))[0]?.n ?? p.resourceId;
  return (await db.select({ n: paasApps.name }).from(paasApps).where(eq(paasApps.id, p.resourceId)))[0]?.n ?? p.resourceId;
}

/** what is new on a resource since the plan's last anomaly read (no tokens to notice it) */
async function newSince(db: DB, p: Plan, logs: string[]) {
  const since = p.lastCheckAt ?? new Date(Date.now() - 10 * MIN);
  const inc = await db.select({ id: monitorIncidents.id }).from(monitorIncidents).where(and(eq(monitorIncidents.resourceKind, p.resourceKind), eq(monitorIncidents.resourceId, p.resourceId), gt(monitorIncidents.startedAt, since))).limit(1);
  let lastEventId = p.lastEventId, ev = false;
  if (p.resourceKind === "app") {
    const [e] = await db.select({ id: paasEvents.id }).from(paasEvents).where(and(eq(paasEvents.appId, p.resourceId), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]), gt(paasEvents.id, p.lastEventId))).orderBy(desc(paasEvents.id)).limit(1);
    if (e) { ev = true; lastEventId = e.id; }
  }
  const errors = logs.filter((l) => ERROR_RE.test(l));
  const s = errors.length ? sig(errors[errors.length - 1]) : "";
  const burst = errors.length >= 3 && s !== p.lastSig;
  return { any: !!inc.length || ev || burst, lastEventId, sig: s || p.lastSig };
}

/** due checks of every live plan (بافت projects' apps are left to builderMaintain) */
async function checksPass(db: DB, now: Date) {
  const t = now.getTime();
  const s = await watchSettings(db);
  const plans = await db.select().from(watchPlans).where(inArray(watchPlans.status, [...LIVE]));
  const builderApps = new Set(plans.length ? (await db.select({ appId: builderProjects.appId }).from(builderProjects).where(inArray(builderProjects.appId, plans.filter((p) => p.resourceKind === "app").map((p) => p.resourceId).concat("")))).map((r) => r.appId) : []);
  let checks = 0;
  for (const p of plans) {
    if (p.resourceKind === "app" && builderApps.has(p.resourceId)) continue;
    if (p.mode === "every3h") {
      if (p.lastCheckAt && t - p.lastCheckAt.getTime() < 3 * H) continue;
      const f = await gatherFacts(db, p.resourceKind, p.resourceId, now);
      if (!f) continue;
      await db.update(watchPlans).set({ lastCheckAt: now }).where(eq(watchPlans.id, p.id));
      await reportCheck(db, p, f.name, await runCheck(db, f, { trigger: "schedule", planId: p.id }));
      checks++;
      continue;
    }
    // continuous: an AI read when something new appears (cooldown, daily cap), and the daily summary
    const f = await gatherFacts(db, p.resourceKind, p.resourceId, now);
    if (!f) continue;
    const fresh = await newSince(db, p, f.logs);
    const cooled = !p.lastCheckAt || t - p.lastCheckAt.getTime() >= COOLDOWN_MS;
    if (fresh.any && cooled) {
      const [today] = await db.select({ n: sql<number>`count(*)::int` }).from(watchChecks).where(and(eq(watchChecks.planId, p.id), eq(watchChecks.trigger, "anomaly"), gte(watchChecks.createdAt, new Date(t - DAY))));
      if ((today?.n ?? 0) < s.continuousMaxPerDay) {
        await db.update(watchPlans).set({ lastCheckAt: now, lastEventId: fresh.lastEventId, lastSig: fresh.sig }).where(eq(watchPlans.id, p.id));
        await reportCheck(db, p, f.name, await runCheck(db, f, { trigger: "anomaly", planId: p.id }));
        checks++;
        continue;
      }
    }
    if (fresh.lastEventId !== p.lastEventId || fresh.sig !== p.lastSig) await db.update(watchPlans).set({ lastEventId: fresh.lastEventId, lastSig: fresh.sig }).where(eq(watchPlans.id, p.id));
    if ((!p.lastDailyAt || t - p.lastDailyAt.getTime() >= DAY) && cooled) {
      await db.update(watchPlans).set({ lastDailyAt: now, lastCheckAt: now }).where(eq(watchPlans.id, p.id));
      await reportCheck(db, p, f.name, await runCheck(db, f, { trigger: "daily", planId: p.id }));
      checks++;
    }
  }
  return checks;
}

/** the weekly health report of every live plan */
async function weeklyPass(db: DB, now: Date) {
  const t = now.getTime();
  for (const p of await db.select().from(watchPlans).where(inArray(watchPlans.status, [...LIVE]))) {
    if (!p.lastWeeklyAt) { await db.update(watchPlans).set({ lastWeeklyAt: now }).where(eq(watchPlans.id, p.id)); continue; }
    if (t - p.lastWeeklyAt.getTime() < 7 * DAY) continue;
    await db.update(watchPlans).set({ lastWeeklyAt: now }).where(eq(watchPlans.id, p.id));
    const rows = await db.select().from(watchChecks).where(and(eq(watchChecks.planId, p.id), gte(watchChecks.createdAt, new Date(t - 7 * DAY))));
    const up = (await uptimeOf(db, [p.id])).get(p.id);
    const name = await nameOf(db, p);
    const bad = rows.filter((r) => r.status === "warn" || r.status === "critical");
    const text = ["گزارش هفتگی پایش «" + name + "»:", "• بررسی‌ها: " + rows.length.toLocaleString("fa-IR") + "، مورد نیازمند توجه: " + bad.length.toLocaleString("fa-IR"), up !== undefined ? "• دسترس‌پذیری ۳۰ روز اخیر: " + up.toLocaleString("fa-IR") + "٪" : "", ...bad.slice(0, 3).map((r) => "• " + faDateTime(r.createdAt) + ": " + r.summary.split("\n").slice(1).join(" ").slice(0, 160))].filter(Boolean).join("\n");
    await tell(db, p.userId, "chart-column", "گزارش هفتگی پایش «" + name + "»", text + "\n\nجزئیات: https://gereh.net/panel/monitor", "watch-week:" + p.id + ":" + Math.floor(t / (7 * DAY)));
  }
}

export async function watchTick(db: DB, o: { now?: Date } = {}) {
  const now = o.now ?? new Date();
  const trials = await autoTrials(db, now);
  await billingPass(db, now);
  const checks = await checksPass(db, now);
  await weeklyPass(db, now);
  return { trials, checks };
}

/* ---------------- the uptime ping ---------------- */
export type Pinger = (url: string) => Promise<{ ok: boolean; ms: number; code: number }>;
const realPinger: Pinger = async (url) => {
  const t = Date.now();
  try {
    const r = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "GerehUptime/1.0" } });
    await r.body?.cancel().catch(() => {});
    return { ok: r.status < 500, ms: Date.now() - t, code: r.status };
  } catch { return { ok: false, ms: Date.now() - t, code: 0 }; }
};
let pinger: Pinger | null = null;
/** tests replace the network */
export const setPinger = (p: Pinger | null) => { pinger = p; };

export async function watchPing(db: DB, o: { now?: Date } = {}) {
  const now = o.now ?? new Date();
  const ping = pinger ?? (demoMode() ? null : realPinger);
  if (!ping) return { pinged: 0 };
  const plans = await db.select().from(watchPlans).where(inArray(watchPlans.status, [...LIVE]));
  let pinged = 0;
  for (let i = 0; i < plans.length; i += 20) {
    await Promise.all(plans.slice(i, i + 20).map(async (p) => {
      const url = await pingUrl(db, p);
      if (!url) return;
      const r = await ping(url);
      pinged++;
      await db.insert(watchPings).values({ planId: p.id, ok: r.ok, ms: r.ms, code: r.code, at: now });
      if (!r.ok) {
        const fails = p.pingFails + 1;
        await db.update(watchPlans).set({ pingFails: fails, ...(fails === 2 ? { downSince: now } : {}) }).where(eq(watchPlans.id, p.id));
        if (fails === 2) {
          const name = await nameOf(db, p);
          await tell(db, p.userId, "shield-alert", WATCH.name + ": «" + name + "» پاسخ نمی‌دهد", "«" + name + "» از " + faDateTime(now) + " به پینگ " + url + " پاسخ نمی‌دهد" + (r.code ? " (کد " + r.code + ")" : " (اتصال برقرار نشد)") + ". وضعیت و لاگ‌ها را در پنل ببینید: https://gereh.net/panel/monitor", "watch-down:" + p.id + ":" + Math.floor(now.getTime() / H));
        }
      } else if (p.pingFails || p.downSince) {
        await db.update(watchPlans).set({ pingFails: 0, downSince: null }).where(eq(watchPlans.id, p.id));
        if (p.downSince) {
          const name = await nameOf(db, p);
          const mins = Math.max(1, Math.round((now.getTime() - p.downSince.getTime()) / MIN));
          await tell(db, p.userId, "circle-check", WATCH.name + ": «" + name + "» دوباره در دسترس است", "«" + name + "» پس از حدود " + mins.toLocaleString("fa-IR") + " دقیقه دوباره پاسخ می‌دهد.");
        }
      }
    }));
  }
  await db.delete(watchPings).where(lt(watchPings.at, new Date(now.getTime() - PING_KEEP_DAYS * DAY)));
  return { pinged };
}

/** resources with a live plan, as "kind:id" (the predictive detectors and the AI wording of «پایش هوشمند» are theirs) */
export async function watchedKeys(db: DB, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  return new Set((await db.select({ k: watchPlans.resourceKind, id: watchPlans.resourceId }).from(watchPlans).where(and(inArray(watchPlans.userId, userIds), inArray(watchPlans.status, [...LIVE])))).map((r) => r.k + ":" + r.id));
}

/* ---------------- staff ---------------- */
export async function watchAdmin(db: DB): Promise<WatchAdminView> {
  const [settings, q] = await Promise.all([watchSettings(db), watchQuote(db)]);
  const counts = await db.select({ status: watchPlans.status, mode: watchPlans.mode, n: sql<number>`count(*)::int` }).from(watchPlans).where(inArray(watchPlans.status, [...LIVE])).groupBy(watchPlans.status, watchPlans.mode);
  const d = new Date(), month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const [rev] = await db.select({ s: sql<number>`coalesce(sum(-${transactions.amount}), 0)::bigint` }).from(transactions).where(and(gte(transactions.createdAt, month), sql`${transactions.desc} like ${WATCH.name + "%"}`));
  const [cost] = await db.select({ s: sql<number>`coalesce(sum(${watchChecks.cost}), 0)::float`, n: sql<number>`count(*)::int` }).from(watchChecks).where(gte(watchChecks.createdAt, month));
  const revenue = Number(rev?.s ?? 0), aiCost = Math.round(Number(cost?.s ?? 0));
  const sum = (f: (c: (typeof counts)[number]) => boolean) => counts.filter(f).reduce((n, c) => n + Number(c.n), 0);
  return {
    settings, quote: q,
    plans: { trial: sum((c) => c.status === "trial"), every3h: sum((c) => c.status === "active" && c.mode === "every3h"), continuous: sum((c) => c.status === "active" && c.mode === "continuous") },
    month: { revenue, aiCost, checks: Number(cost?.n ?? 0), margin: revenue - aiCost },
  };
}
