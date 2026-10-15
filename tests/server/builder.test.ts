import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { filesError, guessStack, pathError, type BuilderEvent, type BuilderProjectView } from "@/lib/builder";
import { setAiUpstream } from "@/server/ai/upstream";
import { preflight } from "@/server/builder/deploy";
import { parseOutput, render } from "@/server/builder/format";
import { builderMaintain } from "@/server/builder/maintain";
import { projectFiles } from "@/server/builder/sim";
import { aiUsage, builderProjects, builderRuns, notifications, paasApps, paasEvents, paasLinks, users } from "@/server/db/schema";
import { MCP_TOOLS } from "@/server/mcp";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(async () => { await fresh(); setAiUpstream(null); });
afterEach(() => setAiUpstream(null));

const settle = async () => { for (let i = 0; i < 30; i++) if (!(await drain(await db()))) break; };
const balance = async (uid = "u1") => (await (await db()).select().from(users).where(eq(users.id, uid)))[0].balance;
const view = (id: string) => call<BuilderProjectView>("builder.get", id);

/** one streamed run through the real route; returns its events */
async function run(projectId: string, prompt: string) {
  const { POST } = await import("@/app/api/build/run/route");
  const res = await POST(new Request("http://x/api/build/run", { method: "POST", headers: { origin: "http://x", host: "x", "content-type": "application/json" }, body: JSON.stringify({ projectId, prompt }) }));
  if (!res.ok) return [{ type: "error", message: ((await res.json()) as { error: string }).error }] as BuilderEvent[];
  const text = await res.text();
  return text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as BuilderEvent);
}
async function preview(path: string) {
  const { GET } = await import("@/app/api/build/preview/[token]/[[...path]]/route");
  const [token, ...rest] = path.split("/");
  return GET(new Request("http://x/api/build/preview/" + path, { headers: { host: "x" } }), { params: Promise.resolve({ token, path: rest }) } as never);
}
const tokenOf = (v: BuilderProjectView) => v.previewUrl.split("/")[4];

async function newProject(prompt: string, stack: "static" | "node" | "auto" = "auto") {
  const id = await call<string>("builder.create", { prompt, stack });
  const ev = await run(id, prompt);
  expect(ev.at(-1)?.type).toBe("done");
  return id;
}

describe("builder: rules and parsing", () => {
  it("validates paths and project size", () => {
    expect(pathError("index.html")).toBeNull();
    expect(pathError("public/app.js")).toBeNull();
    expect(pathError("/etc/passwd")).toContain("مطلق");
    expect(pathError("../x.js")).toContain("..");
    expect(pathError("a/../../x.js")).toContain("..");
    expect(pathError(".env")).not.toBeNull();
    expect(pathError("node_modules/x/index.js")).toContain("node_modules");
    expect(pathError("run.sh")).toContain("پسوند");
    expect(pathError("C:/x.js")).not.toBeNull();
    expect(filesError({ "a.html": "x".repeat(250_000) })).toContain("۲۰۰");
    expect(filesError(Object.fromEntries(Array.from({ length: 70 }, (_, i) => ["f" + i + ".js", "1"])))).toContain("تعداد");
    expect(guessStack("فرم ثبت‌نام رویداد")).toBe("node");
    expect(guessStack("لندینگ معرفی")).toBe("static");
  });

  it("parses the output format robustly", () => {
    const p = parseOutput('<plan>\n- یک\n</plan>\nnoise\n<file path="index.html">\n```html\n<h1>سلام</h1>\n```\n</file>\n<file path=\'assets/app.js\'>\nconsole.log(1)\n</file>\n<delete path="old.css" />\n<summary>\nانجام شد <b>!</b>\n</summary>');
    expect(p.files).toEqual({ "index.html": "<h1>سلام</h1>", "assets/app.js": "console.log(1)" });
    expect(p.deletes).toEqual(["old.css"]);
    expect(p.plan).toBe("- یک");
    expect(p.summary).toBe("انجام شد !");
    const cut = parseOutput('<file path="a.html">\nok\n</file>\n<file path="b.html">\nhalf');
    expect(cut.files).toEqual({ "a.html": "ok" });
    expect(cut.truncated).toEqual(["b.html"]);
    const json = parseOutput('```json\n{"files":[{"path":"index.html","content":"<p>x</p>"}],"summary":"خوب"}\n```');
    expect(json.files["index.html"]).toBe("<p>x</p>");
    expect(json.summary).toBe("خوب");
    const round = parseOutput(render({ plan: "- x", files: { "a.js": "1\n2" }, deletes: ["b.js"], summary: "s" }));
    expect(round).toMatchObject({ files: { "a.js": "1\n2" }, deletes: ["b.js"], summary: "s" });
  });

  it("pre-flight catches what would fail the build", () => {
    const node = projectFiles("سایت نوبت‌دهی", "node");
    expect(preflight(node, "node")).toBeNull();
    expect(preflight(projectFiles("سایت", "static"), "static")).toBeNull();
    expect(preflight({ ...node, "package.json": "{nope" }, "node")?.failure).toBe("deps");
    expect(preflight({ ...node, "package.json": '{"dependencies":{"express":"^4"}}' }, "node")?.failure).toBe("start");
    expect(preflight({ ...node, "package.json": '{"scripts":{"start":"node server.js"},"dependencies":{"express":"^4"}}' }, "node")?.log).toContain("Cannot find module 'pg'");
    expect(preflight({ "about.html": "x" }, "static")?.failure).toBe("health");
  });
});

