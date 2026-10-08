/* Inquiry API core: accounts, the metered call path and settlement.
   Billing: a billable request (a definitive answer: found or not found) reserves its price from the
   wallet before the upstream call and is refunded if the upstream fails; input errors are free.
   Every few minutes the charged calls are summed into one "usage" transaction per customer. */
import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { checkInputs, inquiryDef, INQUIRY_SERVICES } from "@/lib/inquiry";
import type { DB, Tx } from "../db/client";
import { inquiryAccounts, inquiryCalls, inquiryGrants, inquiryServices, transactions, users } from "../db/schema";
import { open, seal } from "../secrets";
import { fa, toman } from "@/lib/format";
import { nextId, rid, sha256 } from "../util";
import { inquiryProvider, simProvider } from "./provider";

export const seedInquiry = (db: DB | Tx) =>
  db.insert(inquiryServices).values(INQUIRY_SERVICES.map((s, i) => ({ id: s.id, name: s.name, price: s.price, approval: s.approval, position: i }))).onConflictDoNothing();

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const token = (n: number) => [...randomBytes(n)].map((b) => ALNUM[b % ALNUM.length]).join("");

export async function createAccount(db: DB | Tx, userId: string) {
  const secret = token(24);
  const no = Number((await nextId(db, "inquiry", 512000)).split("-")[1]);
  await db.insert(inquiryAccounts).values({ userId, accountNo: no, apiKey: token(16), secretEnc: seal(secret), secretHash: sha256(secret) }).onConflictDoNothing();
}
export async function rotateSecret(db: DB | Tx, userId: string) {
  const secret = token(24);
  await db.update(inquiryAccounts).set({ secretEnc: seal(secret), secretHash: sha256(secret) }).where(eq(inquiryAccounts.userId, userId));
}
export const revealSecret = (enc: string) => open(enc) ?? "";

/** API credentials → account (constant-time secret check) */
export async function authenticate(db: DB, apiKey: string, secret: string) {
  if (!/^[A-Za-z0-9]{16}$/.test(apiKey) || !secret || secret.length > 100) return null;
  const [row] = await db.select({ a: inquiryAccounts, status: users.status }).from(inquiryAccounts).innerJoin(users, eq(users.id, inquiryAccounts.userId)).where(eq(inquiryAccounts.apiKey, apiKey));
  if (!row) return null;
  const a = Buffer.from(sha256(secret)), b = Buffer.from(row.a.secretHash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { ...row.a, userStatus: row.status };
}

/** IPv4/IPv6 exact match or IPv4 CIDR */
export function ipAllowed(list: string[], ip: string) {
  if (!list.length) return true;
  const v4 = (s: string) => s.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  return list.some((rule) => {
    if (!rule.includes("/")) return rule === ip;
    const [base, bits] = rule.split("/");
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
    const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (v4(ip) & mask) === (v4(base) & mask);
  });
}

export type CallOutcome = { http: number; body: Record<string, unknown> };
const err = (http: number, code: string, message: string, extra: Record<string, unknown> = {}): CallOutcome => ({ http, body: { ok: false, error: { code, message, ...extra } } });

/** one inquiry, end to end; used by the HTTP API and the panel playground */
export async function runInquiry(db: DB, o: { userId: string; serviceId: string; body: Record<string, unknown>; sandbox: boolean; source: "api" | "panel"; ip: string }): Promise<CallOutcome> {
  const [svc] = await db.select().from(inquiryServices).where(eq(inquiryServices.id, o.serviceId));
  const def = inquiryDef(o.serviceId);
  if (!svc || !def || !svc.active) return err(404, "unknown_service", "سرویس «" + o.serviceId + "» وجود ندارد یا غیرفعال است.");
  if (svc.approval) {
    const [g] = await db.select().from(inquiryGrants).where(and(eq(inquiryGrants.userId, o.userId), eq(inquiryGrants.serviceId, svc.id)));
    if (g?.status !== "approved") return err(403, "access_required", "این سرویس نیاز به تأیید دسترسی دارد؛ از پنل درخواست فعال‌سازی بدهید.", { access: g?.status ?? "none" });
  }
  const trackId = "INQ-" + Date.now().toString(36).toUpperCase() + token(4).toUpperCase();
  const log = (status: typeof inquiryCalls.$inferInsert.status, charged: number, latencyMs: number, input: string) =>
    db.insert(inquiryCalls).values({ id: trackId, userId: o.userId, serviceId: svc.id, status, charged, latencyMs, sandbox: o.sandbox, source: o.source, input, ip: o.ip, billed: charged === 0 });
  const checked = checkInputs(def, o.body);
  if ("errors" in checked) {
    await log("invalid", 0, 0, "");
    return err(400, "invalid_input", "ورودی نامعتبر است؛ این درخواست هزینه‌ای ندارد.", { fields: checked.errors, trackId });
  }
  const t0 = Date.now();
  if (o.sandbox) {
    const r = await simProvider.call(svc.id, "", checked.values);
    await log(r.status === "error" ? "error" : r.status, 0, Date.now() - t0, checked.masked);
    if (r.status === "error") return err(502, "upstream_error", "سرویس‌دهنده پاسخ نداد (sandbox).", { trackId });
    return { http: 200, body: { ok: true, sandbox: true, trackId, service: svc.id, status: r.status, result: r.result, charged: 0 } };
  }
  // reserve the price; refunded below if the upstream fails
  const [u] = await db.update(users).set({ balance: sql`${users.balance} - ${svc.price}` }).where(and(eq(users.id, o.userId), sql`${users.balance} >= ${svc.price}`)).returning({ balance: users.balance });
  if (!u) {
    await log("denied", 0, 0, checked.masked);
    return err(402, "insufficient_balance", "موجودی کیف پول کافی نیست؛ هزینه هر درخواست " + toman(svc.price) + " است.", { trackId, price: svc.price });
  }
  const r = await inquiryProvider().call(svc.id, svc.upstream, checked.values);
  const ms = Date.now() - t0;
  if (r.status === "error") {
    await db.update(users).set({ balance: sql`${users.balance} + ${svc.price}` }).where(eq(users.id, o.userId));
    await log("error", 0, ms, checked.masked);
    return err(502, "upstream_error", "سرویس‌دهنده در دسترس نبود؛ مبلغ کسر نشد. چند لحظه بعد دوباره تلاش کنید.", { trackId });
  }
  await log(r.status, svc.price, ms, checked.masked);
  return { http: 200, body: { ok: true, trackId, service: svc.id, status: r.status, result: r.result, charged: svc.price, balance: u.balance } };
}

/** charged calls → one wallet transaction per customer (balances were already debited per call) */
export async function settleInquiry(db: DB) {
  const rows = await db.select({ userId: inquiryCalls.userId, total: sql<number>`sum(${inquiryCalls.charged})::bigint`, n: sql<number>`count(*)::int`, ids: sql<string[]>`array_agg(${inquiryCalls.id})` })
    .from(inquiryCalls).where(eq(inquiryCalls.billed, false)).groupBy(inquiryCalls.userId);
  for (const r of rows) {
    await db.transaction(async (tx) => {
      await tx.update(inquiryCalls).set({ billed: true }).where(inArray(inquiryCalls.id, r.ids));
      if (Number(r.total) > 0) await tx.insert(transactions).values({ id: rid("TX"), userId: r.userId, type: "usage", amount: -Number(r.total), method: "کیف پول", desc: "API استعلام: " + fa(r.n) + " درخواست" });
    });
  }
}
