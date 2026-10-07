/* eslint-disable @typescript-eslint/no-explicit-any -- assertions walk deeply nested manifest JSON */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppSpec, DbSpec } from "@/server/paas/driver";
import { appObjects, buildJob, dbObjects, dumpCommand, KubernetesDriver, nsOf, parseCpu, parseMem, restoreCommand } from "@/server/paas/kubernetes";

/* a tiny fake API server: records requests, answers from a per-path table */
type Hit = { method: string; path: string; type: string; auth: string; body: unknown };
let hits: Hit[] = [];
let answers: Record<string, unknown> = {};
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = req.url!.split("?")[0];
      hits.push({ method: req.method!, path: req.url!, type: String(req.headers["content-type"] || ""), auth: String(req.headers.authorization || ""), body: raw ? JSON.parse(raw) : undefined });
      const key = req.method + " " + path;
      if (key in answers) {
        const a = answers[key];
        if (typeof a === "number") { res.writeHead(a, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "nope" })); return; }
        if (typeof a === "string") { res.writeHead(200, { "content-type": "text/plain" }); res.end(a); return; }
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(a)); return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.method === "PATCH" ? JSON.parse(raw || "{}") : { items: [] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.PAAS_K8S_API = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  process.env.PAAS_K8S_TOKEN = "test-token";
  process.env.PAAS_REGISTRY = "reg.test";
});
afterAll(() => { server.close(); delete process.env.PAAS_K8S_API; delete process.env.PAAS_K8S_TOKEN; });
beforeEach(() => { hits = []; answers = {}; });

const app = (over: Partial<AppSpec> = {}): AppSpec => ({
  id: "app-1", userId: "u1", name: "shop", stack: "nextjs", source: "git", gitUrl: "https://tok@github.com/acme/shop.git", gitBranch: "main", image: "", rootDir: "", buildCommand: "", startCommand: "",
  port: 3000, healthPath: "/health", cpu: 1, ramMb: 1024, instances: 2, autoscale: false, maxInstances: 2, diskGb: 0, diskMount: "/data",
  env: { PORT: "3000", API_KEY: "s3cret" }, hosts: ["shop.gereh.app"], ...over,
});
const db = (over: Partial<DbSpec> = {}): DbSpec => ({ id: "pdb-1", userId: "u1", name: "shop", engine: "postgres", version: "16", cpu: 1, ramMb: 1024, diskGb: 10, username: "shop", password: "pw", dbName: "shop", publicAccess: false, ...over });
const kinds = (objs: Record<string, unknown>[]) => objs.map((o) => o.kind);

