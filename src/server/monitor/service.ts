/* «پایش هوشمند» for the panel, the assistant and staff: incidents (kept by ./scan.ts), feedback, mutes, sensitivity,
   channel thresholds and the one-click actions. An action is chosen from the allowlist derived here from the
   incident's detector and resource; its arguments come from the incident's own row, never from the client. Each runs
   through the RPC layer with the caller's own context (ownership, team roles and custom roles apply as if the person
   had pressed the RPC's own button), needs a confirm (and the typed resource name for disruptive ones) and is logged.
   Nothing ever acts for a customer on its own; staff actions on abuse (suspend, contact) need a confirm and are
   audit-logged. */
import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  DETECTOR_LABEL, MONITOR, SEVERITY_RANK, type ActResult, type ChannelPrefs, type Detector, type IncidentView, type MonitorActionId, type MonitorActionView, type MonitorAdminIncident,
  type MonitorAdminStats, type MonitorBadge, type MonitorBrief, type MonitorEvidence, type MonitorReport, type ResourceKind, type ResourceSetting, type Sensitivity,
} from "@/lib/monitor";
import { fa } from "@/lib/format";
import { faDateTime } from "@/lib/jalali";
import { customAllows } from "../account-extras";
import { refresh as advisorRefresh, apply as advisorApply } from "../advisor/service";
import { platformSpend, tehranStarts } from "../ai/service";
import { actor, needStaff, needUser, teamAllows, type Ctx } from "../ctx";
import { advisorFindings, firewallRules, monitorIncidents, monitorScan, monitorSettings as settingsTable, notifications, notifyChannels, paasApps, servers, ticketMessages, tickets, users } from "../db/schema";
import { enqueue } from "../jobs";
import { AppError, fail, genPassword, logActivity, logAudit, nextId, rid } from "../util";
import { monitorSettings, PURPOSE } from "./explain";
import { hrefOf, loadCfg } from "./scan";

const DAY = 86400_000, H = 3600_000;
type Row = typeof monitorIncidents.$inferSelect;
type Call = [string, unknown[]];

/* ---------------- the action allowlist ---------------- */
type Def = MonitorActionView & { rpcs: string[] };
const A = {
  snapshot: (): Def => ({ id: "snapshot", label: "گرفتن اسنپ‌شات همین حالا", preview: "یک اسنپ‌شات دستی از وضعیت فعلی دیسک ساخته می‌شود (هزینه فضای اسنپ‌شات ساعتی حساب می‌شود).", typed: false, destructive: false, rpcs: ["servers.snapshot"] }),
  reboot: (): Def => ({ id: "reboot", label: "ری‌استارت سرور", preview: "سرور چند دقیقه در دسترس نیست.", typed: false, destructive: false, rpcs: ["servers.power"] }),
  start: (): Def => ({ id: "start", label: "روشن کردن سرور", preview: "سرور دوباره روشن می‌شود.", typed: false, destructive: false, rpcs: ["servers.power"] }),
  poweroff: (): Def => ({ id: "poweroff", label: "خاموش کردن فوری سرور", preview: "برق سرور قطع می‌شود تا آسیب بیشتری نزند؛ سرویس‌ها تا روشن کردن دوباره در دسترس نیستند.", typed: true, destructive: true, rpcs: ["servers.power"] }),
  processes: (id: string): Def => ({ id: "processes", label: "باز کردن فهرست پردازه‌ها", preview: "", typed: false, destructive: false, link: hrefOf("server", id) + "?tab=procs", rpcs: [] }),
  root: (): Def => ({ id: "root_password", label: "تغییر رمز root", preview: "یک رمز قوی تازه ساخته و روی سرور تنظیم می‌شود؛ رمز جدید فقط یک بار در صفحه سرور نمایش داده می‌شود.", typed: false, destructive: false, rpcs: ["servers.resetRootPassword"] }),
  firewall: (): Def => ({ id: "firewall_preset", label: "فایروال: فقط پورت‌های 22، 80 و 443", preview: "قانون‌های اجازه برای TCP 22، 80 و 443 و سپس مسدود کردن بقیه ورودی‌های TCP و UDP افزوده می‌شود؛ اگر سرویس دیگری روی پورت دیگری دارید، از دسترس خارج می‌شود.", typed: true, destructive: true, rpcs: ["servers.addRule"] }),
  scale: (): Def => ({ id: "scale_up", label: "ارتقای منابع (از مشاور هزینه)", preview: "پیشنهاد ارتقای «مشاور هزینه» با قیمت دقیق اعمال می‌شود.", typed: true, destructive: false, rpcs: ["advisor.apply"] }),
  explain: (): Def => ({ id: "explain", label: "توضیح بده و درستش کن", preview: "", typed: false, destructive: false, link: "#explain", rpcs: [] }),
  advisor: (): Def => ({ id: "advisor", label: "پیشنهاد مشاور هزینه", preview: "", typed: false, destructive: false, link: "/panel/advisor", rpcs: [] }),
  cdn: (): Def => ({ id: "cdn", label: "CDN گره برای دامنه", preview: "", typed: false, destructive: false, link: "/panel/domains", rpcs: [] }),
};
const ask = (r: Pick<Row, "title" | "resourceName">): Def => ({ id: "assistant", label: "از دستیار گره بپرس", preview: "", typed: false, destructive: false, link: "/panel/assistant?ask=" + encodeURIComponent("درباره هشدار «" + r.title + "» در پایش هوشمند: چه کار کنم؟"), rpcs: [] });