describe("builder: generate, edit, versions", () => {
  it("generates a project: streamed, files saved, billed through the AI wallet path", async () => {
    await asUser();
    const before = await balance();
    const id = await call<string>("builder.create", { prompt: "یک سایت نوبت‌دهی برای سالن آرایش", stack: "static" });
    const ev = await run(id, "یک سایت نوبت‌دهی برای سالن آرایش");
    expect(ev[0]).toMatchObject({ type: "run" });
    expect(ev.some((e) => e.type === "status")).toBe(true);
    expect(ev.some((e) => e.type === "plan")).toBe(true);
    expect(ev.filter((e) => e.type === "file").map((e) => (e as { path: string }).path)).toEqual(expect.arrayContaining(["index.html", "assets/app.js"]));
    const done = ev.at(-1) as Extract<BuilderEvent, { type: "done" }>;
    expect(done.type).toBe("done");
    expect(done.charged).toBeGreaterThan(0);
    const v = await view(id);
    expect(v).toMatchObject({ version: 1, status: "ready", stack: "static" });
    expect(v.tree.map((f) => f.path)).toEqual(expect.arrayContaining(["index.html", "assets/app.js", "assets/style.css"]));
    expect(v.runs[0]).toMatchObject({ kind: "generate", status: "succeeded" });
    expect(v.runs[0].cost).toBe(done.charged);
    expect(v.spent).toBe(done.charged);
    expect(v.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await balance()).toBe(before - done.charged);
    const usage = await (await db()).select().from(aiUsage).where(and(eq(aiUsage.userId, "u1"), eq(aiUsage.format, "panel")));
    expect(usage.some((u) => u.charged === done.charged && u.status === "success")).toBe(true);
    const html = await call<string>("builder.file", id, "index.html");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("سالن زیبایی");
  });

  it("edits only the changed files as a new version, and restores old versions", async () => {
    await asUser();
    const id = await newProject("لندینگ معرفی رستوران", "static");
    const v1 = await call<string>("builder.file", id, "index.html");
    const ev = await run(id, "رنگ سایت را سبز کن و بخش سؤالات متداول اضافه کن");
    const done = ev.at(-1) as Extract<BuilderEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", version: 2 });
    expect(done.diff).toEqual({ added: [], changed: ["index.html"], deleted: [] });
    const v = await view(id);
    expect(v.runs[0]).toMatchObject({ kind: "edit", status: "succeeded", diff: { changed: ["index.html"] } });
    expect(v.versions.map((x) => x.version)).toEqual([2, 1]);
    const v2 = await call<string>("builder.file", id, "index.html");
    expect(v2).toContain('id="faq"');
    expect(v2).toContain("#10b981");
    expect(await call<string>("builder.file", id, "assets/app.js")).toBe(await call<string>("builder.file", id, "assets/app.js", 1));
    // manual edit, then restore version 1 as version 4
    expect(await call<number>("builder.saveFile", id, "assets/style.css", "body{}")).toBe(3);
    expect(await fails("builder.saveFile", id, "../x.css", "a")).toContain("..");
    expect(await call<number>("builder.restore", id, 1)).toBe(4);
    expect(await call<string>("builder.file", id, "index.html")).toBe(v1);
  });

  it("refuses with a clear message when the wallet cannot cover the run", async () => {
    await asUser();
    const id = await call<string>("builder.create", { prompt: "فروشگاه ساده لباس", stack: "static" });
    await (await db()).update(users).set({ balance: 500 }).where(eq(users.id, "u1"));
    const ev = await run(id, "فروشگاه ساده لباس");
    expect(ev.at(-1)).toMatchObject({ type: "error" });
    expect((ev.at(-1) as { message: string }).message).toContain("موجودی کیف پول کافی نیست");
    const v = await view(id);
    expect(v.version).toBe(0);
    expect(v.runs[0]).toMatchObject({ status: "failed" });
    expect(await balance()).toBe(500);
  });

  it("serves the preview with a sandbox CSP and keeps projects private", async () => {
    await asUser();
    const id = await newProject("فرم ثبت‌نام رویداد", "node");
    const v = await view(id);
    const token = tokenOf(v);
    const res = await preview(token + "/index.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("sandbox allow-scripts allow-forms");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(await res.text()).toContain("همایش");
    expect((await preview(token + "/app.js")).status).toBe(200);
    expect((await preview(token + ".v1/index.html")).status).toBe(200);
    expect((await preview(token + ".v9/index.html")).status).toBe(404);
    expect((await preview(token + "/server.js")).status).toBe(404); // a node project serves public/ only
    expect((await preview("x".repeat(32) + "/index.html")).status).toBe(404);
    expect((await preview(token + "/../package.json")).status).toBe(404);
    // another customer: no access to the project, its files or its preview token
    const { jar } = await import("./helpers");
    jar.clear();
    const other = await call<{ userId: string }>("auth.register", { name: "سارا نوری", email: "sara@example.com", phone: "09351112233", password: "Abcdefg1" });
    await (await db()).update(users).set({ balance: 10_000_000 }).where(eq(users.id, other.userId));
    expect(await fails("builder.get", id)).toContain("پیدا نشد");
    expect(await fails("builder.file", id, "public/index.html")).toContain("پیدا نشد");
    expect(await fails("builder.deploy", id)).toContain("پیدا نشد");
    expect(await call<unknown[]>("builder.list")).toEqual([]);
    const ev = await run(id, "رنگ را آبی کن");
    expect(ev[0]).toMatchObject({ type: "error", message: "پروژه پیدا نشد." });
  });
});

describe("builder: deploy, auto-fix and maintenance", () => {
  it("deploys as a Gereh app with a linked database and appears in the apps list", async () => {
    await asUser();
    const id = await newProject("سایت نوبت‌دهی آرایشگاه", "node");
    const q = await view(id);
    expect(q.plan).toMatchObject({ id: "app-nano" });
    expect(q.plan!.dbMonthly).toBeGreaterThan(0);
    const r = await call<{ deploymentId: string; fixing: boolean }>("builder.deploy", id);
    expect(r.fixing).toBe(false);
    expect((await view(id)).status).toBe("deploying");
    await settle();
    const v = await view(id);
    expect(v).toMatchObject({ status: "live", deployedVersion: 1 });
    expect(v.liveUrl).toMatch(/^https:\/\/salon-[a-z0-9]{5}\./);
    expect(v.liveView).toContain("/api/build/preview/");
    const [app] = await (await db()).select().from(paasApps).where(eq(paasApps.id, v.appId!));
    expect(app).toMatchObject({ source: "zip", stack: "node", planId: "app-nano", status: "running", healthPath: "/healthz" });
    const links = await (await db()).select().from(paasLinks).where(eq(paasLinks.appId, app.id));
    expect(links).toEqual([expect.objectContaining({ envKey: "DATABASE_URL", dbId: v.dbId })]);
    expect(v.messages.at(-1)!.content).toContain("منتشر شد");
    const { paasState } = await import("@/server/paas/state");
    const st = await paasState(await db(), { uid: "u1", admin: false, domain: "gereh.dev", siteUrl: "" });
    expect(st.paasApps.find((a) => a.id === app.id)?.builder).toBe(id);
    // a second deploy reuses the app
    await run(id, "بخش گالری نمونه‌کار اضافه کن");
    await call("builder.deploy", id);
    await settle();
    expect(await (await db()).select().from(paasApps).where(eq(paasApps.userId, "u1")).then((a) => a.filter((x) => x.name.startsWith("salon-")).length)).toBe(1);
    expect((await view(id)).deployedVersion).toBe(2);
  });

  it("fixes a failed build with the AI and succeeds on the second attempt", async () => {
    await asUser();
    const id = await newProject("فرم ثبت‌نام رویداد", "node");
    // break the project: no start script, a dependency missing
    await call("builder.saveFile", id, "package.json", JSON.stringify({ name: "x", dependencies: { express: "^4.21.2" } }));
    const r = await call<{ fixing: boolean }>("builder.deploy", id);
    expect(r.fixing).toBe(true);
    expect((await view(id)).status).toBe("fixing");
    await settle();
    const v = await view(id);
    expect(v.status).toBe("live");
    expect(v.deploy?.attempt).toBe(2);
    const fix = v.runs.find((x) => x.kind === "fix")!;
    expect(fix).toMatchObject({ status: "succeeded", attempt: 1 });
    expect(fix.summary).toContain("علت خطا");
    expect(fix.diff.changed).toContain("package.json");
    const pkg = JSON.parse(await call<string>("builder.file", id, "package.json"));
    expect(pkg.scripts.start).toBe("node server.js");
    expect(pkg.dependencies.pg).toBeTruthy();
    expect(v.messages.some((m) => m.content.includes("رفع خودکار"))).toBe(true);
  });

  it("gives up after three failed fixes", async () => {
    await asUser();
    const id = await newProject("لندینگ معرفی", "static");
    await call("builder.saveFile", id, "home.html", "<p>x</p>");
    await call("builder.saveFile", id, "index.html", null);
    // a model whose "fixes" never change anything
    const sse = (text: string) => new Response("data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    setAiUpstream({ name: "http", chat: async () => sse("<plan>- بررسی</plan>\n<summary>علت روشن نیست.</summary>"), models: async () => [] });
    expect((await call<{ fixing: boolean }>("builder.deploy", id)).fixing).toBe(true);
    expect(await fails("builder.deploy", id)).toContain("در جریان");
    await settle();
    const v = await view(id);
    expect(v.status).toBe("failed");
    expect(v.runs.filter((r) => r.kind === "fix").map((r) => r.attempt).sort()).toEqual([1, 2, 3]);
    expect(v.messages.at(-1)!.content).toContain("ناموفق ماند");
    expect(v.appId).toBeNull(); // never reached the platform
  });

  it("the maintenance agent diagnoses a crash, notifies the owner and can apply its patch", async () => {
    await asUser();
    const id = await newProject("سایت نوبت‌دهی آرایشگاه", "node");
    const server = await call<string>("builder.file", id, "server.js");
    await call("builder.saveFile", id, "server.js", server.replace(/process\.on\("unhandledRejection"[^\n]*\n/, "").replace(/process\.on\("uncaughtException"[^\n]*\n/, ""));
    await call("builder.deploy", id);
    await settle();
    const v = await view(id);
    expect(v.status).toBe("live");
    const d = await db();
    await d.update(builderProjects).set({ checkedAt: new Date(Date.now() - 60_000) }).where(eq(builderProjects.id, id));
    await d.insert(paasEvents).values({ appId: v.appId!, kind: "crash", message: "container exited with code 1; restarted" });
    await builderMaintain(d);
    const [m] = await d.select().from(builderRuns).where(and(eq(builderRuns.projectId, id), eq(builderRuns.kind, "maintain")));
    expect(m).toMatchObject({ status: "succeeded", incident: "crash", applied: false });
    expect(m.summary).toContain("علت احتمالی");
    expect(Object.keys(m.patch ?? {})).toEqual(["server.js"]);
    const notes = await d.select().from(notifications).where(eq(notifications.userId, "u1"));
    expect(notes.some((n) => n.text.includes("عامل نگهداری"))).toBe(true);
    // the same incident window does not run twice
    await d.insert(paasEvents).values({ appId: v.appId!, kind: "crash", message: "again" });
    await builderMaintain(d);
    expect((await d.select().from(builderRuns).where(and(eq(builderRuns.projectId, id), eq(builderRuns.kind, "maintain")))).length).toBe(1);
    // one click: patch → new version → deploy
    const before = (await view(id)).version;
    expect(await call<number>("builder.applyPatch", id, m.id)).toBe(before + 1);
    await settle();
    const after = await view(id);
    expect(after).toMatchObject({ status: "live", deployedVersion: before + 1 });
    expect(await call<string>("builder.file", id, "server.js")).toContain("unhandledRejection");
    expect(await fails("builder.applyPatch", id, m.id)).toContain("قبلاً");
    // the manual health check
    const hc = await call<{ kind: string; incident: string; summary: string }>("builder.healthCheck", id);
    expect(hc).toMatchObject({ kind: "maintain", incident: "manual" });
    expect(hc.summary).toContain("اپ سالم است");
  });

  it("auto-maintenance applies the patch and redeploys by itself", async () => {
    await asUser();
    const id = await newProject("فرم ثبت‌نام رویداد", "node");
    const server = await call<string>("builder.file", id, "server.js");
    await call("builder.saveFile", id, "server.js", server.replace(/\napp\.get\("\/healthz"[^\n]*\n/, "\n"));
    await call("builder.deploy", id);
    await settle();
    await call("builder.update", id, { autoMaintain: true });
    const v = await view(id);
    const d = await db();
    await d.update(builderProjects).set({ checkedAt: new Date(Date.now() - 60_000) }).where(eq(builderProjects.id, id));
    await d.insert(paasEvents).values({ appId: v.appId!, kind: "health_failed", message: "Readiness probe failed" });
    await builderMaintain(d);
    await settle();
    const after = await view(id);
    expect(after.runs.find((r) => r.kind === "maintain")).toMatchObject({ applied: true });
    expect(after).toMatchObject({ status: "live", deployedVersion: v.version + 1 });
    expect(await call<string>("builder.file", id, "server.js")).toContain("/healthz");
  });
});

describe("builder: MCP", () => {
  it("offers builder tools over the public API", async () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["builder_create", "builder_edit", "builder_deploy", "builder_status"]));
    await asUser();
    const { callRoute } = await import("@/server/mcp");
    const { context } = await import("@/server/ctx");
    const ctx = await context();
    const out = await callRoute(ctx, "read-write", "POST", "builder/projects", { prompt: "لندینگ معرفی رستوران", stack: "static" }) as { project: { id: string; version: number; files: string[] }; run: { kind: string } };
    expect(out.project.version).toBe(1);
    expect(out.project.files).toContain("index.html");
    expect(out.run.kind).toBe("generate");
    const st = await callRoute(ctx, "read-write", "GET", "builder/projects/" + out.project.id) as { status: string };
    expect(st.status).toBe("ready");
    expect(await callRoute(ctx, "read", "POST", "builder/projects/" + out.project.id + "/deploy").catch((e: Error) => e.message)).toContain("read-only");
  });
});
