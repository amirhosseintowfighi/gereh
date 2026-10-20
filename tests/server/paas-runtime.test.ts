/* eslint-disable @typescript-eslint/no-explicit-any -- assertions walk deeply nested manifest JSON */
import { and, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyFailure, ciTemplates, dnsError, expandCodes, monthKey, nginxConfError, phpIniError } from "@/lib/paas-runtime";
import { paasApps, paasDeployments, paasEnv, paasEvents, paasPlans, paasRuntime, paasSpend, paasTraffic, users } from "@/server/db/schema";
import type { AppSpec } from "@/server/paas/driver";
import { appObjects, buildJob, healthProbe, ingressObjects } from "@/server/paas/kubernetes";
import { parseManifest, applyManifest } from "@/server/paas/manifest";
import { checkHtpasswd, htpasswdLine } from "@/server/paas/runtime";
import { appSpec } from "@/server/paas/service";
import { drain } from "@/server/worker";
import { paasBilling, paasCollect } from "@/server/worker/paas";
import { paasBudgets, recordSpend } from "@/server/worker/paas-runtime";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeAll(() => { process.env.PAAS_SIM_BUILD_SECONDS = "0"; process.env.PAAS_POLL_MS = "0"; });
beforeEach(fresh);

const gitApp = (over: Record<string, unknown> = {}) => ({ name: "rt-app", stack: "node", source: "git", gitUrl: "https://github.com/acme/api.git", gitBranch: "main", port: 3000, planId: "app-micro", env: [{ key: "A", value: "1", secret: false }], ...over });
const settle = async () => { for (let i = 0; i < 12; i++) if (!(await drain(await db()))) break; };
const row = async (id: string) => (await (await db()).select().from(paasApps).where(eq(paasApps.id, id)))[0];
const deps = async (id: string) => (await db()).select().from(paasDeployments).where(eq(paasDeployments.appId, id));
type View = { config: Record<string, unknown>; events: { kind: string; message: string }[]; spend: { amount: number }; traffic: { monthBytes: number }; egressIps: string[]; limits: { deploysPerDay: number; deploysToday: number; maxBuildMinutes: number }; redirects: { domainId: string; code: number }[] };

describe("shared helpers", () => {
  it("classifies deploy failures", () => {
    expect(classifyFailure("npm ERR! code ERESOLVE")).toBe("deps");
    expect(classifyFailure("container app OOMKilled (exit code 137)")).toBe("oom");
    expect(classifyFailure("No start command could be found")).toBe("start");
    expect(classifyFailure("Readiness probe failed: dial tcp 10.0.0.1:3000: connect: connection refused\nERROR: did not become healthy")).toBe("port");
    expect(classifyFailure("Readiness probe failed: HTTP probe failed with statuscode: 503")).toBe("health");
    expect(classifyFailure("ERROR: build timed out after 20 minutes")).toBe("timeout");
    expect(classifyFailure("ERROR: build step exited with code 1")).toBe("");
  });
  it("validates options", () => {
    expect(expandCodes("200,204,301-302")).toEqual([200, 204, 301, 302]);
    expect(expandCodes("99-200")).toBeNull();
    expect(dnsError(["1.1.1.1", "8.8.8.8"])).toBeNull();
    expect(dnsError(["1.1.1.1", "x"])).toContain("x");
    expect(dnsError(["1.1.1.1", "1.1.1.2", "1.1.1.3", "1.1.1.4", "1.1.1.5"])).toContain("۴");
    expect(nginxConfError("server { listen 80; }")).toBeNull();
    expect(nginxConfError("server { listen 80; ")).not.toBeNull();
    expect(nginxConfError("load_module x.so;")).not.toBeNull();
    expect(phpIniError("memory_limit = 256M\n; c\n[PHP]")).toBeNull();
    expect(phpIniError("extension = evil.so")).not.toBeNull();
    expect(monthKey(new Date("2026-10-12T12:00:00Z"))).toBe("1405-07");
    const t = ciTemplates({ name: "shop", source: "git", gitBranch: "prod" }, "https://gereh.net");
    expect(t.github).toContain("branches: [prod]");
    expect(t.github).toContain("--app shop");
    expect(t.gitlab).toContain('$CI_COMMIT_BRANCH == "prod"');
    expect(t.curl).toContain("/api/v1/apps/shop/deployments");
  });
  it("htpasswd lines verify", () => {
    const l = htpasswdLine("admin", "s3cret-pass");
    expect(l).toMatch(/^admin:\{SSHA\}/);
    expect(checkHtpasswd(l, "admin", "s3cret-pass")).toBe(true);
    expect(checkHtpasswd(l, "admin", "wrong")).toBe(false);
  });
  it("gereh.json hooks and healthcheck", () => {
    expect(parseManifest(JSON.stringify({ hooks: { preBuild: "npm run lint" }, healthcheck: { path: "/hz", codes: "200-299", startPeriod: 30 } })).manifest).toBeTruthy();
    expect(parseManifest(JSON.stringify({ healthcheck: { codes: "abc" } })).error).toContain("codes");
    expect(parseManifest(JSON.stringify({ healthcheck: { type: "command" } })).error).toContain("command");
    expect(parseManifest(JSON.stringify({ hooks: { other: "x" } })).error).toBeTruthy();
  });
});

