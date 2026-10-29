/* «مشاور هزینه»: what the cost and right-sizing advisor returns and the panel shows (src/server/advisor). */

export const ADVISOR = { name: "مشاور هزینه" } as const;

/** the rules; every threshold lives in ADVISOR_RULES so the page, the tests and the engine agree */
export type AdvisorRule =
  | "vps_oversized" | "vps_undersized" | "traffic_overrun" | "billing_monthly"
  | "idle_server" | "idle_app" | "preview_running" | "detached_disk" | "old_snapshots" | "idle_db" | "empty_bucket"
  | "paas_instances" | "paas_oom" | "ai_model" | "builder_mode" | "wallet_runway";

export const ADVISOR_RULES = {
  /** days of usage data before anything may be downsized, stopped or called idle */
  minDays: 14,
  /** days of data before a risk (undersized, OOM) is reported */
  minRiskDays: 3,
  oversized: { cpuP95: 20, ramP95: 35, headroom: 0.7 },
  undersized: { ramP95: 85, cpuSustained: 80, cpuSustainedShare: 0.25, disk: 85 },
  /** projections need this many days of the month */
  trafficMinDays: 3,
  billingHourlyDays: 20,
  idleDays: 14,
  /** manual snapshots kept per server; older ones beyond it, at least this many days old, are reported */
  keepSnapshots: 3, snapshotAgeDays: 30,
  idleAppCpu: 2, idleDbCpu: 1,
  instancesTargetCpu: 70,
  oomEvents: 2,
  ai: { days: 30, minRequests: 200, maxAvgOut: 300, maxPriceShare: 0.5 },
  builderQuietDays: 30,
  runwayWarnDays: 14, runwayRiskDays: 7,
  /** findings saving less than this (Toman per month) are not shown */
  minSaving: 10_000,
} as const;

export const RULE_LABEL: Record<AdvisorRule, string> = {
  vps_oversized: "سرور بزرگ‌تر از نیاز", vps_undersized: "سرور کوچک‌تر از نیاز", traffic_overrun: "ترافیک ماهانه", billing_monthly: "نوع پرداخت",
  idle_server: "سرور بی‌استفاده", idle_app: "اپ بی‌استفاده", preview_running: "پیش‌نمایش روشن", detached_disk: "دیسک جداشده",
  old_snapshots: "اسنپ‌شات‌های قدیمی", idle_db: "پایگاه داده بی‌استفاده", empty_bucket: "باکت خالی یا بی‌استفاده",
  paas_instances: "نمونه‌های اضافه", paas_oom: "کمبود حافظه اپ", ai_model: "مدل هوش مصنوعی", builder_mode: "نگهداری بافت", wallet_runway: "موجودی کیف پول",
};

export type AdvisorRisk = "low" | "medium" | "high";
export type FindingStatus = "open" | "applied" | "ignored" | "expired";

export type AdvisorSeries = { label: string; unit: string; data: number[]; labels: string[] };
export type AdvisorEvidence = { lines: string[]; series?: AdvisorSeries };

/** what «اعمال» does, as the client sees it (the calls themselves stay on the server) */
export type AdvisorActionView = {
  label: string;
  /** the RPC that runs it, for transparency */
  rpc: string;
  /** the exact price or saving, from the pricing functions */
  preview: string;
  /** costly or destructive: the resource name must be typed to confirm */
  typed: boolean;
  /** data may be lost */
  destructive: boolean;
  /** no automatic change: the action is a link */
  link?: string;
};

export type FindingView = {
  id: string; rule: AdvisorRule; title: string; detail: string;
  resource: { kind: string; id: string; name: string; href: string };
  /** Toman per month */
  saving: number; extraCost: number;
  /** Toman charged once now (traffic packs, a proration invoice) */
  oneTime: number;
  confidence: number; risk: AdvisorRisk;
  evidence: AdvisorEvidence;
  action: AdvisorActionView | null;
  status: FindingStatus; at: string;
};

export type InsufficientView = { kind: string; id: string; name: string; days: number; reason: string };

export type AdvisorReport = {
  runRate: number; parts: { label: string; amount: number }[];
  potentialSaving: number; extraCost: number;
  balance: number; burn: number; runwayDays: number | null;
  summary: { text: string; simulated: boolean; at: string };
  findings: FindingView[]; insufficient: InsufficientView[];
  applied: number; ignored: number; muted: boolean; computedAt: string;
};

export type AdvisorBrief = { potentialSaving: number; findings: number; risks: number; runwayDays: number | null };

export type AdvisorAdminStats = {
  potentialSaving: number; openFindings: number; accounts: number;
  applied: number; appliedSaving: number; ignored: number;
  byRule: { rule: AdvisorRule; label: string; open: number; saving: number }[];
  spendToday: number; spendMonth: number; dailyCap: number;
};

export type ApplyResult = { ok: true; message: string };
