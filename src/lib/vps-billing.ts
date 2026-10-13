/* Shared types and pure helpers for the cloud-server extras and the account billing tools. */

export type VpsExtrasView = {
  prices: { ip: number; diskGb: number; snapshotGb: number; packGb: number; packPrice: number; maxIps: number; maxDisks: number; maxDiskGb: number };
  ips: { id: string; ip: string; rdns: string; price: number; primary: boolean }[];
  disks: { id: string; name: string; sizeGb: number; slot: number | null; serverId: string | null; at: string }[];
  /** detached volumes in the same location that could be attached here */
  spareDisks: { id: string; name: string; sizeGb: number }[];
  schedule: { frequency: "daily" | "weekly"; retention: number; hour: number; weekday: number; active: boolean; next: string; last: string } | null;
  snapshotGb: number;
  traffic: { month: string; quotaGb: number; planGb: number; extraGb: number; packs: number; usedGb: number; autoBuy: boolean; days: { day: string; inGb: number; outGb: number }[] };
  groups: { id: string; name: string; rules: FwRuleIn[]; attached: boolean; servers: number }[];
  wallet: { id: string; name: string } | null;
  addonsMonthly: number;
};
export type FwRuleIn = { proto: string; port: string; source: string; action: "allow" | "deny"; note: string };
export type VncView = { host: string; port: number; password: string; ws: string };

export type BillingExtrasView = {
  balance: number;
  forecast: { burn: number; days: number | null; until: string; threshold: number; auto: boolean; manual: number };
  policy: { negativeGrace: number };
  level: { id: AccountLevel; label: string; sla: string; support: string };
  wallets: { id: string; name: string; balance: number; servers: { id: string; name: string }[] }[];
  transfers: { id: string; from: string; to: string; amount: number; note: string; at: string }[];
  profiles: InvoiceProfile[];
  budgets: { service: string; label: string; monthlyCap: number; alertPct: number; block: boolean; spent: number }[];
  services: { id: string; label: string }[];
};
export type InvoiceProfile = { id: string; label: string; name: string; nationalId: string; economicCode: string; address: string; postalCode: string; isDefault: boolean };
export type AccountLevel = "developer" | "startup" | "enterprise";
export type AccountExtrasView = { twofa: boolean; recoveryLeft: number; pushKey: string; pushDevices: { id: string; device: string; at: string }[]; level: { id: AccountLevel; label: string; sla: string; support: string } };

export const PERM_LEVELS = ["none", "view", "deploy", "operate", "manage"] as const;
export type PermLevel = (typeof PERM_LEVELS)[number];
export const PERM_LABEL: Record<PermLevel, string> = { none: "بدون دسترسی", view: "مشاهده", deploy: "استقرار", operate: "بهره‌برداری", manage: "مدیریت کامل" };
/** RPC groups a custom team role can grant, with their labels */
export const TEAM_SERVICES: Record<string, string> = {
  servers: "سرورهای ابری", hosting: "هاست", domains: "دامنه", paas: "گره اپ", dbaas: "پایگاه داده", storage: "فضای ذخیره‌سازی",
  mail: "سرویس ایمیل", ai: "API هوش مصنوعی", geo: "Geo DNS", inquiry: "API استعلام", devops: "خدمات دواپس", billing: "صورتحساب", tickets: "تیکت‌ها",
};
export type TeamRoleView = { id: string; name: string; perms: Record<string, PermLevel>; members: string[] };

/** the level an RPC method needs, from its name (group.verb…) */
export function methodLevel(method: string): Exclude<PermLevel, "none"> {
  const verb = method.split(".")[1] ?? "";
  if (/^(list|get|inspect|stats|logs?$|logSearch|overview|metrics|report|extras|instances|disks$|releases|deployment$|job$|scanReport|runtime|consoleHistory|fsList|fsRead|fsSearch|objects|domain$|messages|message$|chats|chatGet|quote|check|envFile|roles)/.test(verb)) return "view";
  if (/deploy|redeploy|rollback|release|build|promote|preview|import|upload|^setEnv|^env/i.test(verb)) return "deploy";
  if (/power|start|stop|restart|reboot|scale|console|snapshot|backup|restore|rescue|vnc|reset|mount|iso|boot|traffic|purge|flush|exec|run|sftp|^fs|hostname|password|pass$|rule|reply|open|close/i.test(verb)) return "operate";
  return "manage";
}
export const levelAllows = (have: PermLevel | undefined, need: PermLevel) => PERM_LEVELS.indexOf(have ?? "none") >= PERM_LEVELS.indexOf(need);

/** next scheduled run (UTC) for a Tehran-time hour, optionally on a weekday (0 = Sunday) */
export function nextRun(from: Date, frequency: "daily" | "weekly", hour: number, weekday: number) {
  const OFF = 3.5 * 3600_000;
  const local = new Date(from.getTime() + OFF);
  let t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0) - OFF;
  while (t <= from.getTime() || (frequency === "weekly" && new Date(t + OFF).getUTCDay() !== weekday)) t += 86400_000;
  return new Date(t);
}

export const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

/* ---------- public cost calculator ---------- */
export type CalcProduct = { id: string; name: string; monthly: number; meta: string };
export type CalcCatalog = { group: string; label: string; icon: string; unit: string; items: CalcProduct[] }[];
export type CalcLine = { group: string; id: string; qty: number };
/** total for `months` months (1–12) of the chosen lines; unknown lines are ignored */
export function calcTotal(cat: CalcCatalog, lines: CalcLine[], months: number) {
  const m = Math.min(12, Math.max(1, Math.round(months)));
  let monthly = 0;
  for (const l of lines) {
    const p = cat.find((g) => g.group === l.group)?.items.find((i) => i.id === l.id);
    if (p) monthly += p.monthly * Math.max(0, Math.min(1000, Math.round(l.qty)));
  }
  return { monthly, months: m, total: monthly * m };
}
