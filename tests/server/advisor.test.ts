import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { costOf } from "@/lib/ai";
import { ADVISOR_RULES, type AdvisorReport } from "@/lib/advisor";
import { invGross } from "@/lib/money";
import { HOURS_PER_MONTH } from "@/lib/paas";
import { computeFindings, type Finding } from "@/server/advisor/engine";
import { advisorWeekly, refresh } from "@/server/advisor/service";
import { numbersIn, onlyKnownNumbers, templateSummary, writeSummary } from "@/server/advisor/summary";
import { setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { toolByName, execTool } from "@/server/assistant/tools";
import { perHour, vpsHourly, vpsPrices } from "@/server/billing-extras";
import { maintainCosts } from "@/server/builder/service";
import { context } from "@/server/ctx";
import {
  activity, advisorFindings, advisorState, aiModels, aiUsage, builderProjects, jobs, notifications, paasApps, paasDbs, paasDeployments, paasEvents, paasLinks,
  paasMetricsHourly, paasPlans, plans, platformAiUsage, servers, snapshots, storageBuckets, storagePlans, transactions, usageHourly, users, vpsDisks, vpsTraffic,
} from "@/server/db/schema";
import { appHourly, dbHourly } from "@/server/paas/service";
import { changePlanQuote, packQuote } from "@/server/rpc/vps";
import { getSettings } from "@/server/state";
import { bucketHourly } from "@/server/storage/service";
import { rid } from "@/server/util";
import { asUser, call, db, fails, fresh, jar } from "./helpers";

beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => setAiUpstream(null));

const H = HOURS_PER_MONTH, DAY = 86400_000;
const NOW = new Date(Date.UTC(2026, 9, 20, 12));
/** hourly usage rows for a server: `days` days back from `now`, every hour */
async function usage(serverId: string, days: number, v: { cpu: number; ram: number; disk?: number }, now = NOW) {
  const start = Math.floor(now.getTime() / 3600_000) * 3600_000 - days * DAY;
  const rows = Array.from({ length: days * 24 }, (_, i) => ({ serverId, hour: new Date(start + (i + 1) * 3600_000), cpu: v.cpu, ram: v.ram, disk: v.disk ?? 30, n: 12 }));
  for (let i = 0; i < rows.length; i += 500) await (await db()).insert(usageHourly).values(rows.slice(i, i + 500));
}
async function appMetrics(target: string, days: number, v: { cpu: number; rpm: number; ramMb?: number }, now = NOW) {
  const start = Math.floor(now.getTime() / 3600_000) * 3600_000 - days * DAY;
  const rows = Array.from({ length: days * 24 }, (_, i) => ({ target, hour: new Date(start + (i + 1) * 3600_000), cpu: v.cpu, ramMb: v.ramMb ?? 300, rpm: v.rpm, netBytes: 0 }));
  for (let i = 0; i < rows.length; i += 500) await (await db()).insert(paasMetricsHourly).values(rows.slice(i, i + 500));
}
const find = (list: Finding[], rule: string, id?: string) => list.find((f) => f.rule === rule && (!id || f.resourceId === id));
/** the seed prices srv-1042 below its catalog plan («حرفه‌ای», c3); a real server pays its plan's price */
async function catalogPrice() {
  const [p] = await (await db()).select().from(plans).where(eq(plans.id, "c3"));
  await (await db()).update(servers).set({ price: (p.data as { price: number }).price }).where(eq(servers.id, "srv-1042"));
}
const server = async (id: string) => (await (await db()).select().from(servers).where(eq(servers.id, id)))[0];

