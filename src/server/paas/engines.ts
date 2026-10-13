/* Per-engine Kubernetes details for managed databases (image, env, probes, tuning flags) and the
   commands the Kubernetes driver runs inside a database pod (k8s exec) to manage users and
   databases, inspect data and finish first-run setup. Values never pass through a shell: scripts
   take them as positional arguments ("$1"…), and identifiers are validated (src/lib/dbaas.ts). */
import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { pgExtension, QUERY_LIMIT, QUERY_TIMEOUT_MS, type DbGrant } from "@/lib/dbaas";
import type { DbSpec } from "./driver";

type Obj = Record<string, unknown>;
export type EnvVar = { name: string; value?: string; valueFrom?: Obj };

const authName = (d: Pick<DbSpec, "name">) => "db-" + d.name + "-auth";
const fromSecret = (d: Pick<DbSpec, "name">, key = "password") => ({ valueFrom: { secretKeyRef: { name: authName(d), key } } });
const half = (d: DbSpec) => Math.max(256, Math.floor(d.ramMb / 2));

/** the PostgreSQL image with PostGIS and pgvector (deploy/paas/postgres-ext), one tag per major version */
export const pgExtImage = (version: string) => (process.env.PAAS_PG_EXT_IMAGE || "registry.gereh.net/gereh/postgres-ext") + ":" + version;

export type EngineK8s = {
  image: (d: DbSpec) => string;
  port: number;
  /** more container ports (management UI, native protocol) */
  extraPorts?: { name: string; port: number }[];
  data: string;
  env: (d: DbSpec) => EnvVar[];
  /** readiness check run in the container; null = TCP check on the port */
  probe: string | null;
  command?: (d: DbSpec) => string[] | undefined;
  args?: (d: DbSpec) => string[] | undefined;
  /** group that owns the data volume (images that do not run as root) */
  fsGroup?: number;
  /** slow first start (JVM, SQL Server): later liveness checks */
  slow?: boolean;
  /** extra keys in the auth Secret */
  secret?: (d: DbSpec) => Record<string, string>;
};

const TAGS: Record<string, Record<string, string>> = {
  elasticsearch: { "8.15": "8.15.3", "7.17": "7.17.24" },
  prometheus: { "3.0": "v3.0.1", "2.54": "v2.54.1" },
};
const tag = (engine: string, v: string) => TAGS[engine]?.[v] ?? v;
export const SQLCMD = 'S=/opt/mssql-tools18/bin/sqlcmd; C=-C; [ -x "$S" ] || { S=/opt/mssql-tools/bin/sqlcmd; C=; }; "$S" $C -S localhost -U sa -P "$MSSQL_SA_PASSWORD"';

/** PostgreSQL server flags: WAL archiving (PITR), tuning, preloaded extensions */
export function pgArgs(d: DbSpec, pitr: boolean): string[] | undefined {
  const flags: string[] = pitr ? ["wal_level=replica", "archive_mode=on", "archive_command=wal-g wal-push %p", "archive_timeout=300"] : [];
  const MB = new Set(["shared_buffers", "work_mem", "maintenance_work_mem", "effective_cache_size"]);
  for (const [k, v] of Object.entries(d.params ?? {})) flags.push(k + "=" + v + (MB.has(k) ? "MB" : ""));
  const preload = (d.extensions ?? []).filter((x) => pgExtension(x)?.preload);
  if (preload.length) flags.push("shared_preload_libraries=" + preload.join(","));
  return flags.length ? ["postgres", ...flags.flatMap((f) => ["-c", f])] : undefined;
}
const mysqlArgs = (d: DbSpec) => {
  const MB = new Set(["max_allowed_packet", "innodb_buffer_pool_size"]);
  const a = Object.entries(d.params ?? {}).map(([k, v]) => "--" + k + "=" + v + (MB.has(k) ? "M" : ""));
  return a.length ? a : undefined;
};

