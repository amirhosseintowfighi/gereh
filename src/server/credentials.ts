/* One-time password display: every root (or rescue) password the site generates or sets on a cloud server is also
   kept here, sealed, so the owner can see it once in the panel besides the email. It never enters buildState or any
   cached/broadcast view: only servers.revealCredential returns it. «ذخیره کردم» clears the ciphertext, and so does
   expiry (CRED_TTL_DAYS); a newer password of the same kind replaces the pending one. */
import "server-only";
import { and, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import type { DB, Tx } from "./db/client";
import { serverCredentials, servers } from "./db/schema";
import { seal } from "./secrets";

export const CRED_TTL_DAYS = 7;
export type CredKind = "root" | "rescue";

export async function stashCredential(db: DB | Tx, p: { serverId: string; userId: string; kind?: CredKind; password: string; username?: string }) {
  if (!p.password) return;
  const now = new Date(), kind = p.kind ?? "root";
  const v = { passEnc: seal(p.password), username: p.username ?? "root", createdAt: now, expiresAt: new Date(now.getTime() + CRED_TTL_DAYS * 86400_000), revealedAt: null, acknowledgedAt: null };
  await db.insert(serverCredentials).values({ serverId: p.serverId, userId: p.userId, kind, ...v })
    .onConflictDoUpdate({ target: [serverCredentials.serverId, serverCredentials.kind], set: { userId: p.userId, ...v } });
}

/** a password that no longer applies (rescue turned off) */
export async function dropCredential(db: DB | Tx, serverId: string, kind: CredKind) {
  await db.update(serverCredentials).set({ passEnc: null }).where(and(eq(serverCredentials.serverId, serverId), eq(serverCredentials.kind, kind)));
}

const live = () => and(isNotNull(serverCredentials.passEnc), isNull(serverCredentials.acknowledgedAt), gt(serverCredentials.expiresAt, new Date()));

/** the owner's pending credentials, without the password */
export async function pendingCredentials(db: DB, userId: string, serverId?: string) {
  return db.select({ serverId: serverCredentials.serverId, kind: serverCredentials.kind, username: serverCredentials.username, createdAt: serverCredentials.createdAt, expiresAt: serverCredentials.expiresAt, revealed: serverCredentials.revealedAt, name: servers.name, ip: servers.ip })
    .from(serverCredentials).innerJoin(servers, eq(servers.id, serverCredentials.serverId))
    .where(and(eq(serverCredentials.userId, userId), eq(servers.userId, userId), live(), ...(serverId ? [eq(serverCredentials.serverId, serverId)] : [])));
}

export async function pendingRow(db: DB, serverId: string, kind: CredKind) {
  const [r] = await db.select().from(serverCredentials).where(and(eq(serverCredentials.serverId, serverId), eq(serverCredentials.kind, kind), live()));
  return r as typeof r | undefined;
}

/** daily: expired ciphertexts are cleared */
export async function purgeCredentials(db: DB) {
  await db.update(serverCredentials).set({ passEnc: null }).where(and(isNotNull(serverCredentials.passEnc), lt(serverCredentials.expiresAt, new Date())));
}
