/* eslint-disable @typescript-eslint/no-explicit-any -- assertions walk deeply nested manifest JSON */
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normCidr, paramsError, readQueryError, mongoFilterError, sniffDump } from "@/lib/dbaas";
import { DB_ENGINES } from "@/lib/paas";
import { context } from "@/server/ctx";
import { paasDbBackups, paasDbPanels, paasDbs, users } from "@/server/db/schema";
import { bakRestoreSql, simState } from "@/server/paas/dbaas";
import { dumpPathFor } from "@/server/paas/dbaas-service";
import { createUserCmds, htpasswd, inspectCmds, parseTsv, setGrantsCmds } from "@/server/paas/engines";
import { exitCode, frame, frameReader } from "@/server/paas/exec";
import { dbObjects, publicObjects } from "@/server/paas/kubernetes";
import { connectionUrl, dbSpec } from "@/server/paas/service";
import { buildState } from "@/server/state";
import { drain } from "@/server/worker";
import { dbaasExpire } from "@/server/worker/dbaas";
import { paasDaily } from "@/server/worker/paas";
import { asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);

const settle = async () => { for (let i = 0; i < 20; i++) if (!(await drain(await db()))) break; };
const state = async () => { const c = await context(); return buildState(c.db, c.auth, "customer"); };
const dbOf = async (id: string) => (await state()).db.paasDbs.find((d) => d.id === id)!;
const rich = async () => { const d = await db(); await d.update(users).set({ balance: 100_000_000 }).where(eq(users.email, "demo@gereh.net")); };
const make = async (engine: string, version: string, over: Record<string, unknown> = {}) => {
  const id = await call<string>("paas.createDb", { name: (engine + "-db").replace(/[^a-z-]/g, ""), engine, version, planId: "db-small", ...over });
  await settle();
  return id;
};
const specOf = async (id: string) => dbSpec(await db(), (await (await db()).select().from(paasDbs).where(eq(paasDbs.id, id)))[0]);

describe("engines", () => {
  it("every engine has versions, an env key and a Kubernetes spec", async () => {
    for (const e of DB_ENGINES) {
      expect(e.versions.length).toBeGreaterThan(0);
      expect(e.envKey).toMatch(/^[A-Z][A-Z0-9_]+$/);
      const objs = dbObjects({ id: "pdb-1", userId: "u1", name: "x", engine: e.id, version: e.versions[0], cpu: 1, ramMb: 2048, diskGb: 10, username: "u_x", password: "pw", dbName: "x", publicAccess: false }) as never as Record<string, any>[];
      const ct = objs[1].spec.template.spec.containers[0];
      expect(ct.image, e.id).toBeTruthy();
      expect(ct.ports[0].containerPort).toBe(e.port);
      expect(connectionUrl({ engine: e.id, host: "h", port: e.port, username: "u", dbName: "x" }, "pw"), e.id).not.toBe("");
    }
    expect(DB_ENGINES.find((e) => e.id === "postgres")!.versions).toEqual(["18", "17", "16", "15", "14", "13", "12", "11"]);
    expect(DB_ENGINES.find((e) => e.id === "mysql")!.versions).toEqual(expect.arrayContaining(["5.7", "8.0", "9.0"]));
  });

  it("creates new engines; plan minimums, internal-only engines and backup support are enforced", async () => {
    await asUser(); await rich();
    expect(await fails("paas.createDb", { name: "search", engine: "elasticsearch", version: "8.15", planId: "db-micro" })).toContain("حافظه");
    expect(await fails("paas.createDb", { name: "metrics", engine: "prometheus", version: "3.0", planId: "db-small", publicAccess: true })).toContain("اپ‌های خودتان");
    const id = await make("rabbitmq", "4.0", { backups: true });
    const d = await dbOf(id);
    expect(d).toMatchObject({ status: "running", port: 5672, backups: false, config: { initialized: true } });
    expect(await fails("paas.backupDb", id)).toContain("پشتیبانی نمی‌شود");
    expect(await fails("paas.updateDb", id, { backups: true })).toContain("پشتیبانی نمی‌شود");
    const ms = await make("mssql", "2022", { planId: "db-medium" });
    expect((await dbOf(ms)).username).toBe("sa");
    expect((await call<{ password: string }>("paas.dbCredentials", ms)).password).toMatch(/Aa1$/);
    const pg = await make("postgres", "17");
    expect((await specOf(pg)).extImage).toBe(true);
    await paasDaily(await db());
    const bks = await (await db()).select().from(paasDbBackups);
    expect(bks.map((b) => b.dbId)).not.toContain(id);
  });
});

