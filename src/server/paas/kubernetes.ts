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
   - databases: StatefulSet with the official image + Service (+ NodePort for public access)
   - runtime options (AppSpec.runtime): health probes, rollout strategy, pre-start hook, read-only root,
     custom DNS, nginx/php.ini overrides (ConfigMap), extra Ingresses for wildcard hosts, redirects and
     path basic auth */
import "server-only";
import { createHash } from "node:crypto";
import { resolve4, resolveCname } from "node:dns/promises";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { mirrorEnv, mirrorHost } from "@/lib/mirror";
import { expandCodes, NGINX_STACKS, PHP_STACKS } from "@/lib/paas-runtime";
import type { ComposeService } from "./compose";
import type { AppEvent, AppSpec, BuildState, DbSpec, PaasDriver, RolloutProblem } from "./driver";
import { enginePort, engineK8s, pgArgs } from "./engines";

type Obj = Record<string, unknown>;
type K8sError = Error & { status?: number };

const env = (k: string, d = "") => process.env[k] || d;
export const cfg = () => ({
  api: env("PAAS_K8S_API").replace(/\/$/, ""),
  token: env("PAAS_K8S_TOKEN"),
  ca: env("PAAS_K8S_CA"),
  system: env("PAAS_SYSTEM_NAMESPACE", "gereh-system"),
  ingressNs: env("PAAS_INGRESS_NAMESPACE", "ingress-nginx"),
  ingressClass: env("PAAS_INGRESS_CLASS", "nginx"),
  issuer: env("PAAS_CLUSTER_ISSUER", "letsencrypt"),
  // wildcard certificates need a DNS-01 issuer
  wildcardIssuer: env("PAAS_WILDCARD_ISSUER", "letsencrypt-dns"),
  // where a customer's nginx override is mounted in nginx-based images
  nginxConfPath: env("PAAS_NGINX_CONF_PATH", "/etc/nginx/conf.d/default.conf"),
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
  // package mirror (deploy/mirror) used by builds for base images and npm/pip/Go installs
  mirror: env("PAAS_MIRROR", env("MIRROR_URL")).replace(/\/$/, ""),
  trivyImage: env("PAAS_TRIVY_IMAGE", "aquasec/trivy:0.58.1"),
  // optional mirror of the Trivy vulnerability database (ghcr.io/aquasecurity/trivy-db)
  trivyDb: env("PAAS_TRIVY_DB_REPOSITORY"),
  // PostgreSQL image with WAL-G (deploy/paas/postgres-walg) and the S3 bucket for WAL archives
  walgImage: env("PAAS_PG_WALG_IMAGE", "registry.gereh.net/gereh/postgres-walg"),
  pitrBucket: env("PAAS_PITR_BUCKET", "gereh-pitr"),
  pitrS3: { endpoint: env("PAAS_PITR_S3_ENDPOINT"), key: env("PAAS_PITR_S3_ACCESS_KEY"), secret: env("PAAS_PITR_S3_SECRET_KEY") },
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
export function caPem() {
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
  const plural = ({ Namespace: "namespaces", Secret: "secrets", ConfigMap: "configmaps", Service: "services", PersistentVolumeClaim: "persistentvolumeclaims", Pod: "pods", NetworkPolicy: "networkpolicies", ResourceQuota: "resourcequotas", LimitRange: "limitranges",
    Deployment: "deployments", StatefulSet: "statefulsets", Ingress: "ingresses", Job: "jobs", CronJob: "cronjobs", HorizontalPodAutoscaler: "horizontalpodautoscalers", PodDisruptionBudget: "poddisruptionbudgets" } as Record<string, string>)[kind];
  const base = apiVersion.includes("/") ? "/apis/" + apiVersion : "/api/" + apiVersion;
  return base + (ns ? "/namespaces/" + ns : "") + "/" + plural + (name ? "/" + name : "");
}
/** server-side apply (create or update) */
export function apply(obj: Obj & { apiVersion: string; kind: string; metadata: { name: string; namespace?: string } }) {
  return k8s("PATCH", pathOf(obj.apiVersion, obj.kind, obj.metadata.namespace ?? null, obj.metadata.name) + "?fieldManager=" + FM + "&force=true", obj, "application/apply-patch+yaml");
}
export const del = (apiVersion: string, kind: string, ns: string, name: string) => ignore404(k8s("DELETE", pathOf(apiVersion, kind, ns, name) + "?propagationPolicy=Background"));
export const get = (apiVersion: string, kind: string, ns: string, name: string) => k8s("GET", pathOf(apiVersion, kind, ns, name));

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

type Workload = { name: string; image: string; port?: number; command?: string; env?: Record<string, string>; replicas: number; primary: boolean; service: string; aliases?: { ip: string; hostnames: string[] }[]; own?: boolean };

/** shell check of an HTTP status against an allowed list (curl, else busybox/GNU wget) */
export function httpCheckScript(port: number, path: string, codes: number[]) {
  const url = shq("http://127.0.0.1:" + port + path);
  return `c=$( (curl -s -o /dev/null -w '%{http_code}' ${url}) 2>/dev/null || (wget -q -S -O /dev/null ${url} 2>&1 | awk '/HTTP\\//{c=$2} END{print c}') ); case "$c" in ${codes.join("|")}) exit 0;; esac; echo "status $c"; exit 1`;
}
/** readiness/liveness probe: the runtime health check, or an HTTP GET of healthPath */
export function healthProbe(app: AppSpec, port: number): Obj {
  const h = app.runtime?.health;
  const timing = { periodSeconds: h?.interval ?? 5, timeoutSeconds: h?.timeout ?? 3, failureThreshold: h?.retries ?? 3 };
  if (h?.type === "command" && h.command.trim()) return { exec: { command: ["/bin/sh", "-c", h.command] }, ...timing };
  if (h?.type === "tcp") return { tcpSocket: { port }, ...timing };
  const path = app.healthPath || "/", codes = h ? expandCodes(h.codes) : null;
  // the kubelet's own HTTP check accepts 200-399
  if (!codes || (codes[0] === 200 && codes.at(-1) === 399 && codes.length === 200)) return { httpGet: { path, port }, ...timing };
  return { exec: { command: ["/bin/sh", "-c", httpCheckScript(port, path, codes)] }, ...timing };
}
/** read-only root: writable scratch directories the common runtimes need */
const scratchDirs = (app: AppSpec) => ["/tmp", ...(NGINX_STACKS.has(app.stack) ? ["/run", "/var/cache/nginx", "/var/lib/nginx"] : [])];
/** nginx override / php.ini (non-compose apps of the matching stacks) */
export const confData = (app: AppSpec): Record<string, string> => {
  const rt = app.runtime;
  if (!rt || app.source === "compose") return {};
  return { ...(rt.nginxConf && NGINX_STACKS.has(app.stack) ? { "nginx.conf": rt.nginxConf } : {}), ...(rt.phpIni && PHP_STACKS.has(app.stack) ? { "php.ini": rt.phpIni } : {}) };
};

function deployment(app: AppSpec, w: Workload, deploymentId: string, share: number): Obj {
  const c = cfg(), ns = nsOf(app.userId), labels = { ...appLabels(app), "app.kubernetes.io/name": w.name, "gereh.net/service": w.service };
  const rt = app.runtime;
  const probe = w.port ? healthProbe(app, w.port) : undefined;
  const disk = w.primary && app.diskGb > 0;
  const web = w.primary && w.service === "app";
  const preStart = web && rt?.preStart.trim() ? rt.preStart : "";
  const command = w.command && preStart ? "set -e\n" + preStart + "\n" + w.command : w.command;
  const conf = web ? confData(app) : {};
  const scratch = rt?.readOnlyFs ? scratchDirs(app) : [];
  const mounts = [
    ...(disk ? [{ name: "data", mountPath: app.diskMount || "/data" }] : []),
    ...scratch.map((dir, i) => ({ name: "scratch-" + i, mountPath: dir })),
    ...(conf["nginx.conf"] ? [{ name: "conf", mountPath: c.nginxConfPath, subPath: "nginx.conf", readOnly: true }] : []),
    ...(conf["php.ini"] ? [{ name: "conf", mountPath: "/etc/gereh/php/zz-gereh.ini", subPath: "php.ini", readOnly: true }] : []),
  ];
  const volumes = [
    ...(disk ? [{ name: "data", persistentVolumeClaim: { claimName: app.name + "-data" } }] : []),
    ...scratch.map((_, i) => ({ name: "scratch-" + i, emptyDir: { sizeLimit: "512Mi" } })),
    ...(Object.keys(conf).length ? [{ name: "conf", configMap: { name: app.name + "-conf" } }] : []),
  ];
  const security = { allowPrivilegeEscalation: false, seccompProfile: { type: "RuntimeDefault" }, ...(rt?.readOnlyFs ? { readOnlyRootFilesystem: true } : {}) };
  const resources = { requests: { cpu: cpuQty(app.cpu / 2 / share), memory: memQty(Math.ceil(app.ramMb / share)) }, limits: { cpu: cpuQty(app.cpu), memory: memQty(app.ramMb) } };
  const dns = rt?.dns.length ? rt.dns : null;
  return { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: w.name, namespace: ns, labels }, spec: {
    ...(w.primary && app.autoscale ? {} : { replicas: w.replicas }),
    revisionHistoryLimit: 3,
    selector: { matchLabels: { "app.kubernetes.io/name": w.name } },
    strategy: disk || (rt && !rt.zeroDowntime) ? { type: "Recreate" } : { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
    // zero downtime: a new pod must stay ready a moment before the old one is drained
    ...(rt?.zeroDowntime && !disk && w.port ? { minReadySeconds: 3 } : {}),
    template: {
      metadata: { labels, annotations: { "gereh.net/deployment": deploymentId } },
      spec: {
        automountServiceAccountToken: false,
        enableServiceLinks: false,
        ...(c.pullSecret ? { imagePullSecrets: [{ name: "gereh-registry" }] } : {}),
        ...(w.aliases?.length ? { hostAliases: w.aliases } : {}),
        // custom resolvers replace the cluster DNS (Kubernetes takes at most 3); in-namespace names come from hostAliases (release())
        ...(dns ? { dnsPolicy: "None", dnsConfig: { nameservers: dns.slice(0, 3), searches: [ns + ".svc.cluster.local", "svc.cluster.local", "cluster.local"], options: [{ name: "ndots", value: "2" }] } } : {}),
        // high availability: replicas of one workload land on different nodes when the cluster has them
        ...((w.primary && (app.instances > 1 || app.autoscale)) || w.replicas > 1 ? {
          topologySpreadConstraints: [{ maxSkew: 1, topologyKey: "kubernetes.io/hostname", whenUnsatisfiable: "ScheduleAnyway", labelSelector: { matchLabels: { "app.kubernetes.io/name": w.name } } }],
          affinity: { podAntiAffinity: { preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 100, podAffinityTerm: { topologyKey: "kubernetes.io/hostname", labelSelector: { matchLabels: { "app.kubernetes.io/name": w.name } } } }] } },
        } : {}),
        terminationGracePeriodSeconds: 30,
        // pre-start hook without a start command: an init container from the same image
        ...(preStart && !w.command ? { initContainers: [{ name: "pre-start", image: w.image, imagePullPolicy: "IfNotPresent", command: ["/bin/sh", "-c", preStart], envFrom: [{ secretRef: { name: app.name + "-env" } }], resources, securityContext: security, ...(mounts.length ? { volumeMounts: mounts } : {}) }] } : {}),
        containers: [{
          name: "app", image: w.image, imagePullPolicy: "IfNotPresent",
          ...(command ? { command: ["/bin/sh", "-c", command] } : {}),
          ...(w.port ? { ports: [{ name: "http", containerPort: w.port }] } : {}),
          envFrom: [{ secretRef: { name: app.name + "-env" } }],
          ...(w.env && Object.keys(w.env).length ? { env: Object.entries(w.env).map(([name, value]) => ({ name, value })) } : {}),
          // compose services share the plan: each may burst to the full limit, requests are split
          resources,
          ...(w.primary && probe ? { readinessProbe: probe, startupProbe: { ...probe, periodSeconds: 5, failureThreshold: rt?.health.startPeriod ? Math.ceil(rt.health.startPeriod / 5) + rt.health.retries : 60 } } : {}),
          ...(w.port ? { livenessProbe: rt && w.primary && probe
            ? { ...probe, periodSeconds: Math.max(10, rt.health.interval), failureThreshold: Math.max(3, rt.health.retries) }
            : { tcpSocket: { port: w.port }, periodSeconds: 20, failureThreshold: 3, initialDelaySeconds: w.primary ? 0 : 30 } } : {}),
          ...(rt?.zeroDowntime && w.port ? { lifecycle: { preStop: { exec: { command: ["/bin/sh", "-c", "sleep 5"] } } } } : {}),
          securityContext: security,
          ...(mounts.length ? { volumeMounts: mounts } : {}),
        }],
        ...(volumes.length ? { volumes } : {}),
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

const procName = (app: Pick<AppSpec, "name">, proc: string) => app.name + "-" + proc;
export const cronName = (app: Pick<AppSpec, "name">, cron: string) => app.name + "-cron-" + cron;
const runPod = (app: AppSpec, image: string, command: string, labels: Record<string, string>) => {
  const c = cfg();
  return {
    metadata: { labels },
    spec: {
      restartPolicy: "Never", automountServiceAccountToken: false, enableServiceLinks: false,
      ...(c.pullSecret ? { imagePullSecrets: [{ name: "gereh-registry" }] } : {}),
      containers: [{
        name: "app", image, imagePullPolicy: "IfNotPresent", command: ["/bin/sh", "-c", command],
        envFrom: [{ secretRef: { name: app.name + "-env" } }],
        resources: { requests: { cpu: cpuQty(app.cpu / 2), memory: memQty(app.ramMb) }, limits: { cpu: cpuQty(app.cpu), memory: memQty(app.ramMb) } },
        securityContext: { allowPrivilegeEscalation: false, seccompProfile: { type: "RuntimeDefault" } },
      }],
    },
  };
};
/** scheduled command (Tehran time); never overlaps itself */
export function cronJobObject(app: AppSpec, cron: AppSpec["crons"][number], image: string): Obj {
  const labels = { ...appLabels(app), "app.kubernetes.io/name": cronName(app, cron.name), "gereh.net/cron": cron.name };
  return { apiVersion: "batch/v1", kind: "CronJob", metadata: { name: cronName(app, cron.name), namespace: nsOf(app.userId), labels }, spec: {
    schedule: cron.schedule, timeZone: "Asia/Tehran", suspend: !cron.enabled, concurrencyPolicy: "Forbid", startingDeadlineSeconds: 300,
    successfulJobsHistoryLimit: 1, failedJobsHistoryLimit: 3,
    jobTemplate: { metadata: { labels }, spec: { backoffLimit: 0, activeDeadlineSeconds: 3600, ttlSecondsAfterFinished: 86_400, template: runPod(app, image, cron.command, labels) } },
  } };
}
/** one-off job in the customer's namespace (release command or a command run from the panel) */
export function runJobObject(app: AppSpec, image: string, jobId: string, command: string): Obj {
  const labels = { ...appLabels(app), "app.kubernetes.io/name": "job-" + jobId.toLowerCase(), "gereh.net/job": jobId.toLowerCase() };
  return { apiVersion: "batch/v1", kind: "Job", metadata: { name: "job-" + jobId.toLowerCase(), namespace: nsOf(app.userId), labels }, spec: {
    backoffLimit: 0, activeDeadlineSeconds: 3600, ttlSecondsAfterFinished: 86_400, template: runPod(app, image, command, labels),
  } };
}

/* WordPress import: an init container (alpine: wget, tar, unzip) downloads the backup, finds the
   WordPress root and the SQL dump, and copies the files onto the app's disk; the main container
   (mariadb client) loads the dump and points siteurl/home at the new address. */
export const WP_EXTRACT = String.raw`set -eu
cd /work
echo "==> Downloading backup"
wget -q -O backup "$SOURCE_URL"
mkdir x
case "$(head -c 2 backup | od -An -tx1 | tr -d ' \n')" in
  504b) echo "==> ZIP archive"; unzip -q backup -d x ;;
  1f8b) echo "==> tar.gz archive (cPanel)"; tar -xzf backup -C x ;;
  *) echo "ERROR: unsupported archive: upload a cPanel full backup (.tar.gz) or a .zip of the site and its .sql dump"; exit 1 ;;
esac
rm -f backup
CONF=$(find x -name wp-config.php -not -path '*/wp-content/*' | head -1)
[ -n "$CONF" ] || { echo "ERROR: wp-config.php not found in the backup"; exit 1; }
ROOT=$(dirname "$CONF")
SQL=$(find x -path '*/mysql/*.sql' | head -1); [ -n "$SQL" ] || SQL=$(find x -name '*.sql' | head -1)
[ -n "$SQL" ] || { echo "ERROR: no .sql database dump in the backup"; exit 1; }
sed -n "s/^[[:space:]]*\$table_prefix[[:space:]]*=[[:space:]]*['\"]\([A-Za-z0-9_]*\)['\"].*/\1/p" "$CONF" | head -1 > /work/prefix
echo "==> WordPress root: $ROOT, database dump: $SQL, table prefix: $(cat /work/prefix)"
mv "$SQL" /work/dump.sql
echo "==> Copying files ($(find "$ROOT" -type f | wc -l) files)"
find /site -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$ROOT"/. /site/
rm -f /site/wp-config.php
# cPanel PHP handlers and php_value lines break Apache in the container
[ -f /site/.htaccess ] && sed -i -E '/AddHandler|SetHandler.*php|php_value|php_flag|suPHP/d' /site/.htaccess
chown -R 33:33 /site
rm -rf x`;
export const WP_IMPORT_SQL = String.raw`set -eu
P=$(cat /work/prefix); [ -n "$P" ] || P=wp_; T="$P"options
echo "==> Importing database"
sed -E '/^(CREATE DATABASE|USE )/d' /work/dump.sql | mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"
if [ -n "$NEW_URL" ]; then
  mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "UPDATE $T SET option_value='$NEW_URL' WHERE option_name IN ('siteurl','home')"
  echo "==> siteurl and home → $NEW_URL"
fi
echo "PREFIX=$P"`;
export function importJobObject(app: AppSpec, d: DbSpec, sourceUrl: string, jobId: string, newUrl: string): Obj {
  const labels = { ...appLabels(app), "app.kubernetes.io/name": "job-" + jobId.toLowerCase(), "gereh.net/job": jobId.toLowerCase() };
  const vols = [{ name: "work", mountPath: "/work" }];
  return { apiVersion: "batch/v1", kind: "Job", metadata: { name: "job-" + jobId.toLowerCase(), namespace: nsOf(app.userId), labels }, spec: {
    backoffLimit: 0, activeDeadlineSeconds: 7200, ttlSecondsAfterFinished: 86_400,
    template: { metadata: { labels }, spec: {
      restartPolicy: "Never", automountServiceAccountToken: false, enableServiceLinks: false,
      initContainers: [{ name: "files", image: "alpine:3.20", command: ["/bin/sh", "-c", WP_EXTRACT], env: [{ name: "SOURCE_URL", value: sourceUrl }], volumeMounts: [...vols, { name: "site", mountPath: "/site" }], resources: { limits: { cpu: "1", memory: "1Gi" } } }],
      containers: [{ name: "app", image: "mariadb:11.4", command: ["/bin/sh", "-c", WP_IMPORT_SQL], volumeMounts: vols, resources: { limits: { cpu: "1", memory: "1Gi" } },
        env: [{ name: "DB_HOST", value: dbName(d) }, { name: "DB_PORT", value: "3306" }, { name: "DB_USER", value: d.username }, { name: "DB_PASSWORD", value: d.password }, { name: "DB_NAME", value: d.dbName }, { name: "NEW_URL", value: newUrl }] }],
      volumes: [{ name: "work", emptyDir: { sizeLimit: "20Gi" } }, { name: "site", persistentVolumeClaim: { claimName: app.name + "-data" } }],
    } },
  } };
}

/** everything but the Services; `ips` maps compose service name → cluster IP */
/** the app's Ingresses: main, wildcard hosts (DNS-01 certificate), one per redirecting domain, and the
    basic-auth path (same hosts, the longer prefix wins) */
export function ingressObjects(app: AppSpec): Obj[] {
  const c = cfg(), ns = nsOf(app.userId), labels = appLabels(app), rt = app.runtime;
  const redirect = new Map((rt?.redirects ?? []).map((r) => [r.host, r]));
  const served = app.hosts.filter((h, i) => !(i === 0 && rt && !rt.defaultDomain) && !redirect.has(h));
  const plain = served.filter((h) => !h.startsWith("*.")), wild = served.filter((h) => h.startsWith("*."));
  const custom = plain.filter((h) => h !== app.hosts[0]);
  const base = {
    "nginx.ingress.kubernetes.io/proxy-body-size": "50m", "nginx.ingress.kubernetes.io/proxy-read-timeout": "120",
    ...(app.cdn ? { "nginx.ingress.kubernetes.io/configuration-snippet": cdnSnippet(app.cacheVersion) } : {}),
  };
  const tlsFor = (hosts: string[]) => [
    ...(hosts.includes(app.hosts[0]) ? [{ hosts: [app.hosts[0]] }] : []),
    ...(hosts.some((h) => custom.includes(h)) ? [{ hosts: hosts.filter((h) => custom.includes(h)), secretName: app.name + "-tls" }] : []),
    ...(hosts.some((h) => h.startsWith("*.")) ? [{ hosts: hosts.filter((h) => h.startsWith("*.")), secretName: app.name + "-wild-tls" }] : []),
  ];
  const ing = (name: string, annotations: Record<string, string>, hosts: string[], tls: Obj[], path = "/"): Obj => ({
    apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: { name, namespace: ns, labels, annotations },
    spec: { ingressClassName: c.ingressClass, tls, rules: hosts.map((host) => ({ host, http: { paths: [{ path, pathType: "Prefix", backend: { service: { name: app.name, port: { name: "http" } } } }] } })) },
  });
  const out: Obj[] = [];
  // the default host has no secretName: the controller serves its default (wildcard) certificate
  if (plain.length) out.push(ing(app.name, { ...(custom.length ? { "cert-manager.io/cluster-issuer": c.issuer } : {}), ...base }, plain, tlsFor(plain)));
  if (wild.length) out.push(ing(app.name + "-wild", { "cert-manager.io/cluster-issuer": c.wildcardIssuer, ...base }, wild, tlsFor(wild)));
  if (rt?.basicAuth && served.length) out.push(ing(app.name + "-auth", {
    ...base, "nginx.ingress.kubernetes.io/auth-type": "basic", "nginx.ingress.kubernetes.io/auth-secret": app.name + "-basic-auth", "nginx.ingress.kubernetes.io/auth-realm": "Restricted",
  }, served, tlsFor(served), rt.basicAuth.path));
  for (const r of redirect.values()) {
    const name = redirectName(app, r.host);
    out.push(ing(name, {
      "cert-manager.io/cluster-issuer": r.host.startsWith("*.") ? c.wildcardIssuer : c.issuer,
      [r.code === 302 ? "nginx.ingress.kubernetes.io/temporal-redirect" : "nginx.ingress.kubernetes.io/permanent-redirect"]: r.target.replace(/\/$/, "") + (r.keepPath ? "$request_uri" : ""),
    }, [r.host], [{ hosts: [r.host], secretName: name + "-tls" }]));
  }
  return out;
}
export const redirectName = (app: Pick<AppSpec, "name">, host: string) => app.name + "-r-" + createHash("sha1").update(host).digest("hex").slice(0, 8);

/** everything but the Services; `ips` maps compose service name → cluster IP; `nsAliases` resolve the
    namespace's services when the app uses its own DNS servers */
export function appObjects(app: AppSpec, image: string, deploymentId: string, ips: Record<string, string> = {}, nsAliases: { ip: string; hostnames: string[] }[] = []): Obj[] {
  const c = cfg(), ns = nsOf(app.userId), labels = appLabels(app);
  const compose = composeOf(image);
  const aliases = [...Object.entries(ips).map(([name, ip]) => ({ ip, hostnames: [name] })), ...nsAliases];
  const workloads: Workload[] = compose
    ? compose.map((s) => ({
        name: s.public ? app.name : app.name + "-" + s.name, image: s.image!, port: s.port, service: s.name, primary: s.public,
        command: (s.public && app.startCommand) || s.command, replicas: s.public ? app.instances : 1, aliases,
        // panel variables win over compose defaults (container env would otherwise shadow envFrom)
        env: Object.fromEntries(Object.entries(s.env).filter(([k]) => !(k in app.env))),
      }))
    : [{ name: app.name, image, port: app.port, command: app.startCommand, replicas: app.instances, primary: true, service: "app", aliases },
        // background processes get the plan's full size each (they are billed per instance)
        ...(app.processes ?? []).filter((p) => p.instances > 0).map((p) => ({ name: procName(app, p.name), image, command: p.command, replicas: p.instances, primary: false, service: "proc-" + p.name, own: true, aliases }))];
  const conf = confData(app);
  const out: Obj[] = [
    { apiVersion: "v1", kind: "Secret", metadata: { name: app.name + "-env", namespace: ns, labels }, type: "Opaque", stringData: { ...app.env, ...(compose ? { PORT: String(compose.find((x) => x.public)!.port) } : {}), GEREH_DEPLOYMENT: deploymentId } },
    ...(Object.keys(conf).length ? [{ apiVersion: "v1", kind: "ConfigMap", metadata: { name: app.name + "-conf", namespace: ns, labels }, data: conf }] : []),
    ...workloads.map((w) => deployment(app, w, deploymentId, w.own ? 1 : workloads.filter((x) => !x.own).length)),
    ...(app.runtime?.basicAuth ? [{ apiVersion: "v1", kind: "Secret", metadata: { name: app.name + "-basic-auth", namespace: ns, labels }, type: "Opaque", stringData: { auth: app.runtime.basicAuth.htpasswd + "\n" } }] : []),
    ...ingressObjects(app),
  ];
  if (!compose && image) for (const cr of app.crons ?? []) out.push(cronJobObject(app, cr, image));
  if (app.diskGb) out.push({ apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: { name: app.name + "-data", namespace: ns, labels }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: app.diskGb + "Gi" } }, ...(c.storageClass ? { storageClassName: c.storageClass } : {}) } });
  if (app.autoscale) out.push({ apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler", metadata: { name: app.name, namespace: ns, labels }, spec: {
    scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name: app.name }, minReplicas: app.instances, maxReplicas: Math.max(app.instances, app.maxInstances),
    // requests are half the plan's CPU, so utilisation of the request is twice the share of the plan
    metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: Math.round(Math.min(90, Math.max(30, app.autoscaleCpu ?? 70)) * 2) } } }],
    behavior: { scaleUp: { stabilizationWindowSeconds: 30 }, scaleDown: { stabilizationWindowSeconds: 300, policies: [{ type: "Pods", value: 1, periodSeconds: 60 }] } },
  } });
  // node drains and upgrades never take every instance down at once
  if (!app.diskGb && (app.instances > 1 || app.autoscale)) out.push({ apiVersion: "policy/v1", kind: "PodDisruptionBudget", metadata: { name: app.name, namespace: ns, labels }, spec: { maxUnavailable: 1, selector: { matchLabels: { "app.kubernetes.io/name": app.name } } } });
  return out;
}

