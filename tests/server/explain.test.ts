import { and, desc, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EXPLAIN_MIN_FEE, type Explanation } from "@/lib/explain";
import { redact, rpcErrorRef, withErrorRef } from "@/server/ai/explain";
import { simulateExplain } from "@/server/ai/explain-sim";
import { setAiUpstream, type Upstream } from "@/server/ai/upstream";
import { activity, aiExplanations, aiUsage, paasApps, paasDbEvents, paasDbImports, paasDbs, paasDeployments, paasEnv, serverTasks, ticketMessages, tickets, users } from "@/server/db/schema";
import { open } from "@/server/secrets";
import { rid } from "@/server/util";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => setAiUpstream(null));

const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const balance = async (uid = "u1") => (await (await db()).select().from(users).where(eq(users.id, uid)))[0].balance;
const gitApp = (name: string, gitUrl: string, over: Record<string, unknown> = {}) => ({ name, stack: "node", source: "git", gitUrl, gitBranch: "main", port: 3000, planId: "app-micro", env: [{ key: "API_KEY", value: "s3cret-value-9911", secret: true }], ...over });
const failedDep = async (appId: string) => (await (await db()).select().from(paasDeployments).where(and(eq(paasDeployments.appId, appId), eq(paasDeployments.status, "failed"))))[0];
/** an app whose deployment failed with `log` (inserted directly, like the worker's fail()) */
async function appFailedWith(log: string, failure = "") {
  const id = await call<string>("paas.createApp", gitApp("log-app", "https://github.com/acme/api.git"));
  await settle();
  const depId = rid("dep");
  await (await db()).insert(paasDeployments).values({ id: depId, appId: id, status: "failed", trigger: "manual", log, failure });
  return { id, depId };
}
/** a fake model service that records the request and answers `text` */
function fakeModel(text: string) {
  const seen: { body: string }[] = [];
  const up: Upstream = {
    name: "http",
    async chat(req) { seen.push({ body: JSON.stringify(req) }); return Response.json({ id: "x", choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 200 } }); },
    async models() { return []; },
  };
  setAiUpstream(up);
  return seen;
}

