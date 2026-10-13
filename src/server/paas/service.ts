/* Gereh Apps: shared server logic for RPC handlers, HTTP routes and the worker. */
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { appMonthly, defaultEnvKeyFor, hourlyOf, type PaasPlan } from "@/lib/paas";
import { PHP_STACKS } from "@/lib/paas-runtime";
import { PLAN_LOG_DAYS } from "@/lib/paas-tools";
import type { DB, Tx } from "../db/client";
import { paasApps, paasCrons, paasDbConfig, paasDbs, paasDeployments, paasDomains, paasEnv, paasLinks, paasPlans, paasProcesses } from "../db/schema";
import { enqueue } from "../jobs";
import { open, seal } from "../secrets";
import { getSettings } from "../state";
import { rid } from "../util";
import type { AppSpec, DbSpec } from "./driver";
import { toolsSpec } from "./disks";
import { PLAN_LIMITS, runtimeSpec } from "./runtime";

export type AppRow = typeof paasApps.$inferSelect;
export type DbRow = typeof paasDbs.$inferSelect;

/* Sized like the market's common PaaS tiers and priced about 10% under the leading Iranian competitor
   (Paasta, Mehr 1405): app 0.25 core/256 MB 390k → 349k, 0.5/512 590k → 529k, 1/1 GB 1.09M → 979k,
   2/4 GB 2.69M → 2.42M, 4/8 GB 4.99M → 4.49M; databases 349k/690k/1.39M → 315k/619k/1.249M. */
export const DEFAULT_PLANS: PaasPlan[] = [
  { id: "app-nano", kind: "app", name: "نانو", cpu: 0.25, ramMb: 256, diskGb: 0, price: 349_000, active: true },
  { id: "app-micro", kind: "app", name: "میکرو", cpu: 0.5, ramMb: 512, diskGb: 0, price: 529_000, active: true },
  { id: "app-small", kind: "app", name: "کوچک", cpu: 1, ramMb: 1024, diskGb: 0, price: 979_000, active: true },
  { id: "app-medium", kind: "app", name: "متوسط", cpu: 2, ramMb: 4096, diskGb: 0, price: 2_420_000, active: true },
  { id: "app-large", kind: "app", name: "بزرگ", cpu: 4, ramMb: 8192, diskGb: 0, price: 4_490_000, active: true },
  { id: "app-xlarge", kind: "app", name: "خیلی بزرگ", cpu: 8, ramMb: 16384, diskGb: 0, price: 8_790_000, active: true },
  { id: "db-micro", kind: "db", name: "میکرو", cpu: 0.25, ramMb: 512, diskGb: 5, price: 315_000, active: true },
  { id: "db-small", kind: "db", name: "کوچک", cpu: 0.5, ramMb: 1024, diskGb: 10, price: 619_000, active: true },
  { id: "db-medium", kind: "db", name: "متوسط", cpu: 1, ramMb: 2048, diskGb: 25, price: 1_249_000, active: true },
  { id: "db-large", kind: "db", name: "بزرگ", cpu: 2, ramMb: 4096, diskGb: 50, price: 2_490_000, active: true },
  { id: "db-xlarge", kind: "db", name: "خیلی بزرگ", cpu: 4, ramMb: 8192, diskGb: 100, price: 4_790_000, active: true },
];

export const seedPlans = (db: DB) => db.insert(paasPlans).values(DEFAULT_PLANS.map((p, i) => ({ ...p, position: i, ...PLAN_LIMITS[p.id], logDays: PLAN_LOG_DAYS[p.id] ?? 7 }))).onConflictDoNothing();
export const loadPlans = (db: DB | Tx) => db.select().from(paasPlans).orderBy(asc(paasPlans.position));

/** apps live under a separate domain (never a subdomain of the main site: cookie isolation) */
export async function appsDomain(db: DB | Tx) {
  return (await getSettings(db as DB)).paasDomain || process.env.PAAS_APPS_DOMAIN || "gereh.dev";
}
export const defaultHost = (name: string, domain: string) => name + "." + domain;

