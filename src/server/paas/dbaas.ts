/* Managed database extras on top of the PaaS driver: extra users and databases, first-run setup,
   PostgreSQL extensions, temporary admin panels, backup links, dump imports, the data inspector and
   live stats. Two implementations, picked like paas(): Kubernetes (k8s exec into the database pod,
   Jobs and Ingresses) when PAAS_K8S_API + PAAS_K8S_TOKEN are set, else an in-memory simulator. */
import "server-only";
import { createReadStream } from "node:fs";
import { INSPECT_PAGE, QUERY_LIMIT, type DbGrant, type ImportFormat } from "@/lib/dbaas";
import type { DbSpec } from "./driver";
import {
  createDatabaseCmds, createUserCmds, dropDatabaseCmds, dropUserCmds, engineK8s, enginePort, extensionCmds, htpasswd, initCmds, inspectCmds, lastJson, PANEL_TOOLS, parseTsv,
  setGrantsCmds, sqlcmd, userPasswordCmds, type Exec,
} from "./engines";

export type Grid = { columns: string[]; rows: (string | null)[][]; hasMore: boolean };
export type InspectReq =
  | { op: "databases" } | { op: "tables"; db: string }
  | { op: "rows"; db: string; table: string; page: number }
  | { op: "query"; db: string; sql: string }
  | { op: "find"; db: string; collection: string; filter: string; page: number };
export type InspectRes = { databases?: string[]; tables?: { name: string; rows: number }[]; grid?: Grid; docs?: string[]; hasMore?: boolean };
export type DbStats = { connections: number | null; sizeMb: number | null; uptime: number | null };
export type Panel = { id: string; tool: string; host: string; username: string; password: string; email: string };

export interface DbaasDriver {
  readonly name: "kubernetes" | "simulator";
  /** engine-specific first-run setup once the server answers; idempotent */
  init(d: DbSpec): Promise<void>;
  createUser(d: DbSpec, user: string, password: string, grants: DbGrant[], all: string[]): Promise<void>;
  setGrants(d: DbSpec, user: string, grants: DbGrant[], all: string[]): Promise<void>;
  setUserPassword(d: DbSpec, user: string, password: string): Promise<void>;
  dropUser(d: DbSpec, user: string, all: string[]): Promise<void>;
  createDatabase(d: DbSpec, name: string): Promise<void>;
  dropDatabase(d: DbSpec, name: string): Promise<void>;
  /** CREATE / DROP EXTENSION (the server already runs with the needed preload libraries) */
  applyExtensions(d: DbSpec, enable: string[], disable: string[]): Promise<void>;
  openPanel(d: DbSpec, p: Panel): Promise<void>;
  closePanel(d: DbSpec, p: Pick<Panel, "id" | "tool">): Promise<void>;
  /** short-lived download URL of a backup */
  backupLink(d: DbSpec, location: string): Promise<string>;
  /** loads an uploaded dump (served at `url`, stored at `path`); waits for it */
  importDump(d: DbSpec, imp: { id: string; format: ImportFormat; url: string; path: string; sizeBytes: number }): Promise<string>;
  inspect(d: DbSpec, req: InspectReq): Promise<InspectRes>;
  stats(d: DbSpec): Promise<DbStats>;
}

/* ---------- simulator: state per database in memory ---------- */
type Sim = { dbs: Set<string>; users: Map<string, DbGrant[]>; ext: Set<string>; panels: Set<string>; init: number };
const sims = new Map<string, Sim>();
export const simState = (d: Pick<DbSpec, "id" | "dbName">) => {
  let s = sims.get(d.id);
  if (!s) sims.set(d.id, (s = { dbs: new Set([d.dbName]), users: new Map(), ext: new Set(), panels: new Set(), init: 0 }));
  return s;
};
const SIM_TABLES = [{ name: "users", rows: 1284 }, { name: "orders", rows: 9631 }, { name: "products", rows: 212 }];
const simRow = (t: string, i: number): (string | null)[] => t === "orders" ? [String(i + 1), String(1 + (i * 7) % 300), String(150_000 + (i * 7919) % 900_000), i % 5 ? "paid" : "pending"]
  : t === "products" ? [String(i + 1), "محصول " + (i + 1), String(90_000 + (i * 331) % 400_000)] : [String(i + 1), "user" + (i + 1) + "@example.ir", i % 7 ? null : "admin"];
