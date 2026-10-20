/* Wallet helpers shared by cloud-server add-ons and the account billing tools: admin-editable add-on
   prices, the negative-balance grace, project (sub-)wallets, burn rate and the "credit lasts until"
   forecast, monthly budget caps and low-credit alerts. */
import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { DISK_MIN_GB, DISK_STEP_GB, TRAFFIC_STEP_GB, UNIT } from "@/lib/catalog";
import type { DB, Tx } from "./db/client";
import { accountMeta, budgets, kv, subWallets, transactions, users, walletLinks } from "./db/schema";
import { enqueue } from "./jobs";
import { fail, notify, rid } from "./util";

export const VPS_PRICE_DEFAULTS = {
  /** Toman per month */
  ip: UNIT.ip,
  diskGb: Math.round(UNIT.disk10 / 10),
  snapshotGb: 3_000,
  /** one traffic pack (the automatic purchase and the panel's default): size in GB, a multiple of TRAFFIC_STEP_GB,
      and its price. A manual purchase may be any multiple of 500 GB at the same per-GB price (pack500Price). */
  packGb: 1000,
  packPrice: UNIT.tb,
  maxIps: 8,
  maxDisks: 4,
  /** the admin's cap per extra disk, read as a multiple of DISK_STEP_GB */
  maxDiskGb: 2000,
};
export type VpsPrices = typeof VPS_PRICE_DEFAULTS & { /** Toman per 500 GB of traffic, from packPrice/packGb */ pack500Price: number };
export const POLICY_DEFAULTS = {
  /** how far (Toman) the main wallet may go below zero before hourly services are suspended */
  negativeGrace: 0,
};
export type BillingPolicy = typeof POLICY_DEFAULTS;

async function doc<T extends object>(db: DB | Tx, key: string, defaults: T): Promise<T> {
  const [row] = await db.select().from(kv).where(eq(kv.key, key));
  return { ...defaults, ...((row?.value as Partial<T>) || {}) };
}
export async function vpsPrices(db: DB | Tx): Promise<VpsPrices> {
  const p = await doc(db, "vps_prices", VPS_PRICE_DEFAULTS);
  // settings saved before the step rules: the per-GB traffic price is kept and the pack moves to a 500 GB multiple
  const perGb = p.packPrice / (p.packGb || TRAFFIC_STEP_GB);
  const packGb = Math.max(TRAFFIC_STEP_GB, Math.round((p.packGb || 0) / TRAFFIC_STEP_GB) * TRAFFIC_STEP_GB);
  return { ...p, packGb, packPrice: packGb === p.packGb ? p.packPrice : Math.round(perGb * packGb), pack500Price: Math.round(perGb * TRAFFIC_STEP_GB),
    maxDiskGb: Math.max(DISK_MIN_GB, Math.floor((p.maxDiskGb || VPS_PRICE_DEFAULTS.maxDiskGb) / DISK_STEP_GB) * DISK_STEP_GB) };
}
export const billingPolicy = (db: DB | Tx) => doc(db, "billing_policy", POLICY_DEFAULTS);
export async function saveDoc(db: DB | Tx, key: "vps_prices" | "billing_policy", value: object) {
  await db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

/** hourly charge for a monthly price */
export const perHour = (monthly: number) => Math.max(1, Math.ceil(monthly / 720));

/** debits a project wallet linked to the server when it has enough, else the main wallet down to the
    admin's negative grace; records the transaction. All or nothing. */
export async function debit(db: DB | Tx, userId: string, amount: number, desc: string, opts: { serverId?: string } = {}): Promise<boolean> {
  if (amount <= 0) return true;
  if (opts.serverId) {
    const [link] = await db.select({ walletId: walletLinks.walletId }).from(walletLinks).where(eq(walletLinks.serverId, opts.serverId));
    if (link) {
      const [w] = await db.update(subWallets).set({ balance: sql`${subWallets.balance} - ${amount}` }).where(and(eq(subWallets.id, link.walletId), eq(subWallets.userId, userId), sql`${subWallets.balance} >= ${amount}`)).returning({ name: subWallets.name });
      if (w) {
        await db.insert(transactions).values({ id: rid("TX"), userId, type: "usage", amount: -amount, method: "کیف پول پروژه " + w.name, desc });
        return true;
      }
    }
  }
  const grace = Math.max(0, (await billingPolicy(db)).negativeGrace || 0);
  const [u] = await db.update(users).set({ balance: sql`${users.balance} - ${amount}` }).where(and(eq(users.id, userId), sql`${users.balance} - ${amount} >= ${-grace}`)).returning({ id: users.id });
  if (!u) return false;
  await db.insert(transactions).values({ id: rid("TX"), userId, type: "usage", amount: -amount, method: "کیف پول", desc });
  return true;
}

/** wallet spend per day over the last 7 days (hourly usage plus invoices paid from the wallet) */
export async function dailyBurn(db: DB | Tx, userId: string) {
  const since = new Date(Date.now() - 7 * 86400_000);
  const [r] = await db.select({ s: sql<string>`coalesce(sum(-${transactions.amount}), 0)` }).from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.createdAt, since), lt(transactions.amount, 0), sql`(${transactions.type} = 'usage' or (${transactions.type} = 'payment' and ${transactions.method} like 'کیف پول%'))`));
  return Math.round(Number(r?.s ?? 0) / 7);
}

