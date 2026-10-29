/* «مشاور هزینه»: the deterministic rule engine. It reads an account's usage (VPS hourly rollups, traffic, PaaS metrics,
   storage, AI usage, بافت maintenance, the wallet) and returns findings: evidence, a monthly saving or extra cost in
   Toman computed with the same pricing functions checkout, resize, scale and the hourly billing use, a confidence and a
   risk. Each finding that maps to an existing RPC carries its calls, derived here from the account's own rows; nothing
   the client or a model says ever becomes an argument. Nothing is downsized, stopped or called idle on less than
   ADVISOR_RULES.minDays of data: such resources are listed as «داده کافی نیست» instead. */
import "server-only";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { costOf } from "@/lib/ai";
import { ADVISOR_RULES as R, type AdvisorActionView, type AdvisorEvidence, type AdvisorRisk, type AdvisorRule, type AdvisorSeries, type InsufficientView } from "@/lib/advisor";
import { CLOUD_SPECS, DISK_STEP_GB, PLAN_NUMS, TRAFFIC_STEP_GB, type Plan } from "@/lib/catalog";
import { fa, roundK } from "@/lib/format";
import { invGross } from "@/lib/money";
import { HOURS_PER_MONTH } from "@/lib/paas";
import { addonMonthly, creditForecast, monthKey, perHour, prorate, vpsHourly, vpsPrices } from "../billing-extras";
import { maintainCosts } from "../builder/service";
import type { DB } from "../db/client";
import {
  aiModels, aiUsage, builderProjects, builderRuns, paasApps, paasDbs, paasDeployments, paasEvents, paasLinks, paasMetricsHourly, paasPlans,
  servers, snapshots, storageBuckets, storagePlans, storageUsage, usageHourly, vpsDisks, vpsIps, vpsTraffic, vpsTrafficDaily,
} from "../db/schema";
import { appHourly, dbHourly } from "../paas/service";
import { catalog } from "../rpc/billing";
import { changePlanQuote, packQuote } from "../rpc/vps";
import { getSettings } from "../state";
import { bucketHourly } from "../storage/service";
import { primaryFor } from "../virt/layout";
import { quotaOf } from "../virt/sync";

const DAY = 86400_000;
const H = HOURS_PER_MONTH;
const t = (n: number) => fa(Math.round(n)) + " تومان";
const pct = (n: number) => fa(Math.round(n)) + "٪";

export type Call = [string, unknown[]];
/** «اعمال»: what the client sees plus the server-derived calls ("@vps.downsize" is the stop → changePlan → start flow) */
export type Action = AdvisorActionView & { calls: Call[] };
export type Finding = {
  key: string; rule: AdvisorRule; kind: "server" | "disk" | "app" | "db" | "bucket" | "ai" | "builder" | "wallet";
  resourceId: string; resourceName: string; href: string;
  title: string; detail: string; evidence: AdvisorEvidence;
  saving: number; extraCost: number; oneTime: number; confidence: number; risk: AdvisorRisk;
  action: Action | null;
};
export type Computed = {
  findings: Finding[]; insufficient: InsufficientView[];
  runRate: number; parts: { label: string; amount: number }[];
  balance: number; burn: number; runwayDays: number | null;
};

/* ---------------- statistics ---------------- */
export function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
export const p95 = (v: number[]) => quantile(v, 0.95);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** full days of hourly data (one row per hour) */
export const daysCovered = (dates: Date[]) => Math.floor(new Set(dates.map((d) => Math.floor(d.getTime() / 3600_000))).size / 24);
/** usage confidence: more days of data, more confidence (0.5 … 0.95) */
const usageConfidence = (days: number) => Math.round((0.5 + 0.45 * Math.min(1, days / 30)) * 100) / 100;
const dayLabel = (day: string) => new Date(day + "T12:00:00Z").toLocaleDateString("fa-IR", { month: "short", day: "numeric" });
/** daily averages of one field, oldest first (days with data only) */
function daily<T extends { at: Date }>(rows: T[], f: (r: T) => number, label: string, unit: string): AdvisorSeries {
  const by = new Map<string, { s: number; n: number }>();
  for (const r of rows) { const k = dayOf(r.at); const x = by.get(k) ?? { s: 0, n: 0 }; x.s += f(r); x.n++; by.set(k, x); }
  const days = [...by.keys()].sort();
  return { label, unit, data: days.map((d) => Math.round((by.get(d)!.s / by.get(d)!.n) * 10) / 10), labels: days.map(dayLabel) };
}
const hourlyOrZero = (monthly: number) => (monthly > 0 ? perHour(monthly) : 0);

/** the monthly cost a server bills while it exists (running or stopped): its price, or 720 hours for hourly billing */
export const serverMonthly = (s: { billing: string; price: number }) => (s.billing === "hourly" ? H * vpsHourly(s.price) : s.price);

/* ---------------- cloud servers ---------------- */
type UsageRow = { at: Date; cpu: number; ram: number; disk: number };

/** a catalog cloud plan with its numbers, or undefined for a custom server */
const cloudPlans = async (db: DB) => (await catalog(db)).plans.cloud.filter((p) => p.active !== false && PLAN_NUMS[p.id]).sort((a, b) => a.price - b.price);
const planTrafficGb = (p: Plan) => Math.round((CLOUD_SPECS[p.id]?.tb ?? 0) * 1000);

