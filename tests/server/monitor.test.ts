import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MonitorReport } from "@/lib/monitor";
import { setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { execTool, toolByName } from "@/server/assistant/tools";
import { staffToolByName } from "@/server/assistant/staff";
import { context } from "@/server/ctx";
import {
  activity, aiUsage, audit, firewallRules, monitorIncidents, notifications, paasEvents, platformAiUsage, serverCredentials, serverTasks, servers, snapshots, usageHourly, usageSamples, users,
} from "@/server/db/schema";
import { detectApp, detectServer, diskOf, leakOf, type Hit, type Result } from "@/server/monitor/detect";
import { explainIncident, templateExplanation } from "@/server/monitor/explain";
import { applyResult, loadCfg, monitorScanJob, type Res } from "@/server/monitor/scan";
import { buildBaseline, hourOfWeek, type Point } from "@/server/monitor/stats";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => setAiUpstream(null));

const MIN = 60_000, H = 3600_000, DAY = 86400_000;
/** 12:00 Tehran (08:30 UTC) on a Wednesday */
const NOON = Date.UTC(2026, 9, 21, 8, 30);
const pt = (at: number, v: Partial<Point>): Point => ({ at: new Date(at), cpu: 10, ram: 40, disk: 30, netIn: 5, netOut: 5, ioRead: 200, ioWrite: 300, ...v });
/** hourly history for `days` days before `now`, values from f(hour of day in Tehran) */
const history = (now: number, days: number, f: (tehranHour: number, i: number) => Partial<Point>) =>
  Array.from({ length: days * 24 }, (_, i) => { const at = Math.floor(now / H) * H - (days * 24 - i) * H; return pt(at, f(hourOfWeek(at) % 24, i)); });
const samples = (now: number, minutes: number, f: (i: number) => Partial<Point>) =>
  Array.from({ length: minutes / 5 }, (_, i) => pt(now - minutes * MIN + (i + 1) * 5 * MIN, f(i)));
const OLD = new Date(NOON - 400 * DAY);
const base = { name: "web", createdAt: OLD, now: NOON, sensitivity: "normal" as const, hourly: null, traffic: null, downSince: null };
const hit = (r: Result, d: string) => r.hits.find((h) => h.detector === d);

