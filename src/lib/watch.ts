/* «پایش پیشرفته»: paid, ongoing watch of a service that is already up (src/server/watch). The free basic monitoring
   only covers getting a service up (build and deploy failures, «توضیح بده و درستش کن») and the platform's own
   security checks; once a service runs, the customer picks how closely it is watched:
   - on_demand: «الان بررسی کن», one AI read of logs and usage, paid per check
   - every3h:   an AI read every 3 hours, plus the predictive detectors and the uptime ping (monthly)
   - continuous: the detectors and the ping every few minutes, and an AI read whenever they see something new, plus a
                 daily summary (monthly; costs about a tenth of an AI reading everything all the time)
   Prices default to Gereh's real token cost of the expected checks plus the admin's margin; every number is the
   admin's to change. Pure: no I/O. */

export const WATCH = { name: "پایش پیشرفته" } as const;

export type WatchMode = "on_demand" | "every3h" | "continuous";
export type WatchPlanMode = Exclude<WatchMode, "on_demand">;
export type WatchStatus = "trial" | "active" | "expired" | "cancelled";
export type WatchTrigger = "manual" | "schedule" | "anomaly" | "daily";
export type WatchHealth = "healthy" | "warn" | "critical" | "failed";
export type WatchKind = "server" | "app";

export const WATCH_MODE_LABEL: Record<WatchMode, string> = { on_demand: "هر وقت خواستم", every3h: "هر ۳ ساعت", continuous: "همیشه روشن" };
export const WATCH_MODE_HINT: Record<WatchMode, string> = {
  on_demand: "دکمه «الان بررسی کن»: هوش مصنوعی لاگ‌ها و مصرف را می‌خواند و گزارش و راه‌حل می‌دهد. هزینه هر بار از کیف پول.",
  every3h: "هر ۳ ساعت بررسی خودکار با هوش مصنوعی، هشدار پیش‌بینانه (نشت حافظه، پر شدن دیسک، مصرف ترافیک، از کار افتادن) و پینگ هر دقیقه. هشدار فقط وقتی مشکلی باشد.",
  continuous: "پایش مداوم: قاعده‌ها و پینگ هر چند دقیقه، و هر چیز تازه‌ای (خطای جدید، کرش، کندی) فوراً با هوش مصنوعی بررسی می‌شود؛ به‌علاوه خلاصه روزانه و گزارش هفتگی.",
};
export const WATCH_STATUS_LABEL: Record<WatchStatus, string> = { trial: "آزمایشی رایگان", active: "فعال", expired: "پایان یافته", cancelled: "لغو شده" };
export const WATCH_HEALTH_LABEL: Record<WatchHealth, string> = { healthy: "سالم", warn: "نیاز به توجه", critical: "بحرانی", failed: "انجام نشد" };
export const WATCH_TRIGGER_LABEL: Record<WatchTrigger, string> = { manual: "درخواست شما", schedule: "زمان‌بندی", anomaly: "رخداد تازه", daily: "خلاصه روزانه" };

/** the predictive detectors of «پایش هوشمند» that only watched services get (security checks stay free for all) */
export const WATCH_DETECTORS = ["service_down", "memory_leak", "disk_fill", "traffic_burn"] as const;

