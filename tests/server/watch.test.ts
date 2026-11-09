/* «پایش پیشرفته»: prices from Gereh's real token cost plus the admin's margin, the trial, monthly billing (renewal,
   upgrade prorated, downgrade at renewal, ending), the on-demand check, the schedule (every 3 hours, continuous on
   something new, daily summary), the uptime ping and the admin's figures. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computePrices, quote, upgradeDue, WATCH_DEFAULTS, type WatchAdminView, type WatchCheckView, type WatchReport } from "@/lib/watch";
import type { ChatRequest } from "@/server/ai/translate";
import { setAiUpstream } from "@/server/ai/upstream";
import { aiModels, kv, notifications, paasApps, paasEvents, transactions, users, watchChecks, watchPings, watchPlans } from "@/server/db/schema";
import { setPinger, watchPing, watchTick } from "@/server/watch/service";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

const MODEL = { id: "watch-test", name: "Watch model", vendor: "openai", upstream: "openai/watch-test", inPrice: 200_000, outPrice: 800_000, costIn: 100_000, costOut: 400_000, context: 128_000, position: 998 };
const DAY = 86400_000, H = 3600_000;

beforeEach(async () => {
  await fresh(); setAiUpstream(null); setPinger(null);
  const d = await db();
  await d.insert(aiModels).values(MODEL).onConflictDoNothing();
  await d.insert(kv).values({ key: "watch", value: { model: "watch-test" } }).onConflictDoUpdate({ target: kv.key, set: { value: { model: "watch-test" } } });
});
afterEach(() => { setAiUpstream(null); setPinger(null); });

const REPORT = "وضعیت: نیاز به توجه\nچه دیدیم: خطای اتصال به پایگاه داده در لاگ.\nعلت احتمالی: رمز پایگاه داده.\nراه‌حل: متغیر DATABASE_URL را بررسی کنید.";
/** a model that answers every check with `text`, recording what it was sent */
function model(text = REPORT) {
  const seen: ChatRequest[] = [];
  setAiUpstream({ name: "http", models: async () => [], chat: async (req) => { seen.push(req); return Response.json({ id: "w", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 5000, completion_tokens: 500 } }); } });
  return seen;
}
const balance = async () => (await (await db()).select().from(users).where(eq(users.id, "u1")))[0].balance;
const plan = async (id = "app-demo1") => (await (await db()).select().from(watchPlans).where(eq(watchPlans.resourceId, id)))[0];
const notes = async () => (await (await db()).select().from(notifications).where(eq(notifications.userId, "u1"))).map((n) => n.text);
const report = () => call<WatchReport>("watch.report");

describe("pricing", () => {
  it("prices are the token cost of the expected checks plus the margin, rounded up; overrides win", () => {
    const s = { ...WATCH_DEFAULTS };
    const cost = (6000 * 100_000 + 700 * 400_000) / 1e6; // 880 Toman a check at the cost price
    expect(computePrices(s, cost)).toEqual({ onDemand: 2000, every3h: Math.ceil((10_000 + cost * 240 * 2) / 1000) * 1000, continuous: Math.ceil((10_000 + cost * 330 * 2) / 1000) * 1000 });
    const q = quote({ ...s, priceEvery3h: 99_000 }, cost, "m", true);
    expect(q.every3h).toBe(99_000);
    expect(q.computed.every3h).not.toBe(99_000);
    expect(q.continuous).toBeGreaterThan(q.computed.every3h);
    expect(upgradeDue(100_000, 200_000, 15)).toBe(50_000);
    expect(upgradeDue(200_000, 100_000, 15)).toBe(0);
  });

  it("the admin sees the computed prices from the model's cost price and can change margin and prices", async () => {
    await asUser();
    expect(await fails("watch.admin")).toMatch(/اجازه|دسترسی/);
    await asAdmin();
    const v = await call<WatchAdminView>("watch.admin");
    expect(v.quote).toMatchObject({ model: "watch-test", costKnown: true, costPerCheck: 880 });
    expect(v.quote.every3h).toBe(Math.ceil((10_000 + 880 * 240 * 2) / 1000) * 1000);
    const w = await call<WatchAdminView>("watch.adminSettings", { margin: 0.5, priceContinuous: 750_000 });
    expect(w.quote.every3h).toBe(Math.ceil((10_000 + 880 * 240 * 1.5) / 1000) * 1000);
    expect(w.quote.continuous).toBe(750_000);
    expect(await fails("watch.adminSettings", { margin: -1 })).toBeTruthy();
  });
});