describe("detectors", () => {
  it("miner: a flat 95% CPU against a low baseline fires; a busy-hours pattern that matches the baseline does not", () => {
    const quiet = buildBaseline(history(NOON, 14, (_h, i) => ({ cpu: 8 + (i % 5) })), NOON);
    const flat = samples(NOON, 150, (i) => ({ cpu: 95 + (i % 3) * 0.5 }));
    const r = detectServer({ ...base, samples: flat, baseline: quiet });
    expect(r.ran).toContain("miner");
    const m = hit(r, "miner")!;
    expect(m.severity).toBe("critical");
    expect(m.confidence).toBeGreaterThanOrEqual(0.75);
    expect(m.evidence.lines.join(" ")).toContain("استخراج رمزارز");
    expect(m.evidence.series!.lo!.length).toBe(m.evidence.series!.data.length);

    // a server that is busy every day from 9 to 18 Tehran time: 95% at noon is its normal
    const busy = buildBaseline(history(NOON, 14, (h) => ({ cpu: h >= 9 && h < 18 ? 95 : 10 })), NOON);
    expect(hit(detectServer({ ...base, samples: flat, baseline: busy }), "miner")).toBeUndefined();
    // heavy disk IO alongside: a real workload, not a miner
    expect(hit(detectServer({ ...base, samples: samples(NOON, 150, () => ({ cpu: 96, ioWrite: 50_000 })), baseline: quiet }), "miner")).toBeUndefined();
  });

  it("memory leak and disk fill compute the ETA from the linear trend", () => {
    const ram = Array.from({ length: 48 }, (_, i) => ({ at: new Date(NOON - (47 - i) * H), v: 40 + i }));
    const leak = leakOf(ram, 1)!;
    expect(leak.detector).toBe("memory_leak");
    expect(leak.evidence.etaHours).toBe(8); // (95 − 87) / 1 per hour
    expect(leak.severity).toBe("warn");
    // noisy, not monotonic: no claim
    expect(leakOf(ram.map((p, i) => ({ ...p, v: 40 + (i % 2 ? 30 : 0) })), 1)).toBeNull();
    // too little history: the detector does not run
    expect(leakOf(ram.slice(-10), 1)).toBeUndefined();

    const disk = Array.from({ length: 72 }, (_, i) => ({ at: new Date(NOON - (71 - i) * H), v: 30 + i * 0.9 }));
    const d = diskOf(disk, 1)!;
    expect(d.evidence.etaHours).toBe(Math.round((100 - (30 + 71 * 0.9)) / 0.9));
    expect(d.severity).toBe("critical"); // under 24 hours
    const slow = diskOf(disk.map((p, i) => ({ ...p, v: 30 + i * 0.6 })), 1)!;
    expect(slow.severity).toBe("warn");
    expect(slow.evidence.etaHours).toBe(Math.round((100 - (30 + 71 * 0.6)) / 0.6));
    // more than 72 hours away: nothing yet
    expect(diskOf(disk.map((p, i) => ({ ...p, v: 30 + i * 0.3 })), 1)).toBeNull();
  });

  it("app flapping: repeated crashes in the last hour fire with the latest event for «توضیح بده»", () => {
    const events = [1, 2, 3, 4].map((id) => ({ id, kind: id === 4 ? "oom" : "crash", at: new Date(NOON - (50 - id * 10) * MIN), message: "exit 1" }));
    const r = detectApp({ name: "shop", createdAt: OLD, now: NOON, sensitivity: "normal", metrics: [], cpuBaseline: { median: 20, days: 20 }, hourly: null, ramMb: 512, events, authFailures: null });
    const f = hit(r, "service_down")!;
    expect(f.severity).toBe("warn");
    expect(f.evidence.eventId).toBe(4);
    expect(hit(detectApp({ name: "shop", createdAt: OLD, now: NOON, sensitivity: "normal", metrics: [], cpuBaseline: null, hourly: null, ramMb: 512, events: events.slice(0, 2), authFailures: null }), "service_down")).toBeUndefined();
    // a burst of auth failures in the logs
    expect(hit(detectApp({ name: "shop", createdAt: OLD, now: NOON, sensitivity: "normal", metrics: [], cpuBaseline: { median: 20, days: 20 }, hourly: null, ramMb: 512, events: [], authFailures: 120 }), "brute_force")!.severity).toBe("warn");
  });

  it("a new resource uses static thresholds and raises critical incidents only", () => {
    const young = { ...base, createdAt: new Date(NOON - DAY), baseline: null };
    // 100 Mb/s out would be 20× a quiet baseline, but under the static 200 Mb/s floor
    expect(hit(detectServer({ ...young, samples: samples(NOON, 20, () => ({ netOut: 100, netIn: 1 })) }), "outbound_abuse")).toBeUndefined();
    const out = hit(detectServer({ ...young, samples: samples(NOON, 20, () => ({ netOut: 300, netIn: 2 })) }), "outbound_abuse")!;
    expect(out).toMatchObject({ severity: "critical", abuse: true });
    // a warn-level memory leak is not raised for a young server
    const hourly = Array.from({ length: 48 }, (_, i) => pt(NOON - (47 - i) * H, { ram: 40 + i }));
    expect(hit(detectServer({ ...young, samples: [], hourly }), "memory_leak")).toBeUndefined();
    expect(hit(detectServer({ ...base, baseline: buildBaseline(history(NOON, 14, () => ({})), NOON), samples: [], hourly }), "memory_leak")!.severity).toBe("warn");
    // the inbound and IO detectors need a baseline
    expect(detectServer({ ...young, samples: samples(NOON, 30, () => ({})) }).ran).not.toContain("inbound_attack");
  });
});

/* ---------------- the scan job over the database ---------------- */
async function seedHistory(serverId: string, now: number, days = 14, v: Partial<Point> = {}) {
  const rows = history(now, days, () => v).map((p) => ({ serverId, hour: p.at, cpu: p.cpu, ram: p.ram, disk: p.disk, netIn: p.netIn, netOut: p.netOut, ioRead: p.ioRead, ioWrite: p.ioWrite, n: 12 }));
  for (let i = 0; i < rows.length; i += 500) await (await db()).insert(usageHourly).values(rows.slice(i, i + 500));
}
async function seedSamples(serverId: string, now: number, minutes: number, v: Partial<Point>) {
  await (await db()).insert(usageSamples).values(samples(now, minutes, () => v).map((p) => ({ serverId, cpu: p.cpu, ram: p.ram, disk: p.disk, netIn: p.netIn, netOut: p.netOut, ioRead: p.ioRead, ioWrite: p.ioWrite, bwUsed: 0, createdAt: p.at })));
}
const incidents = async (detector?: string) => (await (await db()).select().from(monitorIncidents)).filter((r) => !detector || r.detector === detector);
const notes = async (uid: string) => (await (await db()).select().from(notifications).where(eq(notifications.userId, uid))).filter((n) => n.text.includes("پایش هوشمند"));