describe("advisor rules", () => {
  it("VPS oversized: suggests the next smaller plan with the saving from changePlan's price, and not on < 14 days", async () => {
    await catalogPrice();
    await usage("srv-1042", 10, { cpu: 5, ram: 10 });
    let c = await computeFindings(await db(), "u1", NOW);
    expect(find(c.findings, "vps_oversized", "srv-1042")).toBeUndefined();
    expect(c.insufficient.find((x) => x.id === "srv-1042")).toMatchObject({ days: 10 });

    await (await db()).delete(usageHourly);
    await usage("srv-1042", 20, { cpu: 5, ram: 10 });
    c = await computeFindings(await db(), "u1", NOW);
    const f = find(c.findings, "vps_oversized", "srv-1042")!;
    expect(f).toBeTruthy();
    const s = await server("srv-1042");
    const q = await changePlanQuote(await db(), s, "c2");
    expect(f.saving).toBe(s.price - q.price);
    expect(f.action!.calls).toEqual([["@vps.downsize", ["srv-1042", "c2"]]]);
    expect(f.evidence.lines.join(" ")).toContain("دیسک کوچک نمی‌شود");
    expect(c.insufficient.find((x) => x.id === "srv-1042")).toBeUndefined();
  });

  it("VPS oversized does not fire when the smaller plan would not fit p95 + headroom", async () => {
    // p95 RAM 34% of 8 GB = 2.7 GB > 70% of the 4 GB plan; CPU low
    await usage("srv-1042", 20, { cpu: 5, ram: 34 });
    const c = await computeFindings(await db(), "u1", NOW);
    expect(find(c.findings, "vps_oversized", "srv-1042")).toBeUndefined();
  });

  it("VPS undersized: high RAM suggests a resize with the extra cost from the catalog", async () => {
    await usage("srv-1042", 5, { cpu: 30, ram: 95 });
    const c = await computeFindings(await db(), "u1", NOW);
    const f = find(c.findings, "vps_undersized", "srv-1042")!;
    const s = await server("srv-1042");
    expect(f.action!.calls).toEqual([["servers.resize", ["srv-1042", "c4"]]]);
    const [p] = await (await db()).select().from(plans).where(eq(plans.id, "c4"));
    expect(f.extraCost).toBe((p.data as { price: number }).price - s.price);
    expect(f.risk).toBe("high");
    expect(f.action!.typed).toBe(true);
    // two days of data: no risk claim either
    await (await db()).delete(usageHourly);
    await usage("srv-1042", 2, { cpu: 30, ram: 95 });
    expect(find((await computeFindings(await db(), "u1", NOW)).findings, "vps_undersized", "srv-1042")).toBeUndefined();
  });

  it("traffic: projects month-end usage and prices the packs like servers.buyTraffic", async () => {
    await (await db()).insert(vpsTraffic).values({ serverId: "srv-1042", month: "2026-10", usedGb: 1500, extraGb: 0 }).onConflictDoUpdate({ target: vpsTraffic.serverId, set: { month: "2026-10", usedGb: 1500, extraGb: 0 } });
    const c = await computeFindings(await db(), "u1", NOW);
    const f = find(c.findings, "traffic_overrun", "srv-1042")!;
    const s = await server("srv-1042");
    const projected = 1500 / ((NOW.getTime() - Date.UTC(2026, 9, 1)) / (Date.UTC(2026, 10, 1) - Date.UTC(2026, 9, 1)));
    const gb = Math.ceil((projected - s.bwLimit) / 500) * 500;
    expect(f.oneTime).toBe((await packQuote(await db(), gb)).price);
    expect(f.action!.calls).toEqual([["servers.buyTraffic", ["srv-1042", gb]]]);
    // well under the quota: nothing
    await (await db()).update(vpsTraffic).set({ usedGb: 100 }).where(eq(vpsTraffic.serverId, "srv-1042"));
    expect(find((await computeFindings(await db(), "u1", NOW)).findings, "traffic_overrun", "srv-1042")).toBeUndefined();
  });

  it("billing mode: an hourly server running all month is compared with the taxed monthly price", async () => {
    await (await db()).update(servers).set({ status: "running" }).where(eq(servers.id, "srv-1101"));
    const s = await server("srv-1101");
    const diff = H * vpsHourly(s.price) - invGross({ items: [{ amount: s.price }], tax: (await getSettings(await db())).tax });
    const f = find((await computeFindings(await db(), "u1", NOW)).findings, "billing_monthly", "srv-1101");
    if (diff >= ADVISOR_RULES.minSaving) expect(f!.saving).toBe(diff);
    else expect(f).toBeUndefined();
    // a server that charges more hourly than monthly
    await (await db()).update(servers).set({ price: 1_000_000 + 719 * 360 }).where(eq(servers.id, "srv-1101"));
    const s2 = await server("srv-1101");
    const d2 = H * vpsHourly(s2.price) - invGross({ items: [{ amount: s2.price }], tax: (await getSettings(await db())).tax });
    const f2 = find((await computeFindings(await db(), "u1", NOW)).findings, "billing_monthly", "srv-1101");
    expect(d2 >= ADVISOR_RULES.minSaving ? f2?.saving : f2).toBe(d2 >= ADVISOR_RULES.minSaving ? d2 : undefined);
  });

  it("idle: a server stopped for 14 days, a detached disk and old snapshots, with the hourly-billing savings", async () => {
    await usage("srv-1101", 15, { cpu: 0, ram: 0 });
    const d = await db();
    await d.insert(vpsDisks).values({ id: "vd-x1", userId: "u1", serverId: null, name: "old-data", loc: "thr", sizeGb: 100 });
    const old = new Date(NOW.getTime() - 60 * DAY);
    await d.insert(snapshots).values([1, 2, 3, 4, 5].map((i) => ({ id: "snap-t" + i, serverId: "srv-1042", name: "manual-" + i, size: 20, createdAt: new Date(old.getTime() - i * DAY) })));
    const c = await computeFindings(d, "u1", NOW);
    const s = await server("srv-1101");
    expect(find(c.findings, "idle_server", "srv-1101")).toMatchObject({ saving: H * vpsHourly(s.price), risk: "high" });
    expect(find(c.findings, "idle_server", "srv-1101")!.action).toMatchObject({ typed: true, destructive: true });
    const p = await vpsPrices(d);
    expect(find(c.findings, "detached_disk", "vd-x1")).toMatchObject({ saving: H * perHour(100 * p.diskGb), risk: "high" });
    const snap = find(c.findings, "old_snapshots", "srv-1042")!;
    // seed snapshot (12.4 GB, newest) + 5 × 20 GB; the newest 3 stay
    const s42 = await server("srv-1042");
    const before = Math.max(0, 112.4 - s42.disk * 0.1) * p.snapshotGb, after = Math.max(0, 52.4 - s42.disk * 0.1) * p.snapshotGb;
    expect(snap.saving).toBe(H * (perHour(before) - (after > 0 ? perHour(after) : 0)));
    expect(snap.action!.calls.length).toBe(3);
    // fewer than 14 days of samples while stopped: «داده کافی نیست»
    await d.delete(usageHourly);
    await usage("srv-1101", 5, { cpu: 0, ram: 0 });
    const c2 = await computeFindings(d, "u1", NOW);
    expect(find(c2.findings, "idle_server", "srv-1101")).toBeUndefined();
    expect(c2.insufficient.some((x) => x.id === "srv-1101")).toBe(true);
  });

  it("PaaS: idle app, too many instances, preview left running, OOM restarts, an idle database and an empty bucket", async () => {
    const d = await db();
    const [app] = await d.select().from(paasApps).where(eq(paasApps.id, "app-demo1"));
    const [plan] = await d.select().from(paasPlans).where(eq(paasPlans.id, app.planId));
    await appMetrics("app-demo1", 15, { cpu: 0.5, rpm: 0 });
    let c = await computeFindings(d, "u1", NOW);
    expect(find(c.findings, "idle_app", "app-demo1")!.saving).toBe(H * (appHourly(app, plan) - appHourly({ ...app, status: "stopped" }, plan)));

    await d.delete(paasMetricsHourly);
    await appMetrics("app-demo1", 15, { cpu: 20, rpm: 40 });
    c = await computeFindings(d, "u1", NOW);
    const inst = find(c.findings, "paas_instances", "app-demo1")!;
    expect(inst.saving).toBe(H * (appHourly(app, plan) - appHourly({ ...app, instances: 1 }, plan)));
    expect(inst.action!.calls[0]).toEqual(["paas.scale", ["app-demo1", expect.objectContaining({ instances: 1, autoscale: true, maxInstances: 2 })]]);

    await d.insert(paasDeployments).values({ id: "dep-prev1", appId: "app-demo1", status: "live", trigger: "manual", target: "preview", createdAt: new Date(NOW.getTime() - 10 * DAY) });
    await d.update(paasApps).set({ previewDeployment: "dep-prev1" }).where(eq(paasApps.id, "app-demo1"));
    await d.insert(paasEvents).values([{ appId: "app-demo1", kind: "oom", message: "OOMKilled" }, { appId: "app-demo1", kind: "oom", message: "OOMKilled" }]);
    await d.delete(paasLinks);
    await appMetrics("pdb-demo1", 15, { cpu: 0.2, rpm: 0 });
    const [sp] = await d.select().from(storagePlans).limit(1);
    await d.insert(storageBuckets).values({ id: "bk-empty", userId: "u1", name: "u1-empty-bucket", planId: sp.id, createdAt: new Date(NOW.getTime() - 20 * DAY) });
    c = await computeFindings(d, "u1", NOW);
    const [app2] = await d.select().from(paasApps).where(eq(paasApps.id, "app-demo1"));
    expect(find(c.findings, "preview_running", "app-demo1")!.saving).toBe(H * (appHourly(app2, plan) - appHourly({ ...app2, previewDeployment: null }, plan)));
    const oom = find(c.findings, "paas_oom", "app-demo1")!;
    const next = (await d.select().from(paasPlans)).filter((p) => p.kind === "app" && p.active && p.ramMb > plan.ramMb && p.price > plan.price).sort((a, b) => a.price - b.price)[0];
    expect(oom.extraCost).toBe(H * appHourly(app2, next) - H * appHourly(app2, plan));
    const [pdb] = await d.select().from(paasDbs).where(eq(paasDbs.id, "pdb-demo1"));
    const [dplan] = await d.select().from(paasPlans).where(eq(paasPlans.id, pdb.planId));
    expect(find(c.findings, "idle_db", "pdb-demo1")!.saving).toBe(H * (dbHourly(pdb, dplan) - dbHourly({ status: "stopped" }, dplan)));
    expect(find(c.findings, "empty_bucket", "bk-empty")).toMatchObject({ saving: H * bucketHourly(sp), risk: "low" });
  });

  it("AI: heavy short-output use of an expensive model suggests a cheaper one of the same vendor at the current volume", async () => {
    const d = await db();
    const [m] = await d.select().from(aiModels).where(eq(aiModels.id, "claude-opus-5"));
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: "req_t" + i, userId: "u1", model: m.id, format: "openai" as const, status: "success" as const, inTokens: 1000, outTokens: 100, charged: costOf(1000, 100, m), createdAt: new Date(NOW.getTime() - (i % 20) * DAY) }));
    await d.insert(aiUsage).values(rows);
    const f = find((await computeFindings(d, "u1", NOW)).findings, "ai_model")!;
    const name = /«([^»]+)»/.exec(f.detail)![1];
    const [cand] = await d.select().from(aiModels).where(eq(aiModels.name, name));
    expect(cand.vendor).toBe(m.vendor);
    expect(f.saving).toBe(300 * costOf(1000, 100, m) - costOf(300_000, 30_000, cand));
    expect(f.action!.calls).toEqual([]);
    expect(f.action!.link).toBe("/panel/ai");
  });

  it("بافت: continuous maintenance with no incident for 30 days → incident mode saves continuousMonthly", async () => {
    const d = await db();
    await d.insert(builderProjects).values({ id: "bld-t1", userId: "u1", name: "shop-site", appId: "app-demo1", previewToken: "tok-advisor-test", maintainMode: "continuous", model: "claude-opus-5.5", createdAt: new Date(NOW.getTime() - 40 * DAY) });
    const f = find((await computeFindings(d, "u1", NOW)).findings, "builder_mode", "bld-t1")!;
    const [p] = await d.select().from(builderProjects).where(eq(builderProjects.id, "bld-t1"));
    expect(f.saving).toBe((await maintainCosts(d, p)).continuousMonthly);
    expect(f.action!.calls).toEqual([["builder.update", ["bld-t1", { maintainMode: "incident" }]]]);
    await d.insert(paasEvents).values({ appId: "app-demo1", kind: "crash", message: "x", createdAt: new Date(NOW.getTime() - 3 * DAY) });
    expect(find((await computeFindings(d, "u1", NOW)).findings, "builder_mode", "bld-t1")).toBeUndefined();
  });

  it("wallet runway: warns when the balance lasts under 14 days, high risk under 7", async () => {
    const d = await db();
    await d.update(users).set({ balance: 300_000 }).where(eq(users.id, "u1"));
    await d.insert(transactions).values(Array.from({ length: 7 }, (_, i) => ({ id: rid("TX"), userId: "u1", type: "usage" as const, amount: -100_000, method: "کیف پول", desc: "مصرف ساعتی سرور", createdAt: new Date(Date.now() - i * DAY - 3600_000) })));
    const f = find((await computeFindings(d, "u1")).findings, "wallet_runway")!;
    expect(f.risk).toBe("high");
    expect(f.action!.link).toContain("/panel/billing");
  });
});