export const appHourly = (a: Pick<AppRow, "instances" | "diskGb" | "status" | "workerInstances" | "previewDeployment">, plan: Pick<PaasPlan, "price">) =>
  a.status === "stopped" ? (a.diskGb ? hourlyOf(appMonthly({ price: 0 }, 1, a.diskGb)) : 0) : hourlyOf(appMonthly(plan, a.instances + a.workerInstances + (a.previewDeployment ? 1 : 0), a.diskGb));

/** the preview workload: one instance beside production on <name>-preview.<domain>, separate
    Kubernetes objects (own id), no disk, workers, cron or release command */
export const previewHost = (name: string, domain: string) => name + "-preview." + domain;
export function previewSpec(spec: AppSpec, branch = ""): AppSpec {
  const domain = spec.hosts[0].slice(spec.name.length + 1);
  return {
    ...spec, id: spec.id + "-pv", name: spec.name + "-preview", hosts: [previewHost(spec.name, domain)], gitBranch: branch || spec.gitBranch,
    instances: 1, autoscale: false, maxInstances: 1, diskGb: 0, disks: [], sftp: undefined, processes: [], crons: [], releaseCommand: "", cdn: false,
    env: { ...spec.env, GEREH_PREVIEW: "1" },
    runtime: spec.runtime && { ...spec.runtime, defaultDomain: true, redirects: [] },
  };
}
export const dbHourly = (d: Pick<DbRow, "status">, plan: Pick<PaasPlan, "price" | "diskGb">) =>
  d.status === "stopped" ? hourlyOf(plan.diskGb * 3_000) : hourlyOf(plan.price);

/* ---------- env & database wiring ---------- */
export function connectionUrl(d: Pick<DbRow, "engine" | "host" | "port" | "username" | "dbName">, password: string) {
  const u = encodeURIComponent(d.username), p = encodeURIComponent(password);
  switch (d.engine) {
    case "postgres": return `postgresql://${u}:${p}@${d.host}:${d.port}/${d.dbName}`;
    case "mysql": case "mariadb": return `mysql://${u}:${p}@${d.host}:${d.port}/${d.dbName}`;
    case "mongodb": return `mongodb://${u}:${p}@${d.host}:${d.port}/${d.dbName}?authSource=admin`;
    case "redis": return `redis://default:${p}@${d.host}:${d.port}/0`;
    // Prisma / JDBC style, accepted by the common Node, Python and .NET drivers
    case "mssql": return `sqlserver://${d.host}:${d.port};database=${d.dbName};user=${d.username};password=${password};encrypt=true;trustServerCertificate=true`;
    case "elasticsearch": return `http://${u}:${p}@${d.host}:${d.port}`;
    case "rabbitmq": return `amqp://${u}:${p}@${d.host}:${d.port}/${encodeURIComponent(d.dbName)}`;
    case "clickhouse": return `http://${u}:${p}@${d.host}:${d.port}/?database=${d.dbName}`;
    case "cassandra": return `cassandra://${u}:${p}@${d.host}:${d.port}/${d.dbName}`;
    case "couchdb": return `http://${u}:${p}@${d.host}:${d.port}/${d.dbName}`;
    // the password is also the API token
    case "influxdb": return `http://${u}:${p}@${d.host}:${d.port}/?org=gereh&bucket=${d.dbName}`;
    case "neo4j": return `bolt://${u}:${p}@${d.host}:${d.port}`;
    case "arangodb": return `http://${u}:${p}@${d.host}:${d.port}/_db/${d.dbName}`;
    case "rethinkdb": return `rethinkdb://${u}:${p}@${d.host}:${d.port}/${d.dbName}`;
    case "prometheus": return `http://${d.host}:${d.port}`;
    default: return "";
  }
}
export const defaultEnvKey = defaultEnvKeyFor;

