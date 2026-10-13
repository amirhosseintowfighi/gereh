/* Live web console sessions. A session lives in the server process that opened it (the panel reads
   its output over SSE and sends keystrokes with RPC calls to the same process; behind several
   replicas, route /api/paas/console and /api/rpc/paas.console* with sticky sessions). Output is kept
   in a small ring so a reconnecting viewer catches up. Every session is recorded in
   paas_console_sessions when it opens and when it ends. */
import "server-only";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { paasConsoleSessions } from "../db/schema";
import type { PodShell } from "./exec";

export const IDLE_MS = 15 * 60_000;
export const MAX_SESSION_MS = 2 * 3600_000;
const RING = 256 * 1024;

export type Session = {
  id: string; appId: string; owner: string; userId: string;
  shell: PodShell; chunks: { seq: number; data: string }[]; seq: number; bytes: number;
  listeners: Set<(c: { seq: number; data: string } | null) => void>;
  closed: boolean; exitCode: number | null; startedAt: number; lastInput: number; timer: ReturnType<typeof setInterval>;
};
const g = globalThis as unknown as { __gerehConsoles?: Map<string, Session> };
export const sessions: Map<string, Session> = (g.__gerehConsoles ??= new Map());

export function startSession(db: DB, s: Omit<Session, "chunks" | "seq" | "bytes" | "listeners" | "closed" | "exitCode" | "startedAt" | "lastInput" | "timer">) {
  const sess: Session = { ...s, chunks: [], seq: 0, bytes: 0, listeners: new Set(), closed: false, exitCode: null, startedAt: Date.now(), lastInput: Date.now(), timer: setInterval(() => {
    if (Date.now() - sess.lastInput > IDLE_MS || Date.now() - sess.startedAt > MAX_SESSION_MS) { push(sess, "\r\n[session closed: idle or time limit]\r\n"); sess.shell.close(); }
  }, 30_000) };
  sess.timer.unref?.();
  sessions.set(sess.id, sess);
  sess.shell.onData((b) => push(sess, b.toString("utf8")));
  sess.shell.onExit((code) => {
    if (sess.closed) return;
    sess.closed = true;
    sess.exitCode = code;
    clearInterval(sess.timer);
    for (const l of sess.listeners) l(null);
    void db.update(paasConsoleSessions).set({ endedAt: new Date(), exitCode: code }).where(eq(paasConsoleSessions.id, sess.id)).catch(() => undefined);
    // keep the tail readable for a minute
    setTimeout(() => sessions.delete(sess.id), 60_000).unref?.();
  });
  return sess;
}
function push(s: Session, data: string) {
  const c = { seq: ++s.seq, data };
  s.chunks.push(c);
  s.bytes += data.length;
  while (s.bytes > RING && s.chunks.length > 1) s.bytes -= s.chunks.shift()!.data.length;
  for (const l of s.listeners) l(c);
}
/** the session if it belongs to this account */
export const sessionOf = (id: string, owner: string) => { const s = sessions.get(id); return s && s.owner === owner ? s : null; };
export const openCount = (appId: string) => [...sessions.values()].filter((s) => s.appId === appId && !s.closed).length;