/** the admin's pricing and limits (kv "watch") */
export type WatchSettings = {
  /** margin over Gereh's token cost, e.g. 1 = price is twice the cost */
  margin: number;
  /** the model of the checks ("" = the monitoring model, AI_MONITOR_MODEL or the cheapest suitable one) */
  model: string;
  /** expected tokens of one AI check */
  tokensIn: number; tokensOut: number;
  /** checks a month the price assumes: every3h = 8 a day; continuous = its expected anomaly reads + the daily summary */
  checksEvery3h: number; checksContinuous: number;
  /** the most AI reads one continuous plan makes in a day (fair use), and free manual checks a day on a plan */
  continuousMaxPerDay: number; freeManualPerDay: number;
  /** Toman a month for the uptime ping and detectors (no tokens) */
  baseMonthly: number;
  /** the smallest on-demand price */
  minCheck: number;
  /** price overrides in Toman (0 = computed) */
  priceOnDemand: number; priceEvery3h: number; priceContinuous: number;
  trialDays: number;
};
export const WATCH_DEFAULTS: WatchSettings = {
  margin: 1, model: "", tokensIn: 6000, tokensOut: 700, checksEvery3h: 240, checksContinuous: 330,
  continuousMaxPerDay: 24, freeManualPerDay: 3, baseMonthly: 10_000, minCheck: 2000,
  priceOnDemand: 0, priceEvery3h: 0, priceContinuous: 0, trialDays: 7,
};

export type WatchPrices = { onDemand: number; every3h: number; continuous: number };
export type WatchQuote = WatchPrices & {
  /** Gereh's token cost of one check (Toman) and the computed prices before overrides */
  costPerCheck: number; computed: WatchPrices; model: string; costKnown: boolean;
};

const up1000 = (n: number) => Math.ceil(n / 1000) * 1000;
/** Gereh's token cost of one check for a model's cost price (Toman per 1M tokens) */
export const checkCost = (s: Pick<WatchSettings, "tokensIn" | "tokensOut">, costIn: number, costOut: number) => (s.tokensIn * costIn + s.tokensOut * costOut) / 1e6;
/** the prices from the cost of one check: cost × expected checks × (1 + margin), rounded up to 1000 Toman */
export function computePrices(s: WatchSettings, costPerCheck: number): WatchPrices {
  const k = 1 + Math.max(0, s.margin);
  return {
    onDemand: Math.max(s.minCheck, up1000(costPerCheck * k)),
    every3h: up1000(s.baseMonthly + costPerCheck * s.checksEvery3h * k),
    continuous: up1000(s.baseMonthly + costPerCheck * s.checksContinuous * k),
  };
}
export function quote(s: WatchSettings, costPerCheck: number, model: string, costKnown: boolean): WatchQuote {
  const computed = computePrices(s, costPerCheck);
  return {
    onDemand: s.priceOnDemand || computed.onDemand, every3h: s.priceEvery3h || computed.every3h, continuous: s.priceContinuous || computed.continuous,
    costPerCheck, computed, model, costKnown,
  };
}

/** the difference to pay now when a plan moves up mid-period, for the days left (rounded to 1000 Toman) */
export const upgradeDue = (from: number, to: number, daysLeft: number) => (to <= from ? 0 : Math.round(((to - from) * Math.max(0, Math.min(30, daysLeft))) / 30 / 1000) * 1000);

export type WatchCheckView = { id: string; trigger: WatchTrigger; status: WatchHealth; summary: string; charged: number; at: string };
export type WatchResourceView = {
  kind: WatchKind; id: string; name: string; href: string; running: boolean;
  plan: null | {
    mode: WatchPlanMode; status: WatchStatus; renew: boolean; nextMode: WatchPlanMode | null; price: number;
    paidUntil: string; trialEnds: string; daysLeft: number; uptimeUrl: string; autoFix: boolean;
  };
  /** this month's uptime from the ping (null without one or without enough pings) */
  uptime: number | null; down: boolean;
  last: WatchCheckView | null;
  /** «الان بررسی کن» right now: free (within the plan's daily allowance) or this price */
  checkPrice: number;
  builder: boolean;
};
export type WatchReport = { resources: WatchResourceView[]; prices: WatchPrices; trialDays: number; trialAvailable: boolean; balance: number };
export type WatchHistory = { checks: WatchCheckView[]; pings: { at: string; ok: boolean; ms: number }[] };
export type WatchAdminView = {
  settings: WatchSettings; quote: WatchQuote;
  plans: { trial: number; every3h: number; continuous: number };
  month: { revenue: number; aiCost: number; checks: number; margin: number };
};
