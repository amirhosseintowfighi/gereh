/* «پایش هوشمند»: smart monitoring and anomaly/security detection for cloud servers and Gereh Apps
   (src/server/monitor). Detection is deterministic statistics; AI only words the explanation. */

export const MONITOR = { name: "پایش هوشمند" } as const;

export type Detector =
  | "miner" | "outbound_abuse" | "inbound_attack" | "traffic_burn" | "memory_leak" | "disk_fill"
  | "service_down" | "unusual_io" | "brute_force";
export type Severity = "info" | "warn" | "critical";
export type IncidentStatus = "open" | "resolved" | "muted" | "false_positive";
export type Sensitivity = "low" | "normal" | "high";
export type ResourceKind = "server" | "app";

export const DETECTOR_LABEL: Record<Detector, string> = {
  miner: "الگوی استخراج رمزارز", outbound_abuse: "ترافیک خروجی مشکوک (حمله یا اسپم)", inbound_attack: "حمله ورودی (DDoS)",
  traffic_burn: "مصرف سریع سهمیه ترافیک", memory_leak: "نشت حافظه", disk_fill: "پر شدن دیسک",
  service_down: "از کار افتادن سرویس", unusual_io: "نوشتن غیرعادی روی دیسک", brute_force: "حمله حدس رمز (Brute force)",
};
export const SEVERITY_LABEL: Record<Severity, string> = { info: "اطلاع", warn: "هشدار", critical: "بحرانی" };
export const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, critical: 3 };
export const SENSITIVITY_LABEL: Record<Sensitivity, string> = { low: "کم", normal: "عادی", high: "زیاد" };

/** every threshold the detectors use; sensitivity scales the multipliers (low ×1.5, high ×0.7) */
export const MONITOR_RULES = {
  /** baseline window (days) and how often it is rebuilt (hours) */
  baselineDays: 28, baselineMinDays: 7, baselineEveryHours: 24,
  /** resources younger than this use static thresholds and raise critical incidents only */
  newResourceDays: 3,
  sensitivity: { low: 1.5, normal: 1, high: 0.7 } as Record<Sensitivity, number>,
  miner: { cpu: 90, hours: 2, coverage: 0.8, maxStd: 6, baselineMax: 30, staticCpu: 95, ioRatio: 3, netFloor: 20, procEveryHours: 6 },
  outbound: { ratio: 10, floorMbps: 50, minutes: 15, outInRatio: 5, staticFloorMbps: 200 },
  inbound: { ratio: 10, floorMbps: 50, minutes: 15, cpuRise: 20, cpuHigh: 80 },
  traffic: { recentHours: 6, rateJump: 3, minElapsedDays: 1 },
  leak: { hours: 48, minHours: 24, minR2: 0.8, minRise: 10, monotonic: 0.8, target: 95, etaHours: 72, criticalEta: 6 },
  disk: { hours: 72, minHours: 24, minR2: 0.6, minRise: 2, etaWarn: 72, etaCritical: 24 },
  flap: { windowMinutes: 60, warn: 3, critical: 6 },
  io: { ratio: 8, floorKBs: 20_000, minutes: 30 },
  brute: { windowMinutes: 15, warn: 50, critical: 300 },
  /** consecutive clean scans before an open incident is resolved */
  resolveAfter: 3,
  /** a re-opened incident within this many hours of the last notified one is not notified again unless it is worse */
  cooldownHours: 6,
  /** «هشدار اشتباه بود»: the same detector stays quiet on that resource for this long */
  falsePositiveHours: 24,
} as const;

/** the miner names checked in the process list (only after the CPU pattern fired) */
export const MINER_NAMES = ["xmrig", "minerd", "cpuminer", "kdevtmpfsi", "kinsing", "xmr-stak", "ethminer", "nbminer", "t-rex", "lolminer", "phoenixminer", "nanominer", "srbminer", "teamredminer", "ccminer", "bminer", "gminer", "xmrig-notls", "moneroocean", "c3pool", "nicehash"] as const;

export type MonitorSeries = { label: string; unit: string; data: number[]; labels: string[]; lo?: number[]; hi?: number[] };
export type MonitorEvidence = { lines: string[]; series?: MonitorSeries; eventId?: number; etaHours?: number; processes?: string[] };

export type MonitorActionId = "snapshot" | "reboot" | "start" | "poweroff" | "processes" | "root_password" | "firewall_preset" | "scale_up" | "explain" | "assistant" | "advisor" | "cdn";
/** what the client sees; the calls stay on the server and are derived again from the incident's resource */
export type MonitorActionView = {
  id: MonitorActionId; label: string; preview: string;
  /** the resource name must be typed to confirm */
  typed: boolean; destructive: boolean;
  /** no server call: a link (or the explain dialog) */
  link?: string;
};

export type IncidentView = {
  id: string; detector: Detector; label: string; severity: Severity; confidence: number; status: IncidentStatus;
  resource: { kind: ResourceKind; id: string; name: string; href: string };
  title: string; evidence: MonitorEvidence; explanation: string; explanationAi: boolean;
  actions: MonitorActionView[]; abuse: boolean; feedback: string;
  startedAt: string; updatedAt: string; resolvedAt: string; mutedUntil: string;
  taken: { label: string; at: string }[];
};

export type ChannelPrefs = { panel: Severity | "off"; email: "warn" | "critical" | "off"; channel: Severity | "off" };
export const DEFAULT_PREFS: ChannelPrefs = { panel: "info", email: "warn", channel: "warn" };

export type ResourceSetting = { kind: ResourceKind; id: string; name: string; sensitivity: Sensitivity; mutedUntil: string; muted: boolean };

export type MonitorReport = {
  open: IncidentView[]; history: IncidentView[];
  resources: ResourceSetting[]; prefs: ChannelPrefs; channels: number; scannedAt: string;
};
export type MonitorBrief = { open: number; critical: number; warn: number; top: { title: string; severity: Severity; href: string } | null };
export type MonitorBadge = { open: number; severity: Severity | null; titles: string[] };

export type MonitorAdminIncident = IncidentView & { user: { id: string; name: string; email: string }; resourceStatus: string };
export type MonitorAdminStats = {
  open: number; critical: number; abuse: number;
  perDay: { day: string; count: number }[];
  byDetector: { detector: Detector; label: string; total: number; open: number; falsePositive: number }[];
  falsePositiveRate: number; feedbackCount: number;
  spendToday: number; spendMonth: number; dailyCap: number; autoSuspendAbuse: boolean;
};

export type ActResult = { ok: true; message: string };