export async function accountMetaOf(db: DB | Tx, userId: string) {
  const [m] = await db.select().from(accountMeta).where(eq(accountMeta.userId, userId));
  return m ?? { userId, level: "developer" as const, lowCredit: 0, lowCreditAuto: true, lowCreditAlertedAt: null, updatedAt: new Date() };
}

/** balance, burn, when the credit runs out and the low-credit threshold in force */
export async function creditForecast(db: DB | Tx, userId: string) {
  const [u] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
  const balance = u?.balance ?? 0;
  const burn = await dailyBurn(db, userId);
  const meta = await accountMetaOf(db, userId);
  const threshold = meta.lowCreditAuto ? burn * 3 : meta.lowCredit;
  const days = burn > 0 ? Math.max(0, balance) / burn : null;
  return { balance, burn, days, until: days === null ? null : new Date(Date.now() + days * 86400_000), threshold, auto: meta.lowCreditAuto, manual: meta.lowCredit, level: meta.level };
}

/* ---------- budgets ---------- */
export const BUDGET_SERVICES: Record<string, { label: string; match: RegExp | null }> = {
  all: { label: "کل حساب", match: null },
  vps: { label: "سرورهای ابری", match: /سرور|IPv4|اسنپ‌شات|بسته ترافیک|دیسک اضافه/ },
  apps: { label: "گره اپ", match: /گره اپ/ },
  storage: { label: "فضای ذخیره‌سازی", match: /فضای ذخیره‌سازی/ },
  mail: { label: "سرویس ایمیل", match: /سرویس ایمیل/ },
  ai: { label: "API هوش مصنوعی", match: /هوش مصنوعی/ },
  inquiry: { label: "API استعلام", match: /استعلام/ },
  geo: { label: "Geo DNS", match: /Geo DNS/ },
};
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

/** what the account spent this calendar month, overall or on one service (matched by the transaction text) */
export async function monthSpend(db: DB | Tx, userId: string, service = "all") {
  const rows = await db.select({ amount: transactions.amount, desc: transactions.desc }).from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.createdAt, monthStart()), lt(transactions.amount, 0), inArray(transactions.type, ["usage", "payment"])));
  const m = BUDGET_SERVICES[service]?.match;
  return rows.filter((r) => !m || m.test(r.desc)).reduce((s, r) => s - r.amount, 0);
}

