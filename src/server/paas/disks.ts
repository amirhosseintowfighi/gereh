/* Named disks and SFTP accounts of an app. paas_apps.disk_gb is kept as the total of its disks (so
   billing, credit checks and the stopped-app disk charge stay unchanged) and disk_mount as the "data"
   disk's path. An app with disk_gb > 0 and no disk rows (created before disks or through the old
   single-disk inputs) has one implicit "data" disk; ensureDisks() writes it out before any change. */
import "server-only";
import { generateKeyPairSync } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import type { DB, Tx } from "../db/client";
import { paasAppTools, paasApps, paasDisks, paasSftpUsers } from "../db/schema";
import { open, seal } from "../secrets";
import { rid } from "../util";
import type { AppSpec } from "./driver";

export type DiskRow = typeof paasDisks.$inferSelect;
type AppLike = Pick<typeof paasApps.$inferSelect, "id" | "diskGb" | "diskMount">;

/** the app's disks, the implicit "data" disk included (id "" until written) */
export async function appDisks(db: DB | Tx, app: AppLike): Promise<DiskRow[]> {
  const rows = await db.select().from(paasDisks).where(eq(paasDisks.appId, app.id)).orderBy(asc(paasDisks.createdAt), asc(paasDisks.name));
  if (rows.length || app.diskGb <= 0) return rows;
  return [{ id: "", appId: app.id, name: "data", mountPath: app.diskMount || "/data", sizeGb: app.diskGb, backups: true, createdAt: new Date(0) }];
}
/** writes the implicit disk out so it can be changed, backed up or shared */
export async function ensureDisks(db: DB | Tx, app: AppLike): Promise<DiskRow[]> {
  const list = await appDisks(db, app);
  if (list.length === 1 && !list[0].id) {
    const [row] = await db.insert(paasDisks).values({ id: rid("dsk"), appId: app.id, name: "data", mountPath: list[0].mountPath, sizeGb: list[0].sizeGb }).onConflictDoNothing().returning();
    return row ? [row] : db.select().from(paasDisks).where(eq(paasDisks.appId, app.id));
  }
  return list;
}
/** disk_gb = total, disk_mount = the "data" disk (or the first) */
export async function syncDiskTotals(db: DB | Tx, appId: string) {
  const rows = await db.select().from(paasDisks).where(eq(paasDisks.appId, appId)).orderBy(asc(paasDisks.createdAt));
  const main = rows.find((d) => d.name === "data") ?? rows[0];
  const [next] = await db.update(paasApps).set({ diskGb: rows.reduce((s, d) => s + d.sizeGb, 0), ...(main ? { diskMount: main.mountPath } : {}) }).where(eq(paasApps.id, appId)).returning();
  return next;
}
/** paas.scale grew the total: the "data" disk takes the difference */
export async function growFromScale(db: DB | Tx, app: AppLike, before: number) {
  const rows = await db.select().from(paasDisks).where(eq(paasDisks.appId, app.id));
  if (!rows.length || app.diskGb <= before) return;
  const data = rows.find((d) => d.name === "data");
  if (data) await db.update(paasDisks).set({ sizeGb: data.sizeGb + app.diskGb - before }).where(eq(paasDisks.id, data.id));
  else await db.insert(paasDisks).values({ id: rid("dsk"), appId: app.id, name: "data", mountPath: rows.some((d) => d.mountPath === "/data") ? "/data-main" : "/data", sizeGb: app.diskGb - before });
  await syncDiskTotals(db, app.id);
}
/** copies the disk layout (not the data) to a cloned app */
export async function copyDisks(db: DB | Tx, from: AppLike, toAppId: string) {
  const rows = (await appDisks(db, from));
  if (rows.length) await db.insert(paasDisks).values(rows.map((d) => ({ id: rid("dsk"), appId: toAppId, name: d.name, mountPath: d.mountPath, sizeGb: d.sizeGb, backups: d.backups })));
}

/** a stable SSH host key for the app's SFTP sidecar (RSA PEM; every sshd reads it) */
export async function sftpHostKey(db: DB | Tx, appId: string) {
  const [row] = await db.select().from(paasAppTools).where(eq(paasAppTools.appId, appId));
  const have = open(row?.sftpHostKey);
  if (have) return have;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  await db.insert(paasAppTools).values({ appId, sftpHostKey: seal(privateKey) }).onConflictDoUpdate({ target: paasAppTools.appId, set: { sftpHostKey: seal(privateKey) } });
  return privateKey;
}

/** the driver's view: named disks and SFTP accounts (folded into appSpec) */
export async function toolsSpec(db: DB | Tx, app: AppLike): Promise<Pick<AppSpec, "disks" | "sftp">> {
  const rows = await db.select().from(paasDisks).where(eq(paasDisks.appId, app.id)).orderBy(asc(paasDisks.createdAt));
  if (!rows.length) return {};
  const users = await db.select().from(paasSftpUsers).where(inArray(paasSftpUsers.diskId, rows.map((d) => d.id))).orderBy(asc(paasSftpUsers.createdAt));
  const name = new Map(rows.map((d) => [d.id, d.name]));
  const [tools] = users.length ? await db.select().from(paasAppTools).where(eq(paasAppTools.appId, app.id)) : [];
  return {
    disks: rows.map((d) => ({ name: d.name, mount: d.mountPath, sizeGb: d.sizeGb })),
    ...(users.length ? { sftp: { users: users.map((u) => ({ name: u.username, password: open(u.passwordEnc) ?? "", access: u.access, disk: name.get(u.diskId)! })), hostKey: open(tools?.sftpHostKey) ?? "" } } : {}),
  };
}
