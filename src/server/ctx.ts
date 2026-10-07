import "server-only";
import { count } from "drizzle-orm";
import { headers } from "next/headers";
import type { z } from "zod";
import type { StaffRole } from "@/lib/types";
import { readAuth, type Auth } from "./auth";
import { getDb, type DB } from "./db/client";
import { kv } from "./db/schema";
import { seed } from "./seed";
import { AppError } from "./util";

export type Ctx = { db: DB; auth: Auth | null; ip: string; device: string };

let booted: Promise<void> | null = null;
/** first request on an empty database seeds it (demo data unless NODE_ENV=production and SEED_DEMO≠1) */
export async function db(): Promise<DB> {
  const d = await getDb();
  booted ??= (async () => {
    const [{ n }] = await d.select({ n: count() }).from(kv);
    if (n === 0) {
      const demo = process.env.SEED_DEMO ? process.env.SEED_DEMO === "1" : process.env.NODE_ENV !== "production";
      await seed(d, { demo, adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD });
    }
  })().catch((e) => { booted = null; throw e; });
  await booted;
  return d;
}
export const resetBoot = () => { booted = null; };

const device = (ua: string) => {
  const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "مرورگر";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? b + "، " + os : b;
};

export async function context(): Promise<Ctx> {
  const h = await headers();
  const d = await db();
  // behind a reverse proxy set TRUST_PROXY=1 so the first X-Forwarded-For hop is the client
  const ip = (process.env.TRUST_PROXY === "1" ? h.get("x-forwarded-for")?.split(",")[0]?.trim() : h.get("x-real-ip")) || "";
  return { db: d, auth: await readAuth(d), ip, device: device(h.get("user-agent") || "") };
}

export function needUser(ctx: Ctx): Auth {
  if (!ctx.auth) throw new AppError("برای ادامه وارد حساب شوید.", 401);
  return ctx.auth;
}

export type Area = "users" | "services" | "billing" | "tickets" | "products" | "coupons" | "announcements" | "infra" | "virtualizor" | "settings" | "staff" | "reports" | "content" | "devops";
const PERMS: Record<StaffRole, Area[] | "*"> = {
  owner: "*",
  support: ["tickets", "services", "users"],
  finance: ["billing", "coupons", "users", "reports"],
  sales: ["products", "coupons", "announcements", "tickets", "reports", "content", "devops"],
  viewer: [],
};
export const can = (role: StaffRole | null | undefined, area: Area) => { const p = PERMS[role || "viewer"]; return p === "*" || p.includes(area); };

/** staff with permission for `area` (viewer may read state but never mutate) */
export function needStaff(ctx: Ctx, area: Area): Auth {
  const a = needUser(ctx);
  if (a.user.role !== "admin") throw new AppError("اجازه این کار را ندارید.", 403);
  if (!can(a.user.staffRole, area)) throw new AppError("نقش شما اجازه این کار را ندارد.", 403);
  return a;
}
export const isStaff = (ctx: Ctx, area: Area) => !!ctx.auth && ctx.auth.user.role === "admin" && can(ctx.auth.user.staffRole, area);

/** label for audit entries: the staff member, plus the customer while impersonating */
export const actor = (ctx: Ctx) => ctx.auth ? ctx.auth.user.name + (ctx.auth.uid !== ctx.auth.user.id ? " (به‌جای " + ctx.auth.uid + ")" : "") : "سیستم";

/** what a team member may do inside the owner's account (enforced for every RPC call) */
const MEMBER_SELF = ["team.switch", "team.leave", "team.accept", "account.readAll", "account.readOne"];
const TEAM_POLICY: Record<"admin" | "tech" | "billing", { groups: string[]; allow: string[]; deny: string[] }> = {
  admin: { groups: ["auth", "servers", "hosting", "domains", "billing", "tickets", "contact", "devops", "paas"], allow: [...MEMBER_SELF, "account.addKey", "account.removeKey", "account.createToken", "account.revokeToken", "account.setNotif"], deny: [] },
  tech: { groups: ["auth", "servers", "hosting", "domains", "tickets", "contact", "devops", "paas"], allow: [...MEMBER_SELF, "account.addKey", "account.removeKey"], deny: ["domains.renew", "hosting.renew"] },
  billing: { groups: ["auth", "billing", "tickets", "contact"], allow: [...MEMBER_SELF, "domains.renew", "hosting.renew"], deny: [] },
};
export function teamAllows(role: "admin" | "tech" | "billing" | undefined, methodName: string) {
  if (!role) return true;
  const p = TEAM_POLICY[role];
  if (p.deny.includes(methodName)) return false;
  return p.allow.includes(methodName) || p.groups.includes(methodName.split(".")[0]);
}

export type Method<A extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> = { args: A; run: (ctx: Ctx, args: z.infer<A>) => Promise<R> };
export const method = <A extends z.ZodTypeAny, R>(args: A, run: (ctx: Ctx, args: z.infer<A>) => Promise<R>): Method<A, R> => ({ args, run });
