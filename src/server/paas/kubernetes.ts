/* Kubernetes driver for Gereh Apps. Talks to the API server directly (no client library):
   server-side apply for every object, so release() is create-or-update and idempotent.

   Layout (see deploy/paas/README.md):
   - one namespace per customer: gereh-u-<user id>; a NetworkPolicy only lets in traffic from the same
     namespace, the ingress controller and the platform namespace
   - builds and backups run as Jobs in the platform namespace (PAAS_SYSTEM_NAMESPACE, default
     gereh-system), which holds the registry push secret and the S3 credentials; customers' namespaces
     never see them
   - builds: an init container fetches the source (git clone or the signed ZIP URL) and, when the project
     has no Dockerfile, writes one with Nixpacks; Kaniko then builds and pushes it to the registry
   - apps: Secret (env) + Deployment + Service + Ingress (+ PVC, HPA); the default host uses the
     controller's default wildcard certificate, custom domains get their own cert from cert-manager
   - databases: StatefulSet with the official image + Service (+ NodePort for public access) */
import "server-only";
import { resolve4, resolveCname } from "node:dns/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { ComposeService } from "./compose";
import type { AppSpec, BuildState, DbSpec, PaasDriver } from "./driver";

type Obj = Record<string, unknown>;
type K8sError = Error & { status?: number };

const env = (k: string, d = "") => process.env[k] || d;
const cfg = () => ({
  api: env("PAAS_K8S_API").replace(/\/$/, ""),
  token: env("PAAS_K8S_TOKEN"),
  ca: env("PAAS_K8S_CA"),
  system: env("PAAS_SYSTEM_NAMESPACE", "gereh-system"),
  ingressNs: env("PAAS_INGRESS_NAMESPACE", "ingress-nginx"),
  ingressClass: env("PAAS_INGRESS_CLASS", "nginx"),
  issuer: env("PAAS_CLUSTER_ISSUER", "letsencrypt"),
  registry: env("PAAS_REGISTRY", "registry.gereh.net"),
  pullSecret: env("PAAS_REGISTRY_PULL_SECRET"), // base64 .dockerconfigjson, copied into each customer namespace
  storageClass: env("PAAS_STORAGE_CLASS"),
  builderImage: env("PAAS_BUILDER_IMAGE", "registry.gereh.net/gereh/builder:1"),
  kanikoImage: env("PAAS_KANIKO_IMAGE", "gcr.io/kaniko-project/executor:v1.23.2"),
  mcImage: env("PAAS_MC_IMAGE", "minio/mc:RELEASE.2025-04-16T18-13-26Z"),
  bucket: env("PAAS_BACKUP_BUCKET", "gereh-backups"),
  ingressIp: env("PAAS_INGRESS_IP"),
  appsDomain: env("PAAS_APPS_DOMAIN", "gereh.dev"),
  // "<namespace>/<service>:<port>" of Prometheus, read through the API server's service proxy
  prometheus: env("PAAS_PROMETHEUS"),
});

const FM = "gereh";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dns1123 = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
export const nsOf = (userId: string) => "gereh-u-" + dns1123(userId);
const appLabels = (a: { name: string; id: string }) => ({ "app.kubernetes.io/name": a.name, "app.kubernetes.io/managed-by": FM, "gereh.net/app": a.id });
/** databases are prefixed: an app and a database may share a name inside one namespace */
export const dbName = (d: { name: string }) => "db-" + d.name;
const dbLabels = (d: { name: string; id: string }) => ({ "app.kubernetes.io/name": dbName(d), "app.kubernetes.io/managed-by": FM, "gereh.net/db": d.id });
const cpuQty = (c: number) => Math.round(c * 1000) + "m";
const memQty = (mb: number) => mb + "Mi";
export const imageFor = (app: Pick<AppSpec, "userId" | "name">, tag: string) => cfg().registry + "/" + dns1123(app.userId) + "/" + app.name + ":" + tag;
const shq = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

/* ---------- HTTP ---------- */
let caCache: string | undefined;
function caPem() {
  const c = cfg().ca;
  if (!c) return undefined;
  if (caCache === undefined) caCache = c.includes("BEGIN CERTIFICATE") ? c : readFileSync(c, "utf8");
  return caCache;
}

export function k8s(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<Obj> {
  const { api, token } = cfg();
  const url = new URL(api + path);
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const lib = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method, ca: caPem(), timeout: 30_000,
      headers: { authorization: "Bearer " + token, accept: "application/json", ...(payload !== undefined ? { "content-type": contentType, "content-length": Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          try { resolve(text && (res.headers["content-type"] || "").includes("json") ? JSON.parse(text) : { text }); } catch { resolve({ text }); }
        } else {
          let msg = text.slice(0, 300);
          try { msg = (JSON.parse(text) as { message?: string }).message || msg; } catch { /* plain text */ }
          const e: K8sError = new Error("Kubernetes " + method + " " + url.pathname + ": " + status + " " + msg);
          e.status = status;
          reject(e);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Kubernetes API timeout")));
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}
const notFound = (e: unknown) => (e as K8sError).status === 404;
const ignore404 = (p: Promise<unknown>) => p.catch((e) => { if (!notFound(e)) throw e; });

/** REST path for a namespaced object */
function pathOf(apiVersion: string, kind: string, ns: string | null, name?: string) {
  const plural = ({ Namespace: "namespaces", Secret: "secrets", Service: "services", PersistentVolumeClaim: "persistentvolumeclaims", Pod: "pods", NetworkPolicy: "networkpolicies", ResourceQuota: "resourcequotas", LimitRange: "limitranges",
    Deployment: "deployments", StatefulSet: "statefulsets", Ingress: "ingresses", Job: "jobs", HorizontalPodAutoscaler: "horizontalpodautoscalers" } as Record<string, string>)[kind];
  const base = apiVersion.includes("/") ? "/apis/" + apiVersion : "/api/" + apiVersion;
  return base + (ns ? "/namespaces/" + ns : "") + "/" + plural + (name ? "/" + name : "");
}
/** server-side apply (create or update) */
export function apply(obj: Obj & { apiVersion: string; kind: string; metadata: { name: string; namespace?: string } }) {
  return k8s("PATCH", pathOf(obj.apiVersion, obj.kind, obj.metadata.namespace ?? null, obj.metadata.name) + "?fieldManager=" + FM + "&force=true", obj, "application/apply-patch+yaml");
}
const del = (apiVersion: string, kind: string, ns: string, name: string) => ignore404(k8s("DELETE", pathOf(apiVersion, kind, ns, name) + "?propagationPolicy=Background"));
const get = (apiVersion: string, kind: string, ns: string, name: string) => k8s("GET", pathOf(apiVersion, kind, ns, name));

/* ---------- manifests (exported for tests) ---------- */
export function namespaceObjects(userId: string): Obj[] {
  const c = cfg(), ns = nsOf(userId);
  const out: Obj[] = [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: ns, labels: { "app.kubernetes.io/managed-by": FM, "gereh.net/user": dns1123(userId), "pod-security.kubernetes.io/enforce": "baseline" } } },
    { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: "isolate", namespace: ns }, spec: {
      podSelector: {}, policyTypes: ["Ingress"],
      ingress: [{ from: [{ podSelector: {} }, { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": c.ingressNs } } }, { namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": c.system } } }] }],
    } },
    { apiVersion: "v1", kind: "LimitRange", metadata: { name: "defaults", namespace: ns }, spec: { limits: [{ type: "Container", default: { cpu: "250m", memory: "256Mi" }, defaultRequest: { cpu: "50m", memory: "64Mi" } }] } },
  ];
  if (c.pullSecret) out.push({ apiVersion: "v1", kind: "Secret", metadata: { name: "gereh-registry", namespace: ns }, type: "kubernetes.io/dockerconfigjson", data: { ".dockerconfigjson": c.pullSecret } });
  return out;
}