/** generic guard for new purchases: refuses when a blocking cap (the service's or the account's) would be passed */
export async function needBudget(db: DB | Tx, userId: string, service: string, amount: number) {
  const caps = await db.select().from(budgets).where(and(eq(budgets.userId, userId), inArray(budgets.service, service === "all" ? ["all"] : ["all", service]), eq(budgets.block, true)));
  for (const b of caps) {
    const spent = await monthSpend(db, userId, b.service);
    if (spent + amount > b.monthlyCap) fail("سقف بودجه ماهانه «" + (BUDGET_SERVICES[b.service]?.label ?? b.service) + "» (" + b.monthlyCap.toLocaleString("fa-IR") + " تومان) اجازه این خرید را نمی‌دهد؛ سقف را در صورتحساب تغییر دهید.", 402);
  }
}

/** hourly: alert at the budget's percentage and at 100%, once per level per month */
export async function budgetAlerts(db: DB) {
  const month = monthKey();
  for (const b of await db.select().from(budgets)) {
    const spent = await monthSpend(db, b.userId, b.service);
    const pct = b.monthlyCap > 0 ? (spent / b.monthlyCap) * 100 : 0;
    const level = pct >= 100 ? 100 : pct >= b.alertPct ? b.alertPct : 0;
    const prev = b.alertedMonth === month ? b.alertedLevel : 0;
    if (!level || level <= prev) continue;
    await db.update(budgets).set({ alertedMonth: month, alertedLevel: level }).where(eq(budgets.id, b.id));
    const label = BUDGET_SERVICES[b.service]?.label ?? b.service;
    const text = "هزینه این ماه «" + label + "» به " + Math.round(pct).toLocaleString("fa-IR") + "٪ سقف بودجه (" + b.monthlyCap.toLocaleString("fa-IR") + " تومان) رسید.";
    await notify(db, b.userId, "wallet", text);
    await enqueue(db, "notify.send", { userId: b.userId, kind: "billing", subject: "هشدار بودجه " + label, text }, { dedupe: "budget:" + b.id + ":" + month + ":" + level });
  }
}

/** hourly: balance under the threshold (manual, or three days of burn) → one alert per day */
export async function lowCreditAlerts(db: DB) {
  const metas = new Map((await db.select().from(accountMeta)).map((m) => [m.userId, m]));
  // accounts that spend from the wallet recently, plus those with a manual threshold
  const active = await db.selectDistinct({ userId: transactions.userId }).from(transactions).where(and(eq(transactions.type, "usage"), gte(transactions.createdAt, new Date(Date.now() - 7 * 86400_000))));
  const ids = new Set([...active.map((a) => a.userId), ...[...metas.values()].filter((m) => !m.lowCreditAuto && m.lowCredit > 0).map((m) => m.userId)]);
  for (const uid of ids) {
    const f = await creditForecast(db, uid);
    if (f.threshold <= 0 || f.balance >= f.threshold) continue;
    const last = metas.get(uid)?.lowCreditAlertedAt;
    if (last && Date.now() - last.getTime() < 86400_000) continue;
    await db.insert(accountMeta).values({ userId: uid, lowCreditAlertedAt: new Date() }).onConflictDoUpdate({ target: accountMeta.userId, set: { lowCreditAlertedAt: new Date() } });
    const text = "موجودی کیف پول (" + f.balance.toLocaleString("fa-IR") + " تومان) کمتر از آستانه هشدار است" + (f.days !== null ? "؛ با مصرف فعلی حدود " + Math.floor(f.days).toLocaleString("fa-IR") + " روز دیگر تمام می‌شود" : "") + ".";
    await notify(db, uid, "wallet", text);
    await enqueue(db, "notify.send", { userId: uid, kind: "billing", subject: "موجودی کیف پول رو به اتمام است", text: text + "\nشارژ: https://gereh.net/panel/billing" });
  }
}

export const LEVELS = {
  developer: { label: "توسعه‌دهنده", sla: "۹۹٫۵٪", support: "عادی (پاسخ تا ۴ ساعت)", priority: "normal" },
  startup: { label: "استارتاپ", sla: "۹۹٫۹٪", support: "بالا (پاسخ تا ۱ ساعت)", priority: "high" },
  enterprise: { label: "سازمانی", sla: "۹۹٫۹۵٪", support: "ویژه (پاسخ تا ۱۵ دقیقه، مدیر حساب اختصاصی)", priority: "high" },
} as const;
