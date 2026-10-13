/* Gereh Apps per-app spend (budgets), traffic (alerts) and runtime events, run from the hourly
   billing and the 5-minute collection in ./paas.ts. */
import "server-only";
import { and, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { GB, dayKey, monthKey } from "@/lib/paas-runtime";
import type { DB } from "../db/client";
import { paasApps, paasEvents, paasRuntime, paasSpend, paasTraffic } from "../db/schema";
import { enqueue } from "../jobs";
import { paas } from "../paas/driver";
import { logEvent } from "../paas/runtime";
import { appSpec } from "../paas/service";
import { notify } from "../util";

type App = typeof paasApps.$inferSelect;
const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");

/** adds this hour's charge of each app to its month */
export async function recordSpend(db: DB, items: { appId: string; amount: number }[], month = monthKey()) {
  for (const it of items) if (it.amount > 0) await db.insert(paasSpend).values({ appId: it.appId, month, amount: it.amount })
    .onConflictDoUpdate({ target: [paasSpend.appId, paasSpend.month], set: { amount: sql`${paasSpend.amount} + ${it.amount}` } });
}

/** alert at the threshold, and at the cap alert again and (optionally) stop the app; once per month each */
export async function paasBudgets(db: DB, month = monthKey()) {
  const rows = await db.select({ r: paasRuntime, a: paasApps, spent: paasSpend.amount }).from(paasRuntime)
    .innerJoin(paasApps, eq(paasApps.id, paasRuntime.appId))
    .leftJoin(paasSpend, and(eq(paasSpend.appId, paasRuntime.appId), eq(paasSpend.month, month)))
    .where(gt(paasRuntime.budget, 0));
  for (const { r, a, spent: s } of rows) {
    const spent = s ?? 0;
    if (spent >= r.budget && r.budgetNotified !== month + ":cap") {
      const stop = r.budgetStop && a.status === "running" && !!a.liveDeployment;
      const text = "هزینه اپ " + a.name + " این ماه به سقف بودجه (" + fa(r.budget) + " تومان) رسید" + (stop ? " و اپ خاموش شد" : "");
      if (stop) {
        await (await paas()).setState(await appSpec(db, a), "stop");
        await db.update(paasApps).set({ status: "stopped" }).where(eq(paasApps.id, a.id));
        await logEvent(db, a.id, "stop", "خاموش شدن خودکار با رسیدن به سقف بودجه");
      }
      await db.update(paasRuntime).set({ budgetNotified: month + ":cap" }).where(eq(paasRuntime.appId, a.id));
      await logEvent(db, a.id, "budget", text);
      await notify(db, a.userId, "wallet", text);
      await enqueue(db, "notify.send", { userId: a.userId, kind: "billing", subject: "سقف بودجه اپ " + a.name, text: text + ". هزینه تا این لحظه: " + fa(spent) + " تومان. بودجه را از پنل گره › اپ‌ها › مصرف و بودجه تغییر دهید." });
    } else if (spent < r.budget && spent * 100 >= r.budget * r.budgetAlertPct && !r.budgetNotified.startsWith(month + ":")) {
      const text = "هزینه اپ " + a.name + " این ماه به " + fa(r.budgetAlertPct) + "٪ بودجه رسید (" + fa(spent) + " از " + fa(r.budget) + " تومان)";
      await db.update(paasRuntime).set({ budgetNotified: month + ":alert" }).where(eq(paasRuntime.appId, a.id));
      await logEvent(db, a.id, "budget", text);
      await notify(db, a.userId, "wallet", text);
    }
  }
}

/** first Tehran day (YYYY-MM-DD) of the Jalali month that contains `d` */
export function monthStartDay(d = new Date()) {
  const m = monthKey(d);
  let t = d.getTime();
  for (let i = 0; i < 32 && monthKey(new Date(t - 86400_000)) === m; i++) t -= 86400_000;
  return dayKey(new Date(t));
}
export async function monthTraffic(db: DB, appIds: string[], d = new Date()) {
  if (!appIds.length) return new Map<string, number>();
  const rows = await db.select({ appId: paasTraffic.appId, bytes: sql<number>`sum(${paasTraffic.bytes})::float8` }).from(paasTraffic)
    .where(and(inArray(paasTraffic.appId, appIds), gte(paasTraffic.day, monthStartDay(d)))).groupBy(paasTraffic.appId);
  return new Map(rows.map((r) => [r.appId, Number(r.bytes)]));
}

/** every 5 minutes: traffic of running apps, traffic alerts, crashes / OOM kills / failed health checks */
export async function paasRuntimeCollect(db: DB, apps: App[]) {
  if (!apps.length) return;
  const d = await paas();
  const bytes = await d.traffic(apps.map((a) => ({ id: a.id, owner: a.userId, name: a.name }))).catch(() => new Map<string, number>());
  const day = dayKey();
  for (const [appId, n] of bytes) if (n > 0) await db.insert(paasTraffic).values({ appId, day, bytes: Math.round(n) })
    .onConflictDoUpdate({ target: [paasTraffic.appId, paasTraffic.day], set: { bytes: sql`${paasTraffic.bytes} + ${Math.round(n)}` } });

  const month = monthKey();
  const alerts = await db.select().from(paasRuntime).where(and(inArray(paasRuntime.appId, apps.map((a) => a.id)), gt(paasRuntime.trafficAlertGb, 0)));
  const used = await monthTraffic(db, alerts.map((r) => r.appId));
  for (const r of alerts) {
    const gb = (used.get(r.appId) ?? 0) / GB;
    if (gb < r.trafficAlertGb || r.trafficNotified === month) continue;
    const a = apps.find((x) => x.id === r.appId)!;
    const text = "ترافیک اپ " + a.name + " این ماه از " + fa(r.trafficAlertGb) + " گیگابایت گذشت (" + gb.toLocaleString("fa-IR", { maximumFractionDigits: 1 }) + " گیگ)";
    await db.update(paasRuntime).set({ trafficNotified: month }).where(eq(paasRuntime.appId, r.appId));
    await logEvent(db, a.id, "traffic", text);
    await notify(db, a.userId, "activity", text);
  }

  for (const a of apps) {
    if (!a.liveDeployment) continue;
    const [last] = await db.select({ at: paasEvents.createdAt }).from(paasEvents).where(and(eq(paasEvents.appId, a.id), inArray(paasEvents.kind, ["crash", "oom", "health_failed"]))).orderBy(desc(paasEvents.createdAt)).limit(1);
    const since = new Date(Math.max(Date.now() - 6 * 60_000, last ? last.at.getTime() : 0));
    const evs = await d.appEvents(await appSpec(db, a), since).catch(() => []);
    for (const e of evs.filter((x) => x.at > since).slice(0, 20)) {
      await logEvent(db, a.id, e.kind, e.message, e.at);
      if (e.kind === "oom") await notify(db, a.userId, "circle-alert", "اپ " + a.name + " به‌خاطر کمبود حافظه ری‌استارت شد؛ پلن بزرگ‌تر را در نظر بگیرید");
    }
  }
}