type Workload = { name: string; image: string; port?: number; command?: string; env?: Record<string, string>; replicas: number; primary: boolean; service: string; aliases?: { ip: string; hostnames: string[] }[] };

function deployment(app: AppSpec, w: Workload, deploymentId: string, share: number): Obj {
  const c = cfg(), ns = nsOf(app.userId), labels = { ...appLabels(app), "app.kubernetes.io/name": w.name, "gereh.net/service": w.service };
  const probe = w.port ? { httpGet: { path: app.healthPath || "/", port: w.port }, periodSeconds: 5, timeoutSeconds: 3, failureThreshold: 3 } : undefined;
  const disk = w.primary && app.diskGb > 0;
  return { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: w.name, namespace: ns, labels }, spec: {
    ...(w.primary && app.autoscale ? {} : { replicas: w.replicas }),
    revisionHistoryLimit: 3,
    selector: { matchLabels: { "app.kubernetes.io/name": w.name } },
    strategy: disk ? { type: "Recreate" } : { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
    template: {
      metadata: { labels, annotations: { "gereh.net/deployment": deploymentId } },
      spec: {
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        ...(c.pullSecret ? { imagePullSecrets: [{ name: "gereh-registry" }] } : {}),
        ...(w.aliases?.length ? { hostAliases: w.aliases } : {}),
        terminationGracePeriodSeconds: 30,
        containers: [{
          name: "app", image: w.image, imagePullPolicy: "IfNotPresent",
          ...(w.command ? { command: ["/bin/sh", "-c", w.command] } : {}),
          ...(w.port ? { ports: [{ name: "http", containerPort: w.port }] } : {}),
          envFrom: [{ secretRef: { name: app.name + "-env" } }],
          ...(w.env && Object.keys(w.env).length ? { env: Object.entries(w.env).map(([name, value]) => ({ name, value })) } : {}),
          // compose services share the plan: each may burst to the full limit, requests are split
          resources: { requests: { cpu: cpuQty(app.cpu / 2 / share), memory: memQty(Math.ceil(app.ramMb / share)) }, limits: { cpu: cpuQty(app.cpu), memory: memQty(app.ramMb) } },
          ...(w.primary && probe ? { readinessProbe: probe, startupProbe: { ...probe, failureThreshold: 60 } } : {}),
          ...(w.port ? { livenessProbe: { tcpSocket: { port: w.port }, periodSeconds: 20, failureThreshold: 3, initialDelaySeconds: w.primary ? 0 : 30 } } : {}),
          securityContext: { allowPrivilegeEscalation: false, seccompProfile: { type: "RuntimeDefault" } },
          ...(disk ? { volumeMounts: [{ name: "data", mountPath: app.diskMount || "/data" }] } : {}),
        }],
        ...(disk ? { volumes: [{ name: "data", persistentVolumeClaim: { claimName: app.name + "-data" } }] } : {}),
      },
    },
  } };
}

/** edge cache (zone "gereh_cdn" is declared in the controller's http-snippet, see setup-cluster.sh).
    Honours the app's Cache-Control and never stores responses that set cookies; the version in the
    key is how "purge" works. Only this driver writes Ingresses, so the snippet is not user input. */
export const cdnSnippet = (version: number) => [
  "proxy_cache gereh_cdn;",
  `proxy_cache_key "$scheme$host$request_uri|v${Math.max(1, Math.floor(version))}";`,
  "proxy_cache_valid 200 301 302 10m;",
  "proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;",
  "proxy_cache_background_update on;",
  "proxy_cache_lock on;",
  "add_header X-Cache-Status $upstream_cache_status always;",
].join("\n");

/** Services first: their cluster IPs become host aliases so compose services find each other by name */
export function serviceObjects(app: AppSpec, image: string): Obj[] {
  const ns = nsOf(app.userId), labels = appLabels(app);
  const svc = (name: string, service: string, ports: { name: string; port: number; targetPort: number }[]): Obj =>
    ({ apiVersion: "v1", kind: "Service", metadata: { name, namespace: ns, labels: { ...labels, "gereh.net/service": service } }, spec: { selector: { "app.kubernetes.io/name": name }, ports } });
  const compose = composeOf(image);
  if (!compose) return [svc(app.name, "app", [{ name: "http", port: 80, targetPort: app.port }])];
  return compose.filter((s) => s.port).map((s) => s.public
    ? svc(app.name, s.name, [{ name: "http", port: 80, targetPort: s.port! }, ...(s.port !== 80 ? [{ name: "internal", port: s.port!, targetPort: s.port! }] : [])])
    : svc(app.name + "-" + s.name, s.name, [{ name: "tcp", port: s.port!, targetPort: s.port! }]));
}
export const composeOf = (image: string): ComposeService[] | null => (image.startsWith("compose:") ? JSON.parse(image.slice(8)) as ComposeService[] : null);