describe("users and databases", () => {
  it("creates databases and users with per-database access; passwords are sealed", async () => {
    await asUser(); await rich();
    const id = await make("postgres", "16");
    await call("dbaas.createDatabase", id, "analytics");
    expect(await fails("dbaas.createDatabase", id, "analytics")).toContain("وجود دارد");
    expect(await fails("dbaas.createDatabase", id, "template1")).toContain("رزرو");
    const main = (await dbOf(id)).dbName;
    const u = await call<{ id: string; password: string; url: string }>("dbaas.createUser", id, { username: "reporter", grants: [{ db: "analytics", access: "ro" }, { db: main, access: "rw" }] });
    expect(u.url).toContain("postgresql://reporter:");
    expect(await fails("dbaas.createUser", id, { username: "x2", grants: [{ db: "nope", access: "ro" }] })).toContain("وجود ندارد");
    let d = await dbOf(id);
    expect(d.users).toEqual([expect.objectContaining({ username: "reporter", grants: [{ db: "analytics", access: "ro" }, { db: main, access: "rw" }] })]);
    expect(JSON.stringify(d)).not.toContain(u.password);
    expect((await call<{ password: string }>("dbaas.userCredentials", id, u.id)).password).toBe(u.password);
    expect(simState({ id, dbName: main }).users.get("reporter")).toHaveLength(2);

    await call("dbaas.setGrants", id, u.id, [{ db: "analytics", access: "rw" }]);
    await call("dbaas.dropDatabase", id, "analytics", "analytics");
    d = await dbOf(id);
    expect(d.databases).toEqual([]);
    expect(d.users[0].grants).toEqual([]);
    await call("dbaas.dropUser", id, u.id);
    expect((await dbOf(id)).users).toEqual([]);
    expect((await dbOf(id)).events.map((e) => e.message).join(" ")).toContain("reporter");
  });

  it("rabbitmq vhosts; unsupported engines are refused", async () => {
    await asUser(); await rich();
    const id = await make("rabbitmq", "3.13");
    await call("dbaas.createDatabase", id, "orders");
    const u = await call<{ url: string }>("dbaas.createUser", id, { username: "worker", grants: [{ db: "orders", access: "rw" }] });
    expect(u.url).toMatch(/^amqp:\/\/worker:.+:5672\//);
    const neo = await make("neo4j", "5.24");
    expect(await fails("dbaas.createUser", neo, { username: "abc", grants: [] })).toContain("پشتیبانی نمی‌شود");
  });
});

describe("admin panels, firewall, tuning, extensions", () => {
  it("opens a panel for N hours behind basic auth and the worker expires it", async () => {
    await asUser(); await rich();
    const id = await make("mysql", "8.0");
    expect(await fails("dbaas.openPanel", id, "pgadmin", 5)).toContain("در دسترس نیست");
    const p = await call<{ id: string; url: string; username: string; password: string }>("dbaas.openPanel", id, "phpmyadmin", 5);
    expect(p.url).toMatch(/^https:\/\/dbp-[a-z0-9]+\.gereh\.dev\/$/);
    expect((await dbOf(id)).panels[0]).toMatchObject({ tool: "phpmyadmin", status: "ready", minutesLeft: 300 });
    await (await db()).update(paasDbPanels).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(paasDbPanels.id, p.id));
    expect(await dbaasExpire(await db())).toBe(1);
    expect((await dbOf(id)).panels).toEqual([]);
    expect(htpasswd("gereh", "pw")).toMatch(/^gereh:\{SSHA\}[A-Za-z0-9+/=]+$/);
  });

  it("allowlist limits public access to CIDRs", async () => {
    await asUser(); await rich();
    const id = await make("postgres", "17", { publicAccess: true });
    expect(await fails("dbaas.setAllowlist", id, ["10.0.0.0/4"])).toContain("CIDR");
    expect(await call("dbaas.setAllowlist", id, ["5.6.7.8", "5.6.7.8/32", "192.168.1.77/24"])).toEqual(["5.6.7.8/32", "192.168.1.0/24"]);
    const spec = await specOf(id);
    const [policy, svc] = publicObjects(spec) as never as Record<string, any>[];
    expect(policy.spec.ingress[0].from).toEqual([{ ipBlock: { cidr: "5.6.7.8/32" } }, { ipBlock: { cidr: "192.168.1.0/24" } }]);
    expect(svc.spec.externalTrafficPolicy).toBe("Local");
    expect((publicObjects({ ...spec, allowlist: [] })[0] as any).spec.ingress[0].from).toEqual([{ ipBlock: { cidr: "0.0.0.0/0" } }]);
  });

  it("validates parameters against the plan and passes them to the server", async () => {
    await asUser(); await rich();
    const id = await make("postgres", "17");
    expect(await fails("dbaas.setParams", id, { shared_buffers: "100000" })).toContain("حافظه پلن");
    expect(await fails("dbaas.setParams", id, { fsync: "off" })).toContain("پشتیبانی نمی‌شود");
    await call("dbaas.setParams", id, { max_connections: "200", shared_buffers: "256" });
    const ct = (dbObjects(await specOf(id)) as never as Record<string, any>[])[1].spec.template.spec.containers[0];
    expect(ct.args).toEqual(expect.arrayContaining(["postgres", "max_connections=200", "shared_buffers=256MB"]));
    const redis = await make("redis", "7.4");
    await call("dbaas.setParams", redis, { "maxmemory-policy": "allkeys-lru", maxclients: "500" });
    const rc = (dbObjects(await specOf(redis)) as never as Record<string, any>[])[1].spec.template.spec.containers[0];
    expect(rc.command[2]).toContain("--maxmemory-policy allkeys-lru --maxclients 500");
    expect(paramsError("mysql", { max_allowed_packet: "64" }, 1024)).toBeNull();
  });

  it("PostgreSQL extensions; pg_stat_statements is preloaded", async () => {
    await asUser(); await rich();
    const id = await make("postgres", "17");
    expect(await fails("dbaas.setExtensions", id, ["plpython3u"])).toContain("پشتیبانی نمی‌شود");
    await call("dbaas.setExtensions", id, ["postgis", "vector", "pg_trgm", "pg_stat_statements"]);
    await settle();
    const spec = await specOf(id);
    expect(spec.extensions).toEqual(["postgis", "vector", "pg_trgm", "pg_stat_statements"]);
    // the official image until the extension image is built and named
    const image = () => ((dbObjects(spec) as never as Record<string, any>[])[1].spec.template.spec.containers[0]).image;
    expect(image()).toBe("postgres:17-alpine");
    process.env.PAAS_PG_EXT_IMAGE = "registry.gereh.dev/gereh/postgres-ext";
    expect(image()).toBe("registry.gereh.dev/gereh/postgres-ext:17");
    delete process.env.PAAS_PG_EXT_IMAGE;
    const ct = (dbObjects(spec) as never as Record<string, any>[])[1].spec.template.spec.containers[0];
    expect(ct.args).toContain("shared_preload_libraries=pg_stat_statements");
    expect([...simState(spec).ext].sort()).toEqual(["pg_stat_statements", "pg_trgm", "postgis", "vector"]);
    // an old database on the plain image cannot get PostGIS
    const old = await make("postgres", "16", { name: "old-pg" });
    const { paasDbConfig } = await import("@/server/db/schema");
    await (await db()).update(paasDbConfig).set({ extImage: false }).where(eq(paasDbConfig.dbId, old));
    expect(await fails("dbaas.setExtensions", old, ["postgis"])).toContain("ایمیج");
  });

  it("mongo replica set: keyfile, flags and initiation", async () => {
    await asUser(); await rich();
    const id = await make("mongodb", "7.0", { replicaSet: true });
    const spec = await specOf(id);
    expect(spec.replicaSet).toBe(true);
    const sts = (dbObjects(spec) as never as Record<string, any>[])[1].spec.template.spec;
    expect(sts.containers[0].args).toEqual(expect.arrayContaining(["--replSet", "rs0", "--keyFile", "/etc/mongo-key/keyfile"]));
    expect(sts.initContainers[0].name).toBe("keyfile");
    expect(simState(spec).init).toBeGreaterThan(0);
    await call("dbaas.setReplicaSet", id, false);
    expect((await specOf(id)).replicaSet).toBe(false);
  });
});