export function actionsFor(r: Pick<Row, "detector" | "resourceKind" | "resourceId" | "severity" | "title" | "resourceName" | "evidence">): Def[] {
  const d = r.detector as Detector, crit = r.severity === "critical";
  if (r.resourceKind === "server") {
    const id = r.resourceId;
    const list: Def[] =
      d === "miner" || d === "outbound_abuse" ? [A.processes(id), A.snapshot(), A.root(), A.firewall(), ...(crit ? [A.poweroff()] : [])]
      : d === "inbound_attack" ? [A.firewall(), A.cdn(), A.scale()]
      : d === "traffic_burn" ? [A.advisor(), A.processes(id)]
      : d === "memory_leak" ? [A.processes(id), A.reboot(), A.scale()]
      : d === "disk_fill" ? [A.snapshot(), A.scale()]
      : d === "service_down" ? [A.start()]
      : d === "unusual_io" ? [A.snapshot(), A.processes(id), ...(crit ? [A.poweroff()] : [])]
      : [];
    return [...list, ask(r)];
  }
  const ev = r.evidence as MonitorEvidence;
  const list: Def[] = d === "service_down" ? [...(ev.eventId ? [A.explain()] : []), A.scale()] : d === "memory_leak" ? [A.scale()] : d === "brute_force" ? [A.cdn()] : [];
  return [...list, ask(r)];
}
const viewAction = ({ rpcs: _r, ...v }: Def): MonitorActionView => { void _r; return v; };