/** everything but the Services; `ips` maps compose service name → cluster IP */
export function appObjects(app: AppSpec, image: string, deploymentId: string, ips: Record<string, string> = {}): Obj[] {
  const c = cfg(), ns = nsOf(app.userId), labels = appLabels(app);
  const custom = app.hosts.slice(1);
  const compose = composeOf(image);
  const aliases = Object.entries(ips).map(([name, ip]) => ({ ip, hostnames: [name] }));
  const workloads: Workload[] = compose
    ? compose.map((s) => ({
        name: s.public ? app.name : app.name + "-" + s.name, image: s.image!, port: s.port, service: s.name, primary: s.public,
        command: (s.public && app.startCommand) || s.command, replicas: s.public ? app.instances : 1, aliases,
        // panel variables win over compose defaults (container env would otherwise shadow envFrom)
        env: Object.fromEntries(Object.entries(s.env).filter(([k]) => !(k in app.env))),
      }))
    : [{ name: app.name, image, port: app.port, command: app.startCommand, replicas: app.instances, primary: true, service: "app" }];
  const out: Obj[] = [
    { apiVersion: "v1", kind: "Secret", metadata: { name: app.name + "-env", namespace: ns, labels }, type: "Opaque", stringData: { ...app.env, ...(compose ? { PORT: String(compose.find((x) => x.public)!.port) } : {}), GEREH_DEPLOYMENT: deploymentId } },
    ...workloads.map((w) => deployment(app, w, deploymentId, workloads.length)),
    { apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: { name: app.name, namespace: ns, labels, annotations: {
      ...(custom.length ? { "cert-manager.io/cluster-issuer": c.issuer } : {}),
      "nginx.ingress.kubernetes.io/proxy-body-size": "50m", "nginx.ingress.kubernetes.io/proxy-read-timeout": "120",
      ...(app.cdn ? { "nginx.ingress.kubernetes.io/configuration-snippet": cdnSnippet(app.cacheVersion) } : {}),
    } }, spec: {
      ingressClassName: c.ingressClass,
      // the default host has no secretName: the controller serves its default (wildcard) certificate
      tls: [{ hosts: [app.hosts[0]] }, ...(custom.length ? [{ hosts: custom, secretName: app.name + "-tls" }] : [])],
      rules: app.hosts.map((host) => ({ host, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: app.name, port: { name: "http" } } } }] } })),
    } },
  ];
  if (app.diskGb) out.push({ apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: app.name + "-data", namespace: ns, labels }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: app.diskGb + "Gi" } }, ...(c.storageClass ? { storageClassName: c.storageClass } : {}) } });
  if (app.autoscale) out.push({ apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler", metadata: { name: app.name, namespace: ns, labels }, spec: {
    scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: app.name }, minReplicas: app.instances, maxReplicas: Math.max(app.instances, app.maxInstances),
    metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 70 } } }],
  } });
  return out;
}

/** the build Job: prepare (fetch + Nixpacks) → Kaniko */
export function buildJob(app: AppSpec, deploymentId: string, sourceUrl?: string, service?: ComposeService): Obj {
  const c = cfg(), dep = deploymentId.toLowerCase();
  const image = service ? imageFor({ userId: app.userId, name: app.name + "-" + service.name }, dep) : imageFor(app, dep);
  const root = [(app.rootDir || "").replace(/^\/+|\/+$/g, ""), service?.build?.context === "." ? "" : service?.build?.context ?? ""].filter(Boolean).join("/") || ".";
  const dockerfile = service?.build?.dockerfile ?? "Dockerfile";
  const prepare = [
    "set -eu", "cd /workspace",
    app.source === "git"
      ? `git clone --depth 1 --branch ${shq(app.gitBranch || "main")} ${shq(app.gitUrl)} src 2>&1 | sed -E 's#://[^@/]+@#://***@#g'; echo "REF=$(git -C src rev-parse --short HEAD)"`
      : `wget -q -O src.zip "$SOURCE_URL" && mkdir src && unzip -q src.zip -d src && rm src.zip && if [ "$(ls -A src | wc -l)" = 1 ] && [ -d "src/$(ls -A src)" ]; then d="src/$(ls -A src)"; mv "$d" src.tmp && rmdir src && mv src.tmp src; fi`,
    `cd src/${root}`,
    `if [ -f ${shq(dockerfile)} ]; then echo '==> Using ${dockerfile.replace(/'/g, "")}'; cp ${shq(dockerfile)} /workspace/Dockerfile.gereh; else`,
    `  echo '==> Detecting stack with Nixpacks'; nixpacks build . --out . ${!service && app.buildCommand ? "--build-cmd " + shq(app.buildCommand) : ""} ${!service && app.startCommand ? "--start-cmd " + shq(app.startCommand) : ""}; cp .nixpacks/Dockerfile /workspace/Dockerfile.gereh; fi`,
  ].join("\n");
  return {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: "build-" + dep + (service ? "-" + service.name : ""), namespace: c.system, labels: { ...appLabels(app), "gereh.net/deployment": deploymentId, "gereh.net/kind": "build" } },
    spec: {
      backoffLimit: 0, activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 86_400,
      template: {
        metadata: { labels: { "gereh.net/deployment": deploymentId, "gereh.net/kind": "build" } },
        spec: {
          restartPolicy: "Never", automountServiceAccountToken: false,
          initContainers: [{ name: "prepare", image: c.builderImage, command: ["/bin/sh", "-c", prepare], env: sourceUrl ? [{ name: "SOURCE_URL", value: sourceUrl }] : [], volumeMounts: [{ name: "workspace", mountPath: "/workspace" }], resources: { limits: { cpu: "1", memory: "1Gi" } } }],
          containers: [{
            name: "kaniko", image: c.kanikoImage,
            args: ["--context=dir:///workspace/src/" + root, "--dockerfile=/workspace/Dockerfile.gereh", "--destination=" + image, "--cache=true", "--cache-repo=" + c.registry + "/cache/" + dns1123(app.userId), "--snapshot-mode=redo", "--use-new-run", "--compressed-caching=false"],
            volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "registry", mountPath: "/kaniko/.docker" }],
            resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "4Gi" } },
          }],
          volumes: [{ name: "workspace", emptyDir: { sizeLimit: "10Gi" } }, { name: "registry", secret: { secretName: "registry-push", items: [{ key: ".dockerconfigjson", path: "config.json" }] } }],
        },
      },
    },
  };
}

const DB_IMAGES: Record<string, (v: string) => string> = { postgres: (v) => "postgres:" + v + "-alpine", mysql: (v) => "mysql:" + v, mariadb: (v) => "mariadb:" + v, mongodb: (v) => "mongo:" + v, redis: (v) => "redis:" + v + "-alpine" };
const DB_PORTS: Record<string, number> = { postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017, redis: 6379 };
const DB_DATA: Record<string, string> = { postgres: "/var/lib/postgresql/data", mysql: "/var/lib/mysql", mariadb: "/var/lib/mysql", mongodb: "/data/db", redis: "/data" };

