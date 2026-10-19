/* Managed database extras: shared helpers for the RPC methods, upload routes, worker jobs and the
   panel state (users, databases, admin panels, imports, events and settings of each database). */
import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { faDateTime } from "@/lib/jalali";
import type { DbExtra } from "@/lib/types";
import type { DB, Tx } from "../db/client";
import { paasDbConfig, paasDbDatabases, paasDbEvents, paasDbImports, paasDbPanels, paasDbs, paasDbUsers } from "../db/schema";
import { enqueue } from "../jobs";
import { uploadRoot } from "./service";
import { pgExtAvailable } from "./engines";

export type DbRow = typeof paasDbs.$inferSelect;
export type DbConfig = typeof paasDbConfig.$inferSelect;

export const dbEvent = (db: DB | Tx, dbId: string, message: string, level: "info" | "warn" | "error" = "info") =>
  db.insert(paasDbEvents).values({ dbId, message: message.slice(0, 500), level });

export async function configOf(db: DB | Tx, dbId: string): Promise<DbConfig> {
  const [c] = await db.select().from(paasDbConfig).where(eq(paasDbConfig.dbId, dbId));
  if (c) return c;
  const [made] = await db.insert(paasDbConfig).values({ dbId }).onConflictDoNothing().returning();
  return made ?? (await db.select().from(paasDbConfig).where(eq(paasDbConfig.dbId, dbId)))[0];
}
export const saveConfig = (db: DB | Tx, dbId: string, patch: Partial<Omit<DbConfig, "dbId">>) =>
  db.insert(paasDbConfig).values({ dbId, ...patch, updatedAt: new Date() }).onConflictDoUpdate({ target: paasDbConfig.dbId, set: { ...patch, updatedAt: new Date() } });

/** a new database: its settings row (new PostgreSQL servers get the PostGIS/pgvector image) and the
    first-run setup that waits for it to become ready */
export async function afterCreateDb(db: DB | Tx, row: Pick<DbRow, "id" | "engine">, o: { replicaSet?: boolean; seed?: DbConfig["seed"] } = {}) {
  await db.insert(paasDbConfig).values({ dbId: row.id, extImage: row.engine === "postgres" && pgExtAvailable(), replicaSet: !!o.replicaSet && row.engine === "mongodb", seed: o.seed ?? null }).onConflictDoNothing();
  await enqueue(db, "dbaas.init", { dbId: row.id, since: Date.now() }, { runAt: new Date(Date.now() + Number(process.env.PAAS_POLL_MS ?? 3000)) });
}

/** the main database plus the extra ones: what grants and the inspector may name */
export async function databasesOf(db: DB | Tx, row: Pick<DbRow, "id" | "dbName">) {
  const extra = await db.select({ name: paasDbDatabases.name }).from(paasDbDatabases).where(eq(paasDbDatabases.dbId, row.id)).orderBy(asc(paasDbDatabases.name));
  return [row.dbName, ...extra.map((x) => x.name)];
}

/* ---------- uploaded dumps ---------- */
export async function dumpPathFor(uid: string, uploadId: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(uploadId)) return null;
  const dir = path.join(uploadRoot(), uid);
  await mkdir(dir, { recursive: true });
  return path.join(dir, uploadId + ".dbdump");
}

/* ---------- panel state ---------- */
export async function dbaasState(db: DB, dbIds: string[], opts: { admin: boolean }): Promise<Map<string, DbExtra>> {
  const out = new Map<string, DbExtra>();
  if (!dbIds.length) return out;
  const since = new Date(Date.now() - 30 * 86400_000);
  const [confs, users, dbs, panels, imports, events] = await Promise.all([
    db.select().from(paasDbConfig).where(inArray(paasDbConfig.dbId, dbIds)),
    opts.admin ? [] : db.select({ id: paasDbUsers.id, dbId: paasDbUsers.dbId, username: paasDbUsers.username, grants: paasDbUsers.grants, createdAt: paasDbUsers.createdAt }).from(paasDbUsers).where(inArray(paasDbUsers.dbId, dbIds)).orderBy(asc(paasDbUsers.username)),
    opts.admin ? [] : db.select().from(paasDbDatabases).where(inArray(paasDbDatabases.dbId, dbIds)).orderBy(asc(paasDbDatabases.name)),
    opts.admin ? [] : db.select({ id: paasDbPanels.id, dbId: paasDbPanels.dbId, tool: paasDbPanels.tool, host: paasDbPanels.host, username: paasDbPanels.username, status: paasDbPanels.status, expiresAt: paasDbPanels.expiresAt }).from(paasDbPanels).where(inArray(paasDbPanels.dbId, dbIds)).orderBy(desc(paasDbPanels.createdAt)),
    opts.admin ? [] : db.select({ id: paasDbImports.id, dbId: paasDbImports.dbId, format: paasDbImports.format, status: paasDbImports.status, output: paasDbImports.output, sizeBytes: paasDbImports.sizeBytes, createdAt: paasDbImports.createdAt }).from(paasDbImports).where(inArray(paasDbImports.dbId, dbIds)).orderBy(desc(paasDbImports.createdAt)),
    opts.admin ? [] : db.select().from(paasDbEvents).where(inArray(paasDbEvents.dbId, dbIds)).orderBy(desc(paasDbEvents.createdAt)).limit(dbIds.length * 40),
  ]);
  for (const id of dbIds) {
    const c = confs.find((x) => x.dbId === id);
    out.set(id, {
      config: { params: c?.params ?? {}, extensions: c?.extensions ?? [], allowlist: c?.allowlist ?? [], replicaSet: c?.replicaSet ?? false, extImage: c?.extImage ?? false, initialized: c?.initialized ?? false,
        seed: c?.seed ? { from: c.seed.from, status: c.seed.status, detail: c.seed.detail ?? "" } : null },
      users: users.filter((u) => u.dbId === id).map((u) => ({ id: u.id, username: u.username, grants: u.grants, at: faDateTime(u.createdAt) })),
      databases: dbs.filter((x) => x.dbId === id).map((x) => ({ id: x.id, name: x.name, at: faDateTime(x.createdAt) })),
      panels: panels.filter((p) => p.dbId === id && p.status !== "expired").slice(0, 10).map((p) => ({ id: p.id, tool: p.tool, url: "https://" + p.host + "/", username: p.username, status: p.status, expiresAt: faDateTime(p.expiresAt), minutesLeft: Math.max(0, Math.round((p.expiresAt.getTime() - Date.now()) / 60_000)) })),
      imports: imports.filter((x) => x.dbId === id).slice(0, 10).map((x) => ({ id: x.id, format: x.format, status: x.status, output: x.output.slice(-4000), sizeMb: Math.round(x.sizeBytes / 104857.6) / 10, at: faDateTime(x.createdAt) })),
      events: events.filter((e) => e.dbId === id && e.createdAt >= since).slice(0, 40).map((e) => ({ id: e.id, level: e.level, message: e.message, at: faDateTime(e.createdAt) })),
    });
  }
  return out;
}