describe("explain: Gereh Apps", () => {
  it("port mismatch: explains, offers a server-derived port fix, and applyFix runs it with the user's ctx", async () => {
    await asUser();
    const appId = await call<string>("paas.createApp", gitApp("bad-port", "https://github.com/acme/sim-badport.git"));
    await settle();
    const dep = await failedDep(appId);
    expect(dep.log).toContain("listening on 0.0.0.0:8080");
    const before = await balance();
    const x = await call<Explanation>("ai.explain", "paas", appId, dep.id);
    expect(x.summary).toContain("۸۰۸۰");
    const fix = x.actions.find((a) => a.id === "set_port")!;
    expect(fix).toMatchObject({ rpc: "paas.updateApp", costly: false });
    expect(fix.label).toContain("۸۰۸۰");
    expect(JSON.stringify(x)).not.toContain("calls");
    // metered: the wallet pays a small fee, logged as AI usage
    expect(x.charged).toBeGreaterThanOrEqual(EXPLAIN_MIN_FEE);
    expect(before - (await balance())).toBe(x.charged);
    expect((await (await db()).select().from(aiUsage).where(eq(aiUsage.userId, "u1"))).some((u) => u.charged === x.charged && u.status === "success")).toBe(true);

    const r = await call<{ ok: boolean }>("ai.applyFix", x.id, "set_port");
    expect(r.ok).toBe(true);
    const [app] = await (await db()).select().from(paasApps).where(eq(paasApps.id, appId));
    expect(app.port).toBe(8080);
    // no live version yet: the fix also redeploys
    const deps = await (await db()).select().from(paasDeployments).where(eq(paasDeployments.appId, appId));
    expect(deps.length).toBe(2);
    expect(deps.find((d) => d.id !== dep.id)!.message).toContain("پیشنهاد AI");
    const acts = await (await db()).select().from(activity).where(eq(activity.userId, "u1"));
    expect(acts.some((a) => a.text.includes("رفع خطا با AI"))).toBe(true);
    expect(await fails("ai.applyFix", x.id, "delete_app")).toContain("پیشنهاد نشده");
  });

  it("the same error within the hour is answered from the cache, without charging again", async () => {
    await asUser();
    const appId = await call<string>("paas.createApp", gitApp("crashy", "https://github.com/acme/sim-unhealthy.git"));
    await settle();
    const dep = await failedDep(appId);
    const b0 = await balance();
    const a = await call<Explanation>("ai.explain", "paas", appId, dep.id);
    const b1 = await balance();
    const b = await call<Explanation>("ai.explain", "paas", appId, dep.id);
    expect(b).toMatchObject({ id: a.id, cached: true, charged: 0 });
    expect(await balance()).toBe(b1);
    expect(b0 - b1).toBe(a.charged);
    expect((await (await db()).select().from(aiExplanations).where(eq(aiExplanations.userId, "u1"))).length).toBe(1);
  });

  it("raising the plan is costly: it shows the price and needs confirm", async () => {
    await asUser();
    const appId = await call<string>("paas.createApp", gitApp("hungry", "https://github.com/acme/sim-oom.git"));
    await settle();
    const dep = await failedDep(appId);
    const x = await call<Explanation>("ai.explain", "paas", appId, dep.id);
    const up = x.actions.find((a) => a.id === "raise_plan")!;
    expect(up).toMatchObject({ costly: true, rpc: "paas.scale" });
    expect(up.price).toBeGreaterThan(0);
    expect(up.priceNote).toContain("تومان در ماه");
    expect(await fails("ai.applyFix", x.id, "raise_plan")).toContain("تأیید");
    expect((await (await db()).select().from(paasApps).where(eq(paasApps.id, appId)))[0].planId).toBe("app-micro");
    await call("ai.applyFix", x.id, "raise_plan", true);
    expect((await (await db()).select().from(paasApps).where(eq(paasApps.id, appId)))[0].planId).toBe("app-small");
  });

  it("a missing env key: the value is typed by the customer, stored sealed, and never reaches the prompt", async () => {
    await asUser();
    const { id, depId } = await appFailedWith("==> Starting\nError: Missing required environment variable STRIPE_KEY\ncontainer exited with code 1");
    const x = await call<Explanation>("ai.explain", "paas", id, depId);
    const env = x.actions.find((a) => a.id === "set_env")!;
    expect(env.label).toContain("STRIPE_KEY");
    expect(env.input).toBeTruthy();
    expect(await fails("ai.applyFix", x.id, "set_env")).toContain("مقدار");
    await call("ai.applyFix", x.id, "set_env", false, "sk_live_typed_by_me");
    const [row] = await (await db()).select().from(paasEnv).where(and(eq(paasEnv.appId, id), eq(paasEnv.key, "STRIPE_KEY")));
    expect(row.secret).toBe(true);
    expect(open(row.valueEnc)).toBe("sk_live_typed_by_me");
  });

  it("secrets are redacted from the prompt: env values, passwords, tokens, connection strings", async () => {
    await asUser();
    const seen = fakeModel(JSON.stringify({ summary: "x", cause: "y", steps: ["z"], actions: [] }));
    const { id, depId } = await appFailedWith([
      "connecting to postgres://shop:Pa55word-777@db.internal:5432/shop",
      "using key s3cret-value-9911 for the API",
      "Authorization: Bearer abcdefghijklmnop1234567890",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "password: hunter2hunter2",
      "Error: connect ECONNREFUSED",
    ].join("\n"));
    await call("ai.explain", "paas", id, depId);
    expect(seen.length).toBe(1);
    const prompt = seen[0].body;
    for (const s of ["s3cret-value-9911", "Pa55word-777", "abcdefghijklmnop1234567890", "wJalrXUtnFEMI", "hunter2hunter2"]) expect(prompt).not.toContain(s);
    expect(prompt).toContain("API_KEY"); // keys only
    expect(prompt).toContain("[REDACTED]");
    expect(redact("token=abc123 ok", [])).toBe("token=[REDACTED] ok");
  });

  it("the model cannot invent actions or arguments: only the allowlist, with server-derived args", async () => {
    await asUser();
    fakeModel("```json\n" + JSON.stringify({
      summary: "پورت اشتباه است", cause: "پورت", steps: ["پورت را درست کنید"],
      actions: [{ id: "delete_app" }, { id: "set_port", rpc: "paas.deleteApp", args: [{ port: 1 }] }, { id: "raise_plan" }, "servers.remove"],
    }) + "\n```");
    const { id, depId } = await appFailedWith("Readiness probe failed: dial tcp 10.0.0.1:3000: connect: connection refused\nlistening on 0.0.0.0:5000");
    const x = await call<Explanation>("ai.explain", "paas", id, depId);
    expect(x.simulated).toBe(false);
    expect(x.actions.map((a) => a.id)).toEqual(["set_port", "ticket"]);
    expect(x.actions[0].rpc).toBe("paas.updateApp");
    const [row] = await (await db()).select().from(aiExplanations).where(eq(aiExplanations.id, x.id));
    expect(row.actions[0].calls[0]).toEqual(["paas.updateApp", [id, { port: 5000 }]]);
    // a fair price from the reported usage, at least the minimum fee
    expect(x.charged).toBeGreaterThanOrEqual(EXPLAIN_MIN_FEE);
  });

  it("a failed or unusable model answer falls back to the rules and costs nothing", async () => {
    await asUser();
    fakeModel("I cannot help with that");
    const { id, depId } = await appFailedWith("pod web-1: container app OOMKilled (exit code 137)");
    const b0 = await balance();
    const x = await call<Explanation>("ai.explain", "paas", id, depId);
    expect(x).toMatchObject({ simulated: true, charged: 0 });
    expect(x.summary).toContain("حافظه");
    expect(await balance()).toBe(b0);
  });

  it("ownership: another user's resource cannot be explained or fixed", async () => {
    await asUser();
    const appId = await call<string>("paas.createApp", gitApp("mine-only", "https://github.com/acme/sim-badport.git"));
    await settle();
    const dep = await failedDep(appId);
    const x = await call<Explanation>("ai.explain", "paas", appId, dep.id);
    expect(await fails("ai.explain", "vps", "srv-1200", "provision")).toContain("پیدا نشد");
    // a deployment of another app cannot be passed as the error of this one
    expect(await fails("ai.explain", "paas", "app-demo1", dep.id)).toContain("پیدا نشد");
    await asAdmin();
    expect(await fails("ai.explain", "paas", appId, dep.id)).toContain("پیدا نشد");
    expect(await fails("ai.applyFix", x.id, "set_port")).toContain("پیدا نشد");
  });
});