/* ---------------- views ---------------- */
export const view = (r: Row): IncidentView => ({
  id: r.id, detector: r.detector as Detector, label: DETECTOR_LABEL[r.detector as Detector] ?? r.detector, severity: r.severity, confidence: r.confidence, status: r.status,
  resource: { kind: r.resourceKind, id: r.resourceId, name: r.resourceName, href: hrefOf(r.resourceKind, r.resourceId) },
  title: r.title, evidence: r.evidence as MonitorEvidence, explanation: r.explanation, explanationAi: r.explanationAi,
  actions: r.status === "open" || r.status === "muted" ? actionsFor(r).map(viewAction) : [], abuse: r.abuse, feedback: r.feedback,
  startedAt: faDateTime(r.startedAt), updatedAt: faDateTime(r.updatedAt), resolvedAt: r.resolvedAt ? faDateTime(r.resolvedAt) : "", mutedUntil: r.mutedUntil ? faDateTime(r.mutedUntil) : "",
  taken: r.taken.map((x) => ({ label: x.label, at: faDateTime(new Date(x.at)) })),
});
const bySeverity = (a: Row, b: Row) => (Number(b.abuse) - Number(a.abuse)) || (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (b.startedAt.getTime() - a.startedAt.getTime());
const LIVE = ["open", "muted"] as const;

export async function report(ctx: Ctx): Promise<MonitorReport> {
  const a = needUser(ctx);
  const [live, past, svs, apps, cfg, ch, scanned] = await Promise.all([
    ctx.db.select().from(monitorIncidents).where(and(eq(monitorIncidents.userId, a.uid), inArray(monitorIncidents.status, [...LIVE]))),
    ctx.db.select().from(monitorIncidents).where(and(eq(monitorIncidents.userId, a.uid), inArray(monitorIncidents.status, ["resolved", "false_positive"]), gte(monitorIncidents.updatedAt, new Date(Date.now() - 30 * DAY)))).orderBy(desc(monitorIncidents.updatedAt)).limit(50),
    ctx.db.select({ id: servers.id, name: servers.name }).from(servers).where(and(eq(servers.userId, a.uid), inArray(servers.status, ["running", "stopped", "suspended"]))),
    ctx.db.select({ id: paasApps.id, name: paasApps.name }).from(paasApps).where(and(eq(paasApps.userId, a.uid), inArray(paasApps.status, ["running", "stopped", "failed", "building"]))),
    loadCfg(ctx.db, [a.uid]),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(notifyChannels).where(and(eq(notifyChannels.userId, a.uid), eq(notifyChannels.active, true))),
    ctx.db.select({ at: sql<Date | null>`max(${monitorScan.scannedAt})` }).from(monitorScan),
  ]);
  const c = cfg.get(a.uid);
  const resource = (kind: ResourceKind, x: { id: string; name: string }): ResourceSetting => {
    const s = c?.resources.get(kind + ":" + x.id);
    const muted = !!s?.mutedUntil && s.mutedUntil.getTime() > Date.now();
    return { kind, id: x.id, name: x.name, sensitivity: s?.sensitivity ?? "normal", mutedUntil: muted ? faDateTime(s!.mutedUntil) : "", muted };
  };
  return {
    open: live.sort(bySeverity).map(view), history: past.map(view),
    resources: [...svs.map((x) => resource("server", x)), ...apps.map((x) => resource("app", x))],
    prefs: c?.prefs ?? { panel: "info", email: "warn", channel: "warn" }, channels: Number(ch[0]?.n ?? 0),
    scannedAt: scanned[0]?.at ? faDateTime(new Date(scanned[0].at)) : "",
  };
}

export async function brief(ctx: Ctx): Promise<MonitorBrief> {
  const a = needUser(ctx);
  const rows = (await ctx.db.select().from(monitorIncidents).where(and(eq(monitorIncidents.userId, a.uid), eq(monitorIncidents.status, "open")))).sort(bySeverity);
  return { open: rows.length, critical: rows.filter((r) => r.severity === "critical").length, warn: rows.filter((r) => r.severity === "warn").length, top: rows[0] ? { title: rows[0].title, severity: rows[0].severity, href: "/panel/monitor" } : null };
}

/** the badge on a server or app page */
export async function badge(ctx: Ctx, kind: ResourceKind, id: string): Promise<MonitorBadge> {
  const a = needUser(ctx);
  const rows = (await ctx.db.select().from(monitorIncidents).where(and(eq(monitorIncidents.userId, a.uid), eq(monitorIncidents.resourceKind, kind), eq(monitorIncidents.resourceId, id), eq(monitorIncidents.status, "open")))).sort(bySeverity);
  return { open: rows.length, severity: rows[0]?.severity ?? null, titles: rows.map((r) => r.title) };
}

/** the assistant's read tool */
export async function incidentsForAssistant(ctx: Ctx) {
  const r = await report(ctx);
  const plain = (i: IncidentView) => ({
    incident_id: i.id, kind: i.label, severity: i.severity, status: i.status, resource: i.resource.kind + " " + i.resource.name + " (" + i.resource.id + ")",
    title: i.title, started: i.startedAt, evidence: i.evidence.lines, explanation: i.explanation, confidence: i.confidence,
    actions: i.actions.map((x) => x.label + (x.link ? " (link: " + x.link + ")" : " (only on /panel/monitor, after confirmation)")),
  });
  return { open_incidents: r.open.map(plain), recent_history: r.history.slice(0, 10).map((i) => ({ ...plain(i), resolved: i.resolvedAt, marked_false_positive: i.status === "false_positive" })), page: "/panel/monitor" };
}

/* ---------------- feedback, mutes, settings ---------------- */
async function own(ctx: Ctx, id: string) {
  const a = needUser(ctx);
  const [r] = await ctx.db.select().from(monitorIncidents).where(and(eq(monitorIncidents.id, id), eq(monitorIncidents.userId, a.uid)));
  if (!r) fail("این رخداد پیدا نشد.", 404);
  return { a, r: r! };
}
export async function feedback(ctx: Ctx, id: string, kind: "false_positive" | "useful") {
  const { a, r } = await own(ctx, id);
  const now = new Date();
  if (kind === "false_positive") {
    if (r.status === "false_positive") fail("این هشدار قبلاً اشتباه علامت خورده است.", 409);
    await ctx.db.update(monitorIncidents).set({ status: "false_positive", feedback: kind, feedbackAt: now, resolvedAt: r.resolvedAt ?? now, updatedAt: now }).where(eq(monitorIncidents.id, r.id));
    await logActivity(ctx.db, a.uid, "circle-x", MONITOR.name + ": «" + r.title + "» هشدار اشتباه علامت خورد", ctx.ip);
  } else await ctx.db.update(monitorIncidents).set({ feedback: kind, feedbackAt: now }).where(eq(monitorIncidents.id, r.id));
}
export async function muteIncident(ctx: Ctx, id: string, hours: number) {
  const { r } = await own(ctx, id);
  if (r.status !== "open" && r.status !== "muted") fail("این رخداد دیگر باز نیست.", 409);
  await ctx.db.update(monitorIncidents).set(hours > 0 ? { status: "muted", mutedUntil: new Date(Date.now() + hours * H) } : { status: "open", mutedUntil: null }).where(eq(monitorIncidents.id, r.id));
}

async function ownResource(ctx: Ctx, kind: ResourceKind, id: string) {
  const a = needUser(ctx);
  const [row] = kind === "server"
    ? await ctx.db.select({ id: servers.id, name: servers.name }).from(servers).where(and(eq(servers.id, id), eq(servers.userId, a.uid)))
    : await ctx.db.select({ id: paasApps.id, name: paasApps.name }).from(paasApps).where(and(eq(paasApps.id, id), eq(paasApps.userId, a.uid)));
  if (!row) fail(kind === "server" ? "سرور پیدا نشد." : "اپ پیدا نشد.", 404);
  return { a, row: row! };
}
/** per resource: sensitivity, and a mute for N hours (0 = unmute) */
export async function setResource(ctx: Ctx, kind: ResourceKind, id: string, patch: { sensitivity?: Sensitivity; muteHours?: number }) {
  const { a, row } = await ownResource(ctx, kind, id);
  const set = { ...(patch.sensitivity ? { sensitivity: patch.sensitivity } : {}), ...(patch.muteHours !== undefined ? { mutedUntil: patch.muteHours > 0 ? new Date(Date.now() + patch.muteHours * H) : null } : {}), updatedAt: new Date() };
  await ctx.db.insert(settingsTable).values({ id: rid("mon"), userId: a.uid, resourceKind: kind, resourceId: id, ...set })
    .onConflictDoUpdate({ target: [settingsTable.userId, settingsTable.resourceKind, settingsTable.resourceId], set });
  if (patch.muteHours) await logActivity(ctx.db, a.uid, "eye-off", MONITOR.name + ": اعلان‌های «" + row.name + "» برای " + fa(patch.muteHours) + " ساعت بی‌صدا شد", ctx.ip);
}
export async function setPrefs(ctx: Ctx, prefs: ChannelPrefs) {
  const a = needUser(ctx);
  const set = { prefs: prefs as Record<string, string>, updatedAt: new Date() };
  await ctx.db.insert(settingsTable).values({ id: rid("mon"), userId: a.uid, resourceKind: "", resourceId: "", ...set })
    .onConflictDoUpdate({ target: [settingsTable.userId, settingsTable.resourceKind, settingsTable.resourceId], set });
}

/* ---------------- one-click actions ---------------- */
const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:T]/g, "");
/** the preset «فقط 22، 80 و 443»: rules already on the server are not added twice */
async function firewallCalls(ctx: Ctx, sid: string): Promise<Call[]> {
  const have = await ctx.db.select().from(firewallRules).where(eq(firewallRules.serverId, sid));
  const want = [
    ...["22", "80", "443"].map((port) => ({ proto: "TCP" as const, port, source: "0.0.0.0/0", action: "allow" as const, note: MONITOR.name })),
    { proto: "TCP" as const, port: "1-65535", source: "0.0.0.0/0", action: "deny" as const, note: MONITOR.name },
    { proto: "UDP" as const, port: "1-65535", source: "0.0.0.0/0", action: "deny" as const, note: MONITOR.name },
  ].filter((w) => !have.some((h) => h.proto === w.proto && h.port === w.port && h.source === w.source && h.action === w.action));
  if (!want.length) fail("این قانون‌های فایروال از قبل روی سرور هست.", 409);
  if (have.length + want.length > 50) fail("سقف ۵۰ قانون فایروال پر می‌شود؛ ابتدا چند قانون قدیمی را حذف کنید.");
  return want.map((w): Call => ["servers.addRule", [sid, w]]);
}