const SIM_COLS: Record<string, string[]> = { orders: ["id", "user_id", "amount", "status"], products: ["id", "title", "price"], users: ["id", "email", "role"] };

export class SimDbaas implements DbaasDriver {
  readonly name = "simulator" as const;
  async init(d: DbSpec) { simState(d).init++; }
  async createUser(d: DbSpec, user: string, _pw: string, grants: DbGrant[]) {
    const s = simState(d);
    if (s.users.has(user)) throw new Error(`role "${user}" already exists`);
    s.users.set(user, grants);
  }
  async setGrants(d: DbSpec, user: string, grants: DbGrant[]) { simState(d).users.set(user, grants); }
  async setUserPassword() {}
  async dropUser(d: DbSpec, user: string) { simState(d).users.delete(user); }
  async createDatabase(d: DbSpec, name: string) {
    const s = simState(d);
    if (s.dbs.has(name)) throw new Error(`database "${name}" already exists`);
    s.dbs.add(name);
  }
  async dropDatabase(d: DbSpec, name: string) { simState(d).dbs.delete(name); }
  async applyExtensions(d: DbSpec, enable: string[], disable: string[]) {
    const s = simState(d);
    for (const e of disable) s.ext.delete(e);
    for (const e of enable) s.ext.add(e);
  }
  async openPanel(d: DbSpec, p: Panel) { simState(d).panels.add(p.id); }
  async closePanel(d: DbSpec, p: Pick<Panel, "id">) { simState(d).panels.delete(p.id); }
  async backupLink(_d: DbSpec, location: string) { return "https://s3.gereh.dev/" + location.replace(/^s3:\/\//, "") + "?X-Amz-Expires=1800&simulator=1"; }
  async importDump(_d: DbSpec, imp: { format: ImportFormat; sizeBytes: number; url: string }) {
    if (/fail/.test(imp.url)) throw new Error("ERROR: syntax error at or near \"CREAT\" (line 12)");
    return ["==> Downloading dump (" + Math.round(imp.sizeBytes / 1024) + " KB, " + imp.format + ")", "==> Importing", "==> Done"].join("\n");
  }
  async inspect(d: DbSpec, req: InspectReq): Promise<InspectRes> {
    const s = simState(d);
    switch (req.op) {
      case "databases": return { databases: [...s.dbs].sort() };
      case "tables": return { tables: d.engine === "mongodb" ? SIM_TABLES.map((t) => ({ name: t.name, rows: t.rows })) : SIM_TABLES };
      case "rows": {
        const t = SIM_TABLES.find((x) => x.name === req.table);
        if (!t) throw new Error(`relation "${req.table}" does not exist`);
        const from = req.page * INSPECT_PAGE, n = Math.max(0, Math.min(INSPECT_PAGE, t.rows - from));
        return { grid: { columns: SIM_COLS[t.name], rows: Array.from({ length: n }, (_, i) => simRow(t.name, from + i)), hasMore: from + n < t.rows } };
      }
      case "query": {
        if (/\bnope\b|syntax/i.test(req.sql)) throw new Error("ERROR: syntax error at or near \"nope\"");
        if (/pg_sleep|sleep\(/i.test(req.sql)) throw new Error("ERROR: canceling statement due to statement timeout");
        const t = SIM_TABLES.find((x) => new RegExp("\\b" + x.name + "\\b", "i").test(req.sql));
        if (!t) return { grid: { columns: ["?column?"], rows: [["1"]], hasMore: false } };
        const n = Math.min(t.rows, QUERY_LIMIT);
        return { grid: { columns: SIM_COLS[t.name], rows: Array.from({ length: Math.min(n, 20) }, (_, i) => simRow(t.name, i)), hasMore: t.rows > QUERY_LIMIT } };
      }
      case "find": {
        const t = SIM_TABLES.find((x) => x.name === req.collection);
        if (!t) return { docs: [], hasMore: false };
        const filter = JSON.parse(req.filter || "{}") as Record<string, unknown>;
        const from = req.page * INSPECT_PAGE;
        const all = Array.from({ length: Math.min(t.rows, 200) }, (_, i) => Object.fromEntries(SIM_COLS[t.name].map((c, k) => [c === "id" ? "_id" : c, simRow(t.name, i)[k]])))
          .filter((doc) => Object.entries(filter).every(([k, v]) => typeof v === "object" || String(doc[k]) === String(v)));
        return { docs: all.slice(from, from + INSPECT_PAGE).map((x) => JSON.stringify(x)), hasMore: all.length > from + INSPECT_PAGE };
      }
    }
  }
  async stats(d: DbSpec): Promise<DbStats> {
    const seed = [...d.id].reduce((h, c) => h + c.charCodeAt(0), 0);
    return { connections: 3 + (seed % 12), sizeMb: Math.round((40 + (seed % 900)) * 10) / 10, uptime: 3600 * (1 + (seed % 200)) };
  }
}

/* ---------- Kubernetes ---------- */
const clean = (s: string) => s.split("\n").filter((l) => l.trim() && !/Using a password on the command line/.test(l)).slice(-6).join("\n").slice(0, 600);

export class KubeDbaas implements DbaasDriver {
  readonly name = "kubernetes" as const;
  private async k() { return import("./kubernetes"); }
  /** runs commands in order in the database container; returns the last one's stdout */
  private async run(d: DbSpec, cmds: Exec[], timeoutMs = 60_000) {
    const [{ nsOf, dbName }, { podExec }] = await Promise.all([this.k(), import("./exec")]);
    let last = "";
    for (const cmd of cmds) {
      const r = await podExec(nsOf(d.userId), dbName(d) + "-0", "db", cmd, { timeoutMs });
      if (r.code !== 0) throw new Error(clean(r.stderr || r.stdout) || "command failed with exit code " + r.code);
      last = r.stdout;
    }
    return last;
  }
  async init(d: DbSpec) { const { dbHost } = await this.k(); await this.run(d, initCmds(d, dbHost(d)), 180_000); }
  async createUser(d: DbSpec, user: string, password: string, grants: DbGrant[], all: string[]) { await this.run(d, createUserCmds(d, user, password, grants, all)); }
  async setGrants(d: DbSpec, user: string, grants: DbGrant[], all: string[]) { await this.run(d, setGrantsCmds(d, user, grants, all)); }
  async setUserPassword(d: DbSpec, user: string, password: string) { await this.run(d, userPasswordCmds(d, user, password)); }
  async dropUser(d: DbSpec, user: string, all: string[]) { await this.run(d, dropUserCmds(d, user, all)); }
  async createDatabase(d: DbSpec, name: string) { await this.run(d, createDatabaseCmds(d, name)); }
  async dropDatabase(d: DbSpec, name: string) { await this.run(d, dropDatabaseCmds(d, name), 120_000); }
  async applyExtensions(d: DbSpec, enable: string[], disable: string[]) { await this.run(d, extensionCmds(d, enable, disable), 120_000); }

  async openPanel(d: DbSpec, p: Panel) {
    const { apply, nsOf, dbName, dbHost, cfg } = await this.k();
    const ns = nsOf(d.userId), name = p.id.toLowerCase(), c = cfg();
    const labels = { "app.kubernetes.io/name": name, "app.kubernetes.io/managed-by": "gereh", "gereh.net/db": d.id, "gereh.net/panel": p.id };
    // RabbitMQ ships its own management UI on the database pod
    const tool = PANEL_TOOLS[p.tool];
    const backend = tool ? { name, port: 80 } : { name: dbName(d), port: 15672 };
    const objs: Record<string, unknown>[] = [
      { apiVersion: "v1", kind: "Secret", metadata: { name: name + "-basic", namespace: ns, labels }, type: "Opaque", stringData: { auth: htpasswd(p.username, p.password) } },
      ...(tool ? [
        { apiVersion: "apps/v1", kind: "Deployment", metadata: { name, namespace: ns, labels }, spec: {
          replicas: 1, selector: { matchLabels: { "app.kubernetes.io/name": name } },
          template: { metadata: { labels }, spec: {
            automountServiceAccountToken: false, enableServiceLinks: false,
            containers: [{ name: "panel", image: tool.image, ports: [{ name: "http", containerPort: tool.port }], env: tool.env(d, p.host, dbHost(d), p.email, p.password),
              resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } },
              readinessProbe: { tcpSocket: { port: tool.port }, periodSeconds: 5 } }],
          } },
        } },
        { apiVersion: "v1", kind: "Service", metadata: { name, namespace: ns, labels }, spec: { selector: { "app.kubernetes.io/name": name }, ports: [{ name: "http", port: 80, targetPort: tool.port }] } },
      ] : []),
      { apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: { name, namespace: ns, labels, annotations: {
        "nginx.ingress.kubernetes.io/auth-type": "basic", "nginx.ingress.kubernetes.io/auth-secret": name + "-basic", "nginx.ingress.kubernetes.io/auth-realm": "Gereh database panel",
        "nginx.ingress.kubernetes.io/proxy-body-size": "256m",
      } }, spec: {
        ingressClassName: c.ingressClass, tls: [{ hosts: [p.host] }],
        rules: [{ host: p.host, http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: backend.name, port: { number: backend.port } } } }] } }],
      } },
    ];
    for (const o of objs) await apply(o as never);
  }
  async closePanel(d: DbSpec, p: Pick<Panel, "id" | "tool">) {
    const { del, nsOf } = await this.k();
    const ns = nsOf(d.userId), name = p.id.toLowerCase();
    await del("networking.k8s.io/v1", "Ingress", ns, name);
    await del("apps/v1", "Deployment", ns, name);
    await del("v1", "Service", ns, name);
    await del("v1", "Secret", ns, name + "-basic");
  }

  async backupLink(d: DbSpec, location: string) {
    const { KubernetesDriver, cfg } = await this.k();
    const log = await new KubernetesDriver().dbJob(d, "share", cfg().mcImage, "", [], 300, { mode: "share", key: location.replace(/^s3:\/\//, "") });
    const url = /^URL=(\S+)/m.exec(log)?.[1];
    if (!url) throw new Error("could not create a download link");
    return url;
  }

  async importDump(d: DbSpec, imp: { id: string; format: ImportFormat; url: string; path: string; sizeBytes: number }) {
    if (imp.format === "bak") return this.importBak(d, imp);
    const { apply, cfg, dbHost, KubernetesDriver } = await this.k();
    const c = cfg(), h = dbHost(d), p = enginePort(d.engine), name = ("import-" + imp.id).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
    const gz = imp.format.endsWith(".gz");
    const cat = gz ? "gunzip -c /backup/dump" : "cat /backup/dump";
    // dumps of another server often name their own database: load into this one instead
    const strip = "sed -E '/^(CREATE DATABASE|USE |\\\\connect )/d'";
    const script = {
      postgres: imp.format === "pgdump"
        ? `PGPASSWORD="$DB_PASSWORD" pg_restore -h ${h} -p ${p} -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl --exit-on-error /backup/dump`
        : `${cat} | ${strip} | PGPASSWORD="$DB_PASSWORD" psql -X -h ${h} -p ${p} -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q`,
      mysql: `${cat} | ${strip} | MYSQL_PWD="$DB_PASSWORD" mysql -h ${h} -P ${p} -uroot "$DB_NAME"`,
      mariadb: `${cat} | ${strip} | MYSQL_PWD="$DB_PASSWORD" mariadb -h ${h} -P ${p} -uroot "$DB_NAME"`,
      mongodb: `mongorestore --uri="mongodb://$DB_USER:$DB_PASSWORD_URL@${h}:${p}/?authSource=admin" --archive=/backup/dump ${gz ? "--gzip " : ""}--nsInclude='*'`,
    }[d.engine];
    if (!script) throw new Error("import is not supported for " + d.engine);
    const env = [{ name: "DB_USER", value: d.username }, { name: "DB_PASSWORD", value: d.password }, { name: "DB_PASSWORD_URL", value: encodeURIComponent(d.password) }, { name: "DB_NAME", value: d.dbName }];
    await apply({
      apiVersion: "batch/v1", kind: "Job", metadata: { name, namespace: c.system, labels: { "app.kubernetes.io/managed-by": "gereh", "gereh.net/db": d.id, "gereh.net/kind": "import" } },
      spec: { backoffLimit: 0, activeDeadlineSeconds: 7200, ttlSecondsAfterFinished: 3600, template: { spec: {
        restartPolicy: "Never", automountServiceAccountToken: false,
        initContainers: [{ name: "fetch", image: "alpine:3.20", command: ["/bin/sh", "-c", 'set -e; echo "==> Downloading dump"; wget -q -O /backup/dump "$URL"; echo "==> $(stat -c %s /backup/dump) bytes"'], env: [{ name: "URL", value: imp.url }], volumeMounts: [{ name: "backup", mountPath: "/backup" }] }],
        containers: [{ name: "main", image: engineImage(d), command: ["/bin/sh", "-c", "set -eo pipefail 2>/dev/null || set -e; echo '==> Importing'; " + script + "; echo '==> Done'"], env, volumeMounts: [{ name: "backup", mountPath: "/backup" }], resources: { limits: { cpu: "1", memory: "1Gi" } } }],
        volumes: [{ name: "backup", emptyDir: { sizeLimit: "25Gi" } }],
      } } },
    } as never);
    return new KubernetesDriver().waitJob(c.system, name, 7200, ["fetch", "main"]);
  }

  /** SQL Server restores .bak files from its own disk: stream the file into the pod, then RESTORE */
  private async importBak(d: DbSpec, imp: { path: string; sizeBytes: number }) {
    const [{ nsOf, dbName }, { podExec }] = await Promise.all([this.k(), import("./exec")]);
    const ns = nsOf(d.userId), pod = dbName(d) + "-0", file = "/var/opt/mssql/data/gereh-import.bak";
    const up = await podExec(ns, pod, "db", ["/bin/sh", "-c", 'head -c "$1" > "$2"', "sh", String(imp.sizeBytes), file], { stdin: createReadStream(imp.path), timeoutMs: 2 * 3600_000 });
    if (up.code) throw new Error(clean(up.stderr) || "upload into the server failed");
    try {
      const out = await this.run(d, [sqlcmd(bakRestoreSql(d.dbName, file))], 2 * 3600_000);
      return "==> Uploaded " + Math.round(imp.sizeBytes / 1048576) + " MB\n" + clean(out);
    } finally {
      await podExec(ns, pod, "db", ["rm", "-f", file], { timeoutMs: 30_000 }).catch(() => undefined);
    }
  }

  async inspect(d: DbSpec, req: InspectReq): Promise<InspectRes> {
    const mongo = d.engine === "mongodb", pg = d.engine === "postgres";
    switch (req.op) {
      case "databases": {
        const out = await this.run(d, [inspectCmds.databases(d)], 30_000);
        return { databases: pg || mongo ? lastJson<string[]>(out) : parseTsv(out, false).rows.map((r) => r[0] ?? "") };
      }
      case "tables": {
        const out = await this.run(d, [inspectCmds.tables(d, req.db)], 30_000);
        return { tables: pg || mongo ? lastJson<{ name: string; rows: number }[]>(out) : parseTsv(out, false).rows.map((r) => ({ name: r[0] ?? "", rows: Number(r[1]) || 0 })) };
      }
      case "rows": return { grid: this.grid(d, await this.run(d, [inspectCmds.rows(d, req.db, req.table, req.page * INSPECT_PAGE, INSPECT_PAGE + 1)], 20_000), INSPECT_PAGE) };
      case "query": return { grid: this.grid(d, await this.run(d, [inspectCmds.query(d, req.db, req.sql)], 20_000), QUERY_LIMIT, /^\s*(show|explain)\b/i.test(req.sql)) };
      case "find": {
        const docs = lastJson<unknown[]>(await this.run(d, [inspectCmds.find(req.db, req.collection, req.filter, req.page * INSPECT_PAGE, INSPECT_PAGE + 1)], 20_000));
        return { docs: docs.slice(0, INSPECT_PAGE).map((x) => JSON.stringify(x)), hasMore: docs.length > INSPECT_PAGE };
      }
    }
  }
  /** PostgreSQL answers with a JSON array of row objects, MySQL with tab-separated text */
  private grid(d: DbSpec, out: string, limit: number, raw = false): Grid {
    let g: { columns: string[]; rows: (string | null)[][] };
    if (d.engine === "postgres") {
      if (raw) g = { columns: ["result"], rows: out.split("\n").filter(Boolean).map((l) => [l]) };
      else {
        const list = lastJson<Record<string, unknown>[]>(out);
        const columns = list.length ? Object.keys(list[0]) : [];
        g = { columns, rows: list.map((r) => columns.map((c) => (r[c] === null || r[c] === undefined ? null : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c])))) };
      }
    } else g = parseTsv(out, true);
    const cut = (v: string | null) => (v && v.length > 2000 ? v.slice(0, 2000) + "…" : v);
    return { columns: g.columns, rows: g.rows.slice(0, limit).map((r) => r.map(cut)), hasMore: g.rows.length > limit };
  }

  async stats(d: DbSpec): Promise<DbStats> {
    const cmd = inspectCmds.stats(d);
    const none = { connections: null, sizeMb: null, uptime: null };
    if (!cmd) return none;
    const out = await this.run(d, [cmd], 20_000).catch(() => "");
    if (!out) return none;
    if (d.engine === "redis") {
      const v = (k: string) => Number(new RegExp("^" + k + ":(\\d+)", "m").exec(out)?.[1] ?? NaN);
      return { connections: v("connected_clients"), sizeMb: Math.round(v("used_memory") / 104857.6) / 10, uptime: v("uptime_in_seconds") };
    }
    if (d.engine === "mysql" || d.engine === "mariadb") {
      const [c, s, u] = parseTsv(out, false).rows[0] ?? [];
      return { connections: Number(c), sizeMb: Number(s), uptime: Number(u) };
    }
    return lastJson<DbStats>(out);
  }
}
/** the database's own image doubles as the client for imports */
const engineImage = (d: DbSpec) => engineK8s(d.engine).image(d);

