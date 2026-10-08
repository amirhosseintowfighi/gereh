/* Geo DNS jobs: monthly renewals from the wallet, server health and nameserver delegation. */
import "server-only";
import { Socket } from "node:net";
import { and, eq, inArray, lte } from "drizzle-orm";
import { faDate } from "@/lib/jalali";
import { toman } from "@/lib/format";
import type { DB } from "../db/client";
import { geoPlans, geoRecords, geoZones } from "../db/schema";
import { enqueue } from "../jobs";
import { addMonth, charge, checkDelegation, syncZone } from "../geo/service";
import { notify } from "../util";

/** renews zones due within 3 days; a zone past its paid date without credit is served without the geo split */
export async function geoBilling(db: DB) {
  const soon = new Date(Date.now() + 3 * 86400_000);
  const due = await db.select().from(geoZones).where(and(lte(geoZones.paidUntil, soon), inArray(geoZones.status, ["pending", "active", "suspended"])));
  const plans = new Map((await db.select().from(geoPlans)).map((p) => [p.id, p]));
  for (const z of due) {
    const plan = plans.get(z.planId);
    if (!plan) continue;
    if (z.autoRenew && await db.transaction((tx) => charge(tx, z.userId, plan.price, "تمدید Geo DNS " + z.domain + " (" + plan.name + ")"))) {
      const until = addMonth(z.paidUntil > new Date() ? z.paidUntil : new Date());
      const [next] = await db.update(geoZones).set({ paidUntil: until, status: z.status === "suspended" ? (z.nsOk ? "active" : "pending") : z.status }).where(eq(geoZones.id, z.id)).returning();
      if (z.status === "suspended") { await syncZone(db, next); await notify(db, z.userId, "play", "Geo DNS دامنه " + z.domain + " دوباره فعال شد"); }
      continue;
    }
    if (z.paidUntil <= new Date() && z.status !== "suspended") {
      const [next] = await db.update(geoZones).set({ status: "suspended" }).where(eq(geoZones.id, z.id)).returning();
      await syncZone(db, next);
      await notify(db, z.userId, "circle-alert", "تمدید Geo DNS " + z.domain + " انجام نشد؛ تفکیک جغرافیایی تا شارژ کیف پول متوقف است");
      await enqueue(db, "notify.send", { userId: z.userId, kind: "billing", subject: "Geo DNS دامنه " + z.domain + " متوقف شد", text: "برای تمدید ماهانه Geo DNS دامنه " + z.domain + " به " + toman(plan.price) + " موجودی نیاز است. دامنه همچنان پاسخ می‌دهد ولی همه بازدیدکنندگان به سرور ایران فرستاده می‌شوند. با شارژ کیف پول، سرویس ظرف یک روز خودکار فعال می‌شود." });
    } else if (!z.autoRenew || z.paidUntil > new Date()) {
      await enqueue(db, "notify.send", { userId: z.userId, kind: "billing", subject: "یادآوری تمدید Geo DNS " + z.domain, text: "اعتبار Geo DNS دامنه " + z.domain + " تا " + faDate(z.paidUntil) + " است. " + (z.autoRenew ? "برای تمدید خودکار، " + toman(plan.price) + " موجودی در کیف پول لازم است." : "تمدید خودکار خاموش است؛ از پنل تمدید کنید.") }, { dedupe: "geo-remind:" + z.id + ":" + z.paidUntil.toISOString().slice(0, 10) });
    }
  }
}

const portOpen = (host: string, port: number, ms = 3000) => new Promise<boolean>((resolve) => {
  const s = new Socket();
  const done = (ok: boolean) => { s.destroy(); resolve(ok); };
  s.setTimeout(ms); s.once("connect", () => done(true)); s.once("timeout", () => done(false)); s.once("error", () => done(false));
  s.connect(port, host);
});
let probe = portOpen;
export const setGeoProbe = (f: typeof portOpen) => { probe = f; };

/** reachability of each server (HTTPS port) as seen from the panel; alerts on changes */
export async function geoHealth(db: DB) {
  const zones = await db.select({ z: geoZones, checks: geoPlans.healthChecks }).from(geoZones).innerJoin(geoPlans, eq(geoPlans.id, geoZones.planId)).where(eq(geoZones.status, "active"));
  for (const { z, checks } of zones) {
    if (!checks) continue;
    for (const r of await db.select().from(geoRecords).where(and(eq(geoRecords.zoneId, z.id), inArray(geoRecords.type, ["A", "AAAA"])))) {
      const iranUp = await probe(r.iran, 443), worldUp = r.world ? await probe(r.world, 443) : null;
      await db.update(geoRecords).set({ iranUp, worldUp, checkedAt: new Date() }).where(eq(geoRecords.id, r.id));
      const name = (r.name === "@" ? "" : r.name + ".") + z.domain;
      if (r.iranUp !== null && r.iranUp !== iranUp) await notify(db, z.userId, iranUp ? "circle-check" : "circle-alert", "سرور ایران " + name + (iranUp ? " دوباره در دسترس است" : " پاسخ نمی‌دهد؛ بازدیدکنندگان به سرور خارج فرستاده می‌شوند"));
      if (r.world && r.worldUp !== null && r.worldUp !== worldUp) await notify(db, z.userId, worldUp ? "circle-check" : "circle-alert", "سرور خارج " + name + (worldUp ? " دوباره در دسترس است" : " پاسخ نمی‌دهد؛ بازدیدکنندگان خارج به سرور ایران فرستاده می‌شوند"));
    }
  }
}

/** pending zones (or one zone on demand): activate once the registry points to our nameservers */
export async function geoNsCheck(db: DB, p: { zoneId?: string } = {}) {
  const zones = p.zoneId ? await db.select().from(geoZones).where(eq(geoZones.id, p.zoneId)) : await db.select().from(geoZones).where(inArray(geoZones.status, ["pending", "active"]));
  for (const z of zones) {
    const r = await checkDelegation(z.domain);
    const status = z.status === "suspended" ? "suspended" : r.ok ? "active" : "pending";
    const [next] = await db.update(geoZones).set({ nsOk: r.ok, nsSeen: r.seen, nsCheckedAt: new Date(), status }).where(eq(geoZones.id, z.id)).returning();
    if (!z.nsOk && r.ok) { await syncZone(db, next); await notify(db, z.userId, "globe", "Geo DNS دامنه " + z.domain + " فعال شد؛ بازدیدکنندگان ایران و خارج حالا جداگانه پاسخ می‌گیرند"); }
    if (z.nsOk && !r.ok) await notify(db, z.userId, "circle-alert", "NS دامنه " + z.domain + " دیگر به گره اشاره نمی‌کند؛ Geo DNS کار نمی‌کند");
  }
}
