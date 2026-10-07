import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { context } from "@/server/ctx";
import { paasApps, paasDbs, paasDeployments, transactions, users } from "@/server/db/schema";
import { appSpec } from "@/server/paas/service";
import { buildState } from "@/server/state";
import { paasBilling } from "@/server/worker/paas";
import { drain } from "@/server/worker";
import { asAdmin, asUser, call, db, fails, fresh, jar } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);

const gitApp = (over: Record<string, unknown> = {}) => ({ name: "my-api", stack: "node", source: "git", gitUrl: "https://github.com/acme/api.git", gitBranch: "main", port: 3000, planId: "app-micro", env: [{ key: "LOG_LEVEL", value: "info", secret: false }, { key: "API_KEY", value: "s3cret", secret: true }], ...over });
const state = async () => { const c = await context(); return buildState(c.db, c.auth, c.auth?.user.role === "admin" && c.auth.uid === c.auth.user.id ? "admin" : "customer"); };
const settle = async () => { for (let i = 0; i < 10; i++) if (!(await drain(await db()))) break; };

describe("apps", () => {
  it("git app: build → release → live, with secret env hidden from the panel", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    const s = await state();
    const app = s.db.paasApps.find((a) => a.id === id)!;
    expect(app).toMatchObject({ status: "running", url: "https://my-api.gereh.app" });
    expect(app.deployments[0]).toMatchObject({ status: "live", trigger: "create", image: true });
    expect(app.env).toEqual([{ key: "API_KEY", secret: true, value: null }, { key: "LOG_LEVEL", secret: false, value: "info" }]);
    const log = await call<{ log: string }>("paas.deployment", app.deployments[0].id);
    expect(log.log).toContain("==> Live");
    const spec = await appSpec(await db(), (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0]);
    expect(spec.env).toMatchObject({ API_KEY: "s3cret", LOG_LEVEL: "info", PORT: "3000", GEREH_APP: "my-api" });
  });

  it("validates names, sources, reserved env vars and uniqueness", async () => {
    await asUser();
    expect(await fails("paas.createApp", gitApp({ name: "My_App" }))).toContain("حروف کوچک");
    expect(await fails("paas.createApp", gitApp({ name: "admin" }))).toContain("رزرو");
    expect(await fails("paas.createApp", gitApp({ gitUrl: "file:///etc/passwd" }))).toContain("گیت");
    expect(await fails("paas.createApp", gitApp({ env: [{ key: "PORT", value: "1", secret: false }] }))).toContain("PORT");
    expect(await fails("paas.createApp", gitApp({ source: "zip" }))).toContain("بارگذاری");
    expect(await fails("paas.createApp", gitApp({ name: "novin-shop" }))).toContain("گرفته");
  });

  it("a failed first build marks the app failed; a failed later build keeps the live version", async () => {
    await asUser();
    const bad = await call<string>("paas.createApp", gitApp({ name: "broken-app", gitUrl: "https://github.com/acme/fail.git" }));
    await settle();
    let s = await state();
    expect(s.db.paasApps.find((a) => a.id === bad)!.status).toBe("failed");
    expect((await call<{ log: string }>("paas.deployment", s.db.paasApps.find((a) => a.id === bad)!.deployments[0].id)).log).toContain("ERROR");

    const good = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.updateApp", good, { gitUrl: "https://github.com/acme/fail.git" });
    await call("paas.deploy", good, {});
    await settle();
    s = await state();
    const app = s.db.paasApps.find((a) => a.id === good)!;
    expect(app.status).toBe("running");
    expect(app.deployments.map((d) => d.status)).toEqual(["failed", "live"]);
  });

  it("rollback re-releases an earlier image without building", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.deploy", id, {});
    await settle();
    let app = (await state()).db.paasApps.find((a) => a.id === id)!;
    const first = app.deployments[1];
    expect(first.status).toBe("superseded");
    await call("paas.rollback", id, first.id);
    await settle();
    app = (await state()).db.paasApps.find((a) => a.id === id)!;
    expect(app.deployments[0]).toMatchObject({ status: "live", trigger: "rollback" });
    expect(await fails("paas.rollback", id, app.deployments[0].id)).toContain("فعال");
  });

  it("env changes re-release the live image as a config deployment", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.setEnv", id, [{ key: "FEATURE_X", value: "on", secret: false }, { key: "API_KEY", value: "", secret: true }], ["LOG_LEVEL"]);
    await settle();
    const app = (await state()).db.paasApps.find((a) => a.id === id)!;
    expect(app.env.map((e) => e.key)).toEqual(["API_KEY", "FEATURE_X"]);
    expect(app.deployments[0]).toMatchObject({ trigger: "config", status: "live" });
    const spec = await appSpec(await db(), (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0]);
    expect(spec.env.API_KEY).toBe("s3cret"); // empty secret value = keep
  });

  it("scaling validates disk and instances; power and delete", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp({ diskGb: 5 }));
    await settle();
    expect(await fails("paas.scale", id, { planId: "app-small", instances: 1, autoscale: false, maxInstances: 1, diskGb: 2 })).toContain("کم");
    expect(await fails("paas.scale", id, { planId: "app-small", instances: 3, autoscale: false, maxInstances: 3, diskGb: 5 })).toContain("یک نمونه");
    await call("paas.scale", id, { planId: "app-small", instances: 1, autoscale: false, maxInstances: 1, diskGb: 10 });
    await call("paas.power", id, "stop");
    expect((await state()).db.paasApps.find((a) => a.id === id)!.status).toBe("stopped");
    expect(await fails("paas.deleteApp", id, "wrong")).toContain("نام");
    await call("paas.deleteApp", id, "my-api");
    expect((await state()).db.paasApps.find((a) => a.id === id)).toBeUndefined();
  });

  it("custom domains: platform subdomains rejected, valid ones verified", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    expect(await fails("paas.addDomain", id, "evil.gereh.app")).toContain("پلتفرم");
    expect(await fails("paas.addDomain", id, "not a domain")).toContain("معتبر");
    await call("paas.addDomain", id, "api.acme.ir");
    await call("paas.addDomain", id, "api.example.com"); // simulator: never resolves
    const app = (await state()).db.paasApps.find((a) => a.id === id)!;
    expect(app.domains.map((d) => [d.host, d.status])).toEqual([["api.acme.ir", "active"], ["api.example.com", "pending"]]);
    expect(await fails("paas.addDomain", id, "api.acme.ir")).toContain("متصل");
  });

  it("customers never see or touch another customer's app", async () => {
    await asUser();
    expect(await fails("paas.deploy", "app-demo1x", {})).toContain("پیدا نشد");
    jar.clear();
    await call("auth.register", { name: "دیگری", email: "other@example.com", phone: "09351112299", password: "Abcdefg1" });
    const s = await state();
    expect(s.db.paasApps).toEqual([]);
    expect(await fails("paas.deploy", "app-demo1", {})).toContain("پیدا نشد");
    expect(await fails("paas.logs", "app-demo1", 50)).toContain("پیدا نشد");
    expect(await fails("paas.dbCredentials", "pdb-demo1")).toContain("پیدا نشد");
  });

  it("staff see all apps but never env values", async () => {
    await asAdmin();
    const s = await state();
    const demo = s.db.paasApps.find((a) => a.id === "app-demo1")!;
    expect(demo.env.every((e) => e.value === null)).toBe(true);
    expect(demo.hookUrl).toBe("");
    expect(s.db.paasDriver).toBe("simulator");
  });
});

