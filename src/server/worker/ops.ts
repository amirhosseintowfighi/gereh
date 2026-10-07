/* Operational jobs: usage sampling + alerts, nightly reconciliation, ticket SLA and auto-replies,
   and outbound notifications that respect each customer's preferences. */
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { activity, notifications, servers, ticketMessages, tickets, usageSamples, users, virtLog } from "../db/schema";
import { sendEmail, sendSms } from "../messaging";
import { virt } from "../virt/driver";
import { rid } from "../util";

/** every 5 minutes: one batched status call per 50 VPSs; status drift is corrected from the hypervisor */
export async function collectUsage(db: DB) {
  const list = await db.select({ id: servers.id, vpsid: servers.vpsid, status: servers.status }).from(servers).where(and(isNotNull(servers.vpsid), inArray(servers.status, ["running", "stopped"])));
  const v = await virt();
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const live = await v.status(chunk.map((s) => s.vpsid!));
    const byVps = new Map(live.map((l) => [l.vpsid, l]));
    const rows = chunk.flatMap((s) => { const l = byVps.get(s.vpsid!); return l ? [{ serverId: s.id, cpu: l.cpu, ram: l.ram, disk: l.disk, netIn: l.netIn, netOut: l.netOut, bwUsed: l.bwUsed }] : []; });
    if (rows.length) await db.insert(usageSamples).values(rows);
    for (const s of chunk) {
      const l = byVps.get(s.vpsid!);
      if (l && l.status !== s.status && l.status !== "suspended") await db.update(servers).set({ status: l.status }).where(eq(servers.id, s.id));
    }
  }
  await db.delete(usageSamples).where(lt(usageSamples.createdAt, new Date(Date.now() - 8 * 86400_000)));
}

/** after each collection: CPU above the customer's threshold for 15 min, or bandwidth past the threshold % */
export async function usageAlerts(db: DB) {
  const watched = await db.select().from(servers).where(sql`(${servers.alerts}->>'cpu')::int > 0 or (${servers.alerts}->>'bw')::int > 0`);
  for (const s of watched) {
    const recent = await db.select().from(usageSamples).where(and(eq(usageSamples.serverId, s.id), gte(usageSamples.createdAt, new Date(Date.now() - 15 * 60_000)))).orderBy(desc(usageSamples.createdAt));
    if (!recent.length) continue;
    const today = new Date().toISOString().slice(0, 10);
    const already = async (kind: string) => (await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.id, "al-" + s.id + "-" + kind + "-" + today))).length > 0;
    if (s.alerts.cpu > 0 && recent.length >= 3 && recent.every((r) => r.cpu >= s.alerts.cpu) && !(await already("cpu"))) {
      await db.insert(notifications).values({ id: "al-" + s.id + "-cpu-" + today, userId: s.userId, icon: "cpu", text: "مصرف CPU سرور " + s.name + " بیش از " + s.alerts.cpu.toLocaleString("fa-IR") + "٪ است" });
      await notifySend(db, { userId: s.userId, kind: "service", subject: "هشدار CPU سرور " + s.name, text: "مصرف CPU سرور " + s.name + " در ۱۵ دقیقه اخیر بالای " + s.alerts.cpu + "٪ بوده است." });
    }
    const bwPct = s.bwLimit ? (recent[0].bwUsed / s.bwLimit) * 100 : 0;
    if (s.alerts.bw > 0 && bwPct >= s.alerts.bw && !(await already("bw"))) {
      await db.insert(notifications).values({ id: "al-" + s.id + "-bw-" + today, userId: s.userId, icon: "activity", text: "ترافیک ماهانه " + s.name + " به " + Math.round(bwPct).toLocaleString("fa-IR") + "٪ سهمیه رسید" });
      await notifySend(db, { userId: s.userId, kind: "service", subject: "هشدار ترافیک " + s.name, text: "ترافیک ماهانه سرور " + s.name + " به " + Math.round(bwPct) + "٪ سهمیه رسیده است." });
    }
  }
}