describe("backups and imports", () => {
  it("restores a backup into a new database, links downloads, imports dumps", async () => {
    await asUser(); await rich();
    const id = await make("postgres", "17");
    const bk = await call<string>("paas.backupDb", id);
    await settle();
    const newId = await call<string>("dbaas.restoreToNew", bk, "pg-copy");
    await settle();
    expect((await dbOf(newId)).config.seed).toMatchObject({ status: "done" });
    expect(await call<string>("dbaas.backupLink", bk)).toContain("s3.gereh.dev");

    const { auth } = await context();
    const up = "u".repeat(20);
    await writeFile((await dumpPathFor(auth!.uid, up))!, "CREATE TABLE t (id int);\nINSERT INTO t VALUES (1);\n");
    await call("dbaas.importDump", id, up);
    await settle();
    expect((await dbOf(id)).imports[0]).toMatchObject({ format: "sql", status: "succeeded" });
    const bak = "b".repeat(20);
    await writeFile((await dumpPathFor(auth!.uid, bak))!, Buffer.from("TAPE\0\0binary"));
    expect(await fails("dbaas.importDump", id, bak)).toContain("قالب");
    expect(bakRestoreSql("shop", "/var/opt/mssql/data/x.bak")).toContain("RESTORE DATABASE [shop]");
  });
});

