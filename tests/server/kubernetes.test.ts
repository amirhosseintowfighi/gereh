/* eslint-disable @typescript-eslint/no-explicit-any -- assertions walk deeply nested manifest JSON */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppSpec, DbSpec } from "@/server/paas/driver";
import type { ComposeService } from "@/server/paas/compose";
import { appObjects, buildJob, dbObjects, dumpCommand, KubernetesDriver, nsOf, parseCpu, parseMem, redisRestoreScript, restoreCommand, serviceObjects } from "@/server/paas/kubernetes";

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
  env: { PORT: "3000", API_KEY: "s3cret" }, hosts: ["shop.gereh.dev"], cdn: false, cacheVersion: 1, ...over,
});
const db = (over: Partial<DbSpec> = {}): DbSpec => ({ id: "pdb-1", userId: "u1", name: "shop", engine: "postgres", version: "16", cpu: 1, ramMb: 1024, diskGb: 10, username: "shop", password: "pw", dbName: "shop", publicAccess: false, ...over });
const kinds = (objs: Record<string, unknown>[]) => objs.map((o) => o.kind);

describe("kubernetes manifests", () => {
  it("app: env secret, deployment with probes and limits, service, ingress", () => {
    const objs = appObjects(app(), "reg.test/u1/shop:dep-1", "dep-1");
    expect(kinds(objs)).toEqual(["Secret", "Deployment", "Ingress"]);
    expect((serviceObjects(app(), "img") as never as Record<string, any>[])[0].spec.ports).toEqual([{ name: "http", port: 80, targetPort: 3000 }]);
    const [secret, dep, ing] = objs as never as Record<string, any>[];
    expect(secret.metadata.namespace).toBe(nsOf("u1"));
    expect(secret.stringData).toMatchObject({ API_KEY: "s3cret", GEREH_DEPLOYMENT: "dep-1" });
    const c = dep.spec.template.spec.containers[0];
    expect(dep.spec.replicas).toBe(2);
    expect(c.resources.limits).toEqual({ cpu: "1000m", memory: "1024Mi" });
    expect(c.readinessProbe.httpGet).toEqual({ path: "/health", port: 3000 });
    expect(dep.spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(dep.spec.strategy.rollingUpdate.maxUnavailable).toBe(0);
    // default host relies on the controller's wildcard cert; no cert-manager without custom domains
    expect(ing.spec.tls).toEqual([{ hosts: ["shop.gereh.dev"] }]);
    expect(ing.metadata.annotations["cert-manager.io/cluster-issuer"]).toBeUndefined();
  });

  it("CDN adds the edge-cache snippet with a versioned key; off by default", () => {
    const ing = (a: Partial<AppSpec>) => (appObjects(app(a), "img", "d").find((o) => o.kind === "Ingress") as Record<string, any>).metadata.annotations;
    expect(ing({})["nginx.ingress.kubernetes.io/configuration-snippet"]).toBeUndefined();
    const snip = ing({ cdn: true, cacheVersion: 4 })["nginx.ingress.kubernetes.io/configuration-snippet"];
    expect(snip).toContain("proxy_cache gereh_cdn;");
    expect(snip).toContain('$request_uri|v4"');
  });

  it("custom domains, disk and autoscale add TLS, PVC and HPA", () => {
    const objs = appObjects(app({ hosts: ["shop.gereh.dev", "www.shop.ir"], autoscale: true, maxInstances: 6, diskGb: 5, instances: 1 }), "img", "dep-2") as never as Record<string, any>[];
    expect(kinds(objs)).toEqual(["Secret", "Deployment", "Ingress", "PersistentVolumeClaim", "HorizontalPodAutoscaler"]);
    const dep = objs[1], ing = objs[2], hpa = objs[4];
    expect(dep.spec.replicas).toBeUndefined(); // the HPA owns replicas
    expect(dep.spec.strategy).toEqual({ type: "Recreate" }); // RWO disk
    expect(ing.spec.tls[1]).toEqual({ hosts: ["www.shop.ir"], secretName: "shop-tls" });
    expect(ing.metadata.annotations["cert-manager.io/cluster-issuer"]).toBe("letsencrypt");
    expect(ing.spec.rules.map((r: { host: string }) => r.host)).toEqual(["shop.gereh.dev", "www.shop.ir"]);
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

  it("build job: the package mirror feeds base images and npm/pip/Go installs", () => {
    process.env.PAAS_MIRROR = "https://mirror.test/";
    try {
      const job = buildJob(app(), "dep-9") as Record<string, any>;
      const prep = job.spec.template.spec.initContainers[0].command[2] as string;
      expect(prep).toContain("--env 'NPM_CONFIG_REGISTRY=https://mirror.test/repository/npm/'");
      const args = job.spec.template.spec.containers[0].args as string[];
      expect(args).toContain("--registry-mirror=mirror.test");
      expect(args).toContain("--build-arg=PIP_INDEX_URL=https://mirror.test/repository/pypi/simple");
    } finally { delete process.env.PAAS_MIRROR; }
    expect((buildJob(app(), "dep-9") as Record<string, any>).spec.template.spec.containers[0].args.some((a: string) => a.startsWith("--registry-mirror"))).toBe(false);
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
    expect(redisRestoreScript).toContain("config set appendonly yes");
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
    expect(patches.map((h) => (h.body as { kind: string }).kind)).toEqual(["Namespace", "NetworkPolicy", "LimitRange", "Service", "Secret", "Deployment", "Ingress"]);
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

  it("rollout readiness requires every workload of the app to be rolled out", async () => {
    const d = new KubernetesDriver();
    const path = "GET /apis/apps/v1/namespaces/gereh-u-u1/deployments";
    const ready = { metadata: { name: "shop", generation: 3 }, spec: { replicas: 2 }, status: { observedGeneration: 3, updatedReplicas: 2, availableReplicas: 2, replicas: 2 } };
    answers[path] = { items: [] };
    expect(await d.rolloutReady(app())).toBe(false);
    answers[path] = { items: [{ ...ready, status: { observedGeneration: 3, updatedReplicas: 1, availableReplicas: 2, replicas: 3 } }] };
    expect(await d.rolloutReady(app())).toBe(false);
    answers[path] = { items: [ready, { metadata: { name: "shop-worker", generation: 1 }, spec: { replicas: 1 }, status: { observedGeneration: 1, updatedReplicas: 0, availableReplicas: 0, replicas: 1 } }] };
    expect(await d.rolloutReady(app())).toBe(false);
    answers[path] = { items: [ready] };
    expect(await d.rolloutReady(app())).toBe(true);
    expect(hits.at(-1)!.path).toContain("labelSelector=gereh.net%2Fapp%3Dapp-1");
  });

  it("API errors surface with status; deletes ignore 404", async () => {
    const d = new KubernetesDriver();
    answers["GET /apis/apps/v1/namespaces/gereh-u-u1/deployments"] = 403;
    await expect(d.rolloutReady(app())).rejects.toThrow(/403/);
    delete answers["GET /apis/apps/v1/namespaces/gereh-u-u1/deployments"];
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

const composeImage = (services: ComposeService[]) => "compose:" + JSON.stringify(services);
const stack: ComposeService[] = [
  { name: "web", build: { context: "web" }, image: "reg.test/u1/shop-web:dep-5", port: 3000, env: { REDIS_HOST: "cache", API_KEY: "from-compose" }, public: true },
  { name: "worker", build: { context: "web" }, image: "reg.test/u1/shop-worker:dep-5", command: "node worker.js", env: {}, public: false },
  { name: "cache", image: "redis:7-alpine", port: 6379, env: {}, public: false },
];

describe("compose on kubernetes", () => {
  it("one deployment per service; the public one keeps the app's name, URL and probes", () => {
    const svcs = serviceObjects(app(), composeImage(stack)) as never as Record<string, any>[];
    expect(svcs.map((o) => o.metadata.name)).toEqual(["shop", "shop-cache"]); // worker has no port → no Service
    expect(svcs[0].spec.ports).toEqual([{ name: "http", port: 80, targetPort: 3000 }, { name: "internal", port: 3000, targetPort: 3000 }]);
    const objs = appObjects(app(), composeImage(stack), "dep-5", { web: "10.0.0.5", cache: "10.0.0.9" }) as never as Record<string, any>[];
    const deps = objs.filter((o) => o.kind === "Deployment");
    expect(deps.map((o) => o.metadata.name)).toEqual(["shop", "shop-worker", "shop-cache"]);
    const [web, worker, cache] = deps.map((o) => o.spec.template.spec);
    expect(web.containers[0].readinessProbe.httpGet).toEqual({ path: "/health", port: 3000 });
    expect(worker.containers[0].readinessProbe).toBeUndefined();
    expect(worker.containers[0].command).toEqual(["/bin/sh", "-c", "node worker.js"]);
    expect(cache.containers[0].image).toBe("redis:7-alpine");
    // services find each other by compose name
    expect(web.hostAliases).toEqual([{ ip: "10.0.0.5", hostnames: ["web"] }, { ip: "10.0.0.9", hostnames: ["cache"] }]);
    // panel variables (API_KEY) beat compose defaults; the rest come through
    expect(web.containers[0].env).toEqual([{ name: "REDIS_HOST", value: "cache" }]);
    expect(deps[0].spec.replicas).toBe(2);
    expect(deps[1].spec.replicas).toBe(1);
    // plan shared by three services: requests split, limits full
    expect(web.containers[0].resources).toEqual({ requests: { cpu: "167m", memory: "342Mi" }, limits: { cpu: "1000m", memory: "1024Mi" } });
    expect(objs.find((o) => o.kind === "Secret")!.stringData.PORT).toBe("3000");
  });

  it("builds each service with its own context and image", async () => {
    const d = new KubernetesDriver();
    const handle = await d.startBuild(app({ source: "compose" }), "dep-5", "https://site/src", stack.map(({ image, ...s }) => (s.build ? s : { ...s, image })));
    const jobs = hits.filter((h) => h.path.includes("/jobs/")).map((h) => h.body as any);
    expect(jobs.map((j) => j.metadata.name)).toEqual(["build-dep-5-web", "build-dep-5-worker"]);
    expect(jobs[0].spec.template.spec.containers[0].args).toContain("--destination=reg.test/u1/shop-web:dep-5");
    expect(jobs[0].spec.template.spec.containers[0].args).toContain("--context=dir:///workspace/src/web");
    for (const n of ["web", "worker"]) answers["GET /apis/batch/v1/namespaces/gereh-system/jobs/build-dep-5-" + n] = { status: { succeeded: 1 } };
    const b = await d.buildStatus(app(), handle);
    expect(b.state).toBe("succeeded");
    const built = JSON.parse(b.image!.slice(8)) as ComposeService[];
    expect(built.map((s) => s.image)).toEqual(["reg.test/u1/shop-web:dep-5", "reg.test/u1/shop-worker:dep-5", "redis:7-alpine"]);
    answers["GET /apis/batch/v1/namespaces/gereh-system/jobs/build-dep-5-worker"] = { status: { failed: 1 } };
    expect(await d.buildStatus(app(), handle)).toMatchObject({ state: "failed" });
  });

  it("release wires cluster IPs into host aliases and prunes services removed from the file", async () => {
    const d = new KubernetesDriver();
    answers["PATCH /api/v1/namespaces/gereh-u-u1/services/shop"] = { spec: { clusterIP: "10.0.0.5" } };
    answers["PATCH /api/v1/namespaces/gereh-u-u1/services/shop-cache"] = { spec: { clusterIP: "10.0.0.9" } };
    answers["GET /apis/apps/v1/namespaces/gereh-u-u1/deployments"] = { items: [{ metadata: { name: "shop" } }, { metadata: { name: "shop-old" } }] };
    await d.release(app(), composeImage(stack), "dep-5");
    const web = hits.find((h) => h.method === "PATCH" && h.path.startsWith("/apis/apps/v1/namespaces/gereh-u-u1/deployments/shop?"))!.body as any;
    expect(web.spec.template.spec.hostAliases).toEqual([{ ip: "10.0.0.5", hostnames: ["web"] }, { ip: "10.0.0.9", hostnames: ["cache"] }]);
    expect(hits.some((h) => h.method === "DELETE" && h.path.startsWith("/apis/apps/v1/namespaces/gereh-u-u1/deployments/shop-old"))).toBe(true);
    expect(hits.some((h) => h.method === "DELETE" && h.path.startsWith("/apis/apps/v1/namespaces/gereh-u-u1/deployments/shop?"))).toBe(false);
  });
});

describe("prometheus and redis restore", () => {
  it("reads requests per minute per ingress through the API proxy", async () => {
    process.env.PAAS_PROMETHEUS = "monitoring/prometheus-server:80";
    try {
      answers["GET /api/v1/namespaces/monitoring/services/prometheus-server:80/proxy/api/v1/query"] = { data: { result: [
        { metric: { exported_namespace: "gereh-u-u1", namespace: "ingress-nginx", ingress: "shop" }, value: [0, "41.6"] },
        { metric: { namespace: "gereh-u-u2", ingress: "blog" }, value: [0, "3"] },
      ] } };
      const r = await new KubernetesDriver().requestRates();
      expect(r.get("gereh-u-u1/shop")).toBe(42);
      expect(r.get("gereh-u-u2/blog")).toBe(3);
    } finally { delete process.env.PAAS_PROMETHEUS; }
  });

  it("redis: presigned link, stop, restore job on the volume, start again", async () => {
    const d = new KubernetesDriver();
    const r = db({ engine: "redis", version: "7.4" });
    answers["GET /api/v1/namespaces/gereh-system/pods"] = { items: [{ metadata: { name: "share-x" } }] };
    answers["GET /api/v1/namespaces/gereh-system/pods/share-x/log"] = "URL=http://minio.gereh-system.svc:9000/gereh-backups/k?X-Amz-Signature=abc\n";
    answers["GET /api/v1/namespaces/gereh-u-u1/pods"] = { items: [] };
    // every Job reports success as soon as it is read
    const jobDone = { status: { succeeded: 1 } };
    const origPush = hits.push.bind(hits);
    hits.push = (...h: Hit[]) => { for (const x of h) if (x.method === "PATCH" && x.path.includes("/jobs/")) answers["GET " + x.path.split("?")[0]] = jobDone; return origPush(...h); };
    await d.restoreDb(r, "s3://gereh-backups/u1/pdb-1/bk.dump");
    const scales = hits.filter((h) => h.path.startsWith("/apis/apps/v1/namespaces/gereh-u-u1/statefulsets/db-shop")).map((h) => (h.body as any).spec.replicas);
    expect(scales).toEqual([0, 1]);
    const job = hits.find((h) => h.method === "PATCH" && h.path.startsWith("/apis/batch/v1/namespaces/gereh-u-u1/jobs/"))!.body as any;
    expect(job.spec.template.spec.volumes[0].persistentVolumeClaim.claimName).toBe("data-db-shop-0");
    expect(job.spec.template.spec.containers[0].env).toEqual([{ name: "URL", value: "http://minio.gereh-system.svc:9000/gereh-backups/k?X-Amz-Signature=abc" }]);
    expect(JSON.stringify(job)).not.toContain("S3_SECRET_KEY");
  });
});