export async function act(ctx: Ctx, id: string, action: MonitorActionId, confirm: boolean, typed = ""): Promise<ActResult> {
  const { a, r } = await own(ctx, id);
  if (r.status !== "open" && r.status !== "muted") fail("این رخداد دیگر باز نیست.", 409);
  const def = actionsFor(r).find((x) => x.id === action);
  if (!def) fail("این اقدام برای این رخداد مجاز نیست.", 403);
  if (def!.link) fail("این اقدام یک پیوند است؛ از دکمه آن در صفحه استفاده کنید.");
  if (!confirm) fail("برای اجرا، اقدام را تأیید کنید (" + def!.preview + ").", 409);
  if (def!.typed && typed.trim() !== r.resourceName) fail("برای تأیید، نام «" + r.resourceName + "» را دقیق بنویسید.");
  // the whole plan is checked before anything runs: a role that may do only part of it changes nothing
  for (const n of def!.rpcs) if (!teamAllows(ctx.auth?.teamRole, n) || !(await customAllows(ctx.db, ctx.auth, n))) fail("نقش شما در این حساب اجازه این کار را ندارد.", 403);
  const { registry } = await import("../rpc"); // lazy: the RPC registry imports this module
  const run = async (name: string, args: unknown[]) => {
    const m = registry[name];
    if (!m) fail("این اقدام در دسترس نیست.");
    if (!teamAllows(ctx.auth?.teamRole, name) || !(await customAllows(ctx.db, ctx.auth, name))) throw new AppError("نقش شما در این حساب اجازه این کار را ندارد.", 403);
    return m.run(ctx, m.args.parse(args));
  };
  const sid = r.resourceId;
  let message = "انجام شد: " + def!.label;
  switch (action) {
    case "snapshot": await run("servers.snapshot", [sid, "monitor-" + stamp()]); break;
    case "reboot": await run("servers.power", [sid, "restart"]); break;
    case "start": await run("servers.power", [sid, "start"]); break;
    case "poweroff": await run("servers.power", [sid, "poweroff"]); break;
    case "root_password":
      await run("servers.resetRootPassword", [sid, genPassword()]);
      message = "رمز root عوض شد؛ رمز جدید را یک بار در صفحه سرور ببینید و ذخیره کنید.";
      break;
    case "firewall_preset": for (const [n, args] of await firewallCalls(ctx, sid)) await run(n, args); break;
    case "scale_up": {
      // the advisor's own finding (vps_undersized / paas_oom), so the price and the plan are the advisor's
      await advisorRefresh(ctx.db, a.uid);
      const key = (r.resourceKind === "server" ? "vps_undersized:" : "paas_oom:") + sid;
      const [f] = await ctx.db.select().from(advisorFindings).where(and(eq(advisorFindings.userId, a.uid), eq(advisorFindings.key, key), eq(advisorFindings.status, "open")));
      if (!f) fail("«مشاور هزینه» برای این منبع پیشنهاد ارتقای مشخصی ندارد؛ پلن‌ها را در صفحه ارتقا ببینید.", 409);
      const res = await advisorApply(ctx, f!.id, true, f!.resourceName);
      message = res.message;
      break;
    }
    default: fail("این اقدام در دسترس نیست.");
  }
  const by = ctx.auth!.user.name;
  await ctx.db.update(monitorIncidents).set({ taken: [...r.taken, { action, label: def!.label, by, at: new Date().toISOString() }] }).where(eq(monitorIncidents.id, r.id));
  await logActivity(ctx.db, a.uid, "shield-check", MONITOR.name + ": " + def!.label + " (" + r.resourceName + ")", ctx.ip);
  if (a.uid !== a.user.id && a.user.role === "admin") await logAudit(ctx.db, actor(ctx), MONITOR.name + ": " + def!.label, r.id, ctx.ip);
  return { ok: true, message };
}