async function vpsFindings(db: DB, uid: string, now: Date, out: Finding[], insufficient: InsufficientView[]) {
  const list = await db.select().from(servers).where(and(eq(servers.userId, uid), inArray(servers.status, ["running", "stopped"])));
  if (!list.length) return;
  const ids = list.map((s) => s.id);
  const [plansList, prices, usage, traffic, tax, ips, disks, snaps] = await Promise.all([
    cloudPlans(db), vpsPrices(db),
    db.select({ serverId: usageHourly.serverId, at: usageHourly.hour, cpu: usageHourly.cpu, ram: usageHourly.ram, disk: usageHourly.disk }).from(usageHourly)
      .where(and(inArray(usageHourly.serverId, ids), gte(usageHourly.hour, new Date(now.getTime() - 30 * DAY)))).orderBy(asc(usageHourly.hour)),
    db.select().from(vpsTraffic).where(inArray(vpsTraffic.serverId, ids)),
    getSettings(db).then((s) => s.tax),
    db.select().from(vpsIps).where(and(inArray(vpsIps.serverId, ids), isNull(vpsIps.goneAt))),
    db.select().from(vpsDisks).where(and(eq(vpsDisks.userId, uid), isNull(vpsDisks.goneAt), eq(vpsDisks.billed, true))),
    db.select().from(snapshots).where(inArray(snapshots.serverId, ids)).orderBy(sql`${snapshots.createdAt} desc`),
  ]);
  const month = monthKey(now);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const elapsedDays = (now.getTime() - monthStart) / DAY;

  for (const s of list) {
    const rows: UsageRow[] = usage.filter((u) => u.serverId === s.id);
    const days = daysCovered(rows.map((r) => r.at));
    const href = "/panel/servers/" + s.id;
    const cur = plansList.find((p) => p.name === s.plan);
    const tr = traffic.find((x) => x.serverId === s.id && x.month === month);
    const usedGb = tr?.usedGb ?? 0, quota = quotaOf(s.bwLimit, tr?.extraGb ?? 0);
    const projected = elapsedDays >= R.trafficMinDays ? usedGb / ((now.getTime() - monthStart) / (monthEnd - monthStart)) : 0;
    const myIps = ips.filter((x) => x.serverId === s.id), myDisks = disks.filter((d) => d.serverId === s.id), mySnaps = snaps.filter((x) => x.serverId === s.id);
    const snapGb = mySnaps.reduce((a, x) => a + x.size, 0);
    const addons = addonMonthly(prices, s.disk, myIps, myDisks, snapGb).monthly;

    /* ---- sizing (running servers) ---- */
    let undersized = false;
    if (s.status === "running" && days >= R.minRiskDays) {
      const cpu = p95(rows.map((r) => r.cpu)), ram = p95(rows.map((r) => r.ram));
      const hot = rows.filter((r) => r.cpu > R.undersized.cpuSustained).length / Math.max(1, rows.length);
      const disk = rows[rows.length - 1]?.disk ?? 0;
      const ramHigh = ram > R.undersized.ramP95, cpuHigh = hot >= R.undersized.cpuSustainedShare, diskHigh = disk > R.undersized.disk;
      if (ramHigh || cpuHigh || diskHigh) {
        undersized = true;
        const allowance = (await primaryFor(db, s, 0)).allowance;
        const fits = (p: Plan) => { const [c, r, d] = PLAN_NUMS[p.id]; return c >= s.cpu && r >= s.ram && d >= allowance && (cpu / 100) * s.cpu <= R.oversized.headroom * c && (ram / 100) * s.ram <= R.oversized.headroom * r && (disk / 100) * allowance <= R.oversized.headroom * d && p.name !== s.plan; };
        const target = plansList.find(fits);
        const why = [ramHigh && "رم (p95) " + pct(ram), cpuHigh && "CPU در " + pct(hot * 100) + " ساعت‌ها بالای " + pct(R.undersized.cpuSustained), diskHigh && "دیسک " + pct(disk) + " پر"].filter(Boolean).join("، ");
        const lines = ["داده " + fa(days) + " روز اخیر: " + why + ".", ramHigh ? "خطر: با پر شدن رم، سیستم‌عامل پردازه‌ها را می‌کشد (OOM) و سرویس قطع می‌شود." : "", diskHigh ? "خطر: با پر شدن دیسک، پایگاه داده و لاگ‌ها از کار می‌افتند." : ""].filter(Boolean);
        const series = diskHigh && !ramHigh ? daily(rows, (r) => r.disk, "مصرف دیسک", "٪") : ramHigh ? daily(rows, (r) => r.ram, "مصرف رم", "٪") : daily(rows, (r) => r.cpu, "مصرف CPU", "٪");
        if (target) {
          const [c, r, d] = PLAN_NUMS[target.id];
          const extra = s.billing === "hourly" ? H * (vpsHourly(target.price) - vpsHourly(s.price)) : target.price - s.price;
          const once = Math.max(0, prorate(s, target.price, now.getTime()));
          out.push({
            key: "vps_undersized:" + s.id, rule: "vps_undersized", kind: "server", resourceId: s.id, resourceName: s.name, href,
            title: "سرور «" + s.name + "» به منابع بیشتری نیاز دارد",
            detail: "ارتقا به پلن «" + target.name + "» (" + fa(c) + " هسته، " + fa(r) + " گیگ رم، " + fa(d) + " گیگ دیسک) بدون خاموشی.",
            evidence: { lines: [...lines, "هزینه اضافه: " + t(extra) + " در ماه" + (once ? "؛ مابه‌التفاوت روزهای باقی‌مانده این دوره " + t(once) + " (صورتحساب)." : ".")], series },
            saving: 0, extraCost: Math.max(0, extra), oneTime: once, confidence: usageConfidence(days), risk: "high",
            action: { label: "ارتقا به «" + target.name + "»", rpc: "servers.resize", typed: true, destructive: false, preview: "+" + t(extra) + " در ماه (قیمت جدید " + t(s.billing === "hourly" ? H * vpsHourly(target.price) : target.price) + ")" + (once ? "؛ صورتحساب مابه‌التفاوت: " + t(once) : ""), calls: [["servers.resize", [s.id, target.id]]] },
          });
        } else if (diskHigh) {
          const size = Math.max(DISK_STEP_GB, Math.ceil((allowance * 0.5) / DISK_STEP_GB) * DISK_STEP_GB);
          const extra = size * prices.diskGb;
          const name = "data-" + (myDisks.length + 1);
          out.push({
            key: "vps_undersized:" + s.id, rule: "vps_undersized", kind: "server", resourceId: s.id, resourceName: s.name, href,
            title: "دیسک سرور «" + s.name + "» در حال پر شدن است",
            detail: "افزودن دیسک " + fa(size) + " گیگابایتی «" + name + "» و انتقال داده‌های حجیم به آن.",
            evidence: { lines: [...lines, "هزینه دیسک اضافه: " + t(extra) + " در ماه."], series },
            saving: 0, extraCost: extra, oneTime: 0, confidence: usageConfidence(days), risk: "high",
            action: { label: "افزودن دیسک " + fa(size) + " گیگ", rpc: "servers.addDisk", typed: true, destructive: false, preview: "+" + t(extra) + " در ماه، ساعتی از کیف پول", calls: [["servers.addDisk", [s.id, { name, sizeGb: size }]]] },
          });
        } else {
          out.push({
            key: "vps_undersized:" + s.id, rule: "vps_undersized", kind: "server", resourceId: s.id, resourceName: s.name, href,
            title: "سرور «" + s.name + "» به منابع بیشتری نیاز دارد",
            detail: "پلن بزرگ‌تری در فهرست پلن‌ها نیست؛ سرور سفارشی با منابع بیشتر سفارش دهید یا بار را تقسیم کنید.",
            evidence: { lines, series }, saving: 0, extraCost: 0, oneTime: 0, confidence: usageConfidence(days), risk: "high",
            action: { label: "ساخت سرور سفارشی", rpc: "", typed: false, destructive: false, preview: "قیمت در صفحه سفارش", link: "/vps", calls: [] },
          });
        }
      }
    }
    if (s.status === "running" && !undersized) {
      if (days < R.minDays) insufficient.push({ kind: "server", id: s.id, name: s.name, days, reason: "برای پیشنهاد کوچک‌سازی دست‌کم " + fa(R.minDays) + " روز داده مصرف لازم است." });
      else if (cur) {
        const cpu = p95(rows.map((r) => r.cpu)), ram = p95(rows.map((r) => r.ram));
        if (cpu < R.oversized.cpuP95 && ram < R.oversized.ramP95) {
          const fits = (p: Plan) => { const [c, r] = PLAN_NUMS[p.id]; return (ram / 100) * s.ram <= R.oversized.headroom * r && (cpu / 100) * s.cpu <= R.oversized.headroom * c && (s.bwLimit <= 0 || planTrafficGb(p) >= Math.max(projected, usedGb) * 1.2); };
          const target = plansList.filter((p) => p.price < cur.price && p.name !== s.plan).reverse().find(fits);
          if (target) {
            const q = await changePlanQuote(db, s, target.id);
            const saving = s.billing === "hourly" ? H * (vpsHourly(s.price) - vpsHourly(q.price)) : s.price - q.price;
            if (saving >= R.minSaving) {
              const refund = -Math.min(0, prorate(s, q.price, now.getTime()));
              const keptDisk = q.disk > PLAN_NUMS[target.id][2];
              out.push({
                key: "vps_oversized:" + s.id, rule: "vps_oversized", kind: "server", resourceId: s.id, resourceName: s.name, href,
                title: "سرور «" + s.name + "» بزرگ‌تر از نیاز است",
                detail: "تغییر به پلن «" + target.name + "» (" + fa(q.cpu) + " هسته، " + fa(q.ram) + " گیگ رم). برای تغییر، سرور چند دقیقه خاموش و دوباره روشن می‌شود.",
                evidence: {
                  lines: [
                    "در " + fa(days) + " روز اخیر: CPU (p95) " + pct(cpu) + " و رم (p95) " + pct(ram) + " از " + fa(s.cpu) + " هسته و " + fa(s.ram) + " گیگ.",
                    "پلن جدید با ۳۰٪ فضای اطمینان کافی است: رم مورد نیاز حدود " + fa(Math.ceil((ram / 100) * s.ram * 10) / 10) + " گیگ از " + fa(q.ram) + " گیگ.",
                    keptDisk ? "دیسک کوچک نمی‌شود: " + fa(q.disk) + " گیگ فعلی می‌ماند و گیگ‌های بیش از پلن جداگانه حساب می‌شود (در قیمت لحاظ شده)." : "دیسک کوچک نمی‌شود؛ دیسک پلن جدید برای داده‌های فعلی کافی است.",
                    s.bwLimit > 0 ? "ترافیک این ماه " + fa(Math.round(usedGb)) + " گیگ است و در سهمیه پلن جدید (" + fa(planTrafficGb(target)) + " گیگ) جا می‌شود." : "",
                  ].filter(Boolean),
                  series: daily(rows, (r) => r.cpu, "مصرف CPU", "٪"),
                },
                saving, extraCost: 0, oneTime: -refund, confidence: usageConfidence(days), risk: "medium",
                action: { label: "تغییر به «" + target.name + "»", rpc: "servers.changePlan", typed: false, destructive: false, preview: "−" + t(saving) + " در ماه (قیمت جدید " + t(s.billing === "hourly" ? H * vpsHourly(q.price) : q.price) + ")" + (refund ? "؛ بازگشت " + t(refund) + " به کیف پول" : "") + "؛ سرور برای تغییر خاموش و روشن می‌شود", calls: [["@vps.downsize", [s.id, target.id]]] },
              });
            }
          }
        }
      }
    }

    /* ---- traffic ---- */
    if (quota > 0 && projected > quota) {
      const gb = Math.ceil((projected - quota) / TRAFFIC_STEP_GB) * TRAFFIC_STEP_GB;
      const q = await packQuote(db, gb);
      const dailyRows = await db.select().from(vpsTrafficDaily).where(and(eq(vpsTrafficDaily.serverId, s.id), sql`${vpsTrafficDaily.day} like ${month + "-%"}`)).orderBy(asc(vpsTrafficDaily.day));
      out.push({
        key: "traffic_overrun:" + s.id + ":" + month, rule: "traffic_overrun", kind: "server", resourceId: s.id, resourceName: s.name, href,
        title: "ترافیک سرور «" + s.name + "» تا پایان ماه از سهمیه می‌گذرد",
        detail: "خرید " + fa(gb / TRAFFIC_STEP_GB) + " بسته ۵۰۰ گیگابایتی (" + fa(gb) + " گیگ) از همین حالا.",
        evidence: {
          lines: [
            "مصرف این ماه تا امروز " + fa(Math.round(usedGb)) + " گیگ؛ با همین روند تا پایان ماه حدود " + fa(Math.round(projected)) + " گیگ می‌شود و سهمیه " + fa(quota) + " گیگ است.",
            tr?.autoBuy ? "خرید خودکار روشن است: با رسیدن به سقف، بسته " + fa(prices.packGb) + " گیگابایتی به قیمت " + t(prices.packPrice) + " خودکار خریده می‌شود." : "خرید خودکار خاموش است: با رسیدن به سقف، ترافیک سرور محدود می‌شود تا بسته بخرید.",
            "هزینه " + fa(gb / TRAFFIC_STEP_GB) + " بسته: " + t(q.price) + " (یک‌باره، از کیف پول).",
          ],
          series: dailyRows.length ? { label: "ترافیک روزانه", unit: "گیگ", data: dailyRows.map((d) => Math.round((d.inMb + d.outMb) / 102.4) / 10), labels: dailyRows.map((d) => dayLabel(d.day)) } : undefined,
        },
        saving: 0, extraCost: 0, oneTime: q.price, confidence: Math.min(0.9, 0.4 + elapsedDays / 40), risk: "high",
        action: { label: "خرید " + fa(gb) + " گیگ ترافیک", rpc: "servers.buyTraffic", typed: true, destructive: false, preview: t(q.price) + " یک‌باره از کیف پول؛ سهمیه این ماه " + fa(quota + gb) + " گیگ می‌شود", calls: [["servers.buyTraffic", [s.id, gb]]] },
      });
    }

    /* ---- billing mode: an hourly server that runs all month ---- */
    if (s.billing === "hourly" && s.status === "running" && s.createdAt.getTime() <= now.getTime() - R.billingHourlyDays * DAY) {
      const hourly = H * vpsHourly(s.price), monthly = invGross({ items: [{ amount: s.price }], tax });
      if (hourly - monthly >= R.minSaving) {
        out.push({
          key: "billing_monthly:" + s.id, rule: "billing_monthly", kind: "server", resourceId: s.id, resourceName: s.name, href,
          title: "پرداخت ماهانه برای «" + s.name + "» ارزان‌تر است",
          detail: "این سرور ساعتی حساب می‌شود اما بیش از " + fa(R.billingHourlyDays) + " روز است که پیوسته روشن است.",
          evidence: { lines: ["ساعتی: " + t(hourly) + " در ماه؛ ماهانه (با مالیات): " + t(monthly) + "."] },
          saving: hourly - monthly, extraCost: 0, oneTime: 0, confidence: 0.9, risk: "low",
          action: { label: "درخواست تبدیل به ماهانه", rpc: "", typed: false, destructive: false, preview: "تبدیل نوع پرداخت با تیکت انجام می‌شود", link: "/panel/tickets?new=1", calls: [] },
        });
      }
    }

    /* ---- idle: stopped for the whole window, still billed ---- */
    if (s.status === "stopped") {
      const recent = rows.filter((r) => r.at.getTime() >= now.getTime() - R.idleDays * DAY);
      const coverage = daysCovered(recent.map((r) => r.at));
      if (s.createdAt.getTime() <= now.getTime() - R.idleDays * DAY && coverage >= R.idleDays - 1 && recent.every((r) => r.cpu < 1)) {
        const saving = serverMonthly(s) + H * hourlyOrZero(addons);
        out.push({
          key: "idle_server:" + s.id, rule: "idle_server", kind: "server", resourceId: s.id, resourceName: s.name, href,
          title: "سرور «" + s.name + "» بیش از " + fa(R.idleDays) + " روز خاموش است اما هزینه دارد",
          detail: "اگر دیگر لازم نیست، حذفش کنید (قبل از آن از داده‌ها نسخه پشتیبان بگیرید).",
          evidence: { lines: ["در " + fa(coverage) + " روز اخیر سرور خاموش بوده است.", "سرور خاموش هم " + (s.billing === "hourly" ? "ساعتی" : "ماهانه") + " حساب می‌شود: " + t(serverMonthly(s)) + " در ماه" + (addons > 0 ? " به‌علاوه افزونه‌ها." : "."), "حذف سرور همه داده‌های آن را برای همیشه پاک می‌کند."] },
          saving, extraCost: 0, oneTime: 0, confidence: 0.85, risk: "high",
          action: { label: "حذف سرور", rpc: "servers.remove", typed: true, destructive: true, preview: "−" + t(saving) + " در ماه؛ همه داده‌ها پاک می‌شود", calls: [["servers.remove", [s.id]]] },
        });
      } else if (coverage < R.idleDays - 1) insufficient.push({ kind: "server", id: s.id, name: s.name, days: coverage, reason: "سرور خاموش است؛ برای پیشنهاد حذف دست‌کم " + fa(R.idleDays) + " روز داده لازم است." });
    }

    /* ---- old manual snapshots ---- */
    const manual = mySnaps.filter((x) => !x.name.startsWith("auto-"));
    const old = manual.slice(R.keepSnapshots).filter((x) => x.createdAt.getTime() <= now.getTime() - R.snapshotAgeDays * DAY);
    if (old.length) {
      const freed = old.reduce((a, x) => a + x.size, 0);
      const after = addonMonthly(prices, s.disk, myIps, myDisks, snapGb - freed).monthly;
      const saving = H * (hourlyOrZero(addons) - hourlyOrZero(after));
      if (saving >= R.minSaving) {
        out.push({
          key: "old_snapshots:" + s.id, rule: "old_snapshots", kind: "server", resourceId: s.id, resourceName: s.name, href,
          title: fa(old.length) + " اسنپ‌شات قدیمی سرور «" + s.name + "»",
          detail: "جدیدترین " + fa(R.keepSnapshots) + " اسنپ‌شات می‌ماند و اسنپ‌شات‌های قدیمی‌تر از " + fa(R.snapshotAgeDays) + " روز حذف می‌شوند.",
          evidence: { lines: [old.map((x) => "«" + x.name + "» (" + fa(Math.round(x.size * 10) / 10) + " گیگ)").join("، "), "فضای آزادشده: " + fa(Math.round(freed * 10) / 10) + " گیگ."] },
          saving, extraCost: 0, oneTime: 0, confidence: 0.95, risk: "high",
          action: { label: "حذف " + fa(old.length) + " اسنپ‌شات", rpc: "servers.deleteSnapshot", typed: true, destructive: true, preview: "−" + t(saving) + " در ماه؛ این نسخه‌ها دیگر قابل بازگردانی نیستند", calls: old.map((x): Call => ["servers.deleteSnapshot", [s.id, x.id]]) },
        });
      }
    }
  }
}