/** everything the driver needs to run an app: plan size, decrypted env, linked database URLs, hosts */
export async function appSpec(db: DB | Tx, app: AppRow): Promise<AppSpec> {
  const [[plan], env, links, domains, base, processes, crons, runtime, tools] = await Promise.all([
    db.select().from(paasPlans).where(eq(paasPlans.id, app.planId)),
    db.select().from(paasEnv).where(eq(paasEnv.appId, app.id)),
    db.select({ l: paasLinks, d: paasDbs }).from(paasLinks).innerJoin(paasDbs, eq(paasDbs.id, paasLinks.dbId)).where(eq(paasLinks.appId, app.id)),
    db.select().from(paasDomains).where(and(eq(paasDomains.appId, app.id), eq(paasDomains.status, "active"))),
    appsDomain(db),
    db.select().from(paasProcesses).where(eq(paasProcesses.appId, app.id)).orderBy(asc(paasProcesses.name)),
    db.select().from(paasCrons).where(eq(paasCrons.appId, app.id)).orderBy(asc(paasCrons.name)),
    runtimeSpec(db, app),
    toolsSpec(db, app),
  ]);
  const vars: Record<string, string> = {};
  for (const e of env) vars[e.key] = open(e.valueEnc) ?? "";
  for (const { l, d } of links) {
    if (!d.host) continue;
    // "@parts:PREFIX_" links set PREFIX_HOST/USER/PASSWORD/NAME (images that do not take a URL, e.g. WordPress)
    if (l.envKey.startsWith("@parts:")) {
      const p = l.envKey.slice(7);
      Object.assign(vars, { [p + "HOST"]: d.host + ":" + d.port, [p + "USER"]: d.username, [p + "PASSWORD"]: open(d.passwordEnc) ?? "", [p + "NAME"]: d.dbName });
    } else vars[l.envKey] = connectionUrl(d, open(d.passwordEnc) ?? "");
  }
  vars.PORT = String(app.port);
  vars.GEREH_APP = app.name;
  if (!("TZ" in vars)) vars.TZ = runtime.timezone;
  if (runtime.phpIni && PHP_STACKS.has(app.stack) && app.source !== "compose") vars.PHP_INI_SCAN_DIR = ":/etc/gereh/php";
  return {
    id: app.id, userId: app.userId, name: app.name, stack: app.stack, source: app.source, gitUrl: app.gitUrl, gitBranch: app.gitBranch, image: app.image,
    rootDir: app.rootDir, buildCommand: app.buildCommand, startCommand: app.startCommand, port: app.port, healthPath: app.healthPath,
    cpu: plan?.cpu ?? 0.25, ramMb: plan?.ramMb ?? 256, instances: app.instances, autoscale: app.autoscale, maxInstances: app.maxInstances, autoscaleCpu: app.autoscaleCpu,
    diskGb: app.diskGb, diskMount: app.diskMount, env: vars, hosts: [defaultHost(app.name, base), ...domains.map((x) => x.host)],
    cdn: app.cdn, cacheVersion: app.cacheVersion, releaseCommand: app.releaseCommand,
    processes: processes.map((x) => ({ name: x.name, command: x.command, instances: x.instances })),
    crons: crons.map((x) => ({ name: x.name, schedule: x.schedule, command: x.command, enabled: x.enabled })),
    runtime,
    ...tools,
  };
}