/* ---------------- staff ---------------- */
async function staffRow(ctx: Ctx, id: string) {
  const [r] = await ctx.db.select().from(monitorIncidents).where(eq(monitorIncidents.id, id));
  if (!r) fail("این رخداد پیدا نشد.", 404);
  return r!;
}

/** open critical and abuse incidents across customers, abuse first */
export async function adminIncidents(ctx: Ctx, limit = 100): Promise<MonitorAdminIncident[]> {
  needStaff(ctx, "services");
  const rows = (await ctx.db.select().from(monitorIncidents).where(and(inArray(monitorIncidents.status, [...LIVE]), sql`(${monitorIncidents.severity} = 'critical' or ${monitorIncidents.abuse})`))).sort(bySeverity).slice(0, limit);
  if (!rows.length) return [];
  const us = new Map((await ctx.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]))).map((u) => [u.id, u]));
  const sids = rows.filter((r) => r.resourceKind === "server").map((r) => r.resourceId);
  const st = new Map(sids.length ? (await ctx.db.select({ id: servers.id, status: servers.status }).from(servers).where(inArray(servers.id, sids))).map((s) => [s.id, s.status]) : []);
  return rows.map((r) => ({ ...view(r), actions: [], user: us.get(r.userId) ?? { id: r.userId, name: "", email: "" }, resourceStatus: st.get(r.resourceId) ?? "" }));
}

