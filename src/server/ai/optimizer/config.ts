/* Optimizer configuration: environment defaults (documented in .env.example) and the admin overrides kept
   in kv["ai_optimizer"]. AI_OPTIMIZER=0 turns everything off — the rollback switch; the admin switch can
   only turn it off too, never on against the environment. */
import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../../db/client";
import { aiOptCalibration, kv } from "../../db/schema";
import { DEFAULT_FAMILIES, type CacheFamily } from "./cache";
import { calibrate, type Calibration } from "./estimator";
import type { PolicyOverrides } from "./policy";
import { OPT_FEATURES } from "./types";

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
export const envEnabled = () => process.env.AI_OPTIMIZER !== "0";

const policyPatch = z.object({
  enabled: z.boolean(), level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), recentTurns: z.number().int().min(1).max(50),
  maxInputTokens: z.number().int().min(0).max(2_000_000), maxToolLines: z.number().int().min(8).max(10_000), maxToolChars: z.number().int().min(800).max(1_000_000),
  summarize: z.boolean(), summarizeOverTokens: z.number().int().min(500).max(1_000_000), sections: z.boolean(), docMinTokens: z.number().int().min(500).max(1_000_000),
  nearDedupe: z.boolean(), cache: z.boolean(), translate: z.boolean(), budgetMs: z.number().int().min(1).max(2000), expectedReuse: z.number().min(0).max(1),
}).partial();

export const SETTINGS = z.object({
  enabled: z.boolean(),
  features: z.partialRecord(z.enum(OPT_FEATURES), policyPatch),
  models: z.record(z.string().max(80), policyPatch),
  plans: z.record(z.string().max(40), policyPatch),
  /** auto: cache_control only when AI_UPSTREAM_URL is OpenRouter; on / off force it */
  cacheControl: z.enum(["auto", "on", "off"]),
  families: z.record(z.string().max(30), z.object({ minTokens: z.number().int().min(0).max(1_000_000), write: z.number().min(0).max(10), read: z.number().min(0).max(1) }).partial()),
  translate: z.object({ minSavingTokens: z.number().int().min(0).max(1_000_000), minConfidence: z.number().min(0).max(1), timeoutMs: z.number().int().min(100).max(30_000), includeLatest: z.boolean() }),
  /** Toman per USD, to turn a provider-reported usage.cost into Toman (0 = unknown) */
  usdToman: z.number().min(0).max(100_000_000),
  /** the most one live benchmark run may spend, USD */
  benchMaxUsd: z.number().min(0).max(1000),
});
export type OptimizerSettings = z.infer<typeof SETTINGS>;

export function settingsDefaults(): OptimizerSettings {
  const cc = (process.env.AI_OPT_CACHE_CONTROL || "auto").toLowerCase();
  return {
    enabled: true, features: {}, models: {}, plans: {},
    cacheControl: cc === "1" || cc === "on" ? "on" : cc === "0" || cc === "off" ? "off" : "auto",
    families: {},
    translate: { minSavingTokens: num(process.env.AI_OPT_TRANSLATE_MIN_SAVING, 300), minConfidence: num(process.env.AI_OPT_TRANSLATE_MIN_CONFIDENCE, 0.8), timeoutMs: num(process.env.AI_OPT_TRANSLATE_TIMEOUT_MS, 1500), includeLatest: process.env.AI_OPT_TRANSLATE_LATEST === "1" },
    usdToman: num(process.env.AI_USD_TOMAN, 0),
    benchMaxUsd: num(process.env.AI_OPT_BENCH_MAX_USD, 5),
  };
}

const KEY = "ai_optimizer";
const TTL = 10_000;
const cache = new WeakMap<object, { at: number; v: OptimizerSettings }>();

export async function optimizerSettings(db: DB): Promise<OptimizerSettings> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  const d = settingsDefaults();
  let v = d;
  try {
    const [row] = await db.select().from(kv).where(eq(kv.key, KEY));
    const r = SETTINGS.partial().safeParse(row?.value ?? {});
    if (r.success) v = { ...d, ...r.data, translate: { ...d.translate, ...(r.data.translate ?? {}) } };
  } catch { /* defaults */ }
  cache.set(db, { at: Date.now(), v });
  return v;
}

export async function saveOptimizerSettings(db: DB, patch: Partial<OptimizerSettings>): Promise<OptimizerSettings> {
  const next = SETTINGS.parse({ ...(await optimizerSettings(db)), ...patch });
  await db.insert(kv).values({ key: KEY, value: next }).onConflictDoUpdate({ target: kv.key, set: { value: next } });
  cache.set(db, { at: Date.now(), v: next });
  return next;
}

export const overridesOf = (s: OptimizerSettings): PolicyOverrides => ({ features: s.features, models: s.models, plans: s.plans });
export const isOpenRouter = () => /(^|\/\/|\.)openrouter\.ai(\/|$)/i.test(process.env.AI_UPSTREAM_URL || "");
export const explicitCacheAllowed = (s: OptimizerSettings) => (s.cacheControl === "on" ? true : s.cacheControl === "off" ? false : isOpenRouter());
export const familiesOf = (s: OptimizerSettings): CacheFamily[] => DEFAULT_FAMILIES.map((f) => ({ ...f, ...(s.families[f.name] ?? {}) }));
export const budgetMsDefault = () => num(process.env.AI_OPT_BUDGET_MS, 50);

/* ---------- calibration (per model, EMA) ---------- */

const calib = new WeakMap<object, { at: number; map: Map<string, Calibration> }>();
async function calibMap(db: DB) {
  const hit = calib.get(db);
  if (hit && Date.now() - hit.at < 60_000) return hit.map;
  const map = new Map<string, Calibration>();
  try { for (const r of await db.select().from(aiOptCalibration)) map.set(r.model, { factor: r.factor, samples: r.samples }); } catch { /* none yet */ }
  calib.set(db, { at: Date.now(), map });
  return map;
}
export async function calibrationOf(db: DB, model: string): Promise<Calibration> {
  return (await calibMap(db)).get(model) ?? { factor: 1, samples: 0 };
}
export async function updateCalibration(db: DB, model: string, actual: number, estimate: number) {
  const map = await calibMap(db);
  const prev = map.get(model) ?? null;
  const next = calibrate(prev, actual, estimate);
  if (prev && next.samples === prev.samples) return prev;
  map.set(model, next);
  await db.insert(aiOptCalibration).values({ model, factor: next.factor, samples: next.samples, updatedAt: new Date() })
    .onConflictDoUpdate({ target: aiOptCalibration.model, set: { factor: next.factor, samples: next.samples, updatedAt: new Date() } });
  return next;
}

/* ---------- observed cache hit rate per feature and family (in memory; ai_opt_events keeps the history) ---------- */

const hits = new Map<string, { rate: number; n: number }>();
export function noteCacheHit(feature: string, family: string, hit: boolean) {
  const k = feature + "|" + family, p = hits.get(k) ?? { rate: 0, n: 0 };
  const w = Math.max(0.05, 1 / (p.n + 1));
  hits.set(k, { rate: p.rate * (1 - w) + (hit ? 1 : 0) * w, n: p.n + 1 });
}
/** the expected reuse for the cost check: the observed hit rate once there are enough samples, else the policy prior */
export function expectedReuse(feature: string, family: string, prior: number) {
  const h = hits.get(feature + "|" + family);
  return h && h.n >= 20 ? h.rate : prior;
}
export function resetOptimizerMemory() { hits.clear(); }