/* build hooks, appended to the prepare script once Dockerfile.gereh exists. Panel hooks win; otherwise
   gereh.json "hooks" are read with jq. pre-build: a RUN after the source is copied in the Nixpacks build
   phase, or (own Dockerfile) a step in the source folder before the image build; post-build: a RUN at
   the end of the final stage. RUN lines use the JSON (exec) form, so any command text is safe. */
export function buildHooks(pre: string, preRun: string, postRun: string) {
  const runOf = `jq -Rsc '["/bin/sh","-c",.]'`;
  return [
    `PRE=${shq(pre)}; PRE_RUN=${shq(preRun)}; POST_RUN=${shq(postRun)}`,
    `if [ -f gereh.json ] && command -v jq >/dev/null 2>&1; then`,
    `  [ -n "$PRE" ] || { PRE=$(jq -r '.hooks.preBuild // empty' gereh.json 2>/dev/null || true); [ -z "$PRE" ] || PRE_RUN=$(printf '%s' "$PRE" | ${runOf}); }`,
    `  [ -n "$POST_RUN" ] || { P=$(jq -r '.hooks.postBuild // empty' gereh.json 2>/dev/null || true); [ -z "$P" ] || POST_RUN=$(printf '%s' "$P" | ${runOf}); }`,
    `fi`,
    `if [ -n "$PRE" ]; then echo '==> pre-build hook'; if [ "$GEN" = 1 ]; then L="RUN $PRE_RUN" awk '{print} /^# build phase/{b=1} b && !d && /^COPY /{print ENVIRON["L"]; d=1} END{if(!d) print ENVIRON["L"]}' /workspace/Dockerfile.gereh > /workspace/Dockerfile.tmp && mv /workspace/Dockerfile.tmp /workspace/Dockerfile.gereh; else sh -c "$PRE"; fi; fi`,
    `if [ -n "$POST_RUN" ]; then echo '==> post-build hook'; printf '\nRUN %s\n' "$POST_RUN" >> /workspace/Dockerfile.gereh; fi`,
  ];
}

