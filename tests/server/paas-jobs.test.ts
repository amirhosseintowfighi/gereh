import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cronError } from "@/lib/paas";
import { context } from "@/server/ctx";
import { paasApps, paasJobs } from "@/server/db/schema";
import { appHourly, appSpec, DEFAULT_PLANS } from "@/server/paas/service";
import { buildState } from "@/server/state";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);

const gitApp = (over: Record<string, unknown> = {}) => ({ name: "jobs-app", stack: "django", source: "git", gitUrl: "https://github.com/acme/api.git", gitBranch: "main", port: 8000, planId: "app-micro", ...over });
const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const appOf = async (id: string) => { const c = await context(); return (await buildState(c.db, c.auth, "customer")).db.paasApps.find((a) => a.id === id)!; };

describe("processes, cron, release command and one-off jobs", () => {
  it("release command runs before the rollout; a failing one keeps the previous version", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.updateApp", id, { releaseCommand: "python manage.py migrate --noinput" });
    await call("paas.deploy", id, {});
    await settle();
    let app = await appOf(id);
    expect(app.deployments[0].status).toBe("live");
    expect((await call<{ log: string }>("paas.deployment", app.deployments[0].id)).log).toContain("Applying app.0012_orders... OK");
    expect(app.jobs[0]).toMatchObject({ kind: "release", status: "succeeded" });

    await call("paas.updateApp", id, { releaseCommand: "./migrate.sh || exit 1" });
    await call("paas.deploy", id, {});
    await settle();
    app = await appOf(id);
    expect(app.deployments[0].status).toBe("failed");
    expect(app.status).toBe("running"); // the old version keeps serving
    expect((await call<{ log: string }>("paas.deployment", app.deployments[0].id)).log).toContain("release command failed");
  });

  it("worker processes are billed per instance and reach the driver spec", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    expect(await fails("paas.setProcesses", id, [{ name: "Bad_Name", command: "x", instances: 1 }])).toContain("معتبر");
    await call("paas.setProcesses", id, [{ name: "worker", command: "celery -A app worker", instances: 2 }, { name: "beat", command: "celery -A app beat", instances: 0 }]);
    await settle();
    const row = (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
    expect(row.workerInstances).toBe(2);
    const plan = DEFAULT_PLANS.find((p) => p.id === "app-micro")!;
    expect(appHourly(row, plan)).toBe(Math.ceil((plan.price * 3) / 720));
    const spec = await appSpec(await db(), row);
    expect(spec.processes).toEqual([{ name: "beat", command: "celery -A app beat", instances: 0 }, { name: "worker", command: "celery -A app worker", instances: 2 }]);
    expect((await appOf(id)).deployments[0]).toMatchObject({ trigger: "config", status: "live" });
  });

  it("cron: validation, save, edit and delete", async () => {
    expect(cronError("0 3 * * *")).toBeNull();
    expect(cronError("@daily")).toBeNull();
    expect(cronError("* * * * *")).toContain("۵ دقیقه");
    expect(cronError("61 * * * *")).toContain("محدوده");
    expect(cronError("every day")).toContain("cron");
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.saveCron", id, { name: "cleanup", schedule: "0 3 * * *", command: "python manage.py clearsessions", enabled: true });
    expect(await fails("paas.saveCron", id, { name: "cleanup", schedule: "0 4 * * *", command: "x", enabled: true })).toContain("نام");
    let app = await appOf(id);
    expect(app.crons).toMatchObject([{ name: "cleanup", schedule: "0 3 * * *", enabled: true }]);
    await call("paas.saveCron", id, { id: app.crons[0].id, name: "cleanup", schedule: "*/30 * * * *", command: "x", enabled: false });
    app = await appOf(id);
    expect(app.crons[0]).toMatchObject({ schedule: "*/30 * * * *", enabled: false });
    await call("paas.deleteCron", app.crons[0].id);
    expect((await appOf(id)).crons).toEqual([]);
  });

  it("one-off jobs need a live version and report their output", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    expect(await fails("paas.runJob", id, "echo hi")).toContain("نسخه فعال");
    await settle();
    const jobId = await call<string>("paas.runJob", id, "python manage.py migrate");
    await settle();
    const j = await call<{ status: string; output: string }>("paas.job", jobId);
    expect(j.status).toBe("succeeded");
    expect(j.output).toContain("$ python manage.py migrate");
    const [row] = await (await db()).select().from(paasJobs).where(eq(paasJobs.id, jobId));
    expect(row.finishedAt).not.toBeNull();
  });
});

describe("one-click templates", () => {
  it("creates the app, its database and link, and returns generated credentials once", async () => {
    await asUser();
    const r = await call<{ appId: string; credentials: { label: string; value: string }[] }>("paas.createFromTemplate", "directus", "my-cms");
    expect(r.credentials).toHaveLength(1);
    expect(r.credentials[0].value.length).toBeGreaterThan(20);
    await settle();
    const app = await appOf(r.appId);
    expect(app).toMatchObject({ source: "image", diskMount: "/directus/uploads", healthPath: "/server/health", status: "running" });
    expect(app.links[0].envKey).toBe("DB_CONNECTION_STRING");
    const spec = await appSpec(await db(), (await (await db()).select().from(paasApps).where(eq(paasApps.id, r.appId)))[0]);
    expect(spec.env.DB_CONNECTION_STRING).toMatch(/^postgresql:\/\//);
    expect(spec.env.PUBLIC_URL).toBe("https://my-cms.gereh.dev");
    expect(spec.env.ADMIN_EMAIL).toBe("demo@gereh.net");
    expect(await fails("paas.createFromTemplate", "nope", "x-app")).toContain("پیدا نشد");
  });
});