/** detached extra disks: billed together per account, so each one's saving is the drop in that hourly charge */
async function diskFindings(db: DB, uid: string, out: Finding[]) {
  const detached = await db.select().from(vpsDisks).where(and(eq(vpsDisks.userId, uid), isNull(vpsDisks.serverId), isNull(vpsDisks.goneAt), eq(vpsDisks.billed, true)));
  if (!detached.length) return;
  const p = await vpsPrices(db);
  const total = detached.reduce((a, d) => a + d.sizeGb * p.diskGb, 0);
  for (const d of detached) {
    const saving = H * (hourlyOrZero(total) - hourlyOrZero(total - d.sizeGb * p.diskGb));
    if (saving < R.minSaving) continue;
    out.push({
      key: "detached_disk:" + d.id, rule: "detached_disk", kind: "disk", resourceId: d.id, resourceName: d.name, href: "/panel/servers",
      title: "دیسک «" + d.name + "» به هیچ سروری وصل نیست",
      detail: "دیسک جداشده داده‌هایش را نگه می‌دارد و هزینه فضا دارد؛ اگر لازم نیست حذفش کنید.",
      evidence: { lines: [fa(d.sizeGb) + " گیگابایت، " + t(d.sizeGb * p.diskGb) + " در ماه.", "حذف دیسک داده‌های آن را برای همیشه پاک می‌کند."] },
      saving, extraCost: 0, oneTime: 0, confidence: 0.95, risk: "high",
      action: { label: "حذف دیسک", rpc: "servers.deleteDisk", typed: true, destructive: true, preview: "−" + t(saving) + " در ماه؛ داده‌های دیسک پاک می‌شود", calls: [["servers.deleteDisk", [d.id, d.name]]] },
    });
  }
}