/** the build Job: prepare (fetch + Nixpacks) → Kaniko */
export function buildJob(app: AppSpec, deploymentId: string, sourceUrl?: string, service?: ComposeService): Obj {
  const c = cfg(), dep = deploymentId.toLowerCase();
  const image = service ? imageFor({ userId: app.userId, name: app.name + "-" + service.name }, dep) : imageFor(app, dep);
  const root = [(app.rootDir || "").replace(/^\/+|\/+$/g, ""), service?.build?.context === "." ? "" : service?.build?.context ?? ""].filter(Boolean).join("/") || ".";
  const rt = app.runtime;
  const dockerfile = service?.build?.dockerfile ?? rt?.build.dockerfile ?? "Dockerfile";
  const mirror = c.mirror && (rt?.build.mirror ?? true) ? mirrorEnv(c.mirror) : {};
  const cache = !app.noCache && (rt?.build.cache ?? true);
  const args = service ? {} : rt?.build.args ?? {};
  const run = (cmd: string) => (cmd ? JSON.stringify(["/bin/sh", "-c", cmd]) : "");
  const pre = service ? "" : rt?.preBuild ?? "", post = service ? "" : rt?.postBuild ?? "";
  const nixEnv = Object.entries(mirror).map(([k, v]) => "--env " + shq(k + "=" + v)).join(" ");
  const prepare = [
    "set -eu", "cd /workspace",
    app.source === "git"
      ? `git clone --depth 1 --branch ${shq(app.gitBranch || "main")} ${shq(app.gitUrl)} src 2>&1 | sed -E 's#://[^@/]+@#://***@#g'; echo "REF=$(git -C src rev-parse --short HEAD)"`
      : `wget -q -O src.zip "$SOURCE_URL" && mkdir src && unzip -q src.zip -d src && rm src.zip && if [ "$(ls -A src | wc -l)" = 1 ] && [ -d "src/$(ls -A src)" ]; then d="src/$(ls -A src)"; mv "$d" src.tmp && rmdir src && mv src.tmp src; fi`,
    `cd src/${root}`,
    `if [ -f gereh.json ] && [ "$(wc -c < gereh.json)" -lt 65536 ]; then echo "MANIFEST=$(base64 gereh.json | tr -d '\\n')"; fi`,
    `GEN=0; if [ -f ${shq(dockerfile)} ]; then echo '==> Using ${dockerfile.replace(/'/g, "")}'; cp ${shq(dockerfile)} /workspace/Dockerfile.gereh; else`,
    `  echo '==> Detecting stack with Nixpacks'; GEN=1; nixpacks build . --out . ${nixEnv} ${!service && app.buildCommand ? "--build-cmd " + shq(app.buildCommand) : ""} ${!service && app.startCommand ? "--start-cmd " + shq(app.startCommand) : ""}; cp .nixpacks/Dockerfile /workspace/Dockerfile.gereh; fi`,
    ...(service ? [] : buildHooks(pre, run(pre), run(post))),
  ].join("\n");
  return {
    apiVersion: "batch/v1", kind: "Job",
    metadata: { name: "build-" + dep + (service ? "-" + service.name : ""), namespace: c.system, labels: { ...appLabels(app), "gereh.net/deployment": deploymentId, "gereh.net/kind": "build" } },
    spec: {
      backoffLimit: 0, activeDeadlineSeconds: (rt?.build.timeoutMin ?? 30) * 60, ttlSecondsAfterFinished: 86_400,
      template: {
        metadata: { labels: { "gereh.net/deployment": deploymentId, "gereh.net/kind": "build" } },
        spec: {
          restartPolicy: "Never", automountServiceAccountToken: false,
          initContainers: [{ name: "prepare", image: c.builderImage, command: ["/bin/sh", "-c", prepare], env: sourceUrl ? [{ name: "SOURCE_URL", value: sourceUrl }] : [], volumeMounts: [{ name: "workspace", mountPath: "/workspace" }], resources: { limits: { cpu: "1", memory: "1Gi" } } }],
          containers: [{
            name: "kaniko", image: c.kanikoImage,
            args: ["--context=dir:///workspace/src/" + root, "--dockerfile=/workspace/Dockerfile.gereh", "--destination=" + image, "--cache=" + cache, "--cache-repo=" + c.registry + "/cache/" + dns1123(app.userId), "--snapshot-mode=redo", "--use-new-run", "--compressed-caching=false",
              ...(c.mirror ? ["--registry-mirror=" + mirrorHost(c.mirror)] : []), ...Object.entries(mirror).map(([k, v]) => "--build-arg=" + k + "=" + v),
              ...Object.entries(args).map(([k, v]) => "--build-arg=" + k + "=" + v)],
            volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "registry", mountPath: "/kaniko/.docker" }],
            resources: { requests: { cpu: "500m", memory: "1Gi" }, limits: { cpu: "2", memory: "4Gi" } },
          }],
          volumes: [{ name: "workspace", emptyDir: { sizeLimit: "10Gi" } }, { name: "registry", secret: { secretName: "registry-push", items: [{ key: ".dockerconfigjson", path: "config.json" }] } }],
        },
      },
    },
  };
}