describe("build and runtime options", () => {
  it("saves options, validates, re-releases on runtime changes and feeds the driver spec", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    expect(await fails("paas.setRuntime", id, { healthCodes: "abc" })).toContain("کد");
    expect(await fails("paas.setRuntime", id, { healthType: "command" })).toContain("دستور");
    expect(await fails("paas.setRuntime", id, { dnsServers: ["1.1.1.1", "bad"] })).toContain("bad");
    expect(await fails("paas.setRuntime", id, { timezone: "Mars/Base" })).toContain("منطقه");
    expect(await fails("paas.setRuntime", id, { nginxConf: "server {}" })).toContain("nginx");
    expect(await fails("paas.setRuntime", id, { defaultDomain: false })).toContain("دامنه");
    expect(await fails("paas.setRuntime", id, { dockerfile: "../Dockerfile" })).toContain("Dockerfile");

    // build options only: no redeploy
    expect(await call("paas.setRuntime", id, { preBuild: "npm run lint", postBuild: "npm prune", buildCache: false, buildArgs: { NODE_ENV: "production" } })).toBeNull();
    const dep = await call<string | null>("paas.setRuntime", id, { preStart: "node migrate.js", healthCodes: "200,204", healthStartPeriod: 30, zeroDowntime: false, timezone: "UTC", readOnlyFs: true, dnsServers: ["178.22.122.100", "1.1.1.1"] });
    expect(dep).toMatch(/^dep-/);
    await settle();
    const spec = await appSpec(await db(), await row(id));
    expect(spec.env.TZ).toBe("UTC");
    expect(spec.runtime).toMatchObject({ preBuild: "npm run lint", preStart: "node migrate.js", zeroDowntime: false, readOnlyFs: true, dns: ["178.22.122.100", "1.1.1.1"], build: { cache: false, args: { NODE_ENV: "production" }, timeoutMin: 20 }, health: { codes: "200,204", startPeriod: 30 } });

    // the next build shows the hooks and options
    const d2 = await call<string>("paas.deploy", id, { noCache: true });
    await settle();
    const log = (await call<{ log: string }>("paas.deployment", d2)).log;
    expect(log).toContain("Build cache disabled");
    expect(log).toContain("$ npm run lint");
    expect(log).toContain("post-build hook");
    expect((await deps(id)).find((d) => d.id === d2)!.noCache).toBe(true);

    const view = await call<View>("paas.runtime", id);
    expect(view.config).toMatchObject({ preBuild: "npm run lint", authOn: false });
    expect(view.config).not.toHaveProperty("authHtpasswd");
    expect(view.events.map((e) => e.kind)).toContain("deploy");
  });

  it("image apps reject build options; php stacks take nginx and php.ini", async () => {
    await asUser();
    const img = await call<string>("paas.createApp", gitApp({ name: "rt-img", source: "image", stack: "docker", image: "nginx:1.27", gitUrl: "" }));
    expect(await fails("paas.setRuntime", img, { preBuild: "x" })).toContain("ایمیج");
    const php = await call<string>("paas.createApp", gitApp({ name: "rt-php", stack: "php", port: 80 }));
    await call("paas.setRuntime", php, { nginxConf: "server { listen 80; root /app/public; }", phpIni: "memory_limit = 256M" });
    const spec = await appSpec(await db(), await row(php));
    expect(spec.env.PHP_INI_SCAN_DIR).toBe(":/etc/gereh/php");
  });

  it("gereh.json hooks and health check are applied to the app", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    const m = parseManifest(JSON.stringify({ hooks: { preStart: "./warm.sh" }, healthcheck: { path: "/hz", type: "http", retries: 5 } })).manifest!;
    const changes = await applyManifest(await db(), await row(id), m);
    expect(changes).toEqual(expect.arrayContaining(["healthcheck.path: /hz", "hooks.preStart: ./warm.sh", "healthcheck.retries: 5"]));
    const view = await call<View>("paas.runtime", id);
    expect(view.config).toMatchObject({ preStart: "./warm.sh", healthRetries: 5 });
    expect((await row(id)).healthPath).toBe("/hz");
  });
});

