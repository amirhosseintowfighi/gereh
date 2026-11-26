/* The small-business packages as staff set them (kv "business"); BIZ_DEFAULTS until the first save. */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BIZ_DEFAULTS, type BizPackage } from "@/lib/business";
import type { DB } from "./db/client";
import { kv } from "./db/schema";

const money = z.number().int().min(0).max(100_000_000_000);
export const BIZ_PACKAGE = z.object({
  id: z.string().regex(/^biz-[a-z0-9-]{1,30}$/, "شناسه بسته معتبر نیست."),
  name: z.string().trim().min(2, "نام بسته را بنویسید.").max(40),
  for: z.string().trim().max(200),
  setup: money, monthly: money, quote: z.boolean().optional(),
  days: z.string().trim().max(60),
  includes: z.array(z.string().trim().min(1).max(200)).max(20),
  popular: z.boolean().optional(),
  active: z.boolean(),
});
export const BIZ_LIST = z.array(BIZ_PACKAGE).min(1).max(12).superRefine((list, ctx) => {
  if (new Set(list.map((p) => p.id)).size !== list.length) ctx.addIssue({ code: "custom", message: "شناسه بسته‌ها تکراری است." });
  if (!list.some((p) => p.active)) ctx.addIssue({ code: "custom", message: "دست‌کم یک بسته باید فعال بماند." });
  for (const p of list) if (!p.quote && p.active && p.monthly <= 0 && p.setup <= 0) ctx.addIssue({ code: "custom", message: "بسته «" + p.name + "» قیمت ندارد؛ قیمت بگذارید یا «قیمت بعد از جلسه» را روشن کنید." });
});

export async function bizPackages(db: DB): Promise<BizPackage[]> {
  const [row] = await db.select().from(kv).where(eq(kv.key, "business"));
  const r = BIZ_LIST.safeParse((row?.value as { packages?: unknown } | undefined)?.packages);
  return r.success ? r.data : BIZ_DEFAULTS;
}

export async function saveBizPackages(db: DB, list: BizPackage[]) {
  const packages = BIZ_LIST.parse(list);
  await db.insert(kv).values({ key: "business", value: { packages } }).onConflictDoUpdate({ target: kv.key, set: { value: { packages } } });
  return packages;
}
