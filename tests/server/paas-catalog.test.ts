import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VERSION_ARG } from "@/lib/paas";
import { STACK_GALLERY } from "@/lib/paas-stack";
import { paasApps, paasDbs, paasLinks, paasRuntime } from "@/server/db/schema";
import { appSpec } from "@/server/paas/service";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);
const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const row = async (id: string) => (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];

describe("catalogue: templates, versions and multi-service templates", () => {
  it("one-click template with a chosen version, an @map database link and platform basic auth", async () => {
    await asUser();
    const r = await call<{ appId: string; credentials: { label: string; value: string }[] }>("paas.createFromTemplate", "nextcloud", "my-cloud", "app-small", "30-apache");
    expect(r.credentials.map((c) => c.label)).toEqual(["رمز کاربر admin"]);
    await settle();
    const app = await row(r.appId);
    expect(app.image).toBe("nextcloud:30-apache");
    const spec = await appSpec(await db(), app);
    expect(spec.env.POSTGRES_HOST).toMatch(/:5432$/);
    expect(spec.env.POSTGRES_DB).toBeTruthy();
    expect(spec.env.NEXTCLOUD_TRUSTED_DOMAINS).toBe("my-cloud.gereh.dev");
    expect(await fails("paas.createFromTemplate", "nextcloud", "other-cloud", "app-small", "1-apache")).toContain("نسخه");

    const reg = await call<{ appId: string; credentials: { label: string; value: string }[] }>("paas.createFromTemplate", "registry", "my-registry");
    expect(reg.credentials[0].value.length).toBeGreaterThan(15);
    const [rt] = await (await db()).select().from(paasRuntime).where(eq(paasRuntime.appId, reg.appId));
    expect(rt).toMatchObject({ authPath: "/", authUser: "admin" });
  });

  it("keeps the runtime version of a Git app as a build arg and rejects unknown ones", async () => {
    await asUser();
    const base = { stack: "laravel", source: "git", gitUrl: "https://github.com/acme/shop.git", gitBranch: "main", port: 80, planId: "app-micro" };
    const id = await call<string>("paas.createApp", { ...base, name: "old-php", version: "7.2" });
    const [rt] = await (await db()).select().from(paasRuntime).where(eq(paasRuntime.appId, id));
    expect(rt.buildArgs).toEqual({ [VERSION_ARG]: "7.2" });
    await settle();
    const app = await row(id);
    const log = (await call<{ log: string }>("paas.deployment", app.liveDeployment)).log;
    expect(log).toContain("PHP 7.2 from the official image");
    expect(await fails("paas.createApp", { ...base, name: "bad-php", version: "5.6" })).toContain("نسخه");
    expect(await fails("paas.createApp", { ...base, name: "n8n-app", stack: "n8n" })).toContain("اپ‌های آماده");
  });

  it("creates every app and database of a multi-service template and links them", async () => {
    await asUser();
    const yaml = STACK_GALLERY.find((g) => g.id === "n8n-queue")!.yaml;
    const r = await call<{ appIds: string[]; dbIds: string[] }>("paas.createStack", yaml, "flow");
    expect(r.appIds).toHaveLength(2);
    expect(r.dbIds).toHaveLength(2);
    await settle();
    const [main, worker] = await Promise.all(r.appIds.map(row));
    expect([main.name, worker.name]).toEqual(["flow", "flow-worker"]);
    expect(worker.startCommand).toBe("exec n8n worker");
    const a = await appSpec(await db(), main), b = await appSpec(await db(), worker);
    expect(a.env.N8N_ENCRYPTION_KEY).toBe(b.env.N8N_ENCRYPTION_KEY); // $RANDOM_STRING_key is shared
    expect(a.env.WEBHOOK_URL).toBe("https://flow.gereh.dev/");
    expect(a.env.DB_POSTGRESDB_PORT).toBe("5432");
    expect(a.env.QUEUE_BULL_REDIS_PASSWORD).toBe(b.env.QUEUE_BULL_REDIS_PASSWORD);
    const links = await (await db()).select().from(paasLinks).where(eq(paasLinks.appId, main.id));
    expect(links.map((l) => l.envKey).every((k) => k.startsWith("@map:"))).toBe(true);
    const dbs = await (await db()).select().from(paasDbs).where(eq(paasDbs.name, "flow-main"));
    expect(dbs).toHaveLength(1);
    // the names are taken now
    expect(await fails("paas.createStack", yaml, "flow")).toContain("گرفته شده");
    expect(await fails("paas.createStack", "apps: []", "other")).toContain("دست‌کم یک اپ");
  });
});