describe("deploy failures, limits and events", () => {
  it("classifies simulated failures and keeps the explanation on the deployment", async () => {
    await asUser();
    for (const [name, url, kind] of [["rt-deps", "https://github.com/acme/sim-baddeps.git", "deps"], ["rt-start", "https://github.com/acme/sim-nostart.git", "start"], ["rt-oom", "https://github.com/acme/sim-oom.git", "oom"], ["rt-port", "https://github.com/acme/sim-badport.git", "port"], ["rt-health", "https://github.com/acme/sim-unhealthy.git", "health"]]) {
      const id = await call<string>("paas.createApp", gitApp({ name, gitUrl: url }));
      await settle();
      const [d] = await deps(id);
      expect(d.status).toBe("failed");
      expect((await call<{ failure: string }>("paas.deployment", d.id)).failure).toBe(kind);
    }
  });

  it("build timeout follows the plan's limit", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    const { paasBuild, paasPoll } = await import("@/server/worker/paas");
    process.env.PAAS_SIM_BUILD_SECONDS = "100000";
    try {
      const d = await call<string>("paas.deploy", id, {});
      const x = await db();
      await paasBuild(x, { deploymentId: d });
      await paasPoll(x, { deploymentId: d, phase: "build", handle: d, since: Date.now() - 21 * 60_000 });
      const dep = (await deps(id)).find((y) => y.id === d)!;
      expect(dep.status).toBe("failed");
      expect(dep.failure).toBe("timeout");
      expect(dep.log).toContain("20 minutes");
    } finally { process.env.PAAS_SIM_BUILD_SECONDS = "0"; }
  });

  it("enforces deploys per day and records power and scale events", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    await (await db()).update(paasPlans).set({ deploysPerDay: 2 }).where(eq(paasPlans.id, "app-micro"));
    await call("paas.deploy", id, {});
    await settle();
    expect(await fails("paas.deploy", id, {})).toContain("سقف");
    await call("paas.power", id, "restart");
    await call("paas.scale", id, { planId: "app-micro", instances: 2, autoscale: false, maxInstances: 2, diskGb: 0 });
    const view = await call<View>("paas.runtime", id);
    expect(view.limits).toMatchObject({ deploysPerDay: 2, deploysToday: 2 });
    expect(view.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["deploy", "restart", "scale"]));
  });

  it("collects traffic, crash events and the outbound IPs", async () => {
    process.env.PAAS_EGRESS_IPS = "185.1.2.3, 185.1.2.4";
    try {
      await asUser();
      const id = await call<string>("paas.createApp", gitApp({ name: "sim-crashy" }));
      await settle();
      await call("paas.setRuntime", id, { trafficAlertGb: 1 });
      const x = await db();
      await x.insert(paasTraffic).values({ appId: id, day: "2000-01-01", bytes: 5 });
      await paasCollect(x);
      const t = await x.select().from(paasTraffic).where(eq(paasTraffic.appId, id));
      expect(t.some((r) => r.day !== "2000-01-01" && r.bytes > 0)).toBe(true);
      const view = await call<View>("paas.runtime", id);
      expect(view.egressIps).toEqual(["185.1.2.3", "185.1.2.4"]);
      expect(view.events.map((e) => e.kind)).toContain("crash");
      expect(view.traffic.monthBytes).toBeGreaterThan(0);
      // over the alert: one notice per month
      await x.update(paasTraffic).set({ bytes: 2 * 1024 ** 3 }).where(and(eq(paasTraffic.appId, id)));
      await paasCollect(x);
      await paasCollect(x);
      const ev = await x.select().from(paasEvents).where(and(eq(paasEvents.appId, id), eq(paasEvents.kind, "traffic")));
      expect(ev).toHaveLength(1);
    } finally { delete process.env.PAAS_EGRESS_IPS; }
  });
});

