/* Account extras: 2FA recovery codes, Web Push delivery (VAPID, payload-less: the service worker
   fetches the newest notification itself) and custom team roles layered on the fixed ones. */
import "server-only";
import { createPrivateKey, randomInt, sign } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { levelAllows, methodLevel, TEAM_SERVICES, type PermLevel } from "@/lib/vps-billing";
import type { Auth } from "./auth";
import type { DB, Tx } from "./db/client";
import { pushSubscriptions, recoveryCodes, teamMemberRoles, teamMembers, teamRoles } from "./db/schema";
import { outbox } from "./messaging";
import { sha256 } from "./util";

/* ---------- recovery codes ---------- */
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_RE = /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/;
const norm = (code: string) => code.trim().toUpperCase().replace(/-/g, "");

/** replaces the user's codes with 10 new ones; the plain codes are returned once */
export async function newRecoveryCodes(db: DB | Tx, userId: string) {
  const codes = Array.from({ length: 10 }, () => { const c = Array.from({ length: 8 }, () => ABC[randomInt(ABC.length)]).join(""); return c.slice(0, 4) + "-" + c.slice(4); });
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256("rc:" + norm(c)) })));
  return codes;
}
/** consumes a recovery code; true when it was valid and unused */
export async function redeemRecoveryCode(db: DB | Tx, userId: string, code: string) {
  if (!RECOVERY_RE.test(code.trim().toUpperCase())) return false;
  const r = await db.update(recoveryCodes).set({ usedAt: new Date() }).where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, sha256("rc:" + norm(code))), isNull(recoveryCodes.usedAt))).returning({ id: recoveryCodes.id });
  return r.length > 0;
}

/* ---------- Web Push ---------- */
/** only the browsers' push services: a subscription endpoint must never point anywhere else */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/];
export function pushEndpointOk(raw: string) {
  try { const u = new URL(raw); return u.protocol === "https:" && !u.port && !u.username && PUSH_HOSTS.some((re) => re.test(u.hostname)); } catch { return false; }
}
export const vapidPublic = () => process.env.VAPID_PUBLIC_KEY || "";
const b64u = (b: Buffer) => b.toString("base64url");

/** VAPID JWT (ES256) for one push service origin */
export function vapidJwt(aud: string, now = Math.floor(Date.now() / 1000)) {
  const pub = Buffer.from(vapidPublic(), "base64url");
  const d = process.env.VAPID_PRIVATE_KEY || "";
  if (pub.length !== 65 || !d) return null;
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" });
  const head = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(Buffer.from(JSON.stringify({ aud, exp: now + 12 * 3600, sub: process.env.VAPID_SUBJECT || "mailto:hello@gereh.net" })));
  const sig = sign("sha256", Buffer.from(head + "." + body), { key, dsaEncoding: "ieee-p1363" });
  return head + "." + body + "." + b64u(sig);
}

/** wakes every browser the user subscribed; dead subscriptions (404/410) are dropped */
export async function pushSend(db: DB, userId: string, subject: string) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  for (const s of subs) {
    if (!pushEndpointOk(s.endpoint)) continue;
    const jwt = vapidJwt(new URL(s.endpoint).origin);
    if (!jwt) { outbox.unshift({ channel: "push" as never, to: s.endpoint, text: subject, at: Date.now() }); continue; }
    try {
      const res = await fetch(s.endpoint, { method: "POST", redirect: "manual", headers: { authorization: "vapid t=" + jwt + ", k=" + vapidPublic(), ttl: "86400", urgency: "normal" }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 404 || res.status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    } catch { /* push is best effort */ }
  }
}

/* ---------- custom team roles ---------- */
export async function memberPerms(db: DB, ownerId: string, memberId: string): Promise<Record<string, PermLevel> | null> {
  const [r] = await db.select({ perms: teamRoles.perms }).from(teamMembers)
    .innerJoin(teamMemberRoles, eq(teamMemberRoles.memberRowId, teamMembers.id))
    .innerJoin(teamRoles, eq(teamRoles.id, teamMemberRoles.roleId))
    .where(and(eq(teamMembers.ownerId, ownerId), eq(teamMembers.memberId, memberId)));
  return r?.perms ?? null;
}
/** a member with a custom role may call a service method only at or below the role's level for that service
    (the fixed base role is checked first by teamAllows) */
export async function customAllows(db: DB, auth: Auth | null, method: string) {
  if (!auth?.teamRole) return true;
  const group = method.split(".")[0];
  if (!(group in TEAM_SERVICES)) return true;
  const perms = await memberPerms(db, auth.uid, auth.user.id);
  if (!perms) return true;
  return levelAllows(perms[group], methodLevel(method));
}
/** the fixed role that carries a custom role: billing-only, technical-only or both */
export function baseRole(perms: Record<string, PermLevel>): "admin" | "tech" | "billing" {
  const billing = levelAllows(perms.billing, "view");
  const tech = Object.entries(perms).some(([k, v]) => k !== "billing" && k !== "tickets" && levelAllows(v, "view"));
  return billing && tech ? "admin" : billing ? "billing" : "tech";
}