describe("monitor.scan", () => {
  it("outbound abuse: a critical incident, the customer and staff are alerted, nothing is suspended by default", async () => {
    const now = Date.now();
    await seedHistory("srv-1042", now);
    await seedSamples("srv-1042", now, 20, { netOut: 400, netIn: 3 });
    const out = await monitorScanJob(await db(), { now: new Date(now) });
    expect(out.opened).toBeGreaterThanOrEqual(1);
    const [inc] = await incidents("outbound_abuse");
    expect(inc).toMatchObject({ resourceId: "srv-1042", severity: "critical", abuse: true, status: "open", userId: "u1", notifiedSeverity: "critical" });
    expect(inc.explanation).toContain("قدم‌های پیشنهادی");
    expect(inc.staffNotifiedAt).not.toBeNull();
    expect((await notes("u1")).length).toBe(1);
    const [admin] = await (await db()).select().from(users).where(eq(users.email, "admin@gereh.net"));
    expect((await notes(admin.id)).some((n) => n.text.includes("سوءاستفاده"))).toBe(true);
    expect((await (await db()).select().from(servers).where(eq(servers.id, "srv-1042")))[0].status).toBe("running");

    // the next scan with nothing new: skipped, no duplicate
    await monitorScanJob(await db(), { now: new Date(now + 60_000) });
    expect((await incidents("outbound_abuse")).length).toBe(1);
    expect((await notes("u1")).length).toBe(1);
  });

  it("auto-suspend happens only with the admin setting monitor.autoSuspendAbuse on", async () => {
    await asAdmin();
    await call("monitor.adminSettings", { autoSuspendAbuse: true });
    jar.clear();
    const now = Date.now();
    await seedHistory("srv-1042", now);
    await seedSamples("srv-1042", now, 20, { netOut: 400, netIn: 3 });
    const out = await monitorScanJob(await db(), { now: new Date(now) });
    expect(out.suspended).toBe(1);
    expect((await (await db()).select().from(servers).where(eq(servers.id, "srv-1042")))[0].status).toBe("suspended");
    expect((await (await db()).select().from(audit)).some((a) => a.target === "srv-1042" && a.action.includes("تعلیق"))).toBe(true);
    expect((await incidents("outbound_abuse"))[0].taken[0].action).toBe("suspend");
  });

  it("app crash loop: the scan opens an incident on the app", async () => {
    const d = await db();
    await d.insert(paasEvents).values([1, 2, 3, 4].map((i) => ({ appId: "app-demo1", kind: "crash" as const, message: "exit code 1", createdAt: new Date(Date.now() - i * 5 * MIN) })));
    await monitorScanJob(d);
    const [inc] = await incidents("service_down");
    expect(inc).toMatchObject({ resourceKind: "app", resourceId: "app-demo1", severity: "warn" });
    expect((inc.evidence as { eventId?: number }).eventId).toBeGreaterThan(0);
  });

  it("an unexpected stop (no power action requested) is a critical service_down; a requested stop is not", async () => {
    const d = await db();
    const now = Date.now();
    await seedSamples("srv-1042", now, 10, {});
    await monitorScanJob(d, { now: new Date(now) });
    await d.update(servers).set({ status: "stopped" }).where(eq(servers.id, "srv-1042"));
    await monitorScanJob(d, { now: new Date(now + 5 * MIN) });
    expect((await incidents("service_down")).find((r) => r.resourceId === "srv-1042")).toMatchObject({ severity: "critical", status: "open" });
    // back up, then stopped by the customer (a power task): nothing new, the old incident keeps counting clean scans
    await d.update(servers).set({ status: "running" }).where(eq(servers.id, "srv-1042"));
    await monitorScanJob(d, { now: new Date(now + 10 * MIN) });
    await d.insert(serverTasks).values({ id: "t-mon1", serverId: "srv-1042", action: "خاموش کردن" });
    await d.update(servers).set({ status: "stopped" }).where(eq(servers.id, "srv-1042"));
    await monitorScanJob(d, { now: new Date(now + 15 * MIN) });
    const all = (await incidents("service_down")).filter((r) => r.resourceId === "srv-1042");
    expect(all.length).toBe(1);
    expect(all[0].cleanCount).toBe(2);
  });
});