describe("advisor AI summary", () => {
  const sample = (): Finding[] => [{ key: "k", rule: "detached_disk", kind: "disk", resourceId: "vd", resourceName: "old-data", href: "/", title: "دیسک «old-data» به هیچ سروری وصل نیست", detail: "", evidence: { lines: ["۱۰۰ گیگابایت، ۱۲۵٬۰۰۰ تومان در ماه."] }, saving: 125_280, extraCost: 0, oneTime: 0, confidence: 0.9, risk: "high", action: null }];
  it("numbers are read in Persian and Latin digits; invented ones are rejected", () => {
    expect(numbersIn("صرفه‌جویی ۱۲۵٬۲۸۰ تومان و 3 مورد\n۱. حذف دیسک")).toEqual([125280, 3]);
    expect(onlyKnownNumbers("با حذف دیسک ماهانه ۱۲۵٬۲۸۰ تومان صرفه‌جویی می‌کنید.", sample())).toBe(true);
    expect(onlyKnownNumbers("با حذف دیسک ماهانه ۹۹۰٬۰۰۰ تومان صرفه‌جویی می‌کنید.", sample())).toBe(false);
    expect(onlyKnownNumbers(templateSummary(sample()), sample())).toBe(true);
  });

  function fakeModel(text: string) {
    const up: Upstream = {
      name: "http",
      async chat() { return Response.json({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 400, completion_tokens: 80 } }); },
      async models() { return []; },
    };
    setAiUpstream(up);
  }
  it("the model's text is used only when every number is in the findings; platform-metered, the wallet untouched", async () => {
    const d = await db();
    const bal = (await d.select().from(users).where(eq(users.id, "u1")))[0].balance;
    fakeModel("با حذف دیسک old-data ماهانه ۱۲۵٬۲۸۰ تومان صرفه‌جویی می‌شود.");
    const ok = await writeSummary(d, "u1", sample());
    expect(ok.simulated).toBe(false);
    expect(ok.text).toContain("۱۲۵٬۲۸۰");
    fakeModel("با حذف دیسک ماهانه ۵۰۰٬۰۰۰ تومان و ۴۰٪ صرفه‌جویی می‌شود.");
    const bad = await writeSummary(d, "u1", sample());
    expect(bad.simulated).toBe(true);
    expect(bad.text).toBe(templateSummary(sample()));
    const meter = await d.select().from(platformAiUsage).where(eq(platformAiUsage.purpose, "advisor"));
    expect(meter.length).toBe(2);
    expect(meter.every((r) => r.cost > 0 && r.ref === "u1")).toBe(true);
    expect((await d.select().from(users).where(eq(users.id, "u1")))[0].balance).toBe(bal);
    expect((await d.select().from(aiUsage).where(eq(aiUsage.userId, "u1"))).length).toBe(0);
  });
  it("over the daily cap, and with the simulator, the template answers for free", async () => {
    const d = await db();
    expect((await writeSummary(d, "u1", sample())).simulated).toBe(true);
    await call("auth.login", "admin@gereh.net", (await import("@/server/seed")).DEMO_PASSWORD);
    await call("advisor.adminSettings", { dailyCap: 1 });
    fakeModel("ماهانه ۱۲۵٬۲۸۰ تومان.");
    const r = await writeSummary(d, "u1", sample());
    expect(r).toMatchObject({ simulated: true, cost: 0 });
    expect((await d.select().from(platformAiUsage)).length).toBe(0);
  });
});