describe("inspector", () => {
  it("lists, pages and runs read-only queries", async () => {
    await asUser(); await rich();
    const id = await make("postgres", "17");
    const main = (await dbOf(id)).dbName;
    expect((await call<{ databases: string[] }>("dbaas.inspect", id, { op: "databases" })).databases).toEqual([main]);
    expect((await call<{ tables: unknown[] }>("dbaas.inspect", id, { op: "tables", db: main })).tables).toHaveLength(3);
    const rows = await call<{ grid: { columns: string[]; rows: unknown[]; hasMore: boolean } }>("dbaas.inspect", id, { op: "rows", db: main, table: "orders", page: 0 });
    expect(rows.grid).toMatchObject({ columns: ["id", "user_id", "amount", "status"], hasMore: true });
    expect(rows.grid.rows).toHaveLength(50);
    expect(await fails("dbaas.inspect", id, { op: "query", db: main, sql: "delete from orders" })).toContain("خواندنی");
    expect(await fails("dbaas.inspect", id, { op: "query", db: main, sql: "select 1; drop table orders" })).toContain(";");
    expect(await fails("dbaas.inspect", id, { op: "query", db: main, sql: "select pg_sleep(10)" })).toContain("timeout");
    expect((await call<{ grid: { rows: unknown[] } }>("dbaas.inspect", id, { op: "query", db: main, sql: "select * from users;" })).grid.rows.length).toBeGreaterThan(0);
    const mongo = await make("mongodb", "7.0");
    const m = (await dbOf(mongo)).dbName;
    expect(await fails("dbaas.inspect", mongo, { op: "find", db: m, collection: "orders", filter: '{"$where":"1"}' })).toContain("$where");
    const found = await call<{ docs: string[] }>("dbaas.inspect", mongo, { op: "find", db: m, collection: "orders", filter: '{"status":"pending"}', page: 0 });
    expect(found.docs.every((x) => JSON.parse(x).status === "pending")).toBe(true);
    expect(await call("dbaas.stats", id)).toMatchObject({ connections: expect.any(Number) });
  });
});