/* ---------------- the incident lifecycle ---------------- */
const R0: Res = { kind: "server", id: "srv-1042", userId: "u1", name: "web-prod-1" };
const mk = (severity: Hit["severity"]): Hit => ({ detector: "memory_leak", severity, confidence: 0.8, title: "احتمال نشت حافظه در سرور «web-prod-1»", evidence: { lines: ["مصرف رم از ۴۰٪ به ۸۷٪ رسیده است."], etaHours: 8 } });
async function step(res: Result, now = new Date()) {
  const d = await db();
  const live = await d.select().from(monitorIncidents).where(and(eq(monitorIncidents.resourceId, R0.id)));
  const cfg = (await loadCfg(d, ["u1"])).get("u1") ?? { prefs: { panel: "info" as const, email: "warn" as const, channel: "warn" as const }, resources: new Map() };
  return applyResult(d, R0, res, live.filter((x) => x.status === "open" || x.status === "muted"), cfg, now);
}
const ran = ["memory_leak"] as const;

describe("incident lifecycle", () => {
  it("dedupe, update, escalation re-notifies, auto-resolve, cooldown", async () => {
    await step({ ran: [...ran], hits: [mk("warn")] });
    expect((await incidents()).length).toBe(1);
    expect((await notes("u1")).length).toBe(1);
    // still there: updated, not duplicated, not notified again
    await step({ ran: [...ran], hits: [mk("warn")] });
    expect((await incidents()).length).toBe(1);
    expect((await notes("u1")).length).toBe(1);
    // escalation: notified again
    await step({ ran: [...ran], hits: [mk("critical")] });
    expect((await notes("u1")).length).toBe(2);
    expect((await incidents())[0]).toMatchObject({ severity: "critical", notifiedSeverity: "critical" });
    // a de-escalation is not news
    await step({ ran: [...ran], hits: [mk("warn")] });
    expect((await notes("u1")).length).toBe(2);
    // clean scans resolve it after 3
    await step({ ran: [...ran], hits: [] });
    await step({ ran: [...ran], hits: [] });
    expect((await incidents())[0].status).toBe("open");
    await step({ ran: [...ran], hits: [] });
    expect((await incidents())[0]).toMatchObject({ status: "resolved" });
    // a detector that did not run this round never counts as clean
    // back within the cooldown: a new incident, but quiet (not worse than what was already sent)
    await step({ ran: [...ran], hits: [mk("warn")] });
    expect((await incidents()).length).toBe(2);
    expect((await notes("u1")).length).toBe(2);
  });

  it("a detector that did not run does not resolve its incident", async () => {
    await step({ ran: [...ran], hits: [mk("warn")] });
    for (let i = 0; i < 5; i++) await step({ ran: ["service_down"], hits: [] });
    expect((await incidents())[0].status).toBe("open");
  });

  it("«هشدار اشتباه بود» closes it and keeps the detector quiet on that resource; mute silences notifications", async () => {
    await asUser();
    await step({ ran: [...ran], hits: [mk("warn")] });
    const r = await call<MonitorReport>("monitor.report");
    expect(r.open.length).toBe(1);
    await call("monitor.feedback", r.open[0].id, "false_positive");
    expect((await incidents())[0].status).toBe("false_positive");
    await step({ ran: [...ran], hits: [mk("critical")] });
    expect((await incidents()).length).toBe(1);
    expect((await (await db()).select().from(activity).where(eq(activity.userId, "u1"))).some((a) => a.text.includes("هشدار اشتباه"))).toBe(true);

    // mute: the incident stays visible, an escalation is not sent
    await (await db()).delete(monitorIncidents);
    await step({ ran: [...ran], hits: [mk("warn")] });
    const before = (await notes("u1")).length;
    const [inc] = await incidents();
    await call("monitor.mute", inc.id, 4);
    await step({ ran: [...ran], hits: [mk("critical")] });
    expect((await incidents())[0]).toMatchObject({ status: "muted", severity: "critical" });
    expect((await notes("u1")).length).toBe(before);
    // muting the whole resource: a new incident is recorded but not sent
    await (await db()).delete(monitorIncidents);
    await call("monitor.setResource", "server", "srv-1042", { muteHours: 6, sensitivity: "low" });
    await step({ ran: [...ran], hits: [mk("warn")] });
    expect((await incidents()).length).toBe(1);
    expect((await notes("u1")).length).toBe(before);
    const rep = await call<MonitorReport>("monitor.report");
    expect(rep.resources.find((x) => x.id === "srv-1042")).toMatchObject({ muted: true, sensitivity: "low" });
    // another account's resource cannot be configured
    expect(await fails("monitor.setResource", "server", "srv-9999", { muteHours: 1 })).toContain("پیدا نشد");
  });
});