/* engine details (image, env, probes, tuning flags) live in ./engines.ts */
const dbImage = (d: DbSpec) => engineK8s(d.engine).image(d);
const dbEnv = (d: DbSpec) => engineK8s(d.engine).env(d);
const dbProbe = (d: DbSpec): Obj => {
  const e = engineK8s(d.engine);
  return { ...(e.probe ? { exec: { command: ["/bin/sh", "-c", e.probe] } } : { tcpSocket: { port: e.port } }), periodSeconds: 10, timeoutSeconds: 5 };
};

export const pitrPrefix = (userId: string, dbId: string) => "s3://" + cfg().pitrBucket + "/" + dns1123(userId) + "/" + dbId;
/** WAL-G: restore the latest base backup before `time`, replay WAL up to it, then promote */
export function pitrRestoreScript(prefix: string, time: string) {
  return [
    "set -e", 'D="$PGDATA"',
    '[ -s "$D/PG_VERSION" ] && { echo "data exists, skipping restore"; exit 0; }',
    'mkdir -p "$D"',
    `WALG_S3_PREFIX=${shq(prefix)} wal-g backup-fetch "$D" LATEST`,
    'touch "$D/recovery.signal"',
    `printf "%s\\n" ${shq("restore_command = 'WALG_S3_PREFIX=" + prefix + " wal-g wal-fetch %f %p'")} ${shq("recovery_target_time = '" + time + "'")} "recovery_target_action = 'promote'" >> "$D/postgresql.auto.conf"`,
    'chown -R postgres:postgres "$D" && chmod 700 "$D"',
  ].join("\n");
}
const PITR_SIDECAR = [
  "set -u", "sleep 120",
  // a base backup a day, 7 kept; WAL segments in between are archived by the server itself
  'while true; do wal-g backup-push "$PGDATA" && wal-g delete retain FULL 7 --confirm; sleep 86400; done',
].join("\n");