describe("budget", () => {
  it("records spend, alerts at the threshold and stops the app at the cap", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await settle();
    await call("paas.setRuntime", id, { budget: 100_000, budgetAlertPct: 50, budgetStop: true });
    const x = await db();
    await paasBilling(x);
    const [s] = await x.select().from(paasSpend).where(eq(paasSpend.appId, id));
    expect(s.amount).toBeGreaterThan(0);
    await recordSpend(x, [{ appId: id, amount: 60_000 - s.amount }]);
    await paasBudgets(x);
    let [rt] = await x.select().from(paasRuntime).where(eq(paasRuntime.appId, id));
    expect(rt.budgetNotified).toBe(monthKey() + ":alert");
    expect((await row(id)).status).toBe("running");
    await recordSpend(x, [{ appId: id, amount: 50_000 }]);
    await paasBudgets(x);
    await paasBudgets(x);
    [rt] = await x.select().from(paasRuntime).where(eq(paasRuntime.appId, id));
    expect(rt.budgetNotified).toBe(monthKey() + ":cap");
    expect((await row(id)).status).toBe("stopped");
    expect((await x.select().from(paasEvents).where(and(eq(paasEvents.appId, id), eq(paasEvents.kind, "budget"))))).toHaveLength(2);
    const view = await call<View>("paas.runtime", id);
    expect(view.spend.amount).toBeGreaterThanOrEqual(100_000);
  });
});

describe("domains, basic auth and cloning", () => {
  it("redirects, wildcard, default subdomain, move and basic auth", async () => {
    await asUser();
    const a = await call<string>("paas.createApp", gitApp());
    const b = await call<string>("paas.createApp", gitApp({ name: "rt-other" }));
    await settle();
    const d1 = await call<string>("paas.addDomain", a, "shop.example.ir");
    const d2 = await call<string>("paas.addDomain", a, "old.example.ir");
    const w = await call<string>("paas.addDomain", a, "*.tenants.example.ir");
    expect(w).toMatch(/^pdm-/);
    expect(await fails("paas.addDomain", a, "*.bad")).toContain("دامنه");
    expect(await fails("paas.setRedirect", d2, { target: "ftp://x", code: 301, keepPath: true })).toContain("مقصد");
    await call("paas.setRedirect", d2, { target: "https://shop.example.ir", code: 302, keepPath: false });
    await call("paas.setRuntime", a, { defaultDomain: false });
    await call("paas.setBasicAuth", a, { path: "/admin", user: "boss", password: "long-password" });
    expect(await fails("paas.setBasicAuth", a, { path: "admin", user: "boss", password: "long-password" })).toContain("/");

    const spec = await appSpec(await db(), await row(a));
    const ings = ingressObjects(spec) as { metadata: { name: string; annotations: Record<string, string> }; spec: { rules: { host: string; http: { paths: { path: string }[] } }[] } }[];
    const main = ings.find((i) => i.metadata.name === "rt-app")!;
    expect(main.spec.rules.map((r) => r.host)).toEqual(["shop.example.ir"]);
    expect(ings.find((i) => i.metadata.name === "rt-app-wild")!.spec.rules[0].host).toBe("*.tenants.example.ir");
    const redir = ings.find((i) => i.metadata.annotations["nginx.ingress.kubernetes.io/temporal-redirect"])!;
    expect(redir.metadata.annotations["nginx.ingress.kubernetes.io/temporal-redirect"]).toBe("https://shop.example.ir");
    const auth = ings.find((i) => i.metadata.name === "rt-app-auth")!;
    expect(auth.spec.rules[0].http.paths[0].path).toBe("/admin");
    expect(auth.metadata.annotations["nginx.ingress.kubernetes.io/auth-secret"]).toBe("rt-app-basic-auth");
    const secret = appObjects(spec, "img", "d").find((o) => (o.metadata as { name: string }).name === "rt-app-basic-auth") as { stringData: { auth: string } };
    expect(secret.stringData.auth).toMatch(/^boss:\{SSHA\}/);

    // the last serving domain cannot leave while the default subdomain is off
    await call("paas.moveDomain", w, b);
    expect(await fails("paas.moveDomain", d1, b)).toContain("آخرین");
    await call("paas.setRuntime", a, { defaultDomain: true });
    await call("paas.moveDomain", d1, b);
    const view = await call<View>("paas.runtime", a);
    expect(view.redirects).toEqual([expect.objectContaining({ domainId: d2, code: 302 })]);
    expect((await appSpec(await db(), await row(b))).hosts).toContain("shop.example.ir");
  });

  it("clones settings, env, processes, crons and options without data", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp({ env: [{ key: "A", value: "1", secret: false }, { key: "S", value: "x", secret: true }] }));
    await settle();
    await call("paas.setProcesses", id, [{ name: "worker", command: "node worker.js", instances: 1 }]);
    await call("paas.saveCron", id, { name: "nightly", schedule: "0 3 * * *", command: "node job.js", enabled: true });
    await call("paas.setRuntime", id, { preStart: "echo hi", timezone: "UTC" });
    const copy = await call<string>("paas.cloneApp", id, "rt-copy");
    await settle();
    const c = await row(copy);
    expect(c).toMatchObject({ status: "running", workerInstances: 1, gitUrl: "https://github.com/acme/api.git" });
    const spec = await appSpec(await db(), c);
    expect(spec.env).toMatchObject({ A: "1", S: "x", TZ: "UTC" });
    expect(spec.processes).toEqual([{ name: "worker", command: "node worker.js", instances: 1 }]);
    expect(spec.crons.map((x) => x.name)).toEqual(["nightly"]);
    expect(spec.runtime!.preStart).toBe("echo hi");
    expect(spec.hosts).toHaveLength(1);
    expect(await fails("paas.cloneApp", id, "rt-copy")).toContain("گرفته");
    const env = await (await db()).select().from(paasEnv).where(eq(paasEnv.appId, copy));
    expect(env).toHaveLength(2);
  });

  it("only the owner reads or changes an app's options; staff edit plan limits", async () => {
    await asUser();
    const id = await call<string>("paas.createApp", gitApp());
    await (await db()).update(users).set({ balance: 10_000_000 }).where(eq(users.email, "admin@gereh.net"));
    await asAdmin();
    expect(await fails("paas.runtime", id)).toContain("پیدا نشد");
    expect(await fails("paas.setRuntime", id, { timezone: "UTC" })).toContain("پیدا نشد");
    const limits = await call<{ id: string; deploysPerDay: number; maxBuildMinutes: number }[]>("paas.adminPlanLimits");
    expect(limits.find((l) => l.id === "app-nano")).toMatchObject({ deploysPerDay: 10, maxBuildMinutes: 15 });
    await call("paas.adminSetPlanLimits", "app-nano", { deploysPerDay: 5, maxBuildMinutes: 10 });
    expect((await call<{ id: string; deploysPerDay: number }[]>("paas.adminPlanLimits")).find((l) => l.id === "app-nano")!.deploysPerDay).toBe(5);
    await asUser();
    expect(await fails("paas.adminPlanLimits")).toBeTruthy();
  });
});