export async function dbSpec(db: DB | Tx, d: DbRow): Promise<DbSpec> {
  const [[plan], [conf]] = await Promise.all([db.select().from(paasPlans).where(eq(paasPlans.id, d.planId)), db.select().from(paasDbConfig).where(eq(paasDbConfig.dbId, d.id))]);
  return { id: d.id, userId: d.userId, name: d.name, engine: d.engine, version: d.version, cpu: plan?.cpu ?? 0.5, ramMb: plan?.ramMb ?? 512, diskGb: plan?.diskGb ?? 5, username: d.username, password: open(d.passwordEnc) ?? "", dbName: d.dbName, publicAccess: d.publicAccess,
    pitr: d.pitr, restore: d.restoreFrom && d.restoreTime ? { fromId: d.restoreFrom, fromUserId: d.userId, time: d.restoreTime.toISOString() } : undefined,
    ...(conf ? { params: conf.params, extensions: conf.extensions, allowlist: conf.allowlist, replicaSet: conf.replicaSet, extImage: conf.extImage } : {}) };
}

export const setEnvValue = (tx: DB | Tx, appId: string, key: string, value: string, secret: boolean, managedBy: string | null = null) =>
  tx.insert(paasEnv).values({ appId, key, valueEnc: seal(value), secret, managedBy }).onConflictDoUpdate({ target: [paasEnv.appId, paasEnv.key], set: { valueEnc: seal(value), secret, managedBy } });

/* ---------- deployments ---------- */
export async function queueDeployment(tx: DB | Tx, app: Pick<AppRow, "id">, o: { trigger: (typeof paasDeployments.$inferInsert)["trigger"]; ref?: string; message?: string; image?: string; uploadPath?: string; target?: "production" | "preview"; branch?: string; noCache?: boolean }) {
  const id = rid("dep");
  await tx.insert(paasDeployments).values({ id, appId: app.id, trigger: o.trigger, ref: o.ref ?? "", message: o.message ?? "", image: o.image ?? "", uploadPath: o.uploadPath ?? null, target: o.target ?? "production", branch: o.branch ?? "", noCache: !!o.noCache });
  // config/rollback deployments reuse a built image and skip the build
  await enqueue(tx, "paas.build", { deploymentId: id });
  return id;
}

/** a config change re-releases the live image (no rebuild) */
export async function redeployConfig(tx: DB | Tx, app: AppRow, message: string) {
  if (!app.liveDeployment || app.status === "stopped" || app.status === "suspended") return null;
  const [live] = await tx.select().from(paasDeployments).where(eq(paasDeployments.id, app.liveDeployment));
  if (!live?.image) return null;
  return queueDeployment(tx, app, { trigger: "config", image: live.image, ref: live.ref, message });
}

/* ---------- uploads (ZIP sources) ---------- */
export const uploadRoot = () => process.env.PAAS_UPLOAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "paas-uploads");
/** uploads are stored per user; the id is the file name, so one user can never reference another's */
export async function uploadPathFor(uid: string, uploadId: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(uploadId)) return null;
  const dir = path.join(uploadRoot(), uid);
  await mkdir(dir, { recursive: true });
  return path.join(dir, uploadId + ".zip");
}
export const newUploadId = () => randomBytes(18).toString("base64url");
/** site backups for WordPress imports (.tar.gz or .zip), stored beside project uploads */
export async function backupPathFor(uid: string, uploadId: string) {
  const p = await uploadPathFor(uid, uploadId);
  return p ? p.replace(/\.zip$/, ".backup") : null;
}

/** signed, expiring URL the builder uses to download an uploaded source */
export function signSource(depId: string, ttlSec = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac("sha256", process.env.APP_SECRET || "dev").update(depId + "." + exp).digest("base64url");
  return { exp, sig };
}
export function checkSource(depId: string, exp: number, sig: string) {
  if (!exp || exp < Date.now() / 1000) return false;
  const want = Buffer.from(createHmac("sha256", process.env.APP_SECRET || "dev").update(depId + "." + exp).digest("base64url"));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const userApps = (db: DB | Tx, uid: string) => db.select().from(paasApps).where(eq(paasApps.userId, uid));
export const appsByIds = (db: DB | Tx, ids: string[]) => (ids.length ? db.select().from(paasApps).where(inArray(paasApps.id, ids)) : Promise.resolve([] as AppRow[]));