export function dbObjects(d: DbSpec): Obj[] {
  const c = cfg(), ns = nsOf(d.userId), labels = dbLabels(d), e = engineK8s(d.engine), port = e.port, data = e.data;
  const walg = d.engine === "postgres" && (d.pitr || d.restore);
  const args = d.engine === "postgres" ? pgArgs(d, !!(walg && d.pitr)) : e.args?.(d);
  const command = e.command?.(d);
  const rsKey = d.engine === "mongodb" && d.replicaSet;
  const walgEnv = walg ? [
    { name: "AWS_ACCESS_KEY_ID", valueFrom: { secretKeyRef: { name: "pitr-s3", key: "key" } } }, { name: "AWS_SECRET_ACCESS_KEY", valueFrom: { secretKeyRef: { name: "pitr-s3", key: "secret" } } },
    { name: "AWS_ENDPOINT", value: c.pitrS3.endpoint }, { name: "AWS_S3_FORCE_PATH_STYLE", value: "true" }, { name: "AWS_REGION", value: "us-east-1" },
    { name: "WALG_S3_PREFIX", value: pitrPrefix(d.userId, d.id) }, { name: "WALG_COMPRESSION_METHOD", value: "brotli" },
  ] : [];
  return [
    ...(walg ? [{ apiVersion: "v1", kind: "Secret", metadata: { name: "pitr-s3", namespace: ns, labels: { "app.kubernetes.io/managed-by": FM } }, type: "Opaque", stringData: { key: c.pitrS3.key, secret: c.pitrS3.secret } }] : []),
    { apiVersion: "v1", kind: "Secret", metadata: { name: dbName(d) + "-auth", namespace: ns, labels }, type: "Opaque", stringData: { password: d.password, ...e.secret?.(d) } },
    { apiVersion: "apps/v1", kind: "StatefulSet", metadata: { name: dbName(d), namespace: ns, labels }, spec: {
      serviceName: dbName(d), replicas: 1, selector: { matchLabels: { "app.kubernetes.io/name": dbName(d) } },
      template: { metadata: { labels }, spec: {
        automountServiceAccountToken: false, enableServiceLinks: false, terminationGracePeriodSeconds: 60,
        ...(e.fsGroup ? { securityContext: { fsGroup: e.fsGroup } } : {}),
        ...(walg && d.restore ? { initContainers: [{ name: "pitr-restore", image: c.walgImage + ":" + d.version, command: ["/bin/sh", "-c", pitrRestoreScript(pitrPrefix(d.restore.fromUserId, d.restore.fromId), d.restore.time)], env: [...dbEnv(d), ...walgEnv], volumeMounts: [{ name: "data", mountPath: data }] }] } : {}),
        // mongod insists on a key file only its own user can read
        ...(rsKey ? { initContainers: [{ name: "keyfile", image: dbImage(d), command: ["/bin/sh", "-c", "cp /key-src/keyfile /etc/mongo-key/keyfile && chown 999:999 /etc/mongo-key/keyfile && chmod 400 /etc/mongo-key/keyfile"], volumeMounts: [{ name: "key-src", mountPath: "/key-src" }, { name: "key", mountPath: "/etc/mongo-key" }] }] } : {}),
        containers: [{
          name: "db", image: walg ? c.walgImage + ":" + d.version : dbImage(d),
          ...(args ? { args } : {}),
          ...(command ? { command } : {}),
          env: [...dbEnv(d), ...walgEnv], ports: [{ name: "db", containerPort: port }, ...(e.extraPorts ?? []).map((x) => ({ name: x.name, containerPort: x.port }))],
          resources: { requests: { cpu: cpuQty(d.cpu / 2), memory: memQty(d.ramMb) }, limits: { cpu: cpuQty(d.cpu), memory: memQty(d.ramMb) } },
          readinessProbe: dbProbe(d), livenessProbe: { tcpSocket: { port }, periodSeconds: 20, failureThreshold: 6, initialDelaySeconds: e.slow ? 120 : 30 },
          volumeMounts: [{ name: "data", mountPath: data }, ...(rsKey ? [{ name: "key", mountPath: "/etc/mongo-key" }] : [])],
        }, ...(walg && d.pitr ? [{
          name: "walg", image: c.walgImage + ":" + d.version, command: ["/bin/sh", "-c", PITR_SIDECAR],
          env: [...dbEnv(d), ...walgEnv, { name: "PGHOST", value: "127.0.0.1" }, { name: "PGUSER", value: d.username }, { name: "PGPASSWORD", valueFrom: { secretKeyRef: { name: dbName(d) + "-auth", key: "password" } } }, { name: "PGDATABASE", value: d.dbName }],
          resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
          volumeMounts: [{ name: "data", mountPath: data }],
        }] : [])],
        ...(rsKey ? { volumes: [{ name: "key-src", secret: { secretName: dbName(d) + "-auth", items: [{ key: "keyfile", path: "keyfile" }] } }, { name: "key", emptyDir: { medium: "Memory", sizeLimit: "1Mi" } }] } : {}),
      } },
      volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: d.diskGb + "Gi" } }, ...(c.storageClass ? { storageClassName: c.storageClass } : {}) } }],
    } },
    { apiVersion: "v1", kind: "Service", metadata: { name: dbName(d), namespace: ns, labels }, spec: { selector: { "app.kubernetes.io/name": dbName(d) }, ports: [{ name: "db", port, targetPort: port }, ...(e.extraPorts ?? []).map((x) => ({ name: x.name, port: x.port, targetPort: x.port }))] } },
  ];
}
/** public access: a NodePort plus a policy that opens only this database's pod to the outside — to
    everyone, or only to the allowlisted CIDRs. With an allowlist the Service keeps the client's
    address (externalTrafficPolicy Local), so the public DNS name must point at the nodes themselves. */
export const publicObjects = (d: DbSpec): Obj[] => {
  const allow = d.allowlist?.length ? d.allowlist : ["0.0.0.0/0"];
  return [
    { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: dbName(d) + "-public", namespace: nsOf(d.userId), labels: dbLabels(d) }, spec: { podSelector: { matchLabels: { "app.kubernetes.io/name": dbName(d) } }, policyTypes: ["Ingress"], ingress: [{ ports: [{ port: enginePort(d.engine) }], from: allow.map((cidr) => ({ ipBlock: { cidr } })) }] } },
    publicSvc(d),
  ];
};
const publicSvc = (d: DbSpec): Obj => ({ apiVersion: "v1", kind: "Service", metadata: { name: dbName(d) + "-public", namespace: nsOf(d.userId), labels: dbLabels(d) }, spec: { type: "NodePort", ...(d.allowlist?.length ? { externalTrafficPolicy: "Local" } : {}), selector: { "app.kubernetes.io/name": dbName(d) }, ports: [{ name: "db", port: enginePort(d.engine), targetPort: enginePort(d.engine) }] } });
export const dbHost = (d: Pick<DbSpec, "name" | "userId">) => dbName(d) + "." + nsOf(d.userId) + ".svc.cluster.local";