/* ---------------- Gereh Apps and managed databases ---------------- */
async function paasFindings(db: DB, uid: string, now: Date, out: Finding[], insufficient: InsufficientView[]) {
  const [apps, dbs] = await Promise.all([
    db.select().from(paasApps).where(and(eq(paasApps.userId, uid), inArray(paasApps.status, ["running", "stopped", "failed", "building"]))),
    db.select().from(paasDbs).where(and(eq(paasDbs.userId, uid), eq(paasDbs.status, "running"))),
  ]);
  if (!apps.length && !dbs.length) return;
  const plans = new Map((await db.select().from(paasPlans)).map((p) => [p.id, p]));
  const targets = [...apps.map((a) => a.id), ...dbs.map((d) => d.id)];
  const metrics = (await db.select().from(paasMetricsHourly).where(and(inArray(paasMetricsHourly.target, targets), gte(paasMetricsHourly.hour, new Date(now.getTime() - 30 * DAY))))).map((m) => ({ ...m, at: m.hour }));
  const since14 = now.getTime() - R.idleDays * DAY;

  for (const app of apps) {
    const plan = plans.get(app.planId);
    if (!plan) continue;
    const href = "/panel/apps/" + app.id;
    const appCost = H * appHourly(app, plan);

    /* preview left running */
    if (app.previewDeployment) {
      const [dep] = await db.select({ at: paasDeployments.createdAt, branch: paasDeployments.branch }).from(paasDeployments).where(eq(paasDeployments.id, app.previewDeployment));
      if (dep && dep.at.getTime() <= now.getTime() - 7 * DAY) {
        const saving = appCost - H * appHourly({ ...app, previewDeployment: null }, plan);
        if (saving >= R.minSaving) out.push({
          key: "preview_running:" + app.id, rule: "preview_running", kind: "app", resourceId: app.id, resourceName: app.name, href,
          title: "پیش‌نمایش اپ «" + app.name + "» هنوز روشن است",
          detail: "پیش‌نمایش" + (dep.branch ? " شاخه «" + dep.branch + "»" : "") + " از " + fa(Math.floor((now.getTime() - dep.at.getTime()) / DAY)) + " روز پیش روشن مانده و مثل یک نمونه اضافه حساب می‌شود.",
          evidence: { lines: ["هزینه پیش‌نمایش: " + t(saving) + " در ماه.", "نسخه اصلی اپ دست نمی‌خورد."] },
          saving, extraCost: 0, oneTime: 0, confidence: 0.95, risk: "low",
          action: { label: "حذف پیش‌نمایش", rpc: "paas.removePreview", typed: false, destructive: false, preview: "−" + t(saving) + " در ماه", calls: [["paas.removePreview", [app.id]]] },
        });
      }
    }
    if (app.status !== "running") continue;

    const rows = metrics.filter((m) => m.target === app.id);
    const days = daysCovered(rows.map((r) => r.at));
    /* OOM restarts → a plan with more memory */
    const [ooms] = await db.select({ n: sql<number>`count(*)::int` }).from(paasEvents).where(and(eq(paasEvents.appId, app.id), eq(paasEvents.kind, "oom"), gte(paasEvents.createdAt, new Date(since14))));
    if ((ooms?.n ?? 0) >= R.oomEvents) {
      const next = [...plans.values()].filter((p) => p.kind === "app" && p.active && p.ramMb > plan.ramMb && p.price > plan.price).sort((a, b) => a.price - b.price)[0];
      if (next) {
        const extra = H * appHourly(app, next) - appCost;
        out.push({
          key: "paas_oom:" + app.id, rule: "paas_oom", kind: "app", resourceId: app.id, resourceName: app.name, href,
          title: "اپ «" + app.name + "» به خاطر کمبود حافظه ری‌استارت می‌شود",
          detail: "ارتقا به پلن «" + next.name + "» (" + fa(next.ramMb) + " مگابایت رم، " + fa(next.cpu) + " هسته).",
          evidence: { lines: [fa(ooms!.n) + " بار توقف با کمبود حافظه (OOM) در " + fa(R.idleDays) + " روز اخیر با " + fa(plan.ramMb) + " مگابایت رم.", "هزینه اضافه: " + t(extra) + " در ماه."], series: rows.length ? daily(rows, (r) => r.ramMb, "مصرف رم", "مگابایت") : undefined },
          saving: 0, extraCost: extra, oneTime: 0, confidence: 0.9, risk: "high",
          action: { label: "ارتقا به «" + next.name + "»", rpc: "paas.scale", typed: true, destructive: false, preview: "+" + t(extra) + " در ماه، ساعتی از کیف پول", calls: [["paas.scale", [app.id, { planId: next.id, instances: app.instances, autoscale: app.autoscale, maxInstances: app.maxInstances, diskGb: app.diskGb, autoscaleCpu: app.autoscaleCpu }]]] },
        });
      }
    }
    if (days < R.minDays) { insufficient.push({ kind: "app", id: app.id, name: app.name, days, reason: "برای پیشنهاد کوچک‌سازی یا توقف اپ دست‌کم " + fa(R.minDays) + " روز داده لازم است." }); continue; }
    const recent = rows.filter((r) => r.at.getTime() >= since14);
    const cpu = p95(rows.map((r) => r.cpu));
    const rpm = recent.reduce((a, r) => a + r.rpm, 0) / Math.max(1, recent.length);
    /* idle: no requests, or next to no CPU and traffic, for the window */
    if (recent.every((r) => r.rpm === 0) || (p95(recent.map((r) => r.cpu)) < R.idleAppCpu && rpm < 0.1)) {
      const saving = appCost - H * appHourly({ ...app, status: "stopped" }, plan);
      if (saving >= R.minSaving) out.push({
        key: "idle_app:" + app.id, rule: "idle_app", kind: "app", resourceId: app.id, resourceName: app.name, href,
        title: "اپ «" + app.name + "» در " + fa(R.idleDays) + " روز اخیر تقریباً استفاده نشده است",
        detail: "خاموش کردن اپ هزینه نمونه‌ها را حذف می‌کند" + (app.diskGb ? " (دیسک دائمی و هزینه آن می‌ماند)" : "") + "؛ هر وقت لازم شد دوباره روشنش کنید.",
        evidence: { lines: ["میانگین درخواست در دقیقه: " + fa(Math.round(rpm * 100) / 100) + "؛ CPU (p95): " + pct(p95(recent.map((r) => r.cpu))) + "."], series: daily(rows, (r) => r.rpm, "درخواست در دقیقه", "") },
        saving, extraCost: 0, oneTime: 0, confidence: usageConfidence(days), risk: "medium",
        action: { label: "خاموش کردن اپ", rpc: "paas.power", typed: false, destructive: false, preview: "−" + t(saving) + " در ماه؛ اپ تا روشن کردن دوباره در دسترس نیست", calls: [["paas.power", [app.id, "stop"]]] },
      });
      continue;
    }
    /* more instances than the load needs */
    if (app.instances >= 2 && !app.autoscale) {
      const needed = Math.max(1, Math.ceil((app.instances * cpu) / R.instancesTargetCpu));
      if (needed < app.instances) {
        const saving = appCost - H * appHourly({ ...app, instances: needed }, plan);
        if (saving >= R.minSaving) out.push({
          key: "paas_instances:" + app.id, rule: "paas_instances", kind: "app", resourceId: app.id, resourceName: app.name, href,
          title: "اپ «" + app.name + "» نمونه بیش از نیاز دارد",
          detail: "کاهش به " + fa(needed) + " نمونه و روشن کردن مقیاس خودکار تا " + fa(app.instances) + " نمونه برای اوج‌ها.",
          evidence: { lines: ["CPU (p95) هر نمونه در " + fa(days) + " روز اخیر: " + pct(cpu) + " از پلن «" + plan.name + "».", fa(needed) + " نمونه با هدف " + pct(R.instancesTargetCpu) + " CPU کافی است."], series: daily(rows, (r) => r.cpu, "CPU", "٪") },
          saving, extraCost: 0, oneTime: 0, confidence: usageConfidence(days), risk: "low",
          action: { label: "کاهش به " + fa(needed) + " نمونه + مقیاس خودکار", rpc: "paas.scale", typed: false, destructive: false, preview: "−" + t(saving) + " در ماه در بار عادی؛ در اوج تا " + fa(app.instances) + " نمونه بالا می‌رود", calls: [["paas.scale", [app.id, { planId: plan.id, instances: needed, autoscale: true, maxInstances: app.instances, diskGb: app.diskGb, autoscaleCpu: app.autoscaleCpu }]]] },
        });
      }
    }
  }

  const links = dbs.length ? await db.select({ dbId: paasLinks.dbId, status: paasApps.status }).from(paasLinks).innerJoin(paasApps, eq(paasApps.id, paasLinks.appId)).where(inArray(paasLinks.dbId, dbs.map((d) => d.id))) : [];
  for (const d of dbs) {
    const plan = plans.get(d.planId);
    if (!plan) continue;
    // a database a running app uses is never called idle
    if (links.some((l) => l.dbId === d.id && l.status === "running")) continue;
    const rows = metrics.filter((m) => m.target === d.id);
    const days = daysCovered(rows.map((r) => r.at));
    if (days < R.minDays) { insufficient.push({ kind: "db", id: d.id, name: d.name, days, reason: "برای تشخیص پایگاه داده بی‌استفاده دست‌کم " + fa(R.minDays) + " روز داده لازم است." }); continue; }
    const cpu = p95(rows.filter((r) => r.at.getTime() >= since14).map((r) => r.cpu));
    if (cpu >= R.idleDbCpu) continue;
    const saving = H * (dbHourly(d, plan) - dbHourly({ status: "stopped" }, plan));
    if (saving < R.minSaving) continue;
    out.push({
      key: "idle_db:" + d.id, rule: "idle_db", kind: "db", resourceId: d.id, resourceName: d.name, href: "/panel/databases/" + d.id,
      title: "پایگاه داده «" + d.name + "» فعالیتی ندارد",
      detail: "به هیچ اپ روشنی وصل نیست و CPU آن نزدیک صفر است؛ خاموشش کنید (داده‌ها می‌ماند و فقط هزینه فضا حساب می‌شود).",
      evidence: { lines: ["CPU (p95) در " + fa(R.idleDays) + " روز اخیر: " + pct(cpu) + "."], series: daily(rows, (r) => r.cpu, "CPU", "٪") },
      saving, extraCost: 0, oneTime: 0, confidence: usageConfidence(days), risk: "medium",
      action: { label: "خاموش کردن پایگاه داده", rpc: "paas.dbPower", typed: false, destructive: false, preview: "−" + t(saving) + " در ماه؛ داده‌ها حفظ می‌شود", calls: [["paas.dbPower", [d.id, "stop"]]] },
    });
  }
}