function dbEnv(d: DbSpec) {
  const s = (key: string) => ({ valueFrom: { secretKeyRef: { name: dbName(d) + "-auth", key } } });
  switch (d.engine) {
    case "postgres": return [{ name: "POSTGRES_USER", value: d.username }, { name: "POSTGRES_PASSWORD", ...s("password") }, { name: "POSTGRES_DB", value: d.dbName }, { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" }];
    case "mysql": return [{ name: "MYSQL_USER", value: d.username }, { name: "MYSQL_PASSWORD", ...s("password") }, { name: "MYSQL_ROOT_PASSWORD", ...s("password") }, { name: "MYSQL_DATABASE", value: d.dbName }];
    case "mariadb": return [{ name: "MARIADB_USER", value: d.username }, { name: "MARIADB_PASSWORD", ...s("password") }, { name: "MARIADB_ROOT_PASSWORD", ...s("password") }, { name: "MARIADB_DATABASE", value: d.dbName }];
    case "mongodb": return [{ name: "MONGO_INITDB_ROOT_USERNAME", value: d.username }, { name: "MONGO_INITDB_ROOT_PASSWORD", ...s("password") }, { name: "MONGO_INITDB_DATABASE", value: d.dbName }];
    default: return [{ name: "REDIS_PASSWORD", ...s("password") }];
  }
}
const dbProbe = (d: DbSpec): Obj => ({ exec: { command: ["/bin/sh", "-c", ({
  postgres: 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"', mysql: 'mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD"', mariadb: "healthcheck.sh --connect --innodb_initialized",
  mongodb: "mongosh --quiet --eval 'db.adminCommand({ping:1})'", redis: 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
} as Record<string, string>)[d.engine]] }, periodSeconds: 10, timeoutSeconds: 5 });

export function dbObjects(d: DbSpec): Obj[] {
  const c = cfg(), ns = nsOf(d.userId), labels = dbLabels(d), port = DB_PORTS[d.engine];
  return [
    { apiVersion: "v1", kind: "Secret", metadata: { name: dbName(d) + "-auth", namespace: ns, labels }, type: "Opaque", stringData: { password: d.password } },
    { apiVersion: "apps/v1", kind: "StatefulSet", metadata: { name: dbName(d), namespace: ns, labels }, spec: {
      serviceName: dbName(d), replicas: 1, selector: { matchLabels: { "app.kubernetes.io/name": dbName(d) } },
      template: { metadata: { labels }, spec: {
        automountServiceAccountToken: false, enableServiceLinks: false, terminationGracePeriodSeconds: 60,
        containers: [{
          name: "db", image: DB_IMAGES[d.engine](d.version),
          ...(d.engine === "redis" ? { command: ["/bin/sh", "-c", 'exec redis-server --requirepass "$REDIS_PASSWORD" --appendonly yes --maxmemory ' + Math.floor(d.ramMb * 0.8) + "mb --maxmemory-policy noeviction"] } : {}),
          env: dbEnv(d), ports: [{ name: "db", containerPort: port }],
          resources: { requests: { cpu: cpuQty(d.cpu / 2), memory: memQty(d.ramMb) }, limits: { cpu: cpuQty(d.cpu), memory: memQty(d.ramMb) } },
          readinessProbe: dbProbe(d), livenessProbe: { tcpSocket: { port }, periodSeconds: 20, failureThreshold: 6, initialDelaySeconds: 30 },
          volumeMounts: [{ name: "data", mountPath: DB_DATA[d.engine] }],
        }],
      } },
      volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: d.diskGb + "Gi" } }, ...(c.storageClass ? { storageClassName: c.storageClass } : {}) } }],
    } },
    { apiVersion: "v1", kind: "Service", metadata: { name: dbName(d), namespace: ns, labels }, spec: { selector: { "app.kubernetes.io/name": dbName(d) }, ports: [{ name: "db", port, targetPort: port }] } },
  ];
}
/** public access: a NodePort plus a policy that opens only this database's pod to the outside */
export const publicObjects = (d: DbSpec): Obj[] => [
  { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: dbName(d) + "-public", namespace: nsOf(d.userId), labels: dbLabels(d) }, spec: { podSelector: { matchLabels: { "app.kubernetes.io/name": dbName(d) } }, policyTypes: ["Ingress"], ingress: [{ ports: [{ port: DB_PORTS[d.engine] }], from: [{ ipBlock: { cidr: "0.0.0.0/0" } }] }] } },
  publicSvc(d),
];
const publicSvc = (d: DbSpec): Obj => ({ apiVersion: "v1", kind: "Service", metadata: { name: dbName(d) + "-public", namespace: nsOf(d.userId), labels: dbLabels(d) }, spec: { type: "NodePort", selector: { "app.kubernetes.io/name": dbName(d) }, ports: [{ name: "db", port: DB_PORTS[d.engine], targetPort: DB_PORTS[d.engine] }] } });
export const dbHost = (d: Pick<DbSpec, "name" | "userId">) => dbName(d) + "." + nsOf(d.userId) + ".svc.cluster.local";

/* shell snippets for backup / restore Jobs (run in the platform namespace) */
export function dumpCommand(d: DbSpec) {
  const h = dbHost(d), p = DB_PORTS[d.engine];
  switch (d.engine) {
    case "postgres": return `PGPASSWORD="$DB_PASSWORD" pg_dump -h ${h} -p ${p} -U ${shq(d.username)} -Fc ${shq(d.dbName)} > /backup/dump`;
    case "mysql": return `mysqldump -h ${h} -P ${p} -u root -p"$DB_PASSWORD" --single-transaction --routines --triggers --databases ${shq(d.dbName)} > /backup/dump`;
    case "mariadb": return `mariadb-dump -h ${h} -P ${p} -u root -p"$DB_PASSWORD" --single-transaction --routines --triggers --databases ${shq(d.dbName)} > /backup/dump`;
    case "mongodb": return `mongodump --uri="mongodb://${encodeURIComponent(d.username)}:$DB_PASSWORD@${h}:${p}/?authSource=admin" --archive=/backup/dump --gzip`;
    default: return `redis-cli -h ${h} -p ${p} -a "$DB_PASSWORD" --no-auth-warning --rdb /backup/dump`;
  }
}
export function restoreCommand(d: DbSpec) {
  const h = dbHost(d), p = DB_PORTS[d.engine];
  switch (d.engine) {
    case "postgres": return `PGPASSWORD="$DB_PASSWORD" pg_restore -h ${h} -p ${p} -U ${shq(d.username)} -d ${shq(d.dbName)} --clean --if-exists --no-owner /backup/dump`;
    case "mysql": return `mysql -h ${h} -P ${p} -u root -p"$DB_PASSWORD" < /backup/dump`;
    case "mariadb": return `mariadb -h ${h} -P ${p} -u root -p"$DB_PASSWORD" < /backup/dump`;
    case "mongodb": return `mongorestore --uri="mongodb://${encodeURIComponent(d.username)}:$DB_PASSWORD@${h}:${p}/?authSource=admin" --archive=/backup/dump --gzip --drop`;
    default: throw new Error("Redis is restored by redisRestoreScript");
  }
}