/** RESTORE DATABASE from a .bak with every file moved under this server's data directory */
export function bakRestoreSql(db: string, file: string) {
  const q = (s: string) => s.replace(/'/g, "''");
  return [
    "SET NOCOUNT ON;",
    "DECLARE @f TABLE (LogicalName nvarchar(128), PhysicalName nvarchar(260), [Type] char(1), FileGroupName nvarchar(128), Size numeric(20,0), MaxSize numeric(20,0), FileId bigint, CreateLSN numeric(25,0), DropLSN numeric(25,0), UniqueId uniqueidentifier, ReadOnlyLSN numeric(25,0), ReadWriteLSN numeric(25,0), BackupSizeInBytes bigint, SourceBlockSize int, FileGroupId int, LogGroupGUID uniqueidentifier, DifferentialBaseLSN numeric(25,0), DifferentialBaseGUID uniqueidentifier, IsReadOnly bit, IsPresent bit, TDEThumbprint varbinary(32), SnapshotUrl nvarchar(360));",
    `INSERT @f EXEC (N'RESTORE FILELISTONLY FROM DISK = N''${q(q(file))}''');`,
    "DECLARE @move nvarchar(max) = N'';",
    `SELECT @move = @move + N', MOVE N''' + REPLACE(LogicalName, '''', '''''') + N''' TO N''/var/opt/mssql/data/${q(db)}_' + CAST(FileId AS nvarchar(10)) + CASE WHEN [Type] = 'L' THEN N'.ldf' ELSE N'.mdf' END + N'''' FROM @f;`,
    `IF DB_ID(N'${q(db)}') IS NOT NULL ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;`,
    `EXEC (N'RESTORE DATABASE [${db}] FROM DISK = N''${q(q(file))}'' WITH REPLACE, RECOVERY' + @move);`,
    `ALTER DATABASE [${db}] SET MULTI_USER;`,
    "PRINT 'RESTORED';",
  ].join("\n");
}

let cached: DbaasDriver | null = null;
/** the configured driver (Kubernetes when PAAS_K8S_API + PAAS_K8S_TOKEN are set) */
export function dbaas(): DbaasDriver {
  if (!cached) cached = process.env.PAAS_K8S_API && process.env.PAAS_K8S_TOKEN ? new KubeDbaas() : new SimDbaas();
  return cached;
}
export const resetDbaasDriver = () => { cached = null; };