/* ---------------- actions ---------------- */
const leakIncident = async () => { await step({ ran: [...ran], hits: [mk("warn")] }); return (await incidents())[0]; };
const minerIncident = async () => {
  await step({ ran: ["miner"], hits: [{ detector: "miner", severity: "critical", confidence: 0.9, title: "CPU سرور «web-prod-1» مدام در حداکثر است", evidence: { lines: ["CPU بالای ۹۰٪"] } }] });
  return (await incidents("miner"))[0];
};

describe("actions", () => {
  it("allowlisted per incident, confirm required, run with the user's context and logged", async () => {
    await asUser();
    const inc = await leakIncident();
    const view = (await call<MonitorReport>("monitor.report")).open[0];
    expect(view.actions.map((a) => a.id)).toEqual(["processes", "reboot", "scale_up", "assistant"]);
    expect(JSON.stringify(view)).not.toContain("rpcs");
    expect(await fails("monitor.act", inc.id, "poweroff", true)).toContain("مجاز نیست");
    expect(await fails("monitor.act", inc.id, "reboot", false)).toContain("تأیید");
    const res = await call<{ ok: boolean }>("monitor.act", inc.id, "reboot", true);
    expect(res.ok).toBe(true);
    expect((await incidents())[0].taken[0]).toMatchObject({ action: "reboot" });
    expect((await (await db()).select().from(activity).where(eq(activity.userId, "u1"))).some((a) => a.text.includes("پایش هوشمند"))).toBe(true);
  });

  it("miner: snapshot, root password (shown once via server credentials) and the firewall preset with the typed name", async () => {
    await asUser();
    const inc = await minerIncident();
    await call("monitor.act", inc.id, "snapshot", true);
    expect((await (await db()).select().from(snapshots).where(eq(snapshots.serverId, "srv-1042"))).some((s) => s.name.startsWith("monitor-"))).toBe(true);
    await call("monitor.act", inc.id, "root_password", true);
    expect((await (await db()).select().from(serverCredentials).where(eq(serverCredentials.serverId, "srv-1042"))).length).toBeGreaterThan(0);
    expect(await fails("monitor.act", inc.id, "firewall_preset", true)).toContain("web-prod-1");
    await call("monitor.act", inc.id, "firewall_preset", true, "web-prod-1");
    const rules = (await (await db()).select().from(firewallRules).where(eq(firewallRules.serverId, "srv-1042"))).map((r) => r.proto + " " + r.port + " " + r.source + " " + r.action);
    for (const r of ["TCP 22 0.0.0.0/0 allow", "TCP 80 0.0.0.0/0 allow", "TCP 443 0.0.0.0/0 allow", "TCP 1-65535 0.0.0.0/0 deny", "UDP 1-65535 0.0.0.0/0 deny"]) expect(rules.filter((x) => x === r).length).toBe(1);
    expect(await fails("monitor.act", inc.id, "firewall_preset", true, "web-prod-1")).toContain("از قبل");
  });

  it("ownership and team roles", async () => {
    await asUser();
    const inc = await leakIncident();
    await call("team.invite", "sara@example.com", "billing", "http://localhost:3000");
    const { outbox } = await import("@/server/messaging");
    const token = /token=([\w-]+)/.exec(outbox.find((m) => m.subject?.startsWith("دعوت"))!.text)![1];
    jar.clear();
    await call("auth.register", { name: "سارا", email: "sara@example.com", phone: "09351112233", password: "Abcdefg1" });
    await call("team.accept", token);
    // the billing member sees the incident but cannot reboot the server
    expect((await call<MonitorReport>("monitor.report")).open.length).toBe(1);
    expect(await fails("monitor.act", inc.id, "reboot", true)).toContain("نقش شما");
    jar.clear();
    await call("auth.register", { name: "نیما", email: "nima@example.com", phone: "09351112299", password: "Abcdefg1" });
    expect(await fails("monitor.act", inc.id, "reboot", true)).toContain("پیدا نشد");
    expect(await fails("monitor.feedback", inc.id, "false_positive")).toContain("پیدا نشد");
  });

  it("staff: suspend and contact need a confirm and are audit-logged; customers cannot call them", async () => {
    await asUser();
    const inc = await minerIncident();
    expect(await fails("monitor.staffAct", inc.id, "suspend", true)).toBeTruthy();
    jar.clear();
    await asAdmin();
    const list = await call<{ id: string }[]>("monitor.adminIncidents");
    expect(list.map((x) => x.id)).toContain(inc.id);
    expect(await fails("monitor.staffAct", inc.id, "suspend", false)).toContain("تأیید");
    await call("monitor.staffAct", inc.id, "contact", true, "سلام؛ سرور شما الگوی استخراج رمزارز دارد. لطفاً بررسی کنید.");
    await call("monitor.staffAct", inc.id, "suspend", true);
    expect((await (await db()).select().from(servers).where(eq(servers.id, "srv-1042")))[0].status).toBe("suspended");
    const au = await (await db()).select().from(audit);
    expect(au.filter((a) => a.action.includes("پایش هوشمند")).length).toBe(2);
    const stats = await call<{ open: number; critical: number }>("monitor.adminStats");
    expect(stats.critical).toBe(1);
  });
});