describe("explain: cloud servers, databases, error toasts", () => {
  it("a failed server task: explanation, a safe retry, and a ticket pre-filled with the AI summary", async () => {
    await asUser();
    const d = await db();
    await d.insert(serverTasks).values({ id: "tk-fail-1", serverId: "srv-1101", action: "روشن کردن: وضعیت پس از چند دقیقه تأیید نشد (اکنون خاموش)", status: "failed" });
    const x = await call<Explanation>("ai.explain", "vps", "srv-1101", "t-tk-fail-1");
    const ids = x.actions.map((a) => a.id);
    expect(ids).toContain("retry_power");
    expect(ids).toContain("ticket");
    expect(ids).not.toContain("set_port");
    await call("ai.applyFix", x.id, "ticket");
    const [t] = await d.select().from(tickets).where(eq(tickets.userId, "u1")).orderBy(desc(tickets.createdAt)).limit(1);
    const msgs = await d.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id));
    expect(msgs[0].text).toContain(x.summary);
    expect(t.service).toBe("srv-1101");
    expect(await fails("ai.explain", "vps", "srv-1101", "t-nope")).toContain("خطایی ندارد");
  });

  it("a failed database import: explanation with restart and ticket", async () => {
    await asUser();
    const dbId = await call<string>("paas.createDb", { name: "explain-db", engine: "postgres", version: "17", planId: "db-micro" });
    await settle();
    const d = await db();
    await d.insert(paasDbImports).values({ id: "dbi-x1", dbId, format: "sql", filePath: "/tmp/none.sql", status: "failed", output: "psql: ERROR: relation \"orders\" already exists" });
    const x = await call<Explanation>("ai.explain", "dbaas", dbId, "imp-dbi-x1");
    expect(x.cause).toContain("وجود دارند");
    expect(x.actions.map((a) => a.id)).toEqual(expect.arrayContaining(["ticket"]));
    const ev = await call<Explanation>("ai.explain", "dbaas", dbId, "status").catch((e: Error) => e.message);
    expect(typeof ev === "string" ? ev : ev.summary).toBeTruthy();
    await d.insert(paasDbEvents).values({ dbId, level: "error", message: "connection refused: the server is not accepting connections" });
    const [e] = await d.select().from(paasDbEvents).where(and(eq(paasDbEvents.dbId, dbId), eq(paasDbEvents.level, "error")));
    const y = await call<Explanation>("ai.explain", "dbaas", dbId, "ev-" + e.id);
    expect(y.actions[0].id).toBe("db_restart");
    await call("ai.applyFix", y.id, "db_restart");
    expect((await d.select().from(paasDbs).where(eq(paasDbs.id, dbId)))[0].status).toBe("running");
  });

  it("an error toast's sealed ref explains only for its own user, without actions", async () => {
    await asUser();
    const res = await withErrorRef(Response.json({ error: "موجودی کیف پول کافی نیست؛ برای شروع دست‌کم ۱۰ تومان لازم است." }, { status: 402 }), "u1", "paas.createApp");
    const j = (await res.json()) as { error: string; ref: string };
    expect(j.ref).toBeTruthy();
    const x = await call<Explanation>("ai.explain", "rpc", "paas.createApp", j.ref);
    expect(x.summary).toContain("کیف پول");
    expect(x.actions).toEqual([]);
    expect(await fails("ai.explain", "rpc", "paas.deploy", j.ref)).toContain("قابل توضیح نیست");
    expect(await fails("ai.explain", "rpc", "paas.createApp", rpcErrorRef("u2", "paas.createApp", "x"))).toContain("قابل توضیح نیست");
    await asAdmin();
    expect(await fails("ai.explain", "rpc", "paas.createApp", j.ref)).toContain("قابل توضیح نیست");
  });

  it("not enough balance for the explanation itself is refused before any model call", async () => {
    await asUser();
    const d = await db();
    await d.insert(serverTasks).values({ id: "tk-fail-2", serverId: "srv-1101", action: "There are no free IPs in the IP pool", status: "failed" });
    await d.update(users).set({ balance: 10 }).where(eq(users.id, "u1"));
    expect(await fails("ai.explain", "vps", "srv-1101", "t-tk-fail-2")).toContain("موجودی");
  });
});

