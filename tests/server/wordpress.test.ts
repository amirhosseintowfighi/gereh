import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUT } from "@/app/api/wp/upload/route";
import { context } from "@/server/ctx";
import { paasApps, paasDbs } from "@/server/db/schema";
import { importJobObject, WP_EXTRACT, WP_IMPORT_SQL } from "@/server/paas/kubernetes";
import { appSpec } from "@/server/paas/service";
import { buildState } from "@/server/state";
import { drain } from "@/server/worker";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);
const settle = async () => { for (let i = 0; i < 20; i++) if (!(await drain(await db()))) break; };
const site = async (id: string) => { const c = await context(); return (await buildState(c.db, c.auth, "customer")).db.paasApps.find((a) => a.id === id)!; };
const upload = async (body: Uint8Array) => {
  const res = await PUT(new Request("http://x/api/wp/upload", { method: "PUT", body, headers: { origin: "http://x", host: "x" } }));
  return { status: res.status, body: await res.json() };
};

describe("managed WordPress", () => {
  it("creates the site with MariaDB wired in as WORDPRESS_DB_* and imports a cPanel backup", async () => {
    await asUser();
    expect((await upload(new TextEncoder().encode("not an archive"))).status).toBe(400);
    const up = await upload(gzipSync(Buffer.from("fake tar")));
    expect(up.status).toBe(200);
    const id = await call<string>("wp.create", { name: "my-blog", plan: "eco", uploadId: up.body.result.uploadId, keepUrl: false });
    await settle();
    const s = await site(id);
    expect(s).toMatchObject({ product: "wordpress", wpPlan: "eco", status: "running", diskGb: 10, diskMount: "/var/www/html", image: "wordpress:6.7-php8.3-apache" });
    expect(s.jobs.find((j) => j.kind === "import")).toMatchObject({ status: "succeeded" });
    const row = (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
    const spec = await appSpec(await db(), row);
    expect(spec.env).toMatchObject({ WORDPRESS_DB_USER: expect.any(String), WORDPRESS_DB_NAME: "my_blog_db", WORDPRESS_TABLE_PREFIX: "wp_" });
    expect(spec.env.WORDPRESS_DB_HOST).toMatch(/:3306$/);
    expect(spec.env.WORDPRESS_CONFIG_EXTRA).toContain("HTTP_X_FORWARDED_PROTO");
    const [d] = await (await db()).select().from(paasDbs).where(eq(paasDbs.name, "my-blog-db"));
    expect(d).toMatchObject({ engine: "mariadb", planId: "db-micro", status: "running" });

    await call("wp.changePlan", id, "turbo");
    await settle();
    expect(await site(id)).toMatchObject({ wpPlan: "turbo", planId: "app-small", diskGb: 25, cdn: true });
    expect(await fails("wp.import", id, "bogus-upload-id-123456", false)).toContain("پیدا نشد");
  });

  it("import scripts are valid shell and the job mounts the site disk", () => {
    execFileSync("sh", ["-n", "-c", WP_EXTRACT]);
    execFileSync("sh", ["-n", "-c", WP_IMPORT_SQL]);
    expect(WP_EXTRACT).not.toContain("\\${");
    const app = { id: "app-1", userId: "u1", name: "blog" } as never;
    const job = importJobObject(app, { name: "blog-db", username: "u_blog", password: "p", dbName: "blog_db" } as never, "https://src", "JOB-1", "https://blog.gereh.dev") as Record<string, any>;
    expect(job.spec.template.spec.volumes[1].persistentVolumeClaim.claimName).toBe("blog-data");
    expect(job.spec.template.spec.containers[0].env.find((e: { name: string }) => e.name === "DB_HOST").value).toBe("db-blog-db");
  });
});