describe("plans and billing", () => {
  it("the first plan is a free trial; a later one is charged; ending, renewing and a short wallet", async () => {
    await asUser();
    const r0 = await report();
    expect(r0.trialAvailable).toBe(true);
    expect(r0.resources.map((r) => r.id)).toEqual(expect.arrayContaining(["srv-1042", "app-demo1"]));
    const b0 = await balance();
    expect((await call<{ message: string }>("watch.enable", "app", "app-demo1", "continuous")).message).toContain("رایگان");
    expect(await balance()).toBe(b0);
    expect(await plan()).toMatchObject({ status: "trial", mode: "continuous", renew: false, price: 0 });
    // a second service: charged a month
    const prices = (await report()).prices;
    await call("watch.enable", "server", "srv-1042", "every3h");
    expect(await balance()).toBe(b0 - prices.every3h);
    expect(await plan("srv-1042")).toMatchObject({ status: "active", price: prices.every3h, renew: true });
    // upgrade: the difference for the days left; downgrade: at the renewal
    await call("watch.enable", "server", "srv-1042", "continuous");
    expect(await balance()).toBe(b0 - prices.every3h - upgradeDue(prices.every3h, prices.continuous, 30));
    expect(await plan("srv-1042")).toMatchObject({ mode: "continuous", price: prices.continuous });
    await call("watch.enable", "server", "srv-1042", "every3h");
    expect(await plan("srv-1042")).toMatchObject({ mode: "continuous", nextMode: "every3h" });
    // the trial ends without "continue": back to basic, told
    const d = await db();
    await d.update(watchPlans).set({ trialEnds: new Date(Date.now() + DAY) }).where(eq(watchPlans.resourceId, "app-demo1"));
    await watchTick(d);
    expect((await notes()).some((n) => n.includes("به‌زودی تمام"))).toBe(true);
    await d.update(watchPlans).set({ trialEnds: new Date(Date.now() - 1000) }).where(eq(watchPlans.resourceId, "app-demo1"));
    await watchTick(d);
    expect(await plan()).toMatchObject({ status: "expired" });
    // renewal at paidUntil, with the waiting downgrade
    const b1 = await balance();
    await d.update(watchPlans).set({ paidUntil: new Date(Date.now() - 1000) }).where(eq(watchPlans.resourceId, "srv-1042"));
    await watchTick(d);
    expect(await plan("srv-1042")).toMatchObject({ status: "active", mode: "every3h", nextMode: null, price: prices.every3h });
    expect(await balance()).toBe(b1 - prices.every3h);
    // a short wallet: not renewed, told
    await d.update(users).set({ balance: 0 }).where(eq(users.id, "u1"));
    await d.update(watchPlans).set({ paidUntil: new Date(Date.now() - 1000) }).where(eq(watchPlans.resourceId, "srv-1042"));
    await watchTick(d);
    expect(await plan("srv-1042")).toMatchObject({ status: "expired" });
    expect((await notes()).some((n) => n.includes("تمدید نشد"))).toBe(true);
    expect(await fails("watch.enable", "server", "srv-1042", "every3h")).toContain("موجودی");
    // no second trial
    expect((await report()).trialAvailable).toBe(false);
    const tx = await d.select().from(transactions).where(eq(transactions.userId, "u1"));
    expect(tx.filter((t) => t.desc.startsWith("پایش پیشرفته")).length).toBe(3);
  });

  it("after a trial, «ادامه» renews it as a paid month; turning renew off ends a paid plan at its end", async () => {
    await asUser();
    await call("watch.enable", "app", "app-demo1", "every3h");
    await call("watch.renew", "app", "app-demo1", true);
    const d = await db();
    const b0 = await balance();
    await d.update(watchPlans).set({ trialEnds: new Date(Date.now() - 1000) });
    await watchTick(d);
    const price = (await report()).prices.every3h;
    expect(await plan()).toMatchObject({ status: "active", price });
    expect(await balance()).toBe(b0 - price);
    await call("watch.renew", "app", "app-demo1", false);
    await d.update(watchPlans).set({ paidUntil: new Date(Date.now() - 1000) });
    await watchTick(d);
    expect(await plan()).toMatchObject({ status: "cancelled" });
  });

  it("a new account's first running service gets the trial by itself; existing ones do not", async () => {
    const d = await db();
    await watchTick(d); // marks when the feature started
    expect(await d.select().from(watchPlans)).toHaveLength(0);
    await d.insert(paasApps).values({ id: "app-new1", userId: "u1", name: "fresh-site", stack: "node", source: "git", gitUrl: "https://example.com/x.git", gitBranch: "main", port: 3000, planId: "app-small", instances: 1, status: "running", hookToken: "hook-token-fresh-site-0000000000", liveDeployment: "dep-x" });
    await watchTick(d);
    expect(await plan("app-new1")).toMatchObject({ status: "trial", mode: "continuous" });
    expect((await notes()).some((n) => n.includes("روز رایگان روشن شد"))).toBe(true);
    await watchTick(d);
    expect(await d.select().from(watchPlans)).toHaveLength(1);
  });
});