describe("simulator", () => {
  const s = (t: string, kind: Parameters<typeof simulateExplain>[0] = "paas", f = {}) => simulateExplain(kind, t, f);
  it("explains the common errors deterministically", () => {
    expect(s("pod a: app ImagePullBackOff — Back-off pulling image").summary).toContain("ایمیج");
    expect(s("container app OOMKilled (exit code 137)", "paas", { nextPlan: "کوچک", ramMb: 512 })).toMatchObject({ prefer: expect.arrayContaining(["raise_plan"]) });
    expect(s("Readiness probe failed: connect: connection refused", "paas", { port: 3000, listeningPort: 8080 }).summary).toContain("۸۰۸۰");
    expect(s("Back-off restarting failed container; CrashLoopBackOff").summary).toContain("از کار می‌افتد");
    expect(s("Error: Missing required environment variable DB_URL", "paas", { missingEnv: "DB_URL" }).summary).toContain("DB_URL");
    expect(s("npm ERR! code ERESOLVE").summary).toContain("وابستگی");
    expect(s("Error from server (Forbidden): pods is forbidden: User \"system:serviceaccount:app\" cannot list resource").summary).toContain("۴۰۳");
    expect(s("Virtualizor managevps: You cannot shrink the disk space of a vps", "vps").summary).toContain("کوچک");
    expect(s("Virtualizor addvs: There are no free IPs in the IP pool of the server", "vps").summary).toContain("IP");
    expect(s("موجودی کیف پول کافی نیست؛ برای شروع دست‌کم ۱۰ تومان لازم است.", "rpc").summary).toContain("کیف پول");
    expect(s("something odd happened").summary).toContain("الگوی");
  });
});