describe("public API for the CLI", () => {
  const req = (method: string, path: string, token: string, body?: unknown) =>
    new Request("http://localhost/api/v1/" + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const run = async (method: "GET" | "POST" | "PUT" | "DELETE", path: string, token: string, body?: unknown) => {
    const route = await import("@/app/api/v1/[[...path]]/route");
    const res = await route[method](req(method, path, token, body), { params: Promise.resolve({ path: path.split("?")[0].split("/") }) } as never);
    return { status: res.status, body: await res.json() };
  };

  it("exports env, runs commands, swaps the image, backs up databases and manages bucket objects", async () => {
    await asUser();
    const rw = await call<string>("account.createToken", { name: "cli", scope: "read-write", expires: "۹۰ روز" });
    const ro = await call<string>("account.createToken", { name: "ro", scope: "read", expires: "۳۰ روز" });
    const appId = await call<string>("paas.createApp", { name: "cli-app", stack: "docker", source: "image", image: "nginx:1.27", port: 80, planId: "app-micro", env: [{ key: "API_KEY", value: "s3cret", secret: true }] });
    await settle();
    expect((await run("GET", "apps/cli-app/env", ro)).status).toBe(403);
    expect((await run("GET", "apps/cli-app/env", rw)).body.dotenv).toContain("API_KEY=s3cret");
    const ex = await run("POST", "apps/cli-app/exec", rw, { command: "echo hi" });
    expect(ex.status).toBe(200);
    expect(ex.body).toHaveProperty("exit_code");
    const src = await run("PUT", "apps/cli-app/source", rw, { image: "nginx:1.29-alpine" });
    expect(src.body.deployment).toBeTruthy();
    expect((await row(appId)).image).toBe("nginx:1.29-alpine");
    expect((await run("PUT", "apps/cli-app/source", rw, { git_url: "https://github.com/a/b.git" })).status).toBe(422);
    await settle();
    const logs = await run("GET", "apps/cli-app/logs/since?since=" + new Date(Date.now() - 3600_000).toISOString(), rw);
    expect(Array.isArray(logs.body.lines)).toBe(true);
    expect((await run("POST", "apps/cli-app/deployments", rw, { no_cache: true })).body.status).toBe("queued");

    const dbId = await call<string>("paas.createDb", { name: "cli-db", engine: "postgres", version: "17", planId: "db-micro", publicAccess: false, backups: true });
    await settle();
    const bk = await run("POST", "databases/cli-db/backups", rw, {});
    expect(bk.body.status).toBe("running");
    await settle();
    expect((await run("GET", "databases/" + dbId + "/backups/" + bk.body.id, rw)).body.status).toBe("done");
    expect((await run("GET", "databases/cli-db/backups", ro)).body.data[0].id).toBe(bk.body.id);

    await call("storage.create", { name: "cli-files", planId: "st-20", access: "private" });
    const up = await run("POST", "storage/buckets/cli-files/upload-url", rw, { key: "a/b.txt", size: 5 });
    expect(up.body.url).toContain("cli-files");
    expect((await run("GET", "storage/buckets/cli-files/objects?prefix=a/", rw)).body).toMatchObject({ objects: [], next: null });
    expect((await run("POST", "storage/buckets/cli-files/download-url", rw, { key: "a/b.txt" })).body.url).toContain("b.txt");
    expect((await run("DELETE", "storage/buckets/cli-files/objects", rw)).status).toBe(422);
    expect((await run("DELETE", "storage/buckets/cli-files/objects?key=a/b.txt", rw)).body.deleted).toEqual(["a/b.txt"]);
    expect((await run("GET", "storage/buckets/nope/objects", rw)).status).toBe(404);

    expect(Array.isArray((await run("GET", "mail/domains", rw)).body.data)).toBe(true);
    expect((await run("POST", "mail/domains/nope.example/send", rw, { from: "a@nope.example", to: "b@x.ir" })).status).toBe(404);
  });
});