export const ENGINES: Record<string, EngineK8s> = {
  postgres: {
    image: (d) => (d.extImage ? pgExtImage(d.version) : "postgres:" + d.version + "-alpine"), port: 5432, data: "/var/lib/postgresql/data",
    env: (d) => [{ name: "POSTGRES_USER", value: d.username }, { name: "POSTGRES_PASSWORD", ...fromSecret(d) }, { name: "POSTGRES_DB", value: d.dbName }, { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" }],
    probe: 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"', args: (d) => pgArgs(d, false),
  },
  mysql: {
    image: (d) => "mysql:" + d.version, port: 3306, data: "/var/lib/mysql",
    env: (d) => [{ name: "MYSQL_USER", value: d.username }, { name: "MYSQL_PASSWORD", ...fromSecret(d) }, { name: "MYSQL_ROOT_PASSWORD", ...fromSecret(d) }, { name: "MYSQL_DATABASE", value: d.dbName }],
    probe: 'mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD"', args: mysqlArgs,
  },
  mariadb: {
    image: (d) => "mariadb:" + d.version, port: 3306, data: "/var/lib/mysql",
    env: (d) => [{ name: "MARIADB_USER", value: d.username }, { name: "MARIADB_PASSWORD", ...fromSecret(d) }, { name: "MARIADB_ROOT_PASSWORD", ...fromSecret(d) }, { name: "MARIADB_DATABASE", value: d.dbName }],
    probe: "healthcheck.sh --connect --innodb_initialized", args: mysqlArgs,
  },
  mongodb: {
    image: (d) => "mongo:" + d.version, port: 27017, data: "/data/db",
    env: (d) => [{ name: "MONGO_INITDB_ROOT_USERNAME", value: d.username }, { name: "MONGO_INITDB_ROOT_PASSWORD", ...fromSecret(d) }, { name: "MONGO_INITDB_DATABASE", value: d.dbName }],
    probe: "mongosh --quiet --eval 'db.adminCommand({ping:1})'",
    args: (d) => {
      const p = d.params ?? {};
      const a = [...(p.maxConns ? ["--maxConns", p.maxConns] : []), ...(p.wiredTigerCacheSizeMB ? ["--wiredTigerCacheSizeGB", String(Math.max(0.25, Number(p.wiredTigerCacheSizeMB) / 1024))] : [])];
      if (d.replicaSet) a.push("--replSet", "rs0", "--keyFile", "/etc/mongo-key/keyfile", "--bind_ip_all");
      return a.length ? a : undefined;
    },
    // stable per database: the member authenticates to itself with it
    secret: (d): Record<string, string> => (d.replicaSet ? { keyfile: createHmac("sha512", process.env.APP_SECRET || "dev").update("mongo-rs:" + d.id).digest("base64") } : {}),
  },
  redis: {
    image: (d) => "redis:" + d.version + "-alpine", port: 6379, data: "/data", env: (d) => [{ name: "REDIS_PASSWORD", ...fromSecret(d) }],
    probe: 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
    command: (d) => {
      const p = d.params ?? {};
      const extra = [["maxclients", p.maxclients], ["timeout", p.timeout]].filter(([, v]) => v).map(([k, v]) => " --" + k + " " + Number(v)).join("");
      return ["/bin/sh", "-c", 'exec redis-server --requirepass "$REDIS_PASSWORD" --appendonly yes --maxmemory ' + Math.floor(d.ramMb * 0.8) + "mb --maxmemory-policy " + (p["maxmemory-policy"] || "noeviction").replace(/[^a-z-]/g, "") + extra];
    },
  },
  mssql: {
    image: (d) => "mcr.microsoft.com/mssql/server:" + d.version + "-latest", port: 1433, data: "/var/opt/mssql", fsGroup: 10001, slow: true,
    env: (d) => [{ name: "ACCEPT_EULA", value: "Y" }, { name: "MSSQL_PID", value: "Express" }, { name: "MSSQL_SA_PASSWORD", ...fromSecret(d) }, { name: "MSSQL_MEMORY_LIMIT_MB", value: String(Math.floor(d.ramMb * 0.8)) }],
    probe: SQLCMD + ' -b -Q "SELECT 1" -o /dev/null',
  },
  elasticsearch: {
    image: (d) => "docker.elastic.co/elasticsearch/elasticsearch:" + tag("elasticsearch", d.version), port: 9200, data: "/usr/share/elasticsearch/data", fsGroup: 1000, slow: true,
    env: (d) => [
      { name: "discovery.type", value: "single-node" }, { name: "ELASTIC_PASSWORD", ...fromSecret(d) }, { name: "xpack.security.enabled", value: "true" },
      { name: "xpack.security.http.ssl.enabled", value: "false" }, { name: "xpack.security.transport.ssl.enabled", value: "false" },
      // no vm.max_map_count on shared nodes
      { name: "node.store.allow_mmap", value: "false" }, { name: "ES_JAVA_OPTS", value: "-Xms" + half(d) + "m -Xmx" + half(d) + "m" },
    ],
    probe: 'curl -fsu "elastic:$ELASTIC_PASSWORD" "http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow&timeout=2s" >/dev/null',
  },
  rabbitmq: {
    image: (d) => "rabbitmq:" + d.version + "-management-alpine", port: 5672, extraPorts: [{ name: "mgmt", port: 15672 }], data: "/var/lib/rabbitmq",
    env: (d) => [{ name: "RABBITMQ_DEFAULT_USER", value: d.username }, { name: "RABBITMQ_DEFAULT_PASS", ...fromSecret(d) }, { name: "RABBITMQ_DEFAULT_VHOST", value: d.dbName }],
    probe: "rabbitmq-diagnostics -q ping",
  },
  clickhouse: {
    image: (d) => "clickhouse/clickhouse-server:" + d.version + "-alpine", port: 8123, extraPorts: [{ name: "native", port: 9000 }], data: "/var/lib/clickhouse",
    env: (d) => [{ name: "CLICKHOUSE_USER", value: d.username }, { name: "CLICKHOUSE_PASSWORD", ...fromSecret(d) }, { name: "CLICKHOUSE_DB", value: d.dbName }, { name: "CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT", value: "1" }],
    probe: "wget -qO- http://127.0.0.1:8123/ping >/dev/null",
  },
  cassandra: {
    image: (d) => "cassandra:" + d.version, port: 9042, data: "/var/lib/cassandra", slow: true,
    env: (d) => [{ name: "CASSANDRA_CLUSTER_NAME", value: "gereh" }, { name: "MAX_HEAP_SIZE", value: half(d) + "M" }, { name: "HEAP_NEWSIZE", value: Math.max(64, Math.floor(d.ramMb / 8)) + "M" }],
    // password authentication on; the first-run setup replaces the default cassandra/cassandra role
    command: () => ["/bin/sh", "-c", "sed -i -E 's/AllowAllAuthenticator/PasswordAuthenticator/; s/AllowAllAuthorizer/CassandraAuthorizer/' /etc/cassandra/cassandra.yaml && exec docker-entrypoint.sh cassandra -f"],
    probe: "nodetool status 2>/dev/null | grep -q '^UN'",
  },
  couchdb: {
    image: (d) => "couchdb:" + d.version, port: 5984, data: "/opt/couchdb/data",
    env: (d) => [{ name: "COUCHDB_USER", value: d.username }, { name: "COUCHDB_PASSWORD", ...fromSecret(d) }],
    probe: "curl -fs http://127.0.0.1:5984/_up >/dev/null",
  },
  influxdb: {
    image: (d) => "influxdb:" + d.version + "-alpine", port: 8086, data: "/var/lib/influxdb2",
    env: (d) => [
      { name: "DOCKER_INFLUXDB_INIT_MODE", value: "setup" }, { name: "DOCKER_INFLUXDB_INIT_USERNAME", value: d.username }, { name: "DOCKER_INFLUXDB_INIT_PASSWORD", ...fromSecret(d) },
      { name: "DOCKER_INFLUXDB_INIT_ORG", value: "gereh" }, { name: "DOCKER_INFLUXDB_INIT_BUCKET", value: d.dbName }, { name: "DOCKER_INFLUXDB_INIT_ADMIN_TOKEN", ...fromSecret(d) },
    ],
    probe: "wget -qO- http://127.0.0.1:8086/health >/dev/null",
  },
  neo4j: {
    image: (d) => "neo4j:" + d.version + "-community", port: 7687, extraPorts: [{ name: "http", port: 7474 }], data: "/data", slow: true,
    env: (d) => [
      { name: "NEO4J_AUTH", ...fromSecret(d, "neo4j_auth") }, { name: "NEO4J_PASSWORD", ...fromSecret(d) },
      // setting names changed in 5.x (and unknown ones are fatal)
      { name: d.version.startsWith("4") ? "NEO4J_dbms_memory_heap_max__size" : "NEO4J_server_memory_heap_max__size", value: half(d) + "m" },
    ],
    probe: 'cypher-shell -u neo4j -p "$NEO4J_PASSWORD" "RETURN 1" >/dev/null',
    secret: (d) => ({ neo4j_auth: "neo4j/" + d.password }),
  },
  arangodb: {
    image: (d) => "arangodb:" + d.version, port: 8529, data: "/var/lib/arangodb3",
    env: (d) => [{ name: "ARANGO_ROOT_PASSWORD", ...fromSecret(d) }], probe: null,
  },
  rethinkdb: {
    image: (d) => "rethinkdb:" + d.version, port: 28015, data: "/data",
    env: (d) => [{ name: "RDB_PASSWORD", ...fromSecret(d) }], probe: null,
    // $(RDB_PASSWORD) is expanded by Kubernetes, not a shell
    command: () => ["rethinkdb", "--bind", "all", "--directory", "/data/rethinkdb_data", "--initial-password", "$(RDB_PASSWORD)"],
  },
  prometheus: {
    image: (d) => "prom/prometheus:" + tag("prometheus", d.version), port: 9090, data: "/prometheus", fsGroup: 65534,
    env: () => [], probe: "wget -qO- http://127.0.0.1:9090/-/ready >/dev/null",
    args: () => ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus", "--storage.tsdb.retention.time=15d", "--web.enable-remote-write-receiver", "--web.enable-lifecycle"],
  },
};
export const engineK8s = (engine: string) => ENGINES[engine] ?? ENGINES.postgres;
export const enginePort = (engine: string) => engineK8s(engine).port;

/* ---------- commands run inside the database pod ---------- */
export type Exec = string[];
const sh = (script: string, ...args: string[]): Exec => ["/bin/sh", "-c", script, "sh", ...args];
const lit = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const pgId = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const myId = (s: string) => "`" + s.replace(/`/g, "``") + "`";
const msId = (s: string) => "[" + s.replace(/]/g, "]]") + "]";
const js = (v: unknown) => JSON.stringify(v);

export const psql = (db: string, sql: string, opts = "-At"): Exec => sh('psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" ' + opts + ' -c "$2"', db, sql);
export const mysqlCli = (d: Pick<DbSpec, "engine">, sql: string, db = "", header = false): Exec => d.engine === "mariadb"
  ? sh('MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot -B ' + (header ? "" : "-N ") + '-e "$1" ${2:+"$2"}', sql, db)
  : sh('MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -B ' + (header ? "" : "-N ") + '-e "$1" ${2:+"$2"}', sql, db);
export const mongosh = (script: string): Exec => sh('mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "$1"', script);
export const sqlcmd = (sql: string): Exec => sh(SQLCMD + ' -b -h -1 -W -Q "$1"', sql);
export const chClient = (sql: string): Exec => sh('clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" -n -q "$1"', sql);

const PG_RW = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER";
const MY_RW = "SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, EVENT, TRIGGER, REFERENCES";
const CH_RW = "SELECT, INSERT, ALTER, CREATE TABLE, CREATE VIEW, DROP TABLE, DROP VIEW, TRUNCATE, OPTIMIZE, SHOW";

/** replaces every grant of `user` on `all` databases with `grants` */
export function setGrantsCmds(d: DbSpec, user: string, grants: DbGrant[], all: string[]): Exec[] {
  const g = new Map(grants.map((x) => [x.db, x.access]));
  switch (d.engine) {
    case "postgres": return all.map((db) => {
      const a = g.get(db), u = pgId(user), owner = pgId(d.username);
      const def = (what: string, on: string) => `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public ${what} ON ${on}`;
      const sql = [
        `REVOKE ALL ON DATABASE ${pgId(db)} FROM ${u}`, `REVOKE ALL ON SCHEMA public FROM ${u}`, `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${u}`, `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${u}`,
        `${def("REVOKE ALL", "TABLES")} FROM ${u}`, `${def("REVOKE ALL", "SEQUENCES")} FROM ${u}`,
        ...(a ? [`GRANT CONNECT${a === "rw" ? ", TEMP" : ""} ON DATABASE ${pgId(db)} TO ${u}`, `GRANT USAGE${a === "rw" ? ", CREATE" : ""} ON SCHEMA public TO ${u}`,
          `GRANT ${a === "rw" ? PG_RW : "SELECT"} ON ALL TABLES IN SCHEMA public TO ${u}`, `GRANT ${a === "rw" ? "USAGE, SELECT, UPDATE" : "SELECT"} ON ALL SEQUENCES IN SCHEMA public TO ${u}`,
          `${def("GRANT " + (a === "rw" ? PG_RW : "SELECT"), "TABLES")} TO ${u}`, `${def("GRANT " + (a === "rw" ? "USAGE, SELECT, UPDATE" : "SELECT"), "SEQUENCES")} TO ${u}`] : []),
      ];
      return psql(db, sql.join("; "));
    });
    case "mysql": case "mariadb": {
      const u = lit(user) + "@'%'";
      return [mysqlCli(d, [`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ${u}`, ...grants.map((x) => `GRANT ${x.access === "rw" ? MY_RW : "SELECT, SHOW VIEW"} ON ${myId(x.db)}.* TO ${u}`), "FLUSH PRIVILEGES"].join("; "))];
    }
    case "mongodb": return [mongosh(`db.getSiblingDB("admin").updateUser(${js(user)}, { roles: ${js(grants.map((x) => ({ role: x.access === "rw" ? "readWrite" : "read", db: x.db })))} })`)];
    case "mssql": return [sqlcmd(all.map((db) => {
      const a = g.get(db), u = msId(user);
      return `USE ${msId(db)}; IF USER_ID(${"N" + lit(user)}) IS NOT NULL DROP USER ${u};` + (a ? ` CREATE USER ${u} FOR LOGIN ${u}; ALTER ROLE db_datareader ADD MEMBER ${u};` + (a === "rw" ? ` ALTER ROLE db_datawriter ADD MEMBER ${u}; ALTER ROLE db_ddladmin ADD MEMBER ${u};` : "") : "");
    }).join(" "))];
    case "clickhouse": return [chClient([`REVOKE ALL ON *.* FROM ${myId(user)}`, ...grants.map((x) => `GRANT ${x.access === "rw" ? CH_RW : "SELECT, SHOW"} ON ${myId(x.db)}.* TO ${myId(user)}`)].join("; "))];
    case "rabbitmq": return [
      ...all.map((v) => sh('rabbitmqctl clear_permissions -p "$1" "$2" >/dev/null 2>&1 || true', v, user)),
      ...grants.map((x) => (x.access === "rw" ? ["rabbitmqctl", "set_permissions", "-p", x.db, user, ".*", ".*", ".*"] : ["rabbitmqctl", "set_permissions", "-p", x.db, user, "^$", "^$", ".*"])),
    ];
    default: throw new Error("user management is not supported for " + d.engine);
  }
}

export function createUserCmds(d: DbSpec, user: string, password: string, grants: DbGrant[], all: string[]): Exec[] {
  switch (d.engine) {
    case "postgres": return [psql(d.dbName, `CREATE ROLE ${pgId(user)} LOGIN PASSWORD ${lit(password)}`), ...setGrantsCmds(d, user, grants, all)];
    case "mysql": case "mariadb": return [mysqlCli(d, `CREATE USER ${lit(user)}@'%' IDENTIFIED BY ${lit(password)}`), ...setGrantsCmds(d, user, grants, all)];
    case "mongodb": return [mongosh(`db.getSiblingDB("admin").createUser({ user: ${js(user)}, pwd: ${js(password)}, roles: ${js(grants.map((x) => ({ role: x.access === "rw" ? "readWrite" : "read", db: x.db })))} })`)];
    case "mssql": return [sqlcmd(`CREATE LOGIN ${msId(user)} WITH PASSWORD = N${lit(password)}, CHECK_POLICY = OFF`), ...setGrantsCmds(d, user, grants, all)];
    case "clickhouse": return [chClient(`CREATE USER IF NOT EXISTS ${myId(user)} IDENTIFIED WITH sha256_password BY ${lit(password)}`), ...setGrantsCmds(d, user, grants, all)];
    case "rabbitmq": return [["rabbitmqctl", "add_user", user, password], ["rabbitmqctl", "set_user_tags", user, "management"], ...setGrantsCmds(d, user, grants, all)];
    default: throw new Error("user management is not supported for " + d.engine);
  }
}
export function dropUserCmds(d: DbSpec, user: string, all: string[]): Exec[] {
  switch (d.engine) {
    case "postgres": return [...all.map((db) => psql(db, `REASSIGN OWNED BY ${pgId(user)} TO ${pgId(d.username)}; DROP OWNED BY ${pgId(user)}`)), psql(d.dbName, `DROP ROLE IF EXISTS ${pgId(user)}`)];
    case "mysql": case "mariadb": return [mysqlCli(d, `DROP USER IF EXISTS ${lit(user)}@'%'`)];
    case "mongodb": return [mongosh(`db.getSiblingDB("admin").dropUser(${js(user)})`)];
    case "mssql": return [...setGrantsCmds(d, user, [], all), sqlcmd(`IF SUSER_ID(N${lit(user)}) IS NOT NULL DROP LOGIN ${msId(user)}`)];
    case "clickhouse": return [chClient(`DROP USER IF EXISTS ${myId(user)}`)];
    case "rabbitmq": return [["rabbitmqctl", "delete_user", user]];
    default: throw new Error("user management is not supported for " + d.engine);
  }
}
export function userPasswordCmds(d: DbSpec, user: string, password: string): Exec[] {
  switch (d.engine) {
    case "postgres": return [psql(d.dbName, `ALTER ROLE ${pgId(user)} PASSWORD ${lit(password)}`)];
    case "mysql": case "mariadb": return [mysqlCli(d, `ALTER USER ${lit(user)}@'%' IDENTIFIED BY ${lit(password)}`)];
    case "mongodb": return [mongosh(`db.getSiblingDB("admin").changeUserPassword(${js(user)}, ${js(password)})`)];
    case "mssql": return [sqlcmd(`ALTER LOGIN ${msId(user)} WITH PASSWORD = N${lit(password)}`)];
    case "clickhouse": return [chClient(`ALTER USER ${myId(user)} IDENTIFIED WITH sha256_password BY ${lit(password)}`)];
    case "rabbitmq": return [["rabbitmqctl", "change_password", user, password]];
    default: throw new Error("user management is not supported for " + d.engine);
  }
}
export function createDatabaseCmds(d: DbSpec, name: string): Exec[] {
  switch (d.engine) {
    case "postgres": return [psql(d.dbName, `CREATE DATABASE ${pgId(name)} OWNER ${pgId(d.username)}`)];
    case "mysql": case "mariadb": return [mysqlCli(d, `CREATE DATABASE IF NOT EXISTS ${myId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON ${myId(name)}.* TO ${lit(d.username)}@'%'`)];
    // MongoDB creates a database on its first write
    case "mongodb": return [];
    case "mssql": return [sqlcmd(`IF DB_ID(N${lit(name)}) IS NULL CREATE DATABASE ${msId(name)}`)];
    case "clickhouse": return [chClient(`CREATE DATABASE IF NOT EXISTS ${myId(name)}`)];
    case "rabbitmq": return [["rabbitmqctl", "add_vhost", name], ["rabbitmqctl", "set_permissions", "-p", name, d.username, ".*", ".*", ".*"]];
    default: throw new Error("database management is not supported for " + d.engine);
  }
}
export function dropDatabaseCmds(d: DbSpec, name: string): Exec[] {
  switch (d.engine) {
    case "postgres": return Number(d.version) >= 13
      ? [psql(d.dbName, `DROP DATABASE IF EXISTS ${pgId(name)} WITH (FORCE)`)]
      : [psql(d.dbName, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${lit(name)}`), psql(d.dbName, `DROP DATABASE IF EXISTS ${pgId(name)}`)];
    case "mysql": case "mariadb": return [mysqlCli(d, `DROP DATABASE IF EXISTS ${myId(name)}`)];
    case "mongodb": return [mongosh(`db.getSiblingDB(${js(name)}).dropDatabase()`)];
    case "mssql": return [sqlcmd(`IF DB_ID(N${lit(name)}) IS NOT NULL BEGIN ALTER DATABASE ${msId(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${msId(name)}; END`)];
    case "clickhouse": return [chClient(`DROP DATABASE IF EXISTS ${myId(name)}`)];
    case "rabbitmq": return [["rabbitmqctl", "delete_vhost", name]];
    default: throw new Error("database management is not supported for " + d.engine);
  }
}

/** first-run setup once the server answers (idempotent); `host` is the in-cluster service name */
export function initCmds(d: DbSpec, host: string): Exec[] {
  switch (d.engine) {
    case "mssql": return [sqlcmd(`IF DB_ID(N${lit(d.dbName)}) IS NULL CREATE DATABASE ${msId(d.dbName)}`)];
    case "mongodb": return d.replicaSet ? [mongosh(`try { rs.status() } catch (e) { rs.initiate({ _id: "rs0", members: [{ _id: 0, host: ${js(host + ":27017")} }] }) }`)] : [];
    case "cassandra": {
      const role = `CREATE ROLE IF NOT EXISTS ${pgId(d.username)} WITH PASSWORD = ${lit(d.password)} AND SUPERUSER = true AND LOGIN = true`;
      const rest = `CREATE KEYSPACE IF NOT EXISTS ${pgId(d.dbName)} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}; ALTER ROLE cassandra WITH PASSWORD = ${lit(randomBytes(24).toString("base64url"))} AND SUPERUSER = false AND LOGIN = false`;
      return [sh('cqlsh -u "$1" -p "$2" -e "SELECT now() FROM system.local" >/dev/null 2>&1 || cqlsh -u cassandra -p cassandra -e "$3"; cqlsh -u "$1" -p "$2" -e "$4"', d.username, d.password, role, rest)];
    }
    case "couchdb": return [sh('for x in _users _replicator "$3"; do curl -sS -o /dev/null -u "$1:$2" -X PUT "http://127.0.0.1:5984/$x"; done', d.username, d.password, d.dbName)];
    case "arangodb": return [sh('arangosh --server.endpoint tcp://127.0.0.1:8529 --server.username root --server.password "$ARANGO_ROOT_PASSWORD" --javascript.execute-string "$1"', `if (!db._databases().includes(${js(d.dbName)})) db._createDatabase(${js(d.dbName)});`)];
    default: return [];
  }
}
/** CREATE/DROP EXTENSION for the difference between `want` and what is installed */
export function extensionCmds(d: DbSpec, enable: string[], disable: string[]): Exec[] {
  const sql = [...disable.map((e) => `DROP EXTENSION IF EXISTS ${pgId(e)}`), ...enable.flatMap((e) => [...(pgExtension(e)?.requires ?? []).map((r) => `CREATE EXTENSION IF NOT EXISTS ${pgId(r)}`), `CREATE EXTENSION IF NOT EXISTS ${pgId(e)}`])];
  return sql.length ? [psql(d.dbName, sql.join("; "))] : [];
}

/* ---------- data inspector ---------- */
const PG_RO = `BEGIN READ ONLY; SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}; `;
export const pgQualified = (table: string) => { const i = table.indexOf("."); return i > 0 ? pgId(table.slice(0, i)) + "." + pgId(table.slice(i + 1)) : pgId(table); };
const mySession = (d: Pick<DbSpec, "engine">) => "SET SESSION TRANSACTION READ ONLY; " + (d.engine === "mariadb" ? `SET SESSION max_statement_time = ${QUERY_TIMEOUT_MS / 1000}; ` : `SET SESSION max_execution_time = ${QUERY_TIMEOUT_MS}; `);
export const inspectCmds = {
  databases(d: DbSpec): Exec {
    switch (d.engine) {
      case "postgres": return psql(d.dbName, "SELECT coalesce(json_agg(datname ORDER BY datname), '[]') FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'");
      case "mongodb": return mongosh('print(EJSON.stringify(db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.map((x) => x.name).filter((n) => !["admin", "config", "local"].includes(n))))');
      default: return mysqlCli(d, "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY 1");
    }
  },
  tables(d: DbSpec, db: string): Exec {
    switch (d.engine) {
      case "postgres": return psql(db, "SELECT coalesce(json_agg(json_build_object('name', CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END, 'rows', greatest(c.reltuples, 0)::bigint) ORDER BY n.nspname, c.relname), '[]') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'v', 'm', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'");
      case "mongodb": return mongosh(`const d = db.getSiblingDB(${js(db)}); print(EJSON.stringify(d.getCollectionInfos({ type: "collection" }).map((c) => ({ name: c.name, rows: d.getCollection(c.name).estimatedDocumentCount() }))))`);
      default: return mysqlCli(d, `SELECT table_name, IFNULL(table_rows, 0) FROM information_schema.tables WHERE table_schema = ${lit(db)} ORDER BY 1`);
    }
  },
  rows(d: DbSpec, db: string, table: string, offset: number, limit: number): Exec {
    if (d.engine === "postgres") return psql(db, PG_RO + `SELECT coalesce(json_agg(t), '[]') FROM (SELECT * FROM ${pgQualified(table)} LIMIT ${limit} OFFSET ${offset}) t`);
    return mysqlCli(d, mySession(d) + `SELECT * FROM ${myId(db)}.${myId(table)} LIMIT ${offset}, ${limit}`, db, true);
  },
  /** `q` passed readQueryError(); one statement, so it cannot leave the read-only transaction */
  query(d: DbSpec, db: string, q: string): Exec {
    const s = q.trim().replace(/;\s*$/, "");
    const raw = /^(show|explain)\b/i.test(s);
    if (d.engine === "postgres") return psql(db, PG_RO + (raw ? s : `SELECT coalesce(json_agg(t), '[]') FROM (SELECT * FROM (${s}) q LIMIT ${QUERY_LIMIT + 1}) t`));
    return mysqlCli(d, mySession(d) + (raw ? s : `SELECT * FROM (${s}) _q LIMIT ${QUERY_LIMIT + 1}`), db, true);
  },
  find(db: string, coll: string, filter: string, offset: number, limit: number): Exec {
    return mongosh(`print(EJSON.stringify(db.getSiblingDB(${js(db)}).getCollection(${js(coll)}).find(EJSON.parse(${js(filter || "{}")})).skip(${offset}).limit(${limit}).maxTimeMS(${QUERY_TIMEOUT_MS}).toArray(), { relaxed: true }))`);
  },
  stats(d: DbSpec): Exec | null {
    switch (d.engine) {
      case "postgres": return psql(d.dbName, "SELECT json_build_object('connections', (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend'), 'sizeMb', (SELECT round(sum(pg_database_size(datname)) / 1048576.0, 1) FROM pg_database), 'uptime', extract(epoch FROM now() - pg_postmaster_start_time())::int)");
      case "mysql": case "mariadb": return mysqlCli(d, "SELECT (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Threads_connected'), (SELECT round(IFNULL(sum(data_length + index_length), 0) / 1048576, 1) FROM information_schema.tables), (SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime')");
      case "mongodb": return mongosh("const s = db.serverStatus(); print(EJSON.stringify({ connections: s.connections.current, sizeMb: Math.round(db.adminCommand({ listDatabases: 1 }).totalSize / 104857.6) / 10, uptime: s.uptime }, { relaxed: true }))");
      case "redis": return sh('redis-cli -a "$REDIS_PASSWORD" --no-auth-warning info | grep -E "^(connected_clients|used_memory|uptime_in_seconds):"');
      default: return null;
    }
  },
};

/** parses `mysql -B` output (tab-separated, \t \n \\ escaped, NULL); the first line is the header when `header` */
export function parseTsv(out: string, header: boolean): { columns: string[]; rows: (string | null)[][] } {
  const unesc = (v: string) => (v === "NULL" ? null : v.replace(/\\(.)/g, (_, c: string) => ({ t: "\t", n: "\n", "\\": "\\", "0": "\0" } as Record<string, string>)[c] ?? c));
  const lines = out.split("\n").filter((l) => l.length);
  const rows = lines.map((l) => l.split("\t").map(unesc));
  return header ? { columns: (rows.shift() ?? []).map((c) => c ?? ""), rows } : { columns: [], rows };
}
/** the last JSON line of a command's output */
export function lastJson<T>(out: string): T {
  const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return JSON.parse(line) as T;
}

/* ---------- temporary admin panels ---------- */
/** nginx basic-auth line ({SSHA}: salted SHA-1, understood by nginx's auth_basic) */
export function htpasswd(user: string, password: string) {
  const salt = randomBytes(8);
  return user + ":{SSHA}" + Buffer.concat([createHash("sha1").update(password).update(salt).digest(), salt]).toString("base64");
}
export type PanelTool = { image: string; port: number; env: (d: DbSpec, host: string, dbHost: string, adminEmail: string, password: string) => EnvVar[] };
export const PANEL_TOOLS: Record<string, PanelTool> = {
  phpmyadmin: { image: "phpmyadmin:5.2", port: 80, env: (d, host, h) => [{ name: "PMA_HOST", value: h }, { name: "PMA_PORT", value: String(enginePort(d.engine)) }, { name: "PMA_ABSOLUTE_URI", value: "https://" + host + "/" }, { name: "UPLOAD_LIMIT", value: "256M" }] },
  pgadmin: { image: "dpage/pgadmin4:8", port: 80, env: (_d, _host, _h, email, pw) => [{ name: "PGADMIN_DEFAULT_EMAIL", value: email }, { name: "PGADMIN_DEFAULT_PASSWORD", value: pw }, { name: "PGADMIN_CONFIG_UPGRADE_CHECK_ENABLED", value: "False" }] },
  adminer: { image: "adminer:4.8.1", port: 8080, env: (_d, _host, h) => [{ name: "ADMINER_DEFAULT_SERVER", value: h }] },
  redisinsight: { image: "redis/redisinsight:2.60", port: 5540, env: (d, _host, h) => [{ name: "RI_REDIS_HOST", value: h }, { name: "RI_REDIS_PORT", value: "6379" }, { name: "RI_REDIS_ALIAS", value: d.name }, { name: "RI_REDIS_PASSWORD", ...fromSecret(d) }] },
  "mongo-express": { image: "mongo-express:1.0.2", port: 8081, env: (d, _host, h) => [
    { name: "DB_PASSWORD", ...fromSecret(d) }, { name: "ME_CONFIG_MONGODB_URL", value: "mongodb://" + encodeURIComponent(d.username) + ":$(DB_PASSWORD)@" + h + ":27017/?authSource=admin" },
    { name: "ME_CONFIG_BASICAUTH", value: "false" }, { name: "ME_CONFIG_MONGODB_ENABLE_ADMIN", value: "true" },
  ] },
};
