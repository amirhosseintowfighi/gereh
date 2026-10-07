/* One Drizzle instance per process.
   DATABASE_URL=postgres://… → PostgreSQL via postgres-js (production).
   Otherwise → embedded PGlite (WASM Postgres): PGLITE_DIR on disk for `npm run dev`, in-memory for tests.
   Migrations in /drizzle run once on first use. */
import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import path from "node:path";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export { schema };

const MIGRATIONS = path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle");

async function open(): Promise<{ db: DB; close: () => Promise<void> }> {
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const sql = postgres(url, { max: Number(process.env.DATABASE_POOL || 10), onnotice: () => {} });
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as DB, close: () => sql.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(process.env.PGLITE_DIR || undefined);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as DB, close: () => client.close() };
}

type Holder = { ready?: Promise<{ db: DB; close: () => Promise<void> }> };
const g = globalThis as typeof globalThis & { __gerehDb?: Holder };
const holder: Holder = (g.__gerehDb ??= {});

/** the process-wide database (opened and migrated lazily) */
export async function getDb(): Promise<DB> {
  holder.ready ??= open().catch((e) => { holder.ready = undefined; throw e; });
  return (await holder.ready).db;
}

/** e2e reset: switch to a brand-new database at once; the old one closes after in-flight requests finish */
export async function swapDb() {
  const old = holder.ready;
  holder.ready = open().catch((e) => { holder.ready = undefined; throw e; });
  await holder.ready;
  if (old) setTimeout(() => { old.then((o) => o.close()).catch(() => {}); }, 10_000).unref?.();
}

/** tests: drop the connection so the next getDb() starts from an empty database */
export async function closeDb() {
  const h = holder.ready;
  holder.ready = undefined;
  if (h) await (await h).close();
}
