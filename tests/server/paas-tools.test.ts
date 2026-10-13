/* eslint-disable @typescript-eslint/no-explicit-any -- assertions walk manifest JSON */
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appMonthly } from "@/lib/paas";
import { commitLinks, logLevel, mountError, mountsOverlap, parseDotenv, relPath, toDotenv } from "@/lib/paas-tools";
import { feed, keyInput, newTerm } from "@/lib/term";
import { paasApps, paasConsoleSessions, paasDiskBackups, paasDisks, paasLogs, paasMetrics, paasPlans, users } from "@/server/db/schema";
import { appObjects } from "@/server/paas/kubernetes";
import { sessions } from "@/server/paas/console";
import { appSpec } from "@/server/paas/service";
import { tarEntries, tarHeader } from "@/server/paas/tar";
import { resetSimTools } from "@/server/paas/tools";
import { drain } from "@/server/worker";
import { paasCollect } from "@/server/worker/paas";
import { paasToolsCollect, paasToolsDaily } from "@/server/worker/paas-tools";
import { zip } from "@/server/xlsx";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(async () => { await fresh(); resetSimTools(); });

const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const row = async (id: string) => (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
async function liveApp(over: Record<string, unknown> = {}) {
  await asUser();
  const id = await call<string>("paas.createApp", { name: "tools-app", stack: "node", source: "git", gitUrl: "https://github.com/acme/api.git", gitBranch: "main", port: 3000, planId: "app-micro", diskGb: 5, env: [{ key: "GREETING", value: "salam", secret: false }], ...over });
  await settle();
  expect((await row(id)).status).toBe("running");
  return id;
}
type Disks = { running: boolean; disks: { id: string; name: string; mount: string; sizeGb: number; usedBytes: number | null; backupList: { id: string; status: string; kind: string }[]; sftpUsers: { id: string; username: string; access: string }[] }[]; sftp: { host: string; port: number | null } };

describe("shared helpers", () => {
  it("mount paths", () => {
    expect(mountError("/data")).toBeNull();
    expect(mountError("/var/www/html/uploads")).toBeNull();
    expect(mountError("/app/storage")).toBeNull();
    for (const bad of ["/", "data", "/etc", "/etc/nginx", "/usr/local/x", "/proc/1", "/app", "/var", "/tmp", "/a/../b", "/data/", "/a b"]) expect(mountError(bad), bad).not.toBeNull();
    expect(mountsOverlap("/data", "/data/x")).toBe(true);
    expect(mountsOverlap("/data", "/data2")).toBe(false);
  });
  it("disk paths stay inside the disk", () => {
    expect(relPath("/a/./b//c/")).toBe("a/b/c");
    expect(relPath("")).toBe("");
    expect(relPath("a/../../etc")).toBeNull();
    expect(relPath("a\0b")).toBeNull();
  });
  it("log levels", () => {
    expect(logLevel("ERROR Unhandled rejection")).toBe("error");
    expect(logLevel('{"level":"warn","msg":"x"}')).toBe("warn");
    expect(logLevel('{"level":50,"msg":"x"}')).toBe("error");
    expect(logLevel("GET /api 503 12ms")).toBe("error");
    expect(logLevel("GET /api 404 12ms")).toBe("warn");
    expect(logLevel("GET /api 200 12ms")).toBe("info");
    expect(logLevel("[debug] cache miss")).toBe("debug");
  });
  it(".env files round-trip", () => {
    const text = '# comment\nexport A=1\nB="two words # not comment"\nC=\'single $x\'\nD=plain # comment\nE="multi\\nline"\nbad line\n';
    const r = parseDotenv(text);
    expect(r.vars).toEqual([{ key: "A", value: "1" }, { key: "B", value: "two words # not comment" }, { key: "C", value: "single $x" }, { key: "D", value: "plain" }, { key: "E", value: "multi\nline" }]);
    expect(r.errors).toHaveLength(1);
    expect(parseDotenv(toDotenv(r.vars)).vars).toEqual(r.vars);
    expect(toDotenv([{ key: "S", value: null }])).toContain("S=");
  });
  it("commit links", () => {
    expect(commitLinks("https://github.com/acme/api.git", "abc1234")).toEqual({ commit: "https://github.com/acme/api/commit/abc1234", archive: "https://github.com/acme/api/archive/abc1234.zip" });
    expect(commitLinks("https://gitlab.com/g/sub/repo.git", "abc1234")!.archive).toBe("https://gitlab.com/g/sub/repo/-/archive/abc1234/repo-abc1234.zip");
    expect(commitLinks("git@github.com:acme/api.git", "abc1234")!.commit).toBe("https://github.com/acme/api/commit/abc1234");
    expect(commitLinks("https://github.com/acme/api.git", "upload.zip")).toBeNull();
  });
  it("terminal model handles readline output", () => {
    let t = newTerm();
    t = feed(t, "\x1b[1;32mroot@x\x1b[0m:/# ls\r\n");
    t = feed(t, "a  b\r\n$ abc\b\b\x1b[K");
    expect(t.lines).toEqual(["root@x:/# ls", "a  b", "$ a"]);
    t = feed(t, "\x1b]0;title\x07ok\x1b[");
    expect(t.lines.at(-1)).toBe("$ aok");
    t = feed(t, "2J");
    expect(t.lines).toEqual([""]);
    expect(keyInput({ key: "c", ctrlKey: true, altKey: false, metaKey: false })).toBe("\x03");
    expect(keyInput({ key: "ArrowUp", ctrlKey: false, altKey: false, metaKey: false })).toBe("\x1b[A");
  });
  it("tar headers", () => {
    const h = tarHeader("dir/" + "x".repeat(120) + "/file.txt", 5);
    expect(h.length).toBe(512);
    expect(h.subarray(257, 262).toString()).toBe("ustar");
    expect(() => tarHeader("y".repeat(300), 1)).toThrow();
    const all = Buffer.concat([...tarEntries([{ name: "a.txt", data: () => Buffer.from("hello") }])]);
    expect(all.length).toBe(512 + 512 + 1024);
  });
});

describe("disks", () => {
  it("the single disk becomes a named disk; more disks are billed and validated", async () => {
    const id = await liveApp();
    let v = await call<Disks>("paas.disks", id);
    expect(v.disks).toHaveLength(1);
    expect(v.disks[0]).toMatchObject({ name: "data", mount: "/data", sizeGb: 5 });
    expect(await fails("paas.addDisk", id, { name: "media", mount: "/etc", sizeGb: 5 })).toContain("سیستم");
    expect(await fails("paas.addDisk", id, { name: "media", mount: "/", sizeGb: 5 })).toBeTruthy();
    expect(await fails("paas.addDisk", id, { name: "media", mount: "/data/media", sizeGb: 5 })).toContain("هم‌پوشانی");
    expect(await fails("paas.addDisk", id, { name: "data", mount: "/files", sizeGb: 5 })).toContain("نام");
    expect(await fails("paas.addDisk", id, { name: "Bad Name", mount: "/files", sizeGb: 5 })).toContain("نام دیسک");
    await call("paas.addDisk", id, { name: "media", mount: "/var/www/media", sizeGb: 10 });
    expect((await row(id)).diskGb).toBe(15);
    v = await call<Disks>("paas.disks", id);
    const media = v.disks.find((d) => d.name === "media")!;
    expect(await fails("paas.updateDisk", media.id, { sizeGb: 5 })).toContain("افزایش");
    await call("paas.updateDisk", media.id, { sizeGb: 20 });
    expect((await row(id)).diskGb).toBe(25);
    // billing follows the total
    const [plan] = await (await db()).select().from(paasPlans).where(eq(paasPlans.id, "app-micro"));
    expect(appMonthly(plan, 1, 25)).toBe(plan.price + 25 * 15_000);
    // paas.scale growth goes to the "data" disk
    await call("paas.scale", id, { planId: "app-micro", instances: 1, autoscale: false, maxInstances: 1, diskGb: 30 });
    const rows = await (await db()).select().from(paasDisks).where(eq(paasDisks.appId, id));
    expect(rows.find((d) => d.name === "data")!.sizeGb).toBe(10);
    // the workload mounts both, with the original claim name for "data"
    const spec = await appSpec(await db(), await row(id));
    const objs = appObjects(spec, "img:1", "dep-1") as any[];
    const pvcs = objs.filter((o) => o.kind === "PersistentVolumeClaim").map((o) => [o.metadata.name, o.spec.resources.requests.storage]);
    expect(pvcs).toEqual([["tools-app-data", "10Gi"], ["tools-app-disk-media", "20Gi"]]);
    const dep = objs.find((o) => o.kind === "Deployment" && o.metadata.name === "tools-app");
    expect(dep.spec.template.spec.containers[0].volumeMounts.map((m: any) => m.mountPath)).toEqual(expect.arrayContaining(["/data", "/var/www/media"]));
    // a disk can be removed by name
    expect(await fails("paas.deleteDisk", media.id, "nope")).toContain("نام دیسک");
    await call("paas.deleteDisk", media.id, "media");
    expect((await row(id)).diskGb).toBe(10);
  });
  it("needs a single instance and belongs to the owner", async () => {
    const id = await liveApp({ diskGb: 0, name: "multi-app", instances: 2 });
    expect(await fails("paas.addDisk", id, { name: "files", mount: "/files", sizeGb: 1 })).toContain("یک نمونه");
    await asAdmin();
    expect(await fails("paas.disks", id)).toContain("پیدا نشد");
  });
});

describe("file manager", () => {
  it("lists, writes, edits, renames, searches, deletes and extracts ZIPs", async () => {
    const id = await liveApp();
    const disk = (await call<Disks>("paas.disks", id)).disks[0].id;
    let l = await call<{ entries: { name: string; dir: boolean }[] }>("paas.fsList", disk, "");
    expect(l.entries.map((e) => e.name)).toEqual(["uploads", "README.txt"]);
    await call("paas.fsWrite", disk, "conf/app.json", '{"a":1}');
    expect(await call("paas.fsRead", disk, "/conf/app.json")).toBe('{"a":1}');
    await call("paas.fsMkdir", disk, "conf/sub");
    await call("paas.fsRename", disk, "conf/app.json", "conf/sub/main.json");
    expect(await fails("paas.fsRename", disk, "conf", "conf/sub/x")).toContain("داخل خودش");
    expect((await call<{ path: string }[]>("paas.fsSearch", disk, "", "main")).map((x) => x.path)).toEqual(["conf/sub/main.json"]);
    expect(await fails("paas.fsList", disk, "../../etc")).toContain("مسیر");
    expect(await fails("paas.fsDelete", disk, [""])).toContain("ریشه");
    await call("paas.fsDelete", disk, ["conf"]);
    l = await call("paas.fsList", disk, "");
    expect(l.entries.some((e) => e.name === "conf")).toBe(false);
    // ZIP extraction through the platform's ZIP reader
    const { paasTools } = await import("@/server/paas/tools");
    const spec = await appSpec(await db(), await row(id));
    await paasTools().writeFile(spec, { name: "data", mount: "/data" }, "site.zip", zip([["index.html", Buffer.from("<h1>hi</h1>")], ["assets/app.css", Buffer.from("body{}")]]));
    expect(await call("paas.fsExtract", disk, "site.zip", "public")).toBe(2);
    expect(await call("paas.fsRead", disk, "public/assets/app.css")).toBe("body{}");
    await paasTools().writeFile(spec, { name: "data", mount: "/data" }, "evil.zip", zip([["../x", Buffer.from("x")]]));
    expect(await fails("paas.fsExtract", disk, "evil.zip", "")).toContain("ناامن");
  });
  it("needs a running app", async () => {
    const id = await liveApp();
    const disk = (await call<Disks>("paas.disks", id)).disks[0].id;
    await call("paas.power", id, "stop");
    expect(await fails("paas.fsList", disk, "")).toContain("روشن");
  });
});

describe("console", () => {
  it("runs one-off commands and records them", async () => {
    const id = await liveApp();
    await call("paas.fsWrite", (await call<Disks>("paas.disks", id)).disks[0].id, "hello.txt", "from disk\n");
    const r = await call<{ code: number; output: string }>("paas.consoleRun", id, "cat /data/hello.txt && echo $GREETING && pwd");
    expect(r).toMatchObject({ code: 0, output: "from disk\nsalam\n/app\n" });
    expect((await call<{ code: number; output: string }>("paas.consoleRun", id, "nope")).code).toBe(127);
    const hist = await call<{ kind: string; command: string }[]>("paas.consoleHistory", id);
    expect(hist.map((h) => h.command)).toEqual(expect.arrayContaining(["nope"]));
  });
  it("opens a shell, takes input and closes", async () => {
    const id = await liveApp();
    const { sessionId } = await call<{ sessionId: string }>("paas.consoleOpen", id, {});
    await call("paas.consoleInput", sessionId, "ls /\r");
    await new Promise((r) => setTimeout(r, 20));
    const s = sessions.get(sessionId)!;
    const text = s.chunks.map((c) => c.data).join("");
    expect(text).toContain("Gereh simulated shell");
    expect(text).toMatch(/app\s+bin\s+data/);
    await call("paas.consoleInput", sessionId, "exit\r");
    await new Promise((r) => setTimeout(r, 20));
    expect(s.closed).toBe(true);
    expect(await fails("paas.consoleInput", sessionId, "ls\r")).toContain("بسته");
    const [rec] = await (await db()).select().from(paasConsoleSessions).where(eq(paasConsoleSessions.id, sessionId));
    expect(rec.kind).toBe("shell");
    await new Promise((r) => setTimeout(r, 20));
    expect((await (await db()).select().from(paasConsoleSessions).where(eq(paasConsoleSessions.id, sessionId)))[0].endedAt).toBeTruthy();
    // another account cannot type into it
    const s2 = await call<{ sessionId: string }>("paas.consoleOpen", id, {});
    await asAdmin();
    expect(await fails("paas.consoleInput", s2.sessionId, "id\r")).toContain("بسته");
  });
});

describe("SFTP and backups", () => {
  it("creates accounts with sealed passwords and adds the sidecar", async () => {
    const id = await liveApp();
    const disk = (await call<Disks>("paas.disks", id)).disks[0].id;
    expect(await fails("paas.sftpCreate", disk, { username: "root", access: "rw" })).toContain("رزرو");
    const { password } = await call<{ password: string }>("paas.sftpCreate", disk, { username: "deploy", access: "ro" });
    expect(password.length).toBeGreaterThan(10);
    expect(await fails("paas.sftpCreate", disk, { username: "deploy", access: "rw" })).toContain("گرفته");
    const v = await call<Disks>("paas.disks", id);
    expect(v.disks[0].sftpUsers).toMatchObject([{ username: "deploy", access: "ro" }]);
    expect(v.sftp.port).toBeGreaterThan(29999);
    expect(await call("paas.sftpReveal", v.disks[0].sftpUsers[0].id)).toBe(password);
    const spec = await appSpec(await db(), await row(id));
    expect(spec.sftp!.users).toEqual([{ name: "deploy", password, access: "ro", disk: "data" }]);
    expect(spec.sftp!.hostKey).toContain("BEGIN RSA PRIVATE KEY");
    const objs = appObjects(spec, "img:1", "dep-1") as any[];
    const side = objs.find((o) => o.kind === "Deployment" && o.metadata.name === "tools-app").spec.template.spec.containers[1];
    expect(side.name).toBe("sftp");
    expect(side.volumeMounts).toContainEqual({ name: "data", mountPath: "/home/deploy/data", readOnly: true });
    expect(objs.find((o) => o.kind === "Service" && o.metadata.name === "tools-app-sftp").spec.type).toBe("NodePort");
    expect(objs.find((o) => o.kind === "Secret" && o.metadata.name === "tools-app-sftp").stringData["users.conf"]).toBe("deploy:" + password + ":0:0\n");
    const { password: pw2 } = await call<{ password: string | null }>("paas.sftpUpdate", v.disks[0].sftpUsers[0].id, { resetPassword: true, access: "rw" });
    expect(pw2).not.toBe(password);
    await call("paas.sftpDelete", v.disks[0].sftpUsers[0].id);
    expect((await appSpec(await db(), await row(id))).sftp).toBeUndefined();
  });
  it("backs up, restores and keeps the last 3 automatic backups", async () => {
    const id = await liveApp();
    const disk = (await call<Disks>("paas.disks", id)).disks[0].id;
    await call("paas.fsWrite", disk, "note.txt", "v1");
    const bid = await call<string>("paas.diskBackup", disk);
    await settle();
    const [b] = await (await db()).select().from(paasDiskBackups).where(eq(paasDiskBackups.id, bid));
    expect(b.status).toBe("done");
    await call("paas.fsWrite", disk, "note.txt", "v2");
    await call("paas.diskRestore", bid);
    await settle();
    expect(await call("paas.fsRead", disk, "note.txt")).toBe("v1");
    expect(await call<string>("paas.diskBackupLink", bid)).toContain(".tar.gz");
    for (let i = 0; i < 4; i++) { await paasToolsDaily(await db()); await settle(); }
    const autos = await (await db()).select().from(paasDiskBackups).where(eq(paasDiskBackups.kind, "auto"));
    expect(autos).toHaveLength(3);
    await call("paas.diskBackupDelete", bid);
    expect((await call<Disks>("paas.disks", id)).disks[0].backupList.filter((x) => x.kind === "manual")).toHaveLength(0);
  });
});

describe("logs, metrics, env and releases", () => {
  it("collects logs and searches them by text, level and time", async () => {
    const id = await liveApp();
    await paasToolsCollect(await db());
    const all = await (await db()).select().from(paasLogs).where(eq(paasLogs.appId, id));
    expect(all.length).toBeGreaterThan(10);
    const r = await call<{ lines: { line: string; level: string }[]; retentionDays: number }>("paas.logSearch", id, { levels: ["error"] });
    expect(r.retentionDays).toBe(7);
    expect(r.lines.every((l) => l.level === "error")).toBe(true);
    const q = await call<{ lines: { line: string }[] }>("paas.logSearch", id, { q: "/api/health" });
    expect(q.lines.length).toBeGreaterThan(0);
    expect(q.lines.every((l) => l.line.includes("/api/health"))).toBe(true);
    expect((await call<{ lines: unknown[] }>("paas.logSearch", id, { q: "100%_" })).lines).toHaveLength(0);
    expect((await call<{ lines: unknown[] }>("paas.logSearch", id, { from: new Date(Date.now() + 60_000).toISOString() })).lines).toHaveLength(0);
    // a second run continues from the cursor (no duplicates)
    await paasToolsCollect(await db());
    expect((await (await db()).select().from(paasLogs).where(eq(paasLogs.appId, id))).length).toBe(all.length);
    // retention
    await (await db()).update(paasLogs).set({ at: new Date(Date.now() - 8 * 86400_000) }).where(eq(paasLogs.appId, id));
    await paasToolsDaily(await db());
    expect(await (await db()).select().from(paasLogs).where(eq(paasLogs.appId, id))).toHaveLength(0);
    const [small] = await (await db()).select().from(paasPlans).where(eq(paasPlans.id, "app-large"));
    expect(small.logDays).toBe(60);
  });
  it("metric history over ranges", async () => {
    const id = await liveApp();
    const d = await db();
    await d.insert(paasMetrics).values([2, 3, 70, 80].map((h) => ({ target: id, cpu: 20, ramMb: 100, rpm: 30, createdAt: new Date(Date.now() - h * 3600_000) })));
    await paasCollect(d);
    await paasToolsCollect(d);
    const h1 = await call<{ points: { cpu: number; netBytes: number }[] }>("paas.metrics", id, "1h");
    expect(h1.points.length).toBeGreaterThan(0);
    expect(h1.points.some((p) => p.netBytes > 0)).toBe(true);
    expect((await call<{ points: unknown[] }>("paas.metrics", id, "7d")).points.length).toBeGreaterThanOrEqual(3);
    expect((await call<{ points: unknown[] }>("paas.metrics", id, "30d")).points.length).toBeGreaterThan(0);
  });
  it("exports .env with secrets and lists releases with commit links", async () => {
    const id = await liveApp();
    await call("paas.setEnv", id, [{ key: "TOKEN", value: "s3cr\"et", secret: true }], []);
    const text = await call<string>("paas.envFile", id);
    expect(parseDotenv(text).vars).toEqual([{ key: "GREETING", value: "salam" }, { key: "TOKEN", value: 's3cr"et' }]);
    const rel = await call<{ ref: string; commitUrl: string; archiveUrl: string; live: boolean }[]>("paas.releases", id);
    const live = rel.find((r) => r.live)!;
    expect(live.commitUrl).toBe("https://github.com/acme/api/commit/" + live.ref);
    expect(live.archiveUrl).toContain("/archive/");
  });
  it("staff set log retention", async () => {
    await asUser();
    expect(await fails("paas.adminSetLogDays", "app-nano", 30)).toBeTruthy();
    await asAdmin();
    expect(await fails("paas.adminSetLogDays", "app-nano", 14)).toContain("۷");
    await call("paas.adminSetLogDays", "app-nano", 30);
    const [p] = await (await db()).select().from(paasPlans).where(eq(paasPlans.id, "app-nano"));
    expect(p.logDays).toBe(30);
    await (await db()).update(users).set({ balance: 0 }).where(eq(users.id, "nobody"));
  });
});