/* ---------------- AI wording and billing ---------------- */
describe("explanation", () => {
  function fakeModel(text: string) {
    const up: Upstream = {
      name: "http",
      async chat() { return Response.json({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 500, completion_tokens: 120 } }); },
      async models() { return []; },
    };
    setAiUpstream(up);
  }
  const inc = { detector: "memory_leak" as const, kind: "server" as const, severity: "warn" as const, title: "احتمال نشت حافظه", evidence: { lines: ["مصرف رم در ۴۸ ساعت اخیر از ۴۰٪ به ۸۷٪ رسیده است.", "حدود ۸ ساعت دیگر رم به ۹۵٪ می‌رسد."] } };

  it("the AI text is used only when every number comes from the evidence; platform-metered, the wallet untouched", async () => {
    const d = await db();
    const bal = (await d.select().from(users).where(eq(users.id, "u1")))[0].balance;
    expect((await explainIncident(d, "u1", inc)).ai).toBe(false); // simulator: the template
    fakeModel("آنچه دیدیم: رم در ۴۸ ساعت اخیر از ۴۰٪ به ۸۷٪ رسیده و حدود ۸ ساعت دیگر به ۹۵٪ می‌رسد.\n• سرور را ری‌استارت کنید.");
    const ok = await explainIncident(d, "u1", inc);
    expect(ok.ai).toBe(true);
    fakeModel("رم حدود ۳ ساعت دیگر پر می‌شود و ۶۰٪ احتمال حمله هست.");
    const bad = await explainIncident(d, "u1", inc);
    expect(bad).toMatchObject({ ai: false, text: templateExplanation(inc.detector, inc.kind, inc.severity, inc.evidence) });
    const meter = await d.select().from(platformAiUsage).where(eq(platformAiUsage.purpose, "monitor"));
    expect(meter.length).toBe(2);
    expect(meter.every((r) => r.cost > 0 && r.ref === "u1")).toBe(true);
    expect((await d.select().from(users).where(eq(users.id, "u1")))[0].balance).toBe(bal);
    expect((await d.select().from(aiUsage).where(eq(aiUsage.userId, "u1"))).length).toBe(0);
  });

  it("over the daily cap the template answers for free", async () => {
    await asAdmin();
    await call("monitor.adminSettings", { dailyCap: 1 });
    fakeModel("رم در ۴۸ ساعت اخیر بالا رفته است.");
    expect(await explainIncident(await db(), "u1", inc)).toMatchObject({ ai: false, cost: 0 });
    expect((await (await db()).select().from(platformAiUsage)).length).toBe(0);
  });
});

describe("assistant", () => {
  it("monitoring_incidents returns the customer's incidents; abuse_incidents is for staff", async () => {
    await asUser();
    await minerIncident();
    const ctx = await context();
    const out = await execTool(ctx, toolByName("monitoring_incidents")!, {}) as { open_incidents: { kind: string; severity: string; evidence: string[] }[] };
    expect(out.open_incidents.length).toBe(1);
    expect(out.open_incidents[0]).toMatchObject({ kind: "الگوی استخراج رمزارز", severity: "critical" });
    jar.clear();
    await asAdmin();
    const staff = await staffToolByName("abuse_incidents")!.run(await context(), {}) as { incidents: { customer: string }[] };
    expect(staff.incidents.length).toBe(1);
    expect(staff.incidents[0].customer).toContain("u1");
  });
});