describe("databases", () => {
  it("create → running; credentials; link injects DATABASE_URL; delete blocked while linked", async () => {
    await asUser();
    const dbId = await call<string>("paas.createDb", { name: "orders", engine: "postgres", version: "16", planId: "db-micro" });
    await settle();
    const d = (await state()).db.paasDbs.find((x) => x.id === dbId)!;
    expect(d).toMatchObject({ status: "running", engine: "postgres", port: 5432, username: "u_orders" });
    const cred = await call<{ password: string; url: string }>("paas.dbCredentials", dbId);
    expect(cred.url).toBe("postgresql://u_orders:" + encodeURIComponent(cred.password) + "@" + d.host + ":5432/orders");

    const appId = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.link", appId, dbId);
    const spec = await appSpec(await db(), (await (await db()).select().from(paasApps).where(eq(paasApps.id, appId)))[0]);
    expect(spec.env.DATABASE_URL).toBe(cred.url);
    expect(await fails("paas.setEnv", appId, [{ key: "DATABASE_URL", value: "x", secret: false }], [])).toContain("پایگاه داده");
    expect(await fails("paas.deleteDb", dbId, "orders")).toContain("متصل");
    await call("paas.unlink", appId, dbId);
    await call("paas.deleteDb", dbId, "orders");
  });

  it("validates engine versions and downsizing; backups and restore", async () => {
    await asUser();
    expect(await fails("paas.createDb", { name: "cache", engine: "redis", version: "6", planId: "db-micro" })).toContain("نسخه");
    expect(await fails("paas.createDb", { name: "cache", engine: "redis", version: "7.4", planId: "app-micro" })).toContain("پلن");
    expect(await fails("paas.updateDb", "pdb-demo1", { planId: "db-micro" })).toContain("کوچک");
    const bk = await call<string>("paas.backupDb", "pdb-demo1");
    await settle();
    const d = (await state()).db.paasDbs.find((x) => x.id === "pdb-demo1")!;
    expect(d.backupList.find((b) => b.id === bk)).toMatchObject({ kind: "manual", status: "done" });
    await call("paas.restoreDb", bk);
    await settle();
  });
});