/* shell snippets for backup / restore Jobs (run in the platform namespace) */
export function dumpCommand(d: DbSpec) {
  const h = dbHost(d), p = enginePort(d.engine);
  switch (d.engine) {
    case "postgres": return `PGPASSWORD="$DB_PASSWORD" pg_dump -h ${h} -p ${p} -U ${shq(d.username)} -Fc ${shq(d.dbName)} > /backup/dump`;
    case "mysql": return `mysqldump -h ${h} -P ${p} -u root -p"$DB_PASSWORD" --single-transaction --routines --triggers --databases ${shq(d.dbName)} > /backup/dump`;
    case "mariadb": return `mariadb-dump -h ${h} -P ${p} -u root -p"$DB_PASSWORD" --single-transaction --routines --triggers --databases ${shq(d.dbName)} > /backup/dump`;
    case "mongodb": return `mongodump --uri="mongodb://${encodeURIComponent(d.username)}:$DB_PASSWORD@${h}:${p}/?authSource=admin" --archive=/backup/dump --gzip`;
    default: return `redis-cli -h ${h} -p ${p} -a "$DB_PASSWORD" --no-auth-warning --rdb /backup/dump`;
  }
}
export function restoreCommand(d: DbSpec) {
  const h = dbHost(d), p = enginePort(d.engine);
  switch (d.engine) {
    case "postgres": return `PGPASSWORD="$DB_PASSWORD" pg_restore -h ${h} -p ${p} -U ${shq(d.username)} -d ${shq(d.dbName)} --clean --if-exists --no-owner /backup/dump`;
    case "mysql": return `mysql -h ${h} -P ${p} -u root -p"$DB_PASSWORD" < /backup/dump`;
    case "mariadb": return `mariadb -h ${h} -P ${p} -u root -p"$DB_PASSWORD" < /backup/dump`;
    case "mongodb": return `mongorestore --uri="mongodb://${encodeURIComponent(d.username)}:$DB_PASSWORD@${h}:${p}/?authSource=admin" --archive=/backup/dump --gzip --drop`;
    default: throw new Error("Redis is restored by redisRestoreScript");
  }
}

/** restores /backup/dump into a server started inside the job and prints what it found */
export function verifyScript(d: DbSpec) {
  switch (d.engine) {
    case "postgres": return [
      "export PGDATA=/tmp/v; mkdir -p $PGDATA; chown postgres $PGDATA",
      "su-exec postgres initdb -D $PGDATA -A trust -U postgres >/dev/null",
      "su-exec postgres pg_ctl -D $PGDATA -o \"-k /tmp -c listen_addresses=''\" -w start >/dev/null",
      "createdb -h /tmp -U postgres verify",
      "pg_restore -h /tmp -U postgres -d verify --no-owner --no-acl /backup/dump",
      "echo \"TABLES=$(psql -h /tmp -U postgres -d verify -tAc \"select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')\")\"",
    ].join("\n");
    case "mysql": case "mariadb": {
      const [init, srv, cli] = d.engine === "mysql" ? ["mysqld --initialize-insecure --user=root --datadir=/tmp/v", "mysqld", "mysql"] : ["mariadb-install-db --user=root --datadir=/tmp/v --auth-root-authentication-method=normal", "mariadbd", "mariadb"];
      return [
        init + " >/dev/null 2>&1",
        srv + " --user=root --datadir=/tmp/v --skip-networking --socket=/tmp/m.sock >/tmp/m.log 2>&1 &",
        "for i in $(seq 1 60); do [ -S /tmp/m.sock ] && break; sleep 1; done",
        cli + " -uroot -S /tmp/m.sock < /backup/dump",
        // db names are [a-z0-9_] (from the validated resource name)
        "echo \"TABLES=$(" + cli + " -uroot -S /tmp/m.sock -N -e \"select count(*) from information_schema.tables where table_schema='" + d.dbName.replace(/[^\w]/g, "") + "'\")\"",
      ].join("\n");
    }
    case "mongodb": return [
      "mkdir -p /tmp/v && mongod --dbpath /tmp/v --bind_ip 127.0.0.1 --port 27099 --fork --logpath /tmp/m.log >/dev/null",
      "mongorestore --port 27099 --archive=/backup/dump --gzip --quiet",
      "echo \"TABLES=$(mongosh --port 27099 --quiet --eval 'db.getSiblingDB(" + JSON.stringify(d.dbName) + ").getCollectionNames().length')\"",
    ].join("\n");
    default: return "redis-check-rdb /backup/dump | tail -1 && echo TABLES=1";
  }
}