describe("kubernetes manifests", () => {
  const base: AppSpec = {
    id: "app-k1", userId: "u-1", name: "web", stack: "php", source: "git", gitUrl: "https://g/x.git", gitBranch: "main", image: "", rootDir: "", buildCommand: "", startCommand: "php-fpm",
    port: 8080, healthPath: "/hz", cpu: 1, ramMb: 1024, instances: 2, autoscale: false, maxInstances: 2, autoscaleCpu: 70, diskGb: 0, diskMount: "/data", env: {}, hosts: ["web.gereh.dev"],
    cdn: false, cacheVersion: 1, releaseCommand: "", processes: [], crons: [],
    runtime: {
      preBuild: "composer lint", postBuild: "rm -rf tests", preStart: "php artisan config:cache",
      health: { type: "http", command: "", codes: "200,204", interval: 10, timeout: 2, retries: 4, startPeriod: 60 }, zeroDowntime: true,
      build: { cache: false, mirror: false, args: { APP_ENV: "prod" }, dockerfile: "docker/Dockerfile", timeoutMin: 15 },
      timezone: "Asia/Tehran", readOnlyFs: true, dns: ["1.1.1.1", "8.8.8.8", "9.9.9.9", "4.4.4.4"], nginxConf: "server { listen 8080; }", phpIni: "memory_limit = 512M",
      defaultDomain: true, basicAuth: null, redirects: [],
    },
  };
  type Dep = { spec: { strategy: { type: string }; minReadySeconds?: number; template: { spec: Record<string, any> } } };
  it("default health settings: liveness only checks the port, so a slow app (n8n) is not restarted in a loop", () => {
    const rt = { ...base.runtime!, health: { type: "http" as const, command: "", codes: "200-399", interval: 5, timeout: 3, retries: 3, startPeriod: 0 }, readOnlyFs: false, nginxConf: "", phpIni: "" };
    const dep = appObjects({ ...base, stack: "image", image: "n8nio/n8n:2.44.0", port: 5678, healthPath: "/healthz", startCommand: "", runtime: rt }, "n8nio/n8n:2.44.0", "dep-2").find((o) => o.kind === "Deployment") as unknown as Dep;
    const c = dep.spec.template.spec.containers[0];
    expect(c.readinessProbe).toMatchObject({ httpGet: { path: "/healthz", port: 5678 }, timeoutSeconds: 5 });
    expect(c.startupProbe.failureThreshold).toBe(60);
    expect(c.livenessProbe).toMatchObject({ tcpSocket: { port: 5678 }, failureThreshold: 6, timeoutSeconds: 5 });
  });

  it("deployment: probes, strategy, pre-start, read-only root, DNS and config mounts", () => {
    const objs = appObjects(base, "img:1", "dep-1");
    const dep = objs.find((o) => o.kind === "Deployment") as unknown as Dep;
    const pod = dep.spec.template.spec, c = pod.containers[0];
    expect(dep.spec.strategy.type).toBe("RollingUpdate");
    expect(dep.spec.minReadySeconds).toBe(3);
    expect(c.readinessProbe.exec.command[2]).toContain("200|204");
    expect(c.readinessProbe).toMatchObject({ periodSeconds: 10, timeoutSeconds: 2, failureThreshold: 4 });
    expect(c.startupProbe.failureThreshold).toBe(16);
    expect(c.livenessProbe.exec).toBeTruthy();
    expect(c.command[2]).toBe("set -e\nphp artisan config:cache\nphp-fpm");
    expect(c.securityContext.readOnlyRootFilesystem).toBe(true);
    expect(c.volumeMounts.map((m: { mountPath: string }) => m.mountPath)).toEqual(expect.arrayContaining(["/tmp", "/etc/nginx/conf.d/default.conf", "/etc/gereh/php/zz-gereh.ini"]));
    expect(pod.dnsPolicy).toBe("None");
    expect(pod.dnsConfig.nameservers).toEqual(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
    expect(objs.find((o) => o.kind === "ConfigMap")).toMatchObject({ data: { "nginx.conf": "server { listen 8080; }", "php.ini": "memory_limit = 512M" } });
    const noZd = appObjects({ ...base, startCommand: "", runtime: { ...base.runtime!, zeroDowntime: false } }, "img:1", "dep-1").find((o) => o.kind === "Deployment") as unknown as Dep;
    expect(noZd.spec.strategy.type).toBe("Recreate");
    expect(noZd.spec.template.spec.initContainers[0]).toMatchObject({ name: "pre-start", command: ["/bin/sh", "-c", "php artisan config:cache"] });
    expect(healthProbe({ ...base, runtime: { ...base.runtime!, health: { ...base.runtime!.health, codes: "200-399" } } }, 8080)).toMatchObject({ httpGet: { path: "/hz", port: 8080 } });
    expect(healthProbe({ ...base, runtime: { ...base.runtime!, health: { ...base.runtime!.health, type: "tcp" } } }, 8080)).toMatchObject({ tcpSocket: { port: 8080 } });
  });
  it("build job: cache, args, Dockerfile path, hooks and the plan's deadline", () => {
    const job = buildJob({ ...base, noCache: true }, "dep-x") as { spec: { activeDeadlineSeconds: number; template: { spec: { initContainers: { command: string[] }[]; containers: { args: string[] }[] } } } };
    const args = job.spec.template.spec.containers[0].args, prep = job.spec.template.spec.initContainers[0].command[2];
    expect(job.spec.activeDeadlineSeconds).toBe(900);
    expect(args).toContain("--cache=false");
    expect(args).toContain("--build-arg=APP_ENV=prod");
    expect(args.some((a) => a.includes("NPM_CONFIG_REGISTRY"))).toBe(false);
    expect(prep).toContain("'docker/Dockerfile'");
    expect(prep).toContain("PRE='composer lint'");
    expect(prep).toContain('["/bin/sh","-c","rm -rf tests"]');
    expect(prep).toContain(".hooks.preBuild");
  });
});
