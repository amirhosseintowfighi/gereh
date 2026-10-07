import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB, Tx } from "./db/client";
import { activity, audit, counters, notifications, serverTasks } from "./db/schema";

/** user-facing error: the message is shown in the UI as-is */
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const fail = (message: string, status = 400): never => { throw new AppError(message, status); };

export const rid = (prefix: string) => prefix + "-" + randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8).toLowerCase();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomSecret = (n: number, abc: string) => Array.from({ length: n }, () => abc[randomInt(abc.length)]).join("");
export const genPassword = () => randomSecret(16, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%");

/** next human id: INV-14231 … (atomic upsert; floor is the value before the first id) */
export async function nextId(db: DB | Tx, name: string, floor: number) {
  const [row] = await db.insert(counters).values({ name, value: floor + 1 })
    .onConflictDoUpdate({ target: counters.name, set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return name + "-" + row.value;
}

export const logActivity = (db: DB | Tx, userId: string, icon: string, text: string, ip = "") =>
  db.insert(activity).values({ id: rid("a"), userId, icon, text, ip });
export const logAudit = (db: DB | Tx, actor: string, action: string, target: string, ip = "") =>
  db.insert(audit).values({ id: rid("au"), actor, action, target, ip });
export const notify = (db: DB | Tx, userId: string, icon: string, text: string) =>
  db.insert(notifications).values({ id: rid("n"), userId, icon, text });
export const addTask = (db: DB | Tx, serverId: string, action: string, status: "done" | "running" | "failed" = "done", progress = 100) =>
  db.insert(serverTasks).values({ id: rid("t"), serverId, action, status, progress });