/** runs on the stopped Redis volume: load the RDB with AOF off, then switch AOF on so Redis rewrites
    it from memory (works whatever the version's rule for RDB vs AOF at startup), then shut down */
export const redisRestoreScript = [
  "set -e",
  'wget -q -O /data/restore.rdb "$URL"',
  "rm -rf /data/appendonlydir /data/appendonly.aof /data/dump.rdb && mv /data/restore.rdb /data/dump.rdb",
  "redis-server --dir /data --appendonly no --port 6390 --daemonize yes --save ''",
  "until redis-cli -p 6390 ping 2>/dev/null | grep -q PONG; do sleep 1; done",
  "while redis-cli -p 6390 info persistence | grep -q 'loading:1'; do sleep 1; done",
  'echo "KEYS=$(redis-cli -p 6390 dbsize)"',
  "redis-cli -p 6390 config set appendonly yes >/dev/null",
  "until redis-cli -p 6390 info persistence | grep -q 'aof_enabled:1'; do sleep 1; done",
  "while redis-cli -p 6390 info persistence | grep -qE 'aof_rewrite_in_progress:1|aof_rewrite_scheduled:1'; do sleep 1; done",
  "redis-cli -p 6390 shutdown nosave || true",
  "test -d /data/appendonlydir",
].join("\n");

/* ---------- driver ---------- */
export class KubernetesDriver implements PaasDriver {
  readonly name = "kubernetes" as const;
  private readyNs = new Set<string>();

  async test() {
    const v = await k8s("GET", "/version");
    await get("v1", "Namespace", "", cfg().system).catch((e) => { throw notFound(e) ? new Error("فضای نام " + cfg().system + " وجود ندارد؛ deploy/paas/system.yaml را اعمال کنید.") : e; });
    return { version: "Kubernetes " + String(v.gitVersion ?? "?") };
  }

  private async ensureNs(userId: string) {
    const ns = nsOf(userId);
    if (this.readyNs.has(ns)) return ns;
    for (const o of namespaceObjects(userId)) await apply(o as never);
    this.readyNs.add(ns);
    return ns;
  }

  /* ----- builds ----- */
  async startBuild(app: AppSpec, deploymentId: string, sourceUrl?: string, compose?: ComposeService[]) {
    if (app.source === "image") return "image:" + app.image;
    if (compose) {
      for (const s of compose.filter((x) => x.build)) await apply(buildJob(app, deploymentId, sourceUrl, s) as never);
      return "compose:" + JSON.stringify({ dep: deploymentId.toLowerCase(), services: compose });
    }
    if (app.source === "compose") throw new Error("فایل compose پروژه خوانده نشد.");
    const job = buildJob(app, deploymentId, sourceUrl);
    await apply(job as never);
    return (job.metadata as { name: string }).name;
  }

  private async jobLogs(ns: string, jobName: string, containers: string[], tail = 400) {
    const pods = await k8s("GET", "/api/v1/namespaces/" + ns + "/pods?labelSelector=" + encodeURIComponent("job-name=" + jobName));
    const pod = ((pods.items as Obj[]) ?? [])[0] as { metadata: { name: string } } | undefined;
    if (!pod) return "";
    const parts: string[] = [];
    for (const ct of containers) {
      const r = await k8s("GET", `/api/v1/namespaces/${ns}/pods/${pod.metadata.name}/log?container=${ct}&tailLines=${tail}`).catch(() => ({ text: "" }));
      if (r.text) parts.push(String(r.text).trimEnd());
    }
    return parts.join("\n");
  }

  async buildStatus(app: AppSpec, handle: string): Promise<BuildState> {
    if (handle.startsWith("image:")) return { state: "succeeded", log: "==> Using image " + handle.slice(6), image: handle.slice(6) };
    if (handle.startsWith("compose:")) return this.composeStatus(app, JSON.parse(handle.slice(8)));
    const ns = cfg().system;
    const job = await get("batch/v1", "Job", ns, handle) as { status?: { succeeded?: number; failed?: number; conditions?: { type: string; status: string; message?: string }[] } };
    const log = await this.jobLogs(ns, handle, ["prepare", "kaniko"]);
    const ref = /^REF=(\w+)$/m.exec(log)?.[1];
    const clean = log.replace(/^REF=\w+\n?/gm, "").trim();
    if (job.status?.succeeded) return { state: "succeeded", log: clean + "\n==> Image pushed", image: imageFor(app, handle.replace(/^build-/, "")), ref };
    const failed = job.status?.failed || job.status?.conditions?.some((x) => x.type === "Failed" && x.status === "True");
    if (failed) return { state: "failed", log: clean + "\nERROR: " + (job.status?.conditions?.find((x) => x.type === "Failed")?.message || "build failed") };
    return { state: "running", log: clean };
  }

  private async composeStatus(app: AppSpec, h: { dep: string; services: ComposeService[] }): Promise<BuildState> {
    const ns = cfg().system, logs: string[] = [];
    let running = false;
    for (const s of h.services.filter((x) => x.build)) {
      const name = "build-" + h.dep + "-" + s.name;
      const job = await get("batch/v1", "Job", ns, name) as { status?: { succeeded?: number; failed?: number; conditions?: { type: string; status: string; message?: string }[] } };
      const log = (await this.jobLogs(ns, name, ["prepare", "kaniko"])).replace(/^REF=\w+\n?/gm, "").trim();
      logs.push("──── " + s.name + " ────" + (log ? "\n" + log : ""));
      if (job.status?.failed || job.status?.conditions?.some((x) => x.type === "Failed" && x.status === "True")) return { state: "failed", log: logs.join("\n") + "\nERROR: build of service " + s.name + " failed" };
      if (!job.status?.succeeded) running = true;
    }
    if (running) return { state: "running", log: logs.join("\n") };
    const services = h.services.map((s) => (s.build ? { ...s, image: imageFor({ userId: app.userId, name: app.name + "-" + s.name }, h.dep) } : s));
    return { state: "succeeded", log: logs.join("\n") + "\n==> Images pushed", image: "compose:" + JSON.stringify(services) };
  }