describe("billing", () => {
  it("charges hourly; out of credit suspends everything; top-up resumes", async () => {
    const d = await db();
    const [before] = await d.select({ b: users.balance }).from(users).where(eq(users.id, "u1"));
    await paasBilling(d);
    const [after] = await d.select({ b: users.balance }).from(users).where(eq(users.id, "u1"));
    // demo: app-small × 2 + db-small, billed per hour
    expect(before.b - after.b).toBe(Math.ceil(229_000 * 2 / 720) + Math.ceil(289_000 / 720));
    expect((await d.select().from(transactions).where(eq(transactions.userId, "u1"))).some((t) => t.desc.startsWith("مصرف ساعتی گره اپ"))).toBe(true);

    await d.update(users).set({ balance: 10 }).where(eq(users.id, "u1"));
    await paasBilling(d);
    expect((await d.select().from(paasApps).where(eq(paasApps.id, "app-demo1")))[0].status).toBe("suspended");
    expect((await d.select().from(paasDbs).where(eq(paasDbs.id, "pdb-demo1")))[0].status).toBe("suspended");
    await asUser();
    expect(await fails("paas.deploy", "app-demo1", {})).toContain("معلق");

    await d.update(users).set({ balance: 50_000_000 }).where(eq(users.id, "u1"));
    await paasBilling(d);
    expect((await d.select().from(paasApps).where(eq(paasApps.id, "app-demo1")))[0].status).toBe("running");
    expect((await d.select().from(paasDbs).where(eq(paasDbs.id, "pdb-demo1")))[0].status).toBe("running");
  });

  it("creating needs 24 hours of credit", async () => {
    const d = await db();
    await d.update(users).set({ balance: 100 }).where(eq(users.id, "u1"));
    await asUser();
    expect(await fails("paas.createApp", gitApp())).toContain("موجودی");
  });
});

