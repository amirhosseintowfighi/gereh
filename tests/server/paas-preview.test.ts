import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { context } from "@/server/ctx";
import { paasApps } from "@/server/db/schema";
import { parseManifest } from "@/server/paas/manifest";
import { appHourly, DEFAULT_PLANS } from "@/server/paas/service";
import { buildState } from "@/server/state";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);

const gitApp = (over: Record<string, unknown> = {}) => ({ name: "pv-app", stack: "node", source: "git", gitUrl: "https://github.com/acme/api.git", gitBranch: "main", port: 3000, planId: "app-micro", ...over });
const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const appOf = async (id: string) => { const c = await context(); return (await buildState(c.db, c.auth, "customer")).db.paasApps.find((a) => a.id === id)!; };
const upload = async (files: [string, string][]) => {
  const { POST } = await import("@/app/api/paas/upload/route");
  const { zip } = await import("@/server/xlsx");
  const form = new FormData();
  form.set("file", new File([new Uint8Array(zip(files.map(([n, c]) => [n, Buffer.from(c)])))], "p.zip", { type: "application/zip" }));
  return (await (await POST(new Request("http://x/api/paas/upload", { method: "POST", body: form, headers: { origin: "http://x", host: "x" } }))).json()).result.uploadId as string;
};

describe("previews and promote", () => {
  it("a branch preview runs beside production, is billed, and promotes without a rebuild", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    expect(await fails("paas.createApp", gitApp({ name: "shop-preview" }))).toContain("preview");
    const pv = await call<string>("paas.deployPreview", id, { branch: "feature-x" });
    await settle();
    let app = await appOf(id);
    expect(app.previewDeployment).toBe(pv);
    expect(app.liveDeployment).not.toBe(pv); // production untouched
    expect(app.previewUrl).toBe("https://pv-app-preview.gereh.dev");
    expect(app.deployments.find((d) => d.id === pv)).toMatchObject({ target: "preview", branch: "feature-x", status: "live" });
    const row = (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
    const plan = DEFAULT_PLANS.find((p) => p.id === "app-micro")!;
    expect(appHourly(row, plan)).toBe(Math.ceil((plan.price * 2) / 720));
    expect(await fails("paas.rollback", id, pv)).toContain("موفق");

    const prod = await call<string>("paas.promote", id, pv);
    await settle();
    app = await appOf(id);
    expect(app.liveDeployment).toBe(prod);
    expect(app.deployments.find((d) => d.id === prod)).toMatchObject({ trigger: "promote", target: "production", status: "live" });
    expect(app.previewDeployment).toBe(pv); // the preview stays until removed
    await call("paas.removePreview", id);
    expect((await appOf(id)).previewDeployment).toBeNull();
  });

  it("git push to another branch builds a preview only when previews are on", async () => {
    const { POST } = await import("@/app/api/paas/hook/[app]/route");
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    const row = (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
    const push = async (ref: string) => (await POST(new Request("http://x/api/paas/hook/" + id + "?token=" + row.hookToken, { method: "POST", body: JSON.stringify({ ref, after: "abc1234def", head_commit: { id: "abc1234def", message: "wip" } }) }), { params: Promise.resolve({ app: id }) } as never)).json();
    expect(await push("refs/heads/dev")).toMatchObject({ skipped: "branch dev" });
    await call("paas.updateApp", id, { previews: true });
    const r = await push("refs/heads/dev");
    expect(r.preview).toMatch(/^dep-/);
    await settle();
    expect((await appOf(id)).previewDeployment).toBe(r.preview);
  });
});

describe("gereh.json", () => {
  it("validates the manifest", () => {
    expect(parseManifest('{"app":"x","start":"node s.js","port":8080}').manifest).toMatchObject({ port: 8080 });
    expect(parseManifest("{nope").error).toContain("JSON");
    expect(parseManifest('{"colour":"red"}').error).toContain("colour");
    expect(parseManifest('{"crons":[{"name":"cc","schedule":"* * * * *","command":"x"}]}').error).toContain("دقیقه");
  });

  it("is applied after a production build of a ZIP app", async () => {
    await asUser();
    const first = await upload([["package.json", "{}"], ["index.js", "1"]]);
    const id = await call<string>("paas.createApp", gitApp({ name: "manifest-app", source: "zip", gitUrl: "", uploadId: first }));
    await settle();
    const manifest = JSON.stringify({ app: "manifest-app", start: "node server.js", port: 8080, health: "/healthz", release: "npm run migrate", processes: { worker: "node worker.js" }, crons: [{ name: "nightly", schedule: "0 2 * * *", command: "node nightly.js" }] });
    await call("paas.deploy", id, { uploadId: await upload([["package.json", "{}"], ["gereh.json", manifest]]) });
    await settle();
    const app = await appOf(id);
    expect(app).toMatchObject({ startCommand: "node server.js", port: 8080, healthPath: "/healthz", releaseCommand: "npm run migrate" });
    expect(app.processes).toEqual([{ name: "worker", command: "node worker.js", instances: 1 }]);
    expect(app.crons[0]).toMatchObject({ name: "nightly", schedule: "0 2 * * *" });
    expect(app.deployments[0].status).toBe("live");
    expect((await call<{ log: string }>("paas.deployment", app.deployments[0].id)).log).toContain("==> gereh.json");

    await call("paas.deploy", id, { uploadId: await upload([["package.json", "{}"], ["gereh.json", '{"port":"eighty"}']]) });
    await settle();
    const after = await appOf(id);
    expect(after.deployments[0].status).toBe("failed");
    expect(after.status).toBe("running");
  });
});