  /* ----- apps ----- */
  private async owned(ns: string, kind: "Deployment" | "Service", appId: string) {
    const r = await k8s("GET", pathOf(kind === "Deployment" ? "apps/v1" : "v1", kind, ns) + "?labelSelector=" + encodeURIComponent("gereh.net/app=" + appId));
    return (r.items as { metadata: { name: string; labels?: Record<string, string> }; spec: { replicas?: number }; status?: Record<string, number> }[]) ?? [];
  }

  async release(app: AppSpec, image: string, deploymentId: string) {
    const ns = await this.ensureNs(app.userId);
    const ips: Record<string, string> = {};
    const services = serviceObjects(app, image);
    for (const o of services) {
      const r = await apply(o as never) as { spec?: { clusterIP?: string } };
      const name = (o.metadata as { labels: Record<string, string> }).labels["gereh.net/service"];
      if (composeOf(image) && r.spec?.clusterIP && r.spec.clusterIP !== "None") ips[name] = r.spec.clusterIP;
    }
    const objs = appObjects(app, image, deploymentId, ips);
    for (const o of objs) await apply(o as never);
    // services removed from docker-compose.yml since the last release
    const keep = new Set([...services, ...objs].map((o) => o.kind + "/" + (o.metadata as { name: string }).name));
    for (const d of await this.owned(ns, "Deployment", app.id)) if (!keep.has("Deployment/" + d.metadata.name)) await del("apps/v1", "Deployment", ns, d.metadata.name);
    for (const sv of await this.owned(ns, "Service", app.id)) if (!keep.has("Service/" + sv.metadata.name)) await del("v1", "Service", ns, sv.metadata.name);
    if (!app.autoscale) await del("autoscaling/v2", "HorizontalPodAutoscaler", ns, app.name);
    if (app.hosts.length < 2) await del("v1", "Secret", ns, app.name + "-tls");
  }

  /** routing only: the Ingress (domains, TLS, CDN) */
  async updateRouting(app: AppSpec) {
    const ing = appObjects(app, "", "").find((o) => o.kind === "Ingress");
    if (ing) await apply(ing as never);
  }

  /** every workload of the app (one, or one per compose service) is fully rolled out */
  async rolloutReady(app: AppSpec) {
    const list = await this.owned(nsOf(app.userId), "Deployment", app.id) as unknown as { metadata: { generation: number }; spec: { replicas?: number }; status?: { observedGeneration?: number; updatedReplicas?: number; availableReplicas?: number; replicas?: number } }[];
    return list.length > 0 && list.every((d) => {
      const want = d.spec.replicas ?? 1, s = d.status ?? {};
      return (s.observedGeneration ?? 0) >= d.metadata.generation && (s.updatedReplicas ?? 0) >= want && (s.availableReplicas ?? 0) >= want && (s.replicas ?? 0) === (s.updatedReplicas ?? 0);
    });
  }