describe("git webhook", () => {
  const hook = async (token: string, body: object) => {
    const { POST } = await import("@/app/api/paas/hook/[app]/route");
    return POST(new Request("http://x/api/paas/hook/app-demo1?token=" + token, { method: "POST", body: JSON.stringify(body), headers: { "x-github-event": "push" } }), { params: Promise.resolve({ app: "app-demo1" }) });
  };
  it("rejects bad tokens, ignores other branches, deploys pushes to the app's branch", async () => {
    await db();
    expect((await hook("nope", {})).status).toBe(403);
    expect(await (await hook("demo-hook-token-novin-shop-000000", { ref: "refs/heads/dev" })).json()).toMatchObject({ skipped: "branch dev" });
    const r = await (await hook("demo-hook-token-novin-shop-000000", { ref: "refs/heads/main", head_commit: { id: "abcdef1234567", message: "Ship it\n\nlong body" } })).json();
    expect(r.deployment).toMatch(/^dep-/);
    const [dep] = await (await db()).select().from(paasDeployments).where(eq(paasDeployments.id, r.deployment));
    expect(dep).toMatchObject({ trigger: "git", ref: "abcdef1", message: "Ship it" });
  });
});

describe("zip upload", () => {
  it("stores the archive per user, detects the stack and deploys from it", async () => {
    const { POST } = await import("@/app/api/paas/upload/route");
    const { zip } = await import("@/server/xlsx");
    await asUser();
    const z = zip([["site/package.json", Buffer.from('{"dependencies":{"next":"16"}}')], ["site/app/page.tsx", Buffer.from("export default 1")]]);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(z)], "site.zip", { type: "application/zip" }));
    const res = await POST(new Request("http://x/api/paas/upload", { method: "POST", body: form, headers: { origin: "http://x", host: "x" } }));
    const j = await res.json();
    expect(j.result).toMatchObject({ stack: "nextjs", files: 2 });
    const id = await call<string>("paas.createApp", gitApp({ name: "zip-site", source: "zip", gitUrl: "", stack: "nextjs", uploadId: j.result.uploadId }));
    await settle();
    expect((await state()).db.paasApps.find((a) => a.id === id)!.status).toBe("running");
    // another customer cannot use this upload id
    jar.clear();
    await call("auth.register", { name: "دیگری", email: "other2@example.com", phone: "09351112298", password: "Abcdefg1" });
    await (await db()).update(users).set({ balance: 10_000_000 }).where(eq(users.email, "other2@example.com"));
    expect(await fails("paas.createApp", gitApp({ name: "stolen", source: "zip", gitUrl: "", uploadId: j.result.uploadId }))).toContain("پیدا نشد");
  });
  it("rejects non-zip files", async () => {
    const { POST } = await import("@/app/api/paas/upload/route");
    await asUser();
    const form = new FormData();
    form.set("file", new File(["hello world, not a zip"], "x.zip"));
    const res = await POST(new Request("http://x/api/paas/upload", { method: "POST", body: form, headers: { origin: "http://x", host: "x" } }));
    expect(res.status).toBe(400);
  });
});