describe("checks", () => {
  it("«الان بررسی کن» without a plan is charged the on-demand price, only when the AI wrote the report", async () => {
    await asUser();
    const price = (await report()).prices.onDemand;
    // the simulator: a report by rule, nothing charged
    const b0 = await balance();
    const r0 = await call<WatchCheckView & { ai: boolean }>("watch.checkNow", "server", "srv-1042");
    expect(r0).toMatchObject({ ai: false, charged: 0 });
    expect(r0.summary).toMatch(/^وضعیت: /);
    expect(await balance()).toBe(b0);
    const seen = model();
    const r = await call<WatchCheckView & { ai: boolean }>("watch.checkNow", "server", "srv-1042");
    expect(r).toMatchObject({ ai: true, status: "warn", charged: price });
    expect(await balance()).toBe(b0 - price);
    expect(String(seen[0].messages[0].content)).toContain("on-call engineer");
    expect(String(seen[0].messages[1].content)).toContain("سرور «web-prod-1»");
    const [c] = await (await db()).select().from(watchChecks).where(eq(watchChecks.id, r.id));
    // Gereh's real cost: the model's cost price
    expect(c.cost).toBeCloseTo((5000 * 100_000 + 500 * 400_000) / 1e6, 3);
    // with a plan: free within the daily allowance
    await call("watch.enable", "server", "srv-1042", "every3h");
    expect((await call<WatchCheckView>("watch.checkNow", "server", "srv-1042")).charged).toBe(0);
    expect(await fails("watch.checkNow", "server", "srv-9999")).toContain("پیدا نشد");
  });

  it("every3h reads on schedule; continuous reads when something new appears, with a cooldown, plus the daily summary", async () => {
    await asUser();
    const seen = model();
    await call("watch.enable", "server", "srv-1042", "every3h");
    const d = await db();
    await watchTick(d);
    expect(seen).toHaveLength(1);
    expect((await notes()).some((n) => n.includes("نیاز به توجه"))).toBe(true);
    await watchTick(d);
    expect(seen).toHaveLength(1);
    await d.update(watchPlans).set({ lastCheckAt: new Date(Date.now() - 3 * H - 1000) });
    await watchTick(d);
    expect(seen).toHaveLength(2);

    // continuous on the app: the daily summary first, then only something new wakes the AI
    await d.delete(watchPlans);
    await d.insert(watchPlans).values({ id: "wpl-c", userId: "u1", resourceKind: "app", resourceId: "app-demo1", mode: "continuous", status: "active", paidUntil: new Date(Date.now() + 9 * DAY) });
    seen.length = 0;
    await watchTick(d);
    expect((await d.select().from(watchChecks).where(eq(watchChecks.planId, "wpl-c"))).map((c) => c.trigger)).toEqual(["daily"]);
    await d.update(watchPlans).set({ lastCheckAt: new Date(Date.now() - H) });
    await watchTick(d);
    expect(seen).toHaveLength(1); // nothing new
    await d.insert(paasEvents).values({ appId: "app-demo1", kind: "crash", message: "exit code 1" });
    await watchTick(d);
    expect(seen).toHaveLength(2);
    expect((await d.select().from(watchChecks).where(and(eq(watchChecks.planId, "wpl-c"), eq(watchChecks.trigger, "anomaly")))).length).toBe(1);
    // within the cooldown a new crash waits
    await d.insert(paasEvents).values({ appId: "app-demo1", kind: "crash", message: "exit code 1" });
    await watchTick(d);
    expect(seen).toHaveLength(2);
    // the platform paid: the wallet is untouched by scheduled checks
    expect((await d.select().from(watchChecks).where(eq(watchChecks.planId, "wpl-c"))).every((c) => c.charged === 0)).toBe(true);
  });
});

describe("uptime ping", () => {
  it("two failed pings tell the owner it is down, a good one that it is back; uptime is counted", async () => {
    await asUser();
    await call("watch.enable", "app", "app-demo1", "every3h");
    const urls: string[] = [];
    let up = true;
    setPinger(async (url) => { urls.push(url); return { ok: up, ms: 42, code: up ? 200 : 502 }; });
    const d = await db();
    for (let i = 0; i < 30; i++) await watchPing(d, { now: new Date(Date.now() - (40 - i) * 60_000) });
    expect(urls[0]).toMatch(/^https:\/\/novin-shop\./);
    up = false;
    await watchPing(d);
    expect((await notes()).some((n) => n.includes("پاسخ نمی‌دهد"))).toBe(false);
    await watchPing(d);
    expect((await notes()).some((n) => n.includes("پاسخ نمی‌دهد"))).toBe(true);
    expect((await report()).resources.find((r) => r.id === "app-demo1")).toMatchObject({ down: true });
    up = true;
    await watchPing(d);
    expect((await notes()).some((n) => n.includes("دوباره در دسترس"))).toBe(true);
    const r = (await report()).resources.find((x) => x.id === "app-demo1")!;
    expect(r.down).toBe(false);
    expect(r.uptime).toBeCloseTo((31 / 33) * 100, 1);
    expect((await d.select().from(watchPings)).length).toBe(33);
    await call("watch.options", "app", "app-demo1", { uptimeUrl: "https://status.example.com/health" });
    await watchPing(d);
    expect(urls.at(-1)).toBe("https://status.example.com/health");
    expect(await fails("watch.options", "app", "app-demo1", { uptimeUrl: "ftp://x" })).toContain("http");
  });
});
