/* Power actions with confirmation. The site never writes the result of a start/stop/restart itself: it sends the
   action, records it as pending (vps_power) and a short job (virt.power) reads the live state until it matches.
   While an action is pending, neither the usage poll nor the sync may write a power state, so a poll that reads
   "off" while the VPS is still booting cannot revert it. Root cause of the old flip-flop: the start call wrote
   "running" optimistically and the next 5-minute poll wrote back whatever an unanswered status read defaulted to
   ("stopped"), see ./virtualizor.ts status(). */
import "server-only";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { DB } from "../db/client";
import { serverTasks, servers, vpsPower } from "../db/schema";
import { enqueue } from "../jobs";
import { addTask, notify } from "../util";
import { virt, type PowerAction, type PowerState } from "./driver";

type Server = typeof servers.$inferSelect;
export const POWER_TARGET: Record<PowerAction, "running" | "stopped"> = { start: "running", restart: "running", stop: "stopped", poweroff: "stopped" };
export const POWER_LABEL: Record<PowerAction, string> = { start: "روشن کردن", stop: "خاموش کردن", restart: "ری‌استارت", poweroff: "قطع برق" };
/** how often and how long the result is checked: every 5 s for the first minute, then every 15 s, ~4 minutes in all */
const MAX_CHECKS = 24;
const delay = (checks: number) => (checks < 12 ? 5_000 : 15_000);
/** a pending action older than this no longer protects the power state (a lost job must not freeze it) */
export const PENDING_TTL_MS = 10 * 60_000;

export async function pendingPower(db: DB, ids: string[]) {
  if (!ids.length) return new Map<string, typeof vpsPower.$inferSelect>();
  const rows = await db.select().from(vpsPower).where(inArray(vpsPower.serverId, ids));
  const fresh = rows.filter((r) => Date.now() - r.requestedAt.getTime() < PENDING_TTL_MS);
  return new Map(fresh.map((r) => [r.serverId, r]));
}

/** sends the action to the hypervisor and starts confirming it */
export async function requestPower(db: DB, s: Server, action: PowerAction) {
  await (await virt()).power(s.vpsid!, action);
  const row = { action, target: POWER_TARGET[action], checks: 0, requestedAt: new Date() };
  await db.insert(vpsPower).values({ serverId: s.id, ...row }).onConflictDoUpdate({ target: vpsPower.serverId, set: row });
  await addTask(db, s.id, POWER_LABEL[action], "running", 10);
  await enqueue(db, "virt.power", { serverId: s.id, n: 0 }, { runAt: new Date(Date.now() + delay(0)), dedupe: "virt.power:" + s.id + ":0:" + row.requestedAt.getTime() });
}

/** the job: one live read; confirmed → the state is written; still in transition → checked again; out of time →
    whatever the hypervisor says now is written (or the state is left as it was when it says nothing) */
export async function confirmPower(db: DB, p: { serverId: string; quick?: boolean }) {
  const [row] = await db.select().from(vpsPower).where(eq(vpsPower.serverId, p.serverId));
  if (!row) return "none";
  const [s] = await db.select().from(servers).where(eq(servers.id, p.serverId));
  if (!s?.vpsid) { await db.delete(vpsPower).where(eq(vpsPower.serverId, p.serverId)); return "none"; }
  let live: PowerState | null = null;
  try { live = await (await virt()).powerState(s.vpsid); } catch { live = null; }
  const label = POWER_LABEL[row.action as PowerAction] ?? row.action;
  if (live === row.target || live === "suspended") {
    await settle(db, s, live);
    await addTask(db, s.id, live === "suspended" ? label + ": سرور در Virtualizor معلق است" : label + " تأیید شد");
    return "confirmed";
  }
  // the read right after the request: nothing more to do when it is not there yet (the job keeps checking)
  if (p.quick) return "waiting";
  const checks = row.checks + 1;
  if (checks >= MAX_CHECKS) {
    if (live) await settle(db, s, live, false);
    else {
      await db.delete(vpsPower).where(eq(vpsPower.serverId, s.id));
      await db.update(serverTasks).set({ status: "failed", progress: 100 }).where(and(eq(serverTasks.serverId, s.id), eq(serverTasks.action, label), eq(serverTasks.status, "running")));
    }
    await addTask(db, s.id, label + ": وضعیت پس از چند دقیقه تأیید نشد" + (live ? " (اکنون " + (live === "running" ? "روشن" : "خاموش") + ")" : ""), "failed", 100);
    await notify(db, s.userId, "circle-alert", label + " سرور " + s.name + " تأیید نشد؛ وضعیت فعلی را بررسی کنید یا تیکت ثبت کنید");
    return "timeout";
  }
  await db.update(vpsPower).set({ checks }).where(and(eq(vpsPower.serverId, s.id), eq(vpsPower.requestedAt, row.requestedAt)));
  await enqueue(db, "virt.power", { serverId: s.id, n: checks }, { runAt: new Date(Date.now() + delay(checks)), dedupe: "virt.power:" + s.id + ":" + checks + ":" + row.requestedAt.getTime() });
  return "waiting";
}

async function settle(db: DB, s: Server, live: PowerState, ok = true) {
  const [row] = await db.delete(vpsPower).where(eq(vpsPower.serverId, s.id)).returning();
  // the request's "running" task line is closed
  if (row) await db.update(serverTasks).set({ status: ok && live === row.target ? "done" : "failed", progress: 100 })
    .where(and(eq(serverTasks.serverId, s.id), eq(serverTasks.action, POWER_LABEL[row.action as PowerAction] ?? row.action), eq(serverTasks.status, "running")));
  if (s.status !== live && ["running", "stopped", "suspended"].includes(s.status)) await db.update(servers).set({ status: live }).where(eq(servers.id, s.id));
}

/** a poll that reads the target state confirms the pending action early */
export async function confirmFromPoll(db: DB, s: Server, live: PowerState, pending: typeof vpsPower.$inferSelect) {
  if (live !== pending.target) return false;
  await settle(db, s, live);
  await addTask(db, s.id, (POWER_LABEL[pending.action as PowerAction] ?? pending.action) + " تأیید شد");
  return true;
}

export const purgePower = (db: DB) => db.delete(vpsPower).where(lt(vpsPower.requestedAt, new Date(Date.now() - PENDING_TTL_MS)));