describe("public API and CLI flow", () => {
  const v1 = async (method: string, path: string, token: string, body?: unknown) => {
    const mod = await import("@/app/api/v1/[[...path]]/route");
    const fn = mod[method as "GET" | "POST" | "PUT"];
    const res = await fn(new Request("http://x/api/v1/" + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ path: path.split("/") }) } as never);
    return { status: res.status, body: await res.json() };
  };

  it("lists apps by name, deploys, reads the build log and sets env", async () => {
    await asUser();
    const rw = await call<string>("account.createToken", { name: "cli", scope: "read-write", expires: "۹۰ روز" });
    const list = await v1("GET", "apps", rw);
    expect(list.body.data.map((a: { name: string }) => a.name)).toEqual(["novin-shop"]);
    expect(list.body.data[0]).toMatchObject({ url: "https://novin-shop.gereh.app", status: "running", instances: 2 });
    const dep = await v1("POST", "apps/novin-shop/deployments", rw, { message: "from ci", via: "cli" });
    expect(dep.body).toMatchObject({ status: "queued" });
    await settle();
    const d = await v1("GET", "apps/novin-shop/deployments/" + dep.body.id, rw);
    expect(d.body).toMatchObject({ status: "live", trigger: "cli", message: "from ci" });
    expect(d.body.log).toContain("==> Live");
    const env = await v1("PUT", "apps/novin-shop/env", rw, { vars: { FEATURE_X: "on", NODE_ENV: null }, secret: [] });
    expect(env.body).toMatchObject({ ok: true, set: ["FEATURE_X"], removed: ["NODE_ENV"] });
    expect((await v1("PUT", "apps/novin-shop/env", rw, { vars: { DATABASE_URL: "x" } })).status).toBe(422); // owned by the db link
    expect((await v1("GET", "apps/someone-else", rw)).status).toBe(404);
    const ro = await call<string>("account.createToken", { name: "ro", scope: "read", expires: "۳۰ روز" });
    expect((await v1("POST", "apps/novin-shop/deployments", ro, {})).status).toBe(403);
    expect((await v1("GET", "apps/novin-shop/logs", ro)).body.lines.length).toBeGreaterThan(0);
  });

  it("uploads a ZIP with a bearer token (CLI) but not with a read-only one", async () => {
    const { POST } = await import("@/app/api/paas/upload/route");
    const { zip } = await import("@/server/xlsx");
    await asUser();
    const rw = await call<string>("account.createToken", { name: "cli", scope: "read-write", expires: "۹۰ روز" });
    const ro = await call<string>("account.createToken", { name: "ro", scope: "read", expires: "۳۰ روز" });
    const send = async (token: string) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(zip([["go.mod", Buffer.from("module x")], ["main.go", Buffer.from("package main")]]))], "p.zip"));
      jar.clear(); // no session cookie: token only
      const res = await POST(new Request("http://x/api/paas/upload", { method: "POST", body: form, headers: { authorization: "Bearer " + token } }));
      return { status: res.status, body: await res.json() };
    };
    expect((await send(ro)).status).toBe(403);
    const ok = await send(rw);
    expect(ok.body.result).toMatchObject({ stack: "go", files: 2 });
  });
});

describe("docker compose", () => {
  const upload = async (files: [string, Buffer][]) => {
    const { POST } = await import("@/app/api/paas/upload/route");
    const { zip } = await import("@/server/xlsx");
    const form = new FormData();
    form.set("file", new File([new Uint8Array(zip(files))], "stack.zip"));
    const res = await POST(new Request("http://x/api/paas/upload", { method: "POST", body: form, headers: { origin: "http://x", host: "x" } }));
    return (await res.json()).result as { uploadId: string; stack: string };
  };

  it("parses the stack, lists services in the build log and goes live", async () => {
    await asUser();
    const up = await upload([["stack/docker-compose.yml", Buffer.from("services:\n  web:\n    build: .\n    ports: ['3000']\n  cache:\n    image: redis:7-alpine\n    volumes: ['c:/data']\n")], ["stack/Dockerfile", Buffer.from("FROM node:22")]]);
    expect(up.stack).toBe("compose");
    const id = await call<string>("paas.createApp", gitApp({ name: "stack-app", source: "compose", gitUrl: "", stack: "compose", uploadId: up.uploadId }));
    await settle();
    const app = (await state()).db.paasApps.find((a) => a.id === id)!;
    expect(app.status).toBe("running");
    const log = (await call<{ log: string }>("paas.deployment", app.deployments[0].id)).log;
    expect(log).toContain("* web (build .) :3000");
    expect(log).toContain("WARN cache: volumes");
    const [dep] = await (await db()).select().from(paasDeployments).where(eq(paasDeployments.appId, id));
    expect(JSON.parse(dep.image.slice(8)).map((s: { name: string; image: string }) => s.image)).toEqual([expect.stringContaining("stack-app-web:"), "redis:7-alpine"]);
  });

  it("an invalid compose file fails the deployment with the reason", async () => {
    await asUser();
    const up = await upload([["docker-compose.yml", Buffer.from("services:\n  worker:\n    image: busybox\n")]]);
    const id = await call<string>("paas.createApp", gitApp({ name: "bad-stack", source: "compose", gitUrl: "", stack: "compose", uploadId: up.uploadId }));
    await settle();
    const app = (await state()).db.paasApps.find((a) => a.id === id)!;
    expect(app.status).toBe("failed");
    expect((await call<{ log: string }>("paas.deployment", app.deployments[0].id)).log).toContain("ports");
  });
});