describe("kubernetes manifests", () => {
  it("app: env secret, deployment with probes and limits, service, ingress", () => {
    const objs = appObjects(app(), "reg.test/u1/shop:dep-1", "dep-1");
    expect(kinds(objs)).toEqual(["Secret", "Deployment", "Service", "Ingress"]);
    const [secret, dep, , ing] = objs as never as Record<string, any>[];
    expect(secret.metadata.namespace).toBe(nsOf("u1"));
    expect(secret.stringData).toMatchObject({ API_KEY: "s3cret", GEREH_DEPLOYMENT: "dep-1" });
    const c = dep.spec.template.spec.containers[0];
    expect(dep.spec.replicas).toBe(2);
    expect(c.resources.limits).toEqual({ cpu: "1000m", memory: "1024Mi" });
    expect(c.readinessProbe.httpGet).toEqual({ path: "/health", port: 3000 });
    expect(dep.spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(dep.spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
    // default host relies on the controller's wildcard cert; no cert-manager without custom domains
    expect(ing.spec.tls).toEqual([{ hosts: ["shop.gereh.app"] }]);
    expect(ing.metadata.annotations["cert-manager.io/cluster-issuer"]).toBeUndefined();
  });

  it("custom domains, disk and autoscale add TLS, PVC and HPA", () => {
    const objs = appObjects(app({ hosts: ["shop.gereh.app", "www.shop.ir"], autoscale: true, maxInstances: 6, diskGb: 5, instances: 1 }), "img", "dep-2") as never as Record<string, any>[];
    expect(kinds(objs)).toEqual(["Secret", "Deployment", "Service", "Ingress", "PersistentVolumeClaim", "HorizontalPodAutoscaler"]);
    const dep = objs[1], ing = objs[3], hpa = objs[5];
    expect(dep.spec.replicas).toBeUndefined(); // the HPA owns replicas
    expect(dep.spec.strategy).toEqual({ type: "Recreate" }); // RWO disk
    expect(ing.spec.tls[1]).toEqual({ hosts: ["www.shop.ir"], secretName: "shop-tls" });
    expect(ing.metadata.annotations["cert-manager.io/cluster-issuer"]).toBe("letsencrypt");
    expect(ing.spec.rules.map((r: { host: string }) => r.host)).toEqual(["shop.gereh.app", "www.shop.ir"]);
    expect(hpa.spec).toMatchObject({ minReplicas: 1, maxReplicas: 6 });
  });

  it("build job: git clone hides tokens, nixpacks fallback, kaniko pushes the tagged image", () => {
    const job = buildJob(app({ buildCommand: "npm run build:prod", rootDir: "apps/web" }), "dep-AB12") as Record<string, any>;
    expect(job.metadata).toMatchObject({ name: "build-dep-ab12", namespace: "gereh-system" });
    const prep = job.spec.template.spec.initContainers[0].command[2] as string;
    expect(prep).toContain("git clone --depth 1 --branch 'main' 'https://tok@github.com/acme/shop.git' src");
    expect(prep).toContain("s#://[^@/]+@#://***@#g");
    expect(prep).toContain("--build-cmd 'npm run build:prod'");
    expect(prep).toContain("cd src/apps/web");
    const args = job.spec.template.spec.containers[0].args as string[];
    expect(args).toContain("--destination=reg.test/u1/shop:dep-ab12");
    expect(args).toContain("--context=dir:///workspace/src/apps/web");
    const zipJob = buildJob(app({ source: "zip" }), "dep-3", "https://site/api/paas/source/dep-3?sig=x") as Record<string, any>;
    expect(zipJob.spec.template.spec.initContainers[0].env).toEqual([{ name: "SOURCE_URL", value: "https://site/api/paas/source/dep-3?sig=x" }]);
  });

  it("databases: prefixed names (no clash with an app of the same name), secrets by reference", () => {
    const objs = dbObjects(db()) as never as Record<string, any>[];
    expect(objs.map((o) => o.metadata.name)).toEqual(["db-shop-auth", "db-shop", "db-shop"]);
    const ct = objs[1].spec.template.spec.containers[0];
    expect(ct.image).toBe("postgres:16-alpine");
    expect(ct.env.find((e: { name: string }) => e.name === "POSTGRES_PASSWORD").valueFrom.secretKeyRef).toEqual({ name: "db-shop-auth", key: "password" });
    expect(objs[1].spec.volumeClaimTemplates[0].spec.resources.requests.storage).toBe("10Gi");
    const redis = dbObjects(db({ engine: "redis", version: "7.4" })) as never as Record<string, any>[];
    expect(redis[1].spec.template.spec.containers[0].command[2]).toContain("--requirepass");
    expect(dumpCommand(db())).toContain("pg_dump -h db-shop.gereh-u-u1.svc.cluster.local");
    expect(() => restoreCommand(db({ engine: "redis" }))).toThrow();
  });

  it("parses metrics-server quantities", () => {
    expect(parseCpu("250m")).toBe(0.25);
    expect(parseCpu("500000000n")).toBe(0.5);
    expect(parseMem("524288Ki")).toBe(512);
    expect(parseMem("1Gi")).toBe(1024);
  });
});

describe("kubernetes driver over HTTP", () => {
  it("release applies the namespace once, then every object with server-side apply", async () => {
    const d = new KubernetesDriver();
    await d.release(app(), "img:1", "dep-1");
    const patches = hits.filter((h) => h.method === "PATCH");
    expect(patches.every((h) => h.type === "application/apply-patch+yaml" && h.path.includes("fieldManager=gereh&force=true"))).toBe(true);
    expect(hits.every((h) => h.auth === "Bearer test-token")).toBe(true);
    expect(patches.map((h) => (h.body as { kind: string }).kind)).toEqual(["Namespace", "NetworkPolicy", "LimitRange", "Secret", "Deployment", "Service", "Ingress"]);
    expect(hits.some((h) => h.method === "DELETE" && h.path.startsWith("/apis/autoscaling/v2/namespaces/gereh-u-u1/horizontalpodautoscalers/shop"))).toBe(true);
    hits = [];
    await d.release(app(), "img:2", "dep-2");
    expect(hits.filter((h) => h.method === "PATCH").map((h) => (h.body as { kind: string }).kind)).not.toContain("Namespace");
  });

  it("build status: running → succeeded with image and commit; failures carry the log", async () => {
    const d = new KubernetesDriver();
    const handle = await d.startBuild(app(), "dep-9");
    expect(handle).toBe("build-dep-9");
    answers["GET /apis/batch/v1/namespaces/gereh-system/jobs/build-dep-9"] = { status: {} };
    answers["GET /api/v1/namespaces/gereh-system/pods"] = { items: [{ metadata: { name: "build-dep-9-x" } }] };
    answers["GET /api/v1/namespaces/gereh-system/pods/build-dep-9-x/log"] = "REF=abc1234\n==> Detecting stack with Nixpacks";
    expect(await d.buildStatus(app(), handle)).toMatchObject({ state: "running" });
    answers["GET /apis/batch/v1/namespaces/gereh-system/jobs/build-dep-9"] = { status: { succeeded: 1 } };
    const ok = await d.buildStatus(app(), handle);
    expect(ok).toMatchObject({ state: "succeeded", image: "reg.test/u1/shop:dep-9", ref: "abc1234" });
    expect(ok.log).not.toContain("REF=");
    answers["GET /apis/batch/v1/namespaces/gereh-system/jobs/build-dep-9"] = { status: { failed: 1, conditions: [{ type: "Failed", status: "True", message: "BackoffLimitExceeded" }] } };
    expect(await d.buildStatus(app(), handle)).toMatchObject({ state: "failed" });
    expect(await d.startBuild(app({ source: "image", image: "nginx:alpine" }), "dep-10")).toBe("image:nginx:alpine");
    expect(await d.buildStatus(app(), "image:nginx:alpine")).toMatchObject({ state: "succeeded", image: "nginx:alpine" });
  });

  it("rollout readiness follows the deployment status", async () => {
    const d = new KubernetesDriver();
    const path = "GET /apis/apps/v1/namespaces/gereh-u-u1/deployments/shop";
    answers[path] = { metadata: { generation: 3 }, spec: { replicas: 2 }, status: { observedGeneration: 3, updatedReplicas: 1, availableReplicas: 2, replicas: 3 } };
    expect(await d.rolloutReady(app())).toBe(false);
    answers[path] = { metadata: { generation: 3 }, spec: { replicas: 2 }, status: { observedGeneration: 3, updatedReplicas: 2, availableReplicas: 2, replicas: 2 } };
    expect(await d.rolloutReady(app())).toBe(true);
  });

  it("API errors surface with status; deletes ignore 404", async () => {
    const d = new KubernetesDriver();
    answers["GET /apis/apps/v1/namespaces/gereh-u-u1/deployments/shop"] = 403;
    await expect(d.rolloutReady(app())).rejects.toThrow(/403/);
    answers["DELETE /apis/networking.k8s.io/v1/namespaces/gereh-u-u1/ingresses/shop"] = 404;
    await expect(d.remove(app())).resolves.toBeUndefined();
  });

  it("public database access opens only that pod and returns the node port", async () => {
    const d = new KubernetesDriver();
    answers["PATCH /api/v1/namespaces/gereh-u-u1/services/db-shop-public"] = { spec: { ports: [{ nodePort: 31234 }] } };
    const r = await d.createDb(db({ publicAccess: true }));
    expect(r).toEqual({ host: "db-shop.gereh-u-u1.svc.cluster.local", port: 5432, publicPort: 31234 });
    const policy = hits.find((h) => h.path.startsWith("/apis/networking.k8s.io/v1/namespaces/gereh-u-u1/networkpolicies/db-shop-public"));
    expect((policy!.body as any).spec.podSelector.matchLabels).toEqual({ "app.kubernetes.io/name": "db-shop" });
  });
});