/** nightly: VPSs that exist on one side only */
export async function reconcile(db: DB) {
  const ours = await db.select({ vpsid: servers.vpsid }).from(servers).where(isNotNull(servers.vpsid));
  const live = await (await virt()).status(ours.map((s) => s.vpsid!));
  const missing = live.filter((l) => l.status === "stopped" && l.cpu === 0 && l.ram === 0).length;
  await db.insert(virtLog).values({ id: rid("vl"), kind: "تطبیق شبانه", result: missing ? "warn" : "ok", detail: ours.length.toLocaleString("fa-IR") + " VPS بررسی شد" + (missing ? "، " + missing.toLocaleString("fa-IR") + " مورد بدون پاسخ" : "") });
}

const SLA_MIN: Record<string, number> = { high: 60, normal: 240, low: 1440 };
const inBusinessHours = (d = new Date()) => {
  const h = (d.getUTCHours() * 60 + d.getUTCMinutes() + 210) / 60 % 24; // Tehran UTC+3:30
  const day = new Date(d.getTime() + 3.5 * 3600_000).getUTCDay(); // 5 = Friday
  return day !== 5 && h >= 8 && h < 20;
};

/** on creation: instant acknowledgement; periodically: SLA breaches are escalated to the owner */
export async function ticketSla(db: DB, payload: { ticketId?: string; kind?: string }) {
  if (payload.kind === "auto-reply" && payload.ticketId) {
    const [t] = await db.select().from(tickets).where(eq(tickets.id, payload.ticketId));
    if (!t) return;
    const eta = SLA_MIN[t.priority] ?? 240;
    await db.insert(ticketMessages).values({ ticketId: t.id, from: "staff", name: "پاسخ خودکار گره", text: "تیکت شما با شماره " + t.id + " ثبت شد." + (inBusinessHours() ? "" : " اکنون خارج از ساعت کاری است؛ موارد فوری فنی همچنان رسیدگی می‌شوند.") + " زمان هدف اولین پاسخ برای این اولویت: " + (eta >= 60 ? (eta / 60).toLocaleString("fa-IR") + " ساعت" : eta.toLocaleString("fa-IR") + " دقیقه") + "." });
    return;
  }
  const open = await db.select().from(tickets).where(and(inArray(tickets.status, ["open", "customer-reply"]), isNull(tickets.firstResponseAt)));
  const owners = await db.select().from(users).where(and(eq(users.role, "admin"), eq(users.staffRole, "owner")));
  for (const t of open) {
    const limit = (SLA_MIN[t.priority] ?? 240) * 60_000;
    if (Date.now() - t.createdAt.getTime() < limit) continue;
    const key = "sla-" + t.id;
    if ((await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.id, key + "-" + (owners[0]?.id ?? "")))).length) continue;
    for (const o of owners) await db.insert(notifications).values({ id: key + "-" + o.id, userId: o.id, icon: "clock", text: "تیکت " + t.id + " از زمان هدف پاسخ گذشته است" }).onConflictDoNothing();
  }
}

type NotifyPayload = { userId?: string; to?: string; kind?: "billing" | "service" | "security" | "news"; subject: string; text: string; secret?: boolean };
/** honours notif prefs (kind_email / kind_sms); "secret" mails (credentials) always go by email only */
export async function notifySend(db: DB, p: NotifyPayload) {
  if (p.to) return sendEmail(p.to, p.subject, p.text);
  if (!p.userId) return;
  const [u] = await db.select().from(users).where(eq(users.id, p.userId));
  if (!u) return;
  const prefs = u.notifPrefs || {};
  const kind = p.kind ?? "service";
  if (p.secret || prefs[kind + "_email"] !== false) await sendEmail(u.email, p.subject, p.text);
  if (!p.secret && prefs[kind + "_sms"] && u.phone) await sendSms(u.phone, p.subject + "\n" + p.text.slice(0, 250));
}

export const purgeOld = async (db: DB) => {
  await db.delete(activity).where(lt(activity.createdAt, new Date(Date.now() - 365 * 86400_000)));
  await db.delete(notifications).where(and(eq(notifications.read, true), lt(notifications.createdAt, new Date(Date.now() - 90 * 86400_000))));
};