export const SCAN_TEMPLATE = "{{range .}}{{range .Vulnerabilities}}{{.Severity}} {{.VulnerabilityID}} {{.PkgName}} {{.InstalledVersion}} -> {{.FixedVersion}}\n{{end}}{{end}}";
export function scanJob(app: AppSpec, image: string, deploymentId: string): Obj {
  const c = cfg(), dep = deploymentId.toLowerCase();
  return { apiVersion: "batch/v1", kind: "Job", metadata: { name: "scan-" + dep, namespace: c.system, labels: { ...appLabels(app), "gereh.net/deployment": deploymentId, "gereh.net/kind": "scan" } }, spec: {
    backoffLimit: 0, activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 86_400,
    template: { metadata: { labels: { "gereh.net/kind": "scan" } }, spec: {
      restartPolicy: "Never", automountServiceAccountToken: false,
      containers: [{
        name: "scan", image: c.trivyImage,
        args: ["image", "--quiet", "--no-progress", "--scanners", "vuln", "--severity", "HIGH,CRITICAL", "--ignore-unfixed", "--format", "template", "--template", SCAN_TEMPLATE, ...(c.trivyDb ? ["--db-repository", c.trivyDb] : []), image],
        env: [{ name: "DOCKER_CONFIG", value: "/docker" }, { name: "TRIVY_CACHE_DIR", value: "/cache" }],
        volumeMounts: [{ name: "registry", mountPath: "/docker" }, { name: "cache", mountPath: "/cache" }],
        resources: { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1", memory: "2Gi" } },
      }],
      volumes: [{ name: "registry", secret: { secretName: "registry-push", items: [{ key: ".dockerconfigjson", path: "config.json" }] } }, { name: "cache", emptyDir: { sizeLimit: "5Gi" } }],
    } },
  } };
}
export function parseScan(log: string) {
  const rows = log.split("\n").filter((l) => /^(CRITICAL|HIGH) /.test(l));
  return { critical: rows.filter((l) => l.startsWith("CRITICAL")).length, high: rows.filter((l) => l.startsWith("HIGH")).length, report: [...new Set(rows)].sort().slice(0, 300).join("\n") };
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

  async ensureNs(userId: string) {
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
    const m64 = /^MANIFEST=([A-Za-z0-9+/=]+)$/m.exec(log)?.[1];
    const clean = log.replace(/^(REF|MANIFEST)=\S+\n?/gm, "").trim();
    if (job.status?.succeeded) return { state: "succeeded", log: clean + "\n==> Image pushed", image: imageFor(app, handle.replace(/^build-/, "")), ref, manifest: m64 ? Buffer.from(m64, "base64").toString("utf8") : undefined };
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
      const log = (await this.jobLogs(ns, name, ["prepare", "kaniko"])).replace(/^(REF|MANIFEST)=\S+\n?/gm, "").trim();
      logs.push("──── " + s.name + " ────" + (log ? "\n" + log : ""));
      if (job.status?.failed || job.status?.conditions?.some((x) => x.type === "Failed" && x.status === "True")) return { state: "failed", log: logs.join("\n") + "\nERROR: build of service " + s.name + " failed" };
      if (!job.status?.succeeded) running = true;
    }
    if (running) return { state: "running", log: logs.join("\n") };
    const services = h.services.map((s) => (s.build ? { ...s, image: imageFor({ userId: app.userId, name: app.name + "-" + s.name }, h.dep) } : s));
    return { state: "succeeded", log: logs.join("\n") + "\n==> Images pushed", image: "compose:" + JSON.stringify(services) };
  }

  /* ----- apps ----- */
  private async owned(ns: string, kind: "Deployment" | "Service" | "CronJob" | "Ingress", appId: string) {
    const r = await k8s("GET", pathOf(({ Deployment: "apps/v1", Service: "v1", CronJob: "batch/v1", Ingress: "networking.k8s.io/v1" })[kind], kind, ns) + "?labelSelector=" + encodeURIComponent("gereh.net/app=" + appId));
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
    const objs = appObjects(app, image, deploymentId, ips, app.runtime?.dns.length ? await this.serviceAliases(ns) : []);
    for (const o of objs) await apply(o as never);
    // services removed from docker-compose.yml since the last release
    const keep = new Set([...services, ...objs].map((o) => o.kind + "/" + (o.metadata as { name: string }).name));
    for (const d of await this.owned(ns, "Deployment", app.id)) if (!keep.has("Deployment/" + d.metadata.name)) await del("apps/v1", "Deployment", ns, d.metadata.name);
    for (const sv of await this.owned(ns, "Service", app.id)) if (!keep.has("Service/" + sv.metadata.name)) await del("v1", "Service", ns, sv.metadata.name);
    for (const cj of await this.owned(ns, "CronJob", app.id)) if (!keep.has("CronJob/" + cj.metadata.name)) await del("batch/v1", "CronJob", ns, cj.metadata.name);
    await this.pruneRouting(ns, app, keep);
    if (!keep.has("ConfigMap/" + app.name + "-conf")) await del("v1", "ConfigMap", ns, app.name + "-conf");
    if (!app.autoscale) await del("autoscaling/v2", "HorizontalPodAutoscaler", ns, app.name);
    if (!objs.some((o) => o.kind === "PodDisruptionBudget")) await del("policy/v1", "PodDisruptionBudget", ns, app.name);
    if (app.hosts.length < 2) await del("v1", "Secret", ns, app.name + "-tls");
  }

  /** routing only: the Ingresses (domains, redirects, basic auth, TLS, CDN) */
  async updateRouting(app: AppSpec) {
    const objs = appObjects(app, "", "").filter((o) => o.kind === "Ingress" || (o.metadata as { name: string }).name === app.name + "-basic-auth");
    for (const o of objs) await apply(o as never);
    await this.pruneRouting(nsOf(app.userId), app, new Set(objs.map((o) => o.kind + "/" + (o.metadata as { name: string }).name)));
  }
  /** Ingresses (and the basic-auth Secret) the app no longer needs */
  private async pruneRouting(ns: string, app: AppSpec, keep: Set<string>) {
    for (const i of await this.owned(ns, "Ingress", app.id)) if (!keep.has("Ingress/" + i.metadata.name)) await del("networking.k8s.io/v1", "Ingress", ns, i.metadata.name);
    if (!keep.has("Secret/" + app.name + "-basic-auth")) await del("v1", "Secret", ns, app.name + "-basic-auth");
  }
  /** hostAliases for every Service of the namespace (apps with custom DNS servers bypass the cluster DNS) */
  private async serviceAliases(ns: string) {
    const r = await k8s("GET", "/api/v1/namespaces/" + ns + "/services");
    return ((r.items as { metadata: { name: string }; spec?: { clusterIP?: string } }[]) ?? []).filter((s) => s.spec?.clusterIP && s.spec.clusterIP !== "None")
      .map((s) => ({ ip: s.spec!.clusterIP!, hostnames: [s.metadata.name, s.metadata.name + "." + ns, s.metadata.name + "." + ns + ".svc", s.metadata.name + "." + ns + ".svc.cluster.local"] }));
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
      else {
        const proc = (app.processes ?? []).find((p) => procName(app, p.name) === d.metadata.name);
        await merge(d.metadata.name, { spec: { replicas: action === "stop" ? 0 : primary ? app.instances : proc ? proc.instances : 1 } });
      }
    }
    if (action !== "restart") for (const cj of await this.owned(ns, "CronJob", app.id)) {
      const cron = (app.crons ?? []).find((x) => cronName(app, x.name) === cj.metadata.name);
      await k8s("PATCH", pathOf("batch/v1", "CronJob", ns, cj.metadata.name), { spec: { suspend: action === "stop" || !cron?.enabled } }, "application/merge-patch+json");
    }
    if (action === "start" && app.autoscale) {
      const hpa = appObjects(app, "", "").find((o) => o.kind === "HorizontalPodAutoscaler");
      if (hpa) await apply(hpa as never);
    }
  }

  async remove(app: AppSpec) {
    const ns = nsOf(app.userId);
    await del("networking.k8s.io/v1", "Ingress", ns, app.name);
    for (const i of await this.owned(ns, "Ingress", app.id)) await del("networking.k8s.io/v1", "Ingress", ns, i.metadata.name);
    await del("v1", "ConfigMap", ns, app.name + "-conf");
    await del("v1", "Secret", ns, app.name + "-basic-auth");
    await del("autoscaling/v2", "HorizontalPodAutoscaler", ns, app.name);
    await del("policy/v1", "PodDisruptionBudget", ns, app.name);
    for (const d of await this.owned(ns, "Deployment", app.id)) await del("apps/v1", "Deployment", ns, d.metadata.name);
    for (const sv of await this.owned(ns, "Service", app.id)) await del("v1", "Service", ns, sv.metadata.name);
    for (const cj of await this.owned(ns, "CronJob", app.id)) await del("batch/v1", "CronJob", ns, cj.metadata.name);
    await del("apps/v1", "Deployment", ns, app.name);
    await del("v1", "Service", ns, app.name);
    await del("v1", "Secret", ns, app.name + "-env");
    await del("v1", "Secret", ns, app.name + "-tls");
    await del("v1", "PersistentVolumeClaim", ns, app.name + "-data");
  }

  private async pods(app: AppSpec) {
    const r = await k8s("GET", "/api/v1/namespaces/" + nsOf(app.userId) + "/pods?labelSelector=" + encodeURIComponent("gereh.net/app=" + app.id + ",gereh.net/service=app"));
    return (r.items as PodInfo[]) ?? [];
  }
  private async unhealthy(app: AppSpec, pods: string[]) {
    if (!pods.length) return [];
    const r = await k8s("GET", "/api/v1/namespaces/" + nsOf(app.userId) + "/events?fieldSelector=" + encodeURIComponent("reason=Unhealthy")).catch(() => ({ items: [] }));
    return ((r.items as { involvedObject: { name: string }; message?: string; lastTimestamp?: string; eventTime?: string }[]) ?? []).filter((e) => pods.includes(e.involvedObject.name));
  }

  async rolloutProblem(app: AppSpec): Promise<RolloutProblem | null> {
    const ns = nsOf(app.userId), pods = await this.pods(app), lines: string[] = [];
    let fatal = false;
    for (const p of pods) for (const cs of p.status?.containerStatuses ?? []) {
      const t = cs.lastState?.terminated, wait = cs.state?.waiting?.reason;
      if (t?.reason === "OOMKilled") { lines.push("pod " + p.metadata.name + ": container " + cs.name + " OOMKilled (exit code 137), memory limit " + app.ramMb + "Mi; restarted " + cs.restartCount + " times"); if (cs.restartCount >= 2) fatal = true; }
      else if (wait === "CrashLoopBackOff") {
        const prev = await k8s("GET", `/api/v1/namespaces/${ns}/pods/${p.metadata.name}/log?container=${cs.name}&previous=true&tailLines=30`).catch(() => ({ text: "" }));
        lines.push("pod " + p.metadata.name + ": crashing (exit code " + (t?.exitCode ?? "?") + ", " + cs.restartCount + " restarts)" + (prev.text ? "\n" + String(prev.text).trimEnd() : ""));
        if (cs.restartCount >= 3) fatal = true;
      } else if (wait && ["CreateContainerConfigError", "InvalidImageName", "ErrImageNeverPull"].includes(wait)) { lines.push("pod " + p.metadata.name + ": " + wait + " " + (cs.state?.waiting?.message ?? "")); fatal = true; }
      else if (wait === "ImagePullBackOff" || wait === "ErrImagePull") lines.push("pod " + p.metadata.name + ": " + wait + " " + (cs.state?.waiting?.message ?? ""));
    }
    for (const e of (await this.unhealthy(app, pods.map((p) => p.metadata.name))).slice(-3)) lines.push("pod " + e.involvedObject.name + ": " + (e.message ?? "").trim());
    return lines.length ? { fatal, log: lines.join("\n") } : null;
  }

  async appEvents(app: AppSpec, since: Date): Promise<AppEvent[]> {
    const pods = await this.pods(app), out: AppEvent[] = [];
    for (const p of pods) for (const cs of p.status?.containerStatuses ?? []) {
      const t = cs.lastState?.terminated;
      const at = t?.finishedAt ? new Date(t.finishedAt) : null;
      if (!t || !at || at <= since) continue;
      out.push({ kind: t.reason === "OOMKilled" ? "oom" : "crash", message: p.metadata.name + ": " + (t.reason || "Error") + " (exit code " + t.exitCode + "), restarted", at });
    }
    const seen = new Set<string>();
    for (const e of await this.unhealthy(app, pods.map((p) => p.metadata.name))) {
      const at = new Date(e.lastTimestamp || e.eventTime || 0);
      if (at <= since || seen.has(e.involvedObject.name)) continue;
      seen.add(e.involvedObject.name);
      out.push({ kind: "health_failed", message: e.involvedObject.name + ": " + (e.message ?? "").trim().slice(0, 300), at });
    }
    return out;
  }

  /** request + response bytes per app over 5 minutes, from ingress-nginx metrics in Prometheus */
  async traffic(targets: { id: string; owner: string; name: string }[]) {
    const out = new Map<string, number>();
    const m = /^([a-z0-9-]+)\/([a-z0-9-]+)(?::(\d+))?$/.exec(cfg().prometheus);
    if (!m || !targets.length) return out;
    const q = 'sum by (namespace, exported_namespace, ingress) (increase({__name__=~"nginx_ingress_controller_(request|response)_size_sum"}[5m]))';
    const r = await k8s("GET", `/api/v1/namespaces/${m[1]}/services/${m[2]}:${m[3] ?? "80"}/proxy/api/v1/query?query=${encodeURIComponent(q)}`).catch(() => null) as
      { data?: { result?: { metric: Record<string, string>; value: [number, string] }[] } } | null;
    const by = new Map<string, number>();
    for (const row of r?.data?.result ?? []) {
      const ns = row.metric.exported_namespace || row.metric.namespace;
      if (ns && row.metric.ingress) by.set(ns + "/" + row.metric.ingress, (by.get(ns + "/" + row.metric.ingress) ?? 0) + (Number(row.value[1]) || 0));
    }
    for (const t of targets) {
      const ns = nsOf(t.owner), n = [t.name, t.name + "-wild", t.name + "-auth"].reduce((s, i) => s + (by.get(ns + "/" + i) ?? 0), 0);
      if (n > 0) out.set(t.id, Math.round(n));
    }
    return out;
  }

  async runJob(app: AppSpec, image: string, jobId: string, command: string) {
    await this.ensureNs(app.userId);
    // the env Secret first: a release command of the very first deployment runs before release()
    const secret = appObjects(app, image, "job").find((o) => o.kind === "Secret");
    if (secret) await apply(secret as never);
    await apply(runJobObject(app, image, jobId, command) as never);
  }

  async jobStatus(app: AppSpec, jobId: string) {
    const ns = nsOf(app.userId), name = "job-" + jobId.toLowerCase();
    let job: { status?: { succeeded?: number; failed?: number; conditions?: { type: string; status: string; message?: string }[] } };
    try { job = await get("batch/v1", "Job", ns, name) as typeof job; } catch (e) { if (notFound(e)) return { state: "failed" as const, output: "job not found (removed after 24 hours)" }; throw e; }
    const output = await this.jobLogs(ns, name, ["app"], 2000);
    if (job.status?.succeeded) return { state: "succeeded" as const, output };
    const failed = job.status?.failed || job.status?.conditions?.some((x) => x.type === "Failed" && x.status === "True");
    if (failed) return { state: "failed" as const, output: output + "\nERROR: " + (job.status?.conditions?.find((x) => x.type === "Failed")?.message || "command failed") };
    return { state: "running" as const, output };
  }

  async startScan(app: AppSpec, image: string, deploymentId: string) {
    await apply(scanJob(app, image, deploymentId) as never);
  }
  async scanStatus(_app: AppSpec, deploymentId: string) {
    const ns = cfg().system, name = "scan-" + deploymentId.toLowerCase();
    const job = await get("batch/v1", "Job", ns, name) as { status?: { succeeded?: number; failed?: number } };
    const log = await this.jobLogs(ns, name, ["scan"], 5000);
    if (job.status?.succeeded) return { state: "done" as const, ...parseScan(log) };
    if (job.status?.failed) return { state: "failed" as const, critical: 0, high: 0, report: log.slice(-2000) };
    return { state: "running" as const, critical: 0, high: 0, report: "" };
  }
  async verifyBackup(d: DbSpec, location: string) {
    const key = location.replace(/^s3:\/\//, "");
    try {
      const log = await this.dbJob(d, "verify", dbImage(d), verifyScript(d), [], 3600, { mode: "down", key });
      const t = /TABLES=(\d+)/.exec(log)?.[1];
      return t ? { ok: true, detail: "TABLES=" + t } : { ok: false, detail: log.slice(-300) };
    } catch (e) { return { ok: false, detail: (e as Error).message.slice(-300) }; }
  }

  async importSite(app: AppSpec, d: DbSpec, sourceUrl: string, jobId: string, newUrl: string) {
    await this.ensureNs(app.userId);
    await apply(importJobObject(app, d, sourceUrl, jobId, newUrl) as never);
  }

  async syncCrons(app: AppSpec, image: string) {
    const ns = await this.ensureNs(app.userId);
    if (composeOf(image)) return;
    const want = (app.crons ?? []).map((cr) => cronJobObject(app, cr, image));
    for (const o of want) await apply(o as never);
    const keep = new Set(want.map((o) => (o.metadata as { name: string }).name));
    for (const cj of await this.owned(ns, "CronJob", app.id)) if (!keep.has(cj.metadata.name)) await del("batch/v1", "CronJob", ns, cj.metadata.name);
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
    return { host: dbHost(d), port: enginePort(d.engine), publicPort };
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
    const h = dbHost(d), p = enginePort(d.engine);
    const sql = (s: string) => s.replace(/'/g, "''");
    const cmd = ({
      postgres: `echo 'ALTER USER "${d.username.replace(/"/g, "")}" PASSWORD :'"'"'newpw'"'"';' | PGPASSWORD="$OLD" psql -h ${h} -p ${p} -U ${shq(d.username)} -d ${shq(d.dbName)} -v ON_ERROR_STOP=1 -v newpw="$NEW"`,
      mysql: `mysql -h ${h} -P ${p} -uroot -p"$OLD" -e "ALTER USER '${sql(d.username)}'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$NEW';"`,
      mariadb: `mariadb -h ${h} -P ${p} -uroot -p"$OLD" -e "ALTER USER '${sql(d.username)}'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$NEW';"`,
      mongodb: `mongosh "mongodb://${encodeURIComponent(d.username)}:$OLD_URL@${h}:${p}/admin" --quiet --eval 'db.changeUserPassword(${JSON.stringify(d.username)}, process.env.NEW)'`,
      redis: `redis-cli -h ${h} -p ${p} -a "$OLD" --no-auth-warning CONFIG SET requirepass "$NEW"`,
    } as Record<string, string>)[d.engine];
    await this.dbJob(d, "passwd", dbImage(d), cmd, [{ name: "OLD", value: old }, { name: "OLD_URL", value: encodeURIComponent(old) }, { name: "NEW", value: d.password }], 300);
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
  async waitJob(ns: string, name: string, timeoutSec: number, containers: string[]) {
    for (const t0 = Date.now(); Date.now() - t0 < timeoutSec * 1000 + 30_000; await sleep(3000)) {
      const j = await get("batch/v1", "Job", ns, name) as { status?: { succeeded?: number; failed?: number } };
      if (j.status?.succeeded) return this.jobLogs(ns, name, containers);
      if (j.status?.failed) throw new Error(name + " failed: " + (await this.jobLogs(ns, name, containers, 20)).slice(-500));
    }
    throw new Error(name + " timed out");
  }

  async dbJob(d: DbSpec, kind: string, image: string, script: string, envs: { name: string; value: string }[], timeoutSec: number, upload?: { mode: "up" | "down" | "share"; key: string }) {
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
    const log = await this.dbJob(d, "backup", dbImage(d), dumpCommand(d), [{ name: "DB_PASSWORD", value: d.password }], 3600, { mode: "up", key });
    const bytes = Number(/SIZE=(\d+)/.exec(log)?.[1] ?? 0);
    return { sizeMb: Math.round((bytes / 1024 / 1024) * 10) / 10, location: "s3://" + key };
  }
  async restoreDb(d: DbSpec, location: string) {
    const key = location.replace(/^s3:\/\//, "");
    if (d.engine === "redis") return this.restoreRedis(d, key);
    await this.dbJob(d, "restore", dbImage(d), restoreCommand(d), [{ name: "DB_PASSWORD", value: d.password }], 3600, { mode: "down", key });
  }

  private async restoreRedis(d: DbSpec, key: string) {
    const ns = nsOf(d.userId), sts = dbName(d);
    const url = /^URL=(\S+)/m.exec(await this.dbJob(d, "share", cfg().mcImage, "", [], 300, { mode: "share", key }))?.[1];
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
          containers: [{ name: "main", image: dbImage(d), command: ["/bin/sh", "-c", redisRestoreScript], env: [{ name: "URL", value: url }],
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

type PodInfo = { metadata: { name: string }; status?: { containerStatuses?: {
  name: string; restartCount: number; state?: { waiting?: { reason?: string; message?: string } };
  lastState?: { terminated?: { reason?: string; exitCode?: number; finishedAt?: string } };
}[] } };

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