export async function adminStats(ctx: Ctx): Promise<MonitorAdminStats> {
  needStaff(ctx, "services");
  const since = new Date(Date.now() - 30 * DAY);
  const rows = await ctx.db.select({ detector: monitorIncidents.detector, status: monitorIncidents.status, severity: monitorIncidents.severity, abuse: monitorIncidents.abuse, feedback: monitorIncidents.feedback, startedAt: monitorIncidents.startedAt }).from(monitorIncidents).where(gte(monitorIncidents.startedAt, since));
  const live = await ctx.db.select({ severity: monitorIncidents.severity, abuse: monitorIncidents.abuse }).from(monitorIncidents).where(inArray(monitorIncidents.status, [...LIVE]));
  const days = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10));
  const dets = [...new Set(rows.map((r) => r.detector))] as Detector[];
  const fb = rows.filter((r) => r.feedback), fp = rows.filter((r) => r.status === "false_positive").length;
  const { day, month } = tehranStarts();
  const [spendToday, spendMonth, s] = await Promise.all([platformSpend(ctx.db, PURPOSE, day), platformSpend(ctx.db, PURPOSE, month), monitorSettings(ctx.db)]);
  return {
    open: live.length, critical: live.filter((r) => r.severity === "critical").length, abuse: live.filter((r) => r.abuse).length,
    perDay: days.map((d) => ({ day: d, count: rows.filter((r) => r.startedAt.toISOString().slice(0, 10) === d).length })),
    byDetector: dets.map((d) => ({ detector: d, label: DETECTOR_LABEL[d] ?? d, total: rows.filter((r) => r.detector === d).length, open: rows.filter((r) => r.detector === d && (r.status === "open" || r.status === "muted")).length, falsePositive: rows.filter((r) => r.detector === d && r.status === "false_positive").length })).sort((a, b) => b.total - a.total),
    falsePositiveRate: rows.length ? Math.round((fp / rows.length) * 1000) / 1000 : 0, feedbackCount: fb.length,
    spendToday, spendMonth, dailyCap: s.dailyCap, autoSuspendAbuse: s.autoSuspendAbuse,
  };
}