/* ---------------- object storage ---------------- */
async function storageFindings(db: DB, uid: string, now: Date, out: Finding[]) {
  const buckets = await db.select().from(storageBuckets).where(and(eq(storageBuckets.userId, uid), eq(storageBuckets.status, "active")));
  if (!buckets.length) return;
  const plans = new Map((await db.select().from(storagePlans)).map((p) => [p.id, p]));
  const since = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
  const usage = await db.select().from(storageUsage).where(and(inArray(storageUsage.bucketId, buckets.map((b) => b.id)), gte(storageUsage.day, since)));
  for (const b of buckets) {
    const saving = H * bucketHourly(plans.get(b.planId));
    if (saving < R.minSaving) continue;
    const rows = usage.filter((u) => u.bucketId === b.id);
    const empty = b.objects === 0 && b.usedBytes === 0 && b.createdAt.getTime() <= now.getTime() - R.idleDays * DAY;
    const unused = !empty && rows.length >= R.minDays && b.createdAt.getTime() <= now.getTime() - 30 * DAY && rows.every((r) => r.requests === 0);
    if (!empty && !unused) continue;
    out.push({
      key: "empty_bucket:" + b.id, rule: "empty_bucket", kind: "bucket", resourceId: b.id, resourceName: b.name, href: "/panel/storage/" + b.id,
      title: empty ? "باکت «" + b.name + "» خالی است" : "باکت «" + b.name + "» در ۳۰ روز اخیر استفاده نشده است",
      detail: empty ? "باکت خالی هم هزینه پلن را دارد؛ اگر لازم نیست حذفش کنید." : "هیچ درخواستی به این باکت نرسیده است؛ اگر فایل‌هایش لازم نیست، حذفش کنید.",
      evidence: { lines: [empty ? "بدون فایل، از " + fa(Math.floor((now.getTime() - b.createdAt.getTime()) / DAY)) + " روز پیش." : fa(b.objects) + " فایل، " + fa(Math.round(b.usedBytes / 1e9 * 10) / 10) + " گیگ؛ صفر درخواست در " + fa(rows.length) + " روز.", "هزینه پلن: " + t(saving) + " در ماه."] },
      saving, extraCost: 0, oneTime: 0, confidence: empty ? 0.95 : 0.8, risk: empty ? "low" : "high",
      action: { label: "حذف باکت", rpc: "storage.remove", typed: true, destructive: !empty, preview: "−" + t(saving) + " در ماه" + (empty ? "" : "؛ همه فایل‌ها پاک می‌شود"), calls: [["storage.remove", [b.id, b.name]]] },
    });
  }
}

