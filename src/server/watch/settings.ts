/* «پایش پیشرفته» settings (kv "watch") and the price quote: Gereh's token cost of one check with the checks' model
   (its cost price, ai_models.cost_in/out; the sale price when no cost price is set, which overstates the cost and so
   never sells below it) times the expected checks, plus the admin's margin. */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { checkCost, quote, WATCH_DEFAULTS, type WatchQuote, type WatchSettings } from "@/lib/watch";
import { isAiError } from "../ai/endpoints";
import { resolveModel, type ResolvedModel } from "../ai/service";
import type { DB } from "../db/client";
import { kv } from "../db/schema";
import { monitorModel } from "../monitor/explain";

const int = (max: number) => z.number().int().min(0).max(max);
export const WATCH_SETTINGS = z.object({
  margin: z.number().min(0).max(20), model: z.string().max(120),
  tokensIn: int(200_000), tokensOut: int(20_000), checksEvery3h: int(10_000), checksContinuous: int(10_000),
  continuousMaxPerDay: int(500), freeManualPerDay: int(100), baseMonthly: int(100_000_000), minCheck: int(100_000_000),
  priceOnDemand: int(100_000_000), priceEvery3h: int(100_000_000), priceContinuous: int(100_000_000), trialDays: int(60),
});

export async function watchSettings(db: DB): Promise<WatchSettings> {
  const [row] = await db.select().from(kv).where(eq(kv.key, "watch"));
  const r = WATCH_SETTINGS.partial().safeParse(row?.value ?? {});
  return { ...WATCH_DEFAULTS, ...(r.success ? r.data : {}) };
}
export async function saveWatchSettings(db: DB, patch: Partial<WatchSettings>) {
  const next = WATCH_SETTINGS.parse({ ...(await watchSettings(db)), ...patch });
  await db.insert(kv).values({ key: "watch", value: next }).onConflictDoUpdate({ target: kv.key, set: { value: next } });
  return next;
}

/** the model of the checks */
export async function watchModel(db: DB, s?: WatchSettings): Promise<ResolvedModel | null> {
  const want = (s ?? (await watchSettings(db))).model;
  if (want) { const m = await resolveModel(db, want, [], "chat"); if (!isAiError(m)) return m; }
  return monitorModel(db);
}

/** Gereh's cost price of a model (Toman per 1M tokens); the sale price when none is set */
export const costPrice = (m: ResolvedModel) => ({ in: m.costIn > 0 ? m.costIn : m.inPrice, out: m.costOut > 0 ? m.costOut : m.outPrice, known: m.costIn > 0 || m.costOut > 0 });

export async function watchQuote(db: DB, s?: WatchSettings): Promise<WatchQuote> {
  const set = s ?? (await watchSettings(db));
  const m = await watchModel(db, set);
  const c = m ? costPrice(m) : { in: 0, out: 0, known: false };
  return quote(set, checkCost(set, c.in, c.out), m?.id ?? "", c.known);
}
