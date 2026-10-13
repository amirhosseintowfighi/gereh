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