/* ---------------- AI API ---------------- */
const blended = (m: { inPrice: number; outPrice: number }) => m.inPrice + 4 * m.outPrice;
async function aiFindings(db: DB, uid: string, now: Date, out: Finding[]) {
  const since = new Date(now.getTime() - R.ai.days * DAY);
  const usage = await db.select({ model: aiUsage.model, n: sql<number>`count(*)::int`, inT: sql<number>`coalesce(sum(${aiUsage.inTokens}),0)::bigint`, outT: sql<number>`coalesce(sum(${aiUsage.outTokens}),0)::bigint`, charged: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` })
    .from(aiUsage).where(and(eq(aiUsage.userId, uid), eq(aiUsage.status, "success"), gte(aiUsage.createdAt, since), sql`${aiUsage.format} <> 'panel'`)).groupBy(aiUsage.model);
  if (!usage.length) return;
  const catalogModels = await db.select().from(aiModels).where(and(eq(aiModels.active, true), eq(aiModels.kind, "chat")));
  for (const u of usage) {
    const n = Number(u.n), inT = Number(u.inT), outT = Number(u.outT), charged = Number(u.charged);
    const m = catalogModels.find((x) => x.id === u.model);
    if (!m || n < R.ai.minRequests || outT / n > R.ai.maxAvgOut) continue;
    const cand = catalogModels
      .filter((c) => c.id !== m.id && c.vendor === m.vendor && c.outPrice > 0 && c.context >= Math.min(m.context, 128_000) && (!m.vision || c.vision) && (!m.tools || c.tools) && blended(c) <= R.ai.maxPriceShare * blended(m))
      .sort((a, b) => blended(b) - blended(a))[0];
    if (!cand) continue;
    const saving = charged - costOf(inT, outT, cand);
    if (saving < R.minSaving) continue;
    const days = await db.select({ day: sql<string>`to_char(${aiUsage.createdAt}, 'YYYY-MM-DD')`, s: sql<number>`sum(${aiUsage.charged})::bigint` }).from(aiUsage)
      .where(and(eq(aiUsage.userId, uid), eq(aiUsage.model, m.id), eq(aiUsage.status, "success"), gte(aiUsage.createdAt, since))).groupBy(sql`1`).orderBy(sql`1`);
    out.push({
      key: "ai_model:" + m.id, rule: "ai_model", kind: "ai", resourceId: m.id, resourceName: m.name, href: "/panel/ai",
      title: "درخواست‌های کوتاه با مدل گران «" + m.name + "»",
      detail: "برای کارهای ساده با خروجی کوتاه، مدل «" + cand.name + "» از همان سازنده با قابلیت‌های مشابه کافی است.",
      evidence: {
        lines: [fa(n) + " درخواست در " + fa(R.ai.days) + " روز اخیر با میانگین " + fa(Math.round(outT / n)) + " توکن خروجی؛ هزینه " + t(charged) + ".", "همین حجم با «" + cand.name + "»: " + t(charged - saving) + "."],
        series: { label: "هزینه روزانه", unit: "تومان", data: days.map((d) => Number(d.s)), labels: days.map((d) => dayLabel(d.day)) },
      },
      saving, extraCost: 0, oneTime: 0, confidence: 0.6, risk: "low",
      action: { label: "مدل‌ها و مستندات API", rpc: "", typed: false, destructive: false, preview: "تغییر مدل در کد شما انجام می‌شود؛ تغییر خودکاری داده نمی‌شود", link: "/panel/ai", calls: [] },
    });
  }
}

/* ---------------- بافت maintenance ---------------- */
async function builderFindings(db: DB, uid: string, now: Date, out: Finding[]) {
  const projects = await db.select().from(builderProjects).where(and(eq(builderProjects.userId, uid), eq(builderProjects.maintainMode, "continuous")));
  const since = new Date(now.getTime() - R.builderQuietDays * DAY);
  for (const p of projects) {
    if (!p.appId || p.createdAt > since) continue;
    const [ev] = await db.select({ n: sql<number>`count(*)::int` }).from(paasEvents).where(and(eq(paasEvents.appId, p.appId), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]), gte(paasEvents.createdAt, since)));
    const [runs] = await db.select({ n: sql<number>`count(*) filter (where ${builderRuns.incident} not in ('scan', 'manual', ''))::int`, scan: sql<number>`coalesce(sum(${builderRuns.cost}) filter (where ${builderRuns.incident} = 'scan'), 0)::bigint` })
      .from(builderRuns).where(and(eq(builderRuns.projectId, p.id), eq(builderRuns.kind, "maintain"), gte(builderRuns.createdAt, since)));
    if ((ev?.n ?? 0) + (runs?.n ?? 0) > 0) continue;
    const { continuousMonthly } = await maintainCosts(db, p);
    if (continuousMonthly < R.minSaving) continue;
    out.push({
      key: "builder_mode:" + p.id, rule: "builder_mode", kind: "builder", resourceId: p.id, resourceName: p.name, href: "/panel/build/" + p.id,
      title: "پایش ۲۴ ساعته «" + p.name + "» بدون حادثه",
      detail: "در " + fa(R.builderQuietDays) + " روز اخیر حادثه‌ای نبوده است؛ حالت «هنگام حادثه» فقط وقتی اپ مشکل دارد هزینه AI دارد.",
      evidence: { lines: ["پایش هر " + fa(p.scanEvery) + " دقیقه: حدود " + t(continuousMonthly) + " در ماه.", "هزینه واقعی پایش در " + fa(R.builderQuietDays) + " روز اخیر: " + t(Number(runs?.scan ?? 0)) + "."] },
      saving: continuousMonthly, extraCost: 0, oneTime: 0, confidence: 0.85, risk: "low",
      action: { label: "تغییر به «هنگام حادثه»", rpc: "builder.update", typed: false, destructive: false, preview: "حدود −" + t(continuousMonthly) + " در ماه هزینه AI", calls: [["builder.update", [p.id, { maintainMode: "incident" }]]] },
    });
  }
}

/* ---------------- the whole account ---------------- */
async function runRate(db: DB, uid: string, now: Date) {
  const prices = await vpsPrices(db);
  const [svs, apps, dbs, buckets, plansRows, splans, ips, disks, snaps, ai] = await Promise.all([
    db.select().from(servers).where(and(eq(servers.userId, uid), inArray(servers.status, ["running", "stopped", "relayout"]))),
    db.select().from(paasApps).where(and(eq(paasApps.userId, uid), inArray(paasApps.status, ["running", "building", "stopped", "failed"]))),
    db.select().from(paasDbs).where(and(eq(paasDbs.userId, uid), inArray(paasDbs.status, ["running", "stopped", "creating"]))),
    db.select().from(storageBuckets).where(and(eq(storageBuckets.userId, uid), eq(storageBuckets.status, "active"))),
    db.select().from(paasPlans), db.select().from(storagePlans),
    db.select().from(vpsIps).where(and(eq(vpsIps.userId, uid), isNull(vpsIps.goneAt))),
    db.select().from(vpsDisks).where(and(eq(vpsDisks.userId, uid), isNull(vpsDisks.goneAt), eq(vpsDisks.billed, true))),
    db.select({ serverId: snapshots.serverId, gb: sql<number>`sum(${snapshots.size})::float` }).from(snapshots).innerJoin(servers, eq(servers.id, snapshots.serverId)).where(eq(servers.userId, uid)).groupBy(snapshots.serverId),
    db.select({ s: sql<number>`coalesce(sum(${aiUsage.charged}),0)::bigint` }).from(aiUsage).where(and(eq(aiUsage.userId, uid), gte(aiUsage.createdAt, new Date(now.getTime() - 30 * DAY)))),
  ]);
  const pp = new Map(plansRows.map((p) => [p.id, p])), sp = new Map(splans.map((p) => [p.id, p]));
  const addons = svs.reduce((a, s) => a + H * hourlyOrZero(addonMonthly(prices, s.disk, ips.filter((x) => x.serverId === s.id), disks.filter((d) => d.serverId === s.id), Number(snaps.find((x) => x.serverId === s.id)?.gb ?? 0)).monthly), 0)
    + H * hourlyOrZero(disks.filter((d) => !d.serverId).reduce((a, d) => a + d.sizeGb * prices.diskGb, 0));
  const parts = [
    { label: "سرورهای ابری", amount: svs.reduce((a, s) => a + serverMonthly(s), 0) },
    { label: "افزونه‌های سرور (IP، دیسک، اسنپ‌شات)", amount: addons },
    { label: "اپ‌ها", amount: apps.reduce((a, x) => a + (pp.get(x.planId) ? H * appHourly(x, pp.get(x.planId)!) : 0), 0) },
    { label: "پایگاه‌های داده", amount: dbs.reduce((a, x) => a + (pp.get(x.planId) ? H * dbHourly(x, pp.get(x.planId)!) : 0), 0) },
    { label: "فضای ذخیره‌سازی", amount: buckets.reduce((a, b) => a + H * bucketHourly(sp.get(b.planId)), 0) },
    { label: "API هوش مصنوعی (۳۰ روز اخیر)", amount: Number(ai[0]?.s ?? 0) },
  ].filter((p) => p.amount > 0);
  return { runRate: parts.reduce((a, p) => a + p.amount, 0), parts };
}

/** every rule for one account, newest data; deterministic for the same rows and `now` */
export async function computeFindings(db: DB, uid: string, now = new Date()): Promise<Computed> {
  const findings: Finding[] = [], insufficient: InsufficientView[] = [];
  await vpsFindings(db, uid, now, findings, insufficient);
  await diskFindings(db, uid, findings);
  await paasFindings(db, uid, now, findings, insufficient);
  await storageFindings(db, uid, now, findings);
  await aiFindings(db, uid, now, findings);
  await builderFindings(db, uid, now, findings);
  const f = await creditForecast(db, uid);
  if (f.burn > 0 && f.days !== null && f.days < R.runwayWarnDays) {
    const topup = Math.max(0, roundK(f.burn * 30 - f.balance));
    findings.push({
      key: "wallet_runway:" + uid, rule: "wallet_runway", kind: "wallet", resourceId: uid, resourceName: "کیف پول", href: "/panel/billing?tab=wallet",
      title: f.days < 1 ? "موجودی کیف پول امروز تمام می‌شود" : "موجودی کیف پول حدود " + fa(Math.floor(f.days)) + " روز دیگر تمام می‌شود",
      detail: "با تمام شدن موجودی، سرویس‌های ساعتی معلق می‌شوند. برای یک ماه مصرف حدود " + t(topup) + " شارژ کنید.",
      evidence: { lines: ["موجودی: " + t(f.balance) + "؛ مصرف روزانه (میانگین ۷ روز): " + t(f.burn) + "."] },
      saving: 0, extraCost: 0, oneTime: 0, confidence: 0.8, risk: f.days < R.runwayRiskDays ? "high" : "medium",
      action: { label: "شارژ کیف پول", rpc: "", typed: false, destructive: false, preview: "پیشنهاد: " + t(topup), link: "/panel/billing?tab=wallet", calls: [] },
    });
  }
  const rr = await runRate(db, uid, now);
  return { findings, insufficient, ...rr, balance: f.balance, burn: f.burn, runwayDays: f.days };
}