describe("advisor apply, ignore, weekly, assistant", () => {
  const recent = new Date();
  const oversized = async () => { await catalogPrice(); await usage("srv-1042", 20, { cpu: 5, ram: 10 }, recent); };
  const finding = async (rule: string, resourceId: string) => (await (await db()).select().from(advisorFindings).where(and(eq(advisorFindings.rule, rule), eq(advisorFindings.resourceId, resourceId))))[0];

  it("apply: confirm required, server-derived downsize (stop → changePlan → start), logged; never for another account", async () => {
    await asUser();
    await oversized();
    const r = await call<AdvisorReport>("advisor.report", true);
    const v = r.findings.find((f) => f.rule === "vps_oversized")!;
    expect(v.action).toMatchObject({ rpc: "servers.changePlan", typed: false });
    expect(JSON.stringify(r)).not.toContain("calls");
    expect(r.potentialSaving).toBeGreaterThanOrEqual(v.saving);
    expect(await fails("advisor.apply", v.id, false)).toContain("تأیید");
    const res = await call<{ ok: boolean }>("advisor.apply", v.id, true);
    expect(res.ok).toBe(true);
    const s = await server("srv-1042");
    expect(s.plan).toBe("پایه");
    expect(s.status).toBe("running");
    expect((await finding("vps_oversized", "srv-1042")).status).toBe("applied");
    expect((await (await db()).select().from(activity).where(eq(activity.userId, "u1"))).some((a) => a.text.includes("مشاور هزینه"))).toBe(true);
    expect(await fails("advisor.apply", v.id, true)).toContain("باز نیست");

    // another account cannot see or apply it
    jar.clear();
    await call("auth.register", { name: "نیما", email: "nima@example.com", phone: "09351112299", password: "Abcdefg1" });
    expect(await fails("advisor.apply", v.id, true)).toContain("پیدا نشد");
    expect(await fails("advisor.ignore", v.id)).toContain("پیدا نشد");
  });

  it("destructive actions need the typed name; a changed price stops the old card", async () => {
    await asUser();
    const d = await db();
    await d.insert(vpsDisks).values({ id: "vd-x2", userId: "u1", serverId: null, name: "old-data", loc: "thr", sizeGb: 100 });
    const r = await call<AdvisorReport>("advisor.report", true);
    const v = r.findings.find((f) => f.rule === "detached_disk")!;
    expect(v.action).toMatchObject({ typed: true, destructive: true, rpc: "servers.deleteDisk" });
    expect(await fails("advisor.apply", v.id, true)).toContain("old-data");
    expect(await fails("advisor.apply", v.id, true, "wrong")).toContain("old-data");
    // the disk grew meanwhile: the shown saving is stale, nothing runs
    await d.update(vpsDisks).set({ sizeGb: 200 }).where(eq(vpsDisks.id, "vd-x2"));
    expect(await fails("advisor.apply", v.id, true, "old-data")).toContain("تغییر کرده");
    expect((await d.select().from(vpsDisks).where(eq(vpsDisks.id, "vd-x2"))).length).toBe(1);
    await call("advisor.apply", v.id, true, "old-data");
    expect((await d.select().from(vpsDisks).where(eq(vpsDisks.id, "vd-x2"))).length).toBe(0);
  });

  it("team roles: a billing member reads the advice but cannot run a server change", async () => {
    await asUser();
    await oversized();
    await call<AdvisorReport>("advisor.report", true);
    await call("team.invite", "sara@example.com", "billing", "http://localhost:3000");
    const { outbox } = await import("@/server/messaging");
    const token = /token=([\w-]+)/.exec(outbox.find((m) => m.subject?.startsWith("دعوت"))!.text)![1];
    jar.clear();
    await call("auth.register", { name: "سارا", email: "sara@example.com", phone: "09351112233", password: "Abcdefg1" });
    await call("team.accept", token);
    const r = await call<AdvisorReport>("advisor.report");
    const v = r.findings.find((f) => f.rule === "vps_oversized")!;
    expect(await fails("advisor.apply", v.id, true)).toContain("نقش شما");
    expect((await server("srv-1042")).plan).toBe("حرفه‌ای");
  });

  it("ignore hides a finding for 30 days, then it comes back", async () => {
    await asUser();
    await (await db()).insert(vpsDisks).values({ id: "vd-x3", userId: "u1", serverId: null, name: "spare", loc: "thr", sizeGb: 100 });
    const r = await call<AdvisorReport>("advisor.report", true);
    const v = r.findings.find((f) => f.rule === "detached_disk")!;
    await call("advisor.ignore", v.id);
    const r2 = await call<AdvisorReport>("advisor.report", true);
    expect(r2.findings.some((f) => f.id === v.id)).toBe(false);
    expect(r2.ignored).toBe(1);
    await refresh(await db(), "u1", { now: new Date(Date.now() + 29 * DAY) });
    expect((await finding("detached_disk", "vd-x3")).status).toBe("ignored");
    await refresh(await db(), "u1", { now: new Date(Date.now() + 31 * DAY) });
    expect((await finding("detached_disk", "vd-x3")).status).toBe("open");
  });

  it("the weekly job notifies once per new finding and respects the mute", async () => {
    const d = await db();
    await d.insert(vpsDisks).values({ id: "vd-x4", userId: "u1", serverId: null, name: "big", loc: "thr", sizeGb: 500 });
    const notes = async () => (await d.select().from(notifications).where(eq(notifications.userId, "u1"))).filter((n) => n.text.includes("مشاور هزینه")).length;
    const mails = async () => (await d.select().from(jobs).where(eq(jobs.type, "notify.send"))).filter((j) => JSON.stringify(j.payload).includes("مشاور هزینه") && (j.payload as { userId?: string }).userId === "u1").length;
    await advisorWeekly(d);
    expect(await notes()).toBe(1);
    expect(await mails()).toBe(1);
    await advisorWeekly(d);
    expect(await notes()).toBe(1);
    // a new finding, but muted
    await asUser();
    await call("advisor.setMute", true);
    await d.insert(vpsDisks).values({ id: "vd-x5", userId: "u1", serverId: null, name: "big2", loc: "thr", sizeGb: 500 });
    await advisorWeekly(d);
    expect(await notes()).toBe(1);
    expect((await d.select().from(advisorState).where(eq(advisorState.userId, "u1")))[0].muted).toBe(true);
  });

  it("the assistant's cost_advice returns the findings; apply_cost_advice refuses typed actions", async () => {
    await asUser();
    await (await db()).insert(vpsDisks).values({ id: "vd-x6", userId: "u1", serverId: null, name: "spare", loc: "thr", sizeGb: 100 });
    const ctx = await context();
    const out = await execTool(ctx, toolByName("cost_advice")!, {}) as { findings: { finding_id: string; kind: string; monthly_saving_toman: number; apply: string }[] };
    const f = out.findings.find((x) => x.kind === "دیسک جداشده")!;
    expect(f.monthly_saving_toman).toBeGreaterThan(0);
    expect(f.apply).toContain("/panel/advisor");
    await expect(toolByName("apply_cost_advice")!.quote!(ctx, { finding_id: f.finding_id })).rejects.toThrow("مشاور هزینه");
  });
});