/** staff on an abuse or critical incident: suspend the server, or contact the customer with a ticket. Throttling has
    no hypervisor call in Gereh, so it is not offered. */
export async function staffAct(ctx: Ctx, id: string, action: "suspend" | "contact", confirm: boolean, text = ""): Promise<ActResult> {
  const me = needStaff(ctx, "services");
  const r = await staffRow(ctx, id);
  if (!confirm) fail("برای اجرا، اقدام را تأیید کنید.", 409);
  const now = new Date();
  let label = "";
  if (action === "suspend") {
    if (r.resourceKind !== "server") fail("تعلیق فقط برای سرورها در دسترس است.");
    const [s] = await ctx.db.select({ status: servers.status, name: servers.name }).from(servers).where(eq(servers.id, r.resourceId));
    if (!s) fail("سرور پیدا نشد.", 404);
    if (s!.status === "suspended") fail("این سرور از قبل معلق است.", 409);
    const { registry } = await import("../rpc");
    const m = registry["servers.setStatus"];
    await m.run(ctx, m.args.parse([r.resourceId, "suspended"]));
    await ctx.db.insert(notifications).values({ id: rid("n"), userId: r.userId, icon: "shield-alert", text: "سرور " + s!.name + " به‌خاطر «" + r.title + "» توسط تیم گره معلق شد؛ برای بررسی تیکت ثبت کنید." });
    label = "تعلیق سرور توسط کارمند";
  } else {
    const msg = text.trim();
    if (msg.length < 10 || msg.length > 4000) fail("متن پیام باید بین ۱۰ تا ۴۰۰۰ نویسه باشد.");
    const tid = await nextId(ctx.db, "TK", 3100);
    await ctx.db.insert(tickets).values({ id: tid, userId: r.userId, subject: (MONITOR.name + ": " + r.title).slice(0, 120), dept: "فنی", priority: r.severity === "critical" ? "high" : "normal", service: r.resourceKind === "server" ? r.resourceId : "", status: "answered", firstResponseAt: now });
    await ctx.db.insert(ticketMessages).values({ ticketId: tid, from: "staff", name: me.user.name, text: msg });
    await ctx.db.insert(notifications).values({ id: rid("n"), userId: r.userId, icon: "message-circle", text: "پیام تیم گره درباره «" + r.title + "» در تیکت " + tid });
    const [u] = await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, r.userId));
    if (u) await enqueue(ctx.db, "notify.send", { to: u.email, subject: "پیام تیم گره درباره " + r.resourceName, text: msg + "\n\nپاسخ در تیکت " + tid + ": https://gereh.net/panel/tickets" });
    label = "تماس با مشتری (تیکت " + tid + ")";
  }
  await ctx.db.update(monitorIncidents).set({ taken: [...r.taken, { action, label, by: me.user.name, at: now.toISOString() }], updatedAt: now }).where(eq(monitorIncidents.id, r.id));
  await logAudit(ctx.db, actor(ctx), MONITOR.name + ": " + label, r.resourceId, ctx.ip);
  return { ok: true, message: "انجام شد: " + label };
}

/** the staff assistant's read tool */
export async function abuseForStaff(ctx: Ctx) {
  const rows = await adminIncidents(ctx, 30);
  return {
    incidents: rows.map((i) => ({ incident_id: i.id, kind: i.label, severity: i.severity, abuse: i.abuse, customer: i.user.name + " <" + i.user.email + "> (" + i.user.id + ")", resource: i.resource.kind + " " + i.resource.name + " (" + i.resource.id + ")", resource_status: i.resourceStatus, title: i.title, started: i.startedAt, evidence: i.evidence.lines, actions_taken: i.taken.map((t) => t.label + " — " + t.at) })),
    page: "/admin/monitor",
  };
}