describe("helpers", () => {
  it("validates input", () => {
    expect(normCidr("1.2.3.4")).toBe("1.2.3.4/32");
    expect(normCidr("10.1.2.3/8")).toBe("10.0.0.0/8");
    expect(normCidr("0.0.0.0/0")).toBeNull();
    expect(normCidr("300.1.1.1")).toBeNull();
    expect(readQueryError("WITH x AS (SELECT 1) SELECT * FROM x")).toBeNull();
    expect(readQueryError("select '\\x'")).toContain("\\");
    expect(mongoFilterError('{"a": {"$gt": 1}}')).toBeNull();
    expect(sniffDump(Buffer.from("PGDMP\x01"), "postgres")).toBe("pgdump");
    expect(sniffDump(Buffer.from([0x1f, 0x8b, 8, 0]), "mongodb")).toBe("mongo-archive.gz");
    expect(sniffDump(Buffer.from([0x6d, 0xe2, 0x99, 0x81]), "mongodb")).toBe("mongo-archive");
  });

  it("builds management commands without a shell around values", () => {
    const d = { id: "pdb-1", userId: "u1", name: "shop", engine: "postgres", version: "17", cpu: 1, ramMb: 1024, diskGb: 10, username: "u_shop", password: "pw", dbName: "shop", publicAccess: false };
    const cmds = createUserCmds(d, "bob", "p'w", [{ db: "shop", access: "ro" }], ["shop", "logs"]);
    expect(cmds[0].slice(0, 2)).toEqual(["/bin/sh", "-c"]);
    expect(cmds[0][5]).toBe(`CREATE ROLE "bob" LOGIN PASSWORD 'p''w'`);
    expect(cmds).toHaveLength(3);
    expect(cmds[1][5]).toContain(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO "bob"`);
    expect(cmds[2][5]).not.toContain("GRANT");
    const my = setGrantsCmds({ ...d, engine: "mysql" }, "bob", [{ db: "shop", access: "rw" }], ["shop"]);
    expect(my[0][4]).toContain("GRANT SELECT, INSERT");
    expect(inspectCmds.query(d, "shop", "select 1;")[5]).toBe("BEGIN READ ONLY; SET LOCAL statement_timeout = 5000; SELECT coalesce(json_agg(t), '[]') FROM (SELECT * FROM (select 1) q LIMIT 501) t");
    expect(parseTsv("a\tb\nx\\ty\tNULL\n", true)).toEqual({ columns: ["a", "b"], rows: [["x\ty", null]] });
  });

  it("exec frames round-trip and statuses map to exit codes", () => {
    const got: [number, string][] = [];
    const read = frameReader((op, data) => got.push([op, data.toString()]));
    const f = frame(Buffer.from("\x01hello"));
    read(f.subarray(0, 3)); read(f.subarray(3));
    expect(got).toEqual([[2, "\x01hello"]]);
    expect(exitCode('{"status":"Success"}').code).toBe(0);
    expect(exitCode('{"status":"Failure","details":{"causes":[{"reason":"ExitCode","message":"3"}]}}').code).toBe(3);
  });
});