  async setState(app: AppSpec, action: "start" | "stop" | "restart") {
    const ns = nsOf(app.userId);
    const merge = (name: string, body: unknown) => k8s("PATCH", pathOf("apps/v1", "Deployment", ns, name), body, "application/merge-patch+json");
    const all = await this.owned(ns, "Deployment", app.id);
    if (action === "stop") await del("autoscaling/v2", "HorizontalPodAutoscaler", ns, app.name);
    for (const d of all) {
      const primary = d.metadata.name === app.name;
      if (action === "restart") await merge(d.metadata.name, { spec: { template: { metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } } } } });
      else await merge(d.metadata.name, { spec: { replicas: action === "stop" ? 0 : primary ? app.instances : 1 } });
    }
    if (action === "start" && app.autoscale) {
      const hpa = appObjects(app, "", "").find((o) => o.kind === "HorizontalPodAutoscaler");
      if (hpa) await apply(hpa as never);
    }
  }

  async remove(app: AppSpec) {
    const ns = nsOf(app.userId);
    await del("networking.k8s.io/v1", "Ingress", ns, app.name);
    await del("autoscaling/v2", "HorizontalPodAutoscaler", ns, app.name);
    for (const d of await this.owned(ns, "Deployment", app.id)) await del("apps/v1", "Deployment", ns, d.metadata.name);
    for (const sv of await this.owned(ns, "Service", app.id)) await del("v1", "Service", ns, sv.metadata.name);
    await del("apps/v1", "Deployment", ns, app.name);
    await del("v1", "Service", ns, app.name);
    await del("v1", "Secret", ns, app.name + "-env");
    await del("v1", "Secret", ns, app.name + "-tls");
    await del("v1", "PersistentVolumeClaim", ns, app.name + "-data");
  }

  async logs(app: AppSpec, tail: number) {
    const ns = nsOf(app.userId);
    const pods = await k8s("GET", "/api/v1/namespaces/" + ns + "/pods?labelSelector=" + encodeURIComponent("gereh.net/app=" + app.id));
    const lines: [string, string][] = [];
    for (const p of ((pods.items as { metadata: { name: string; labels?: Record<string, string> } }[]) ?? []).slice(0, 12)) {
      const r = await k8s("GET", `/api/v1/namespaces/${ns}/pods/${p.metadata.name}/log?container=app&timestamps=true&tailLines=${tail}`).catch(() => ({ text: "" }));
      const svc = p.metadata.labels?.["gereh.net/service"];
      const short = (svc && svc !== "app" ? svc + "/" : "") + p.metadata.name.slice(-5);
      for (const l of String(r.text || "").split("\n")) if (l) { const sp = l.indexOf(" "); lines.push([l.slice(0, sp), l.slice(11, 19) + " [" + short + "] " + l.slice(sp + 1)]); }
    }
    return lines.sort((a, b) => a[0].localeCompare(b[0])).slice(-tail).map((x) => x[1]);
  }

  async metrics(targets: { id: string; kind: "app" | "db"; ramMb: number; owner: string; name: string }[]) {
    const out: { id: string; cpu: number; ramMb: number; rpm: number }[] = [];
    const byNs = new Map<string, typeof targets>();
    for (const t of targets) byNs.set(nsOf(t.owner), [...(byNs.get(nsOf(t.owner)) ?? []), t]);
    for (const [ns, list] of byNs) {
      const r = await k8s("GET", "/apis/metrics.k8s.io/v1beta1/namespaces/" + ns + "/pods").catch(() => null);
      if (!r) continue;
      const pods = (r.items as { metadata: { labels?: Record<string, string> }; containers: { usage: { cpu: string; memory: string } }[] }[]) ?? [];
      for (const t of list) {
        const mine = pods.filter((p) => p.metadata.labels?.[t.kind === "db" ? "gereh.net/db" : "gereh.net/app"] === t.id);
        if (!mine.length) continue;
        let cores = 0, mem = 0;
        for (const p of mine) for (const ct of p.containers) { cores += parseCpu(ct.usage.cpu); mem += parseMem(ct.usage.memory); }
        // cpu as % of the plan's per-instance limit, averaged over instances
        const plan = targets.find((x) => x.id === t.id)!;
        out.push({ id: t.id, cpu: Math.round((cores / mine.length / planCpuGuess(plan.ramMb)) * 1000) / 10, ramMb: Math.round(mem / mine.length), rpm: 0 });
      }
    }
    const rpm = await this.requestRates();
    for (const m of out) {
      const t = targets.find((x) => x.id === m.id)!;
      if (t.kind === "app") m.rpm = rpm.get(nsOf(t.owner) + "/" + t.name) ?? 0;
    }
    return out;
  }

  /** requests per minute per ingress ("<namespace>/<ingress>") from ingress-nginx metrics in Prometheus */
  async requestRates(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const target = cfg().prometheus;
    if (!target) return out;
    const m = /^([a-z0-9-]+)\/([a-z0-9-]+)(?::(\d+))?$/.exec(target);
    if (!m) return out;
    // scraping renames the metric's own namespace label to exported_namespace; accept both
    const q = "sum by (namespace, exported_namespace, ingress) (rate(nginx_ingress_controller_requests[5m])) * 60";
    const r = await k8s("GET", `/api/v1/namespaces/${m[1]}/services/${m[2]}:${m[3] ?? "80"}/proxy/api/v1/query?query=${encodeURIComponent(q)}`).catch(() => null) as
      { data?: { result?: { metric: Record<string, string>; value: [number, string] }[] } } | null;
    for (const row of r?.data?.result ?? []) {
      const ns = row.metric.exported_namespace || row.metric.namespace;
      if (ns && row.metric.ingress) out.set(ns + "/" + row.metric.ingress, (out.get(ns + "/" + row.metric.ingress) ?? 0) + Math.round(Number(row.value[1]) || 0));
    }
    return out;
  }

  async verifyDomain(host: string, appName: string) {
    const target = appName + "." + cfg().appsDomain;
    try { if ((await resolveCname(host)).some((c) => c.replace(/\.$/, "") === target)) return true; } catch { /* no CNAME */ }
    const ip = cfg().ingressIp;
    if (!ip) return false;
    try { return (await resolve4(host)).includes(ip); } catch { return false; }
  }

  /* ----- databases ----- */
  async createDb(d: DbSpec) {
    await this.ensureNs(d.userId);
    for (const o of dbObjects(d)) await apply(o as never);
    const publicPort = d.publicAccess ? await this.publicPort(d) : undefined;
    return { host: dbHost(d), port: DB_PORTS[d.engine], publicPort };
  }
  private async publicPort(d: DbSpec) {
    const [policy, svc] = publicObjects(d);
    await apply(policy as never);
    const r = await apply(svc as never) as { spec?: { ports?: { nodePort?: number }[] } };
    return r.spec?.ports?.[0]?.nodePort;
  }
  async dbReady(d: DbSpec) {
    const s = await get("apps/v1", "StatefulSet", nsOf(d.userId), dbName(d)) as { status?: { readyReplicas?: number } };
    return (s.status?.readyReplicas ?? 0) >= 1;
  }
  async updateDb(d: DbSpec) {
    const ns = nsOf(d.userId);
    const cur = await get("v1", "Secret", ns, dbName(d) + "-auth").catch(() => null) as { data?: { password?: string } } | null;
    const old = cur?.data?.password ? Buffer.from(cur.data.password, "base64").toString("utf8") : d.password;
    if (old !== d.password) await this.changePassword(d, old);
    for (const o of dbObjects(d)) await apply(o as never);
    if (d.publicAccess) return { publicPort: await this.publicPort(d) };
    await del("v1", "Service", ns, dbName(d) + "-public");
    await del("networking.k8s.io/v1", "NetworkPolicy", ns, dbName(d) + "-public");
    return { publicPort: undefined };
  }
  private async changePassword(d: DbSpec, old: string) {
    const h = dbHost(d), p = DB_PORTS[d.engine];
    const sql = (s: string) => s.replace(/'/g, "''");
    const cmd = ({
      postgres: `echo 'ALTER USER "${d.username.replace(/"/g, "")}" PASSWORD :'"'"'newpw'"'"';' | PGPASSWORD="$OLD" psql -h ${h} -p ${p} -U ${shq(d.username)} -d ${shq(d.dbName)} -v ON_ERROR_STOP=1 -v newpw="$NEW"`,
      mysql: `mysql -h ${h} -P ${p} -uroot -p"$OLD" -e "ALTER USER '${sql(d.username)}'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$NEW';"`,
      mariadb: `mariadb -h ${h} -P ${p} -uroot -p"$OLD" -e "ALTER USER '${sql(d.username)}'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$NEW';"`,
      mongodb: `mongosh "mongodb://${encodeURIComponent(d.username)}:$OLD_URL@${h}:${p}/admin" --quiet --eval 'db.changeUserPassword(${JSON.stringify(d.username)}, process.env.NEW)'`,
      redis: `redis-cli -h ${h} -p ${p} -a "$OLD" --no-auth-warning CONFIG SET requirepass "$NEW"`,
    } as Record<string, string>)[d.engine];
    await this.runJob(d, "passwd", DB_IMAGES[d.engine](d.version), cmd, [{ name: "OLD", value: old }, { name: "OLD_URL", value: encodeURIComponent(old) }, { name: "NEW", value: d.password }], 300);
  }
  async setDbState(d: DbSpec, action: "start" | "stop") {
    await k8s("PATCH", pathOf("apps/v1", "StatefulSet", nsOf(d.userId), dbName(d)), { spec: { replicas: action === "stop" ? 0 : 1 } }, "application/merge-patch+json");
  }
  async removeDb(d: DbSpec) {
    const ns = nsOf(d.userId);
    await del("apps/v1", "StatefulSet", ns, dbName(d));
    await del("v1", "Service", ns, dbName(d));
    await del("v1", "Service", ns, dbName(d) + "-public");
    await del("networking.k8s.io/v1", "NetworkPolicy", ns, dbName(d) + "-public");
    await del("v1", "Secret", ns, dbName(d) + "-auth");
    await del("v1", "PersistentVolumeClaim", ns, "data-" + dbName(d) + "-0");
  }

  /** runs a one-off Job in the platform namespace and waits for it; returns its log */
  private async waitJob(ns: string, name: string, timeoutSec: number, containers: string[]) {
    for (const t0 = Date.now(); Date.now() - t0 < timeoutSec * 1000 + 30_000; await sleep(3000)) {
      const j = await get("batch/v1", "Job", ns, name) as { status?: { succeeded?: number; failed?: number } };
      if (j.status?.succeeded) return this.jobLogs(ns, name, containers);
      if (j.status?.failed) throw new Error(name + " failed: " + (await this.jobLogs(ns, name, containers, 20)).slice(-500));
    }
    throw new Error(name + " timed out");
  }

  private async runJob(d: DbSpec, kind: string, image: string, script: string, envs: { name: string; value: string }[], timeoutSec: number, upload?: { mode: "up" | "down" | "share"; key: string }) {
    const c = cfg(), name = (kind + "-" + d.id + "-" + Date.now().toString(36)).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
    const s3 = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"].map((k) => ({ name: k, valueFrom: { secretKeyRef: { name: "backup-s3", key: k } } }));
    const vol = [{ name: "backup", mountPath: "/backup" }];
    const mc = (cmd: string) => ({ name: "s3", image: c.mcImage, command: ["/bin/sh", "-c", 'set -e; mc alias set s3 "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null; ' + cmd], env: s3, volumeMounts: vol });
    const main = { name: "main", image, command: ["/bin/sh", "-c", "set -e; " + script], env: envs, volumeMounts: vol, resources: { limits: { cpu: "1", memory: "1Gi" } } };
    const job = {
      apiVersion: "batch/v1", kind: "Job", metadata: { name, namespace: c.system, labels: { ...dbLabels(d), "gereh.net/kind": kind } },
      spec: { backoffLimit: 0, activeDeadlineSeconds: timeoutSec, ttlSecondsAfterFinished: 3600, template: { spec: {
        restartPolicy: "Never", automountServiceAccountToken: false,
        // backup: dump (init) → upload; restore: download (init) → restore
        initContainers: upload?.mode === "up" ? [main] : upload?.mode === "down" ? [mc(`mc cp "s3/${upload.key}" /backup/dump`)] : [],
        containers: upload?.mode === "up" ? [mc(`echo "SIZE=$(stat -c %s /backup/dump)"; mc cp /backup/dump "s3/${upload.key}"`)]
          : upload?.mode === "share" ? [mc(`mc share download --expire=30m "s3/${upload.key}" | sed -n 's/^Share: /URL=/p'`)] : [main],
        volumes: [{ name: "backup", emptyDir: {} }],
      } } },
    };
    await apply(job as never);
    return this.waitJob(c.system, name, timeoutSec, ["main", "s3"]);
  }

  async backupDb(d: DbSpec, backupId: string) {
    const key = cfg().bucket + "/" + dns1123(d.userId) + "/" + d.id + "/" + backupId + ".dump";
    const log = await this.runJob(d, "backup", DB_IMAGES[d.engine](d.version), dumpCommand(d), [{ name: "DB_PASSWORD", value: d.password }], 3600, { mode: "up", key });
    const bytes = Number(/SIZE=(\d+)/.exec(log)?.[1] ?? 0);
    return { sizeMb: Math.round((bytes / 1024 / 1024) * 10) / 10, location: "s3://" + key };
  }
  async restoreDb(d: DbSpec, location: string) {
    const key = location.replace(/^s3:\/\//, "");
    if (d.engine === "redis") return this.restoreRedis(d, key);
    await this.runJob(d, "restore", DB_IMAGES[d.engine](d.version), restoreCommand(d), [{ name: "DB_PASSWORD", value: d.password }], 3600, { mode: "down", key });
  }

  private async restoreRedis(d: DbSpec, key: string) {
    const ns = nsOf(d.userId), sts = dbName(d);
    const url = /^URL=(\S+)/m.exec(await this.runJob(d, "share", cfg().mcImage, "", [], 300, { mode: "share", key }))?.[1];
    if (!url) throw new Error("could not create a download link for the backup");
    await this.setDbState(d, "stop");
    try {
      // the volume is ReadWriteOnce: wait until the Redis pod has released it
      for (let i = 0; ; i++) {
        const pods = await k8s("GET", "/api/v1/namespaces/" + ns + "/pods?labelSelector=" + encodeURIComponent("app.kubernetes.io/name=" + sts));
        if (!((pods.items as unknown[]) ?? []).length) break;
        if (i > 60) throw new Error("Redis did not stop");
        await sleep(2000);
      }
      const name = ("restore-" + d.id + "-" + Date.now().toString(36)).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
      await apply({
        apiVersion: "batch/v1", kind: "Job", metadata: { name, namespace: ns, labels: { "app.kubernetes.io/managed-by": FM, "gereh.net/kind": "restore" } },
        spec: { backoffLimit: 0, activeDeadlineSeconds: 3600, ttlSecondsAfterFinished: 3600, template: { metadata: { labels: { "gereh.net/kind": "restore" } }, spec: {
          restartPolicy: "Never", automountServiceAccountToken: false,
          containers: [{ name: "main", image: DB_IMAGES.redis(d.version), command: ["/bin/sh", "-c", redisRestoreScript], env: [{ name: "URL", value: url }],
            resources: { limits: { cpu: cpuQty(d.cpu), memory: memQty(d.ramMb * 2) } }, volumeMounts: [{ name: "data", mountPath: "/data" }] }],
          volumes: [{ name: "data", persistentVolumeClaim: { claimName: "data-" + sts + "-0" } }],
        } } },
      } as never);
      await this.waitJob(ns, name, 3600, ["main"]);
    } finally {
      await this.setDbState(d, "start");
    }
  }
}

/* quantities from metrics-server: "12345678n", "250m", "1"; "123456Ki", "512Mi" */
export function parseCpu(q: string) {
  if (q.endsWith("n")) return Number(q.slice(0, -1)) / 1e9;
  if (q.endsWith("u")) return Number(q.slice(0, -1)) / 1e6;
  if (q.endsWith("m")) return Number(q.slice(0, -1)) / 1e3;
  return Number(q);
}
export function parseMem(q: string) {
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|K|M|G)?$/.exec(q);
  if (!m) return 0;
  const n = Number(m[1]);
  return ({ Ki: n / 1024, Mi: n, Gi: n * 1024, K: n / 1048.576, M: n / 1.048576, G: n * 953.674 } as Record<string, number>)[m[2] ?? ""] ?? n / 1024 / 1024;
}
/* plans pair RAM and CPU 1 GB ↔ 1 core; metrics() only gets RAM, so the core count follows from it */
const planCpuGuess = (ramMb: number) => Math.max(0.25, ramMb / 1024);
