/* Disk layouts that shrink or remove a disk. Virtualizor's Edit VPS refuses that ("You cannot shrink the disk space
   of a vps"), so the layout is applied by recreating the VPS, in the worker (virt.relayout), one stored step at a time
   so a retried or crashed job continues where it stopped and never creates a second VPS:
     Plan A (safe): read the old VPS → create the new one on the same node with the new disks and a temporary address
       → wait for its build → delete the old VPS → move the old addresses onto the new one (the temporary one is
       released). If the move fails the new address is kept and the customer and staff are told.
     Plan B: the node has no room or no free address for a second VPS → the old VPS is deleted first and the new one
       is created with the old addresses. Three failed creates → the server goes to manual delivery (provisionFailed).
   Until it is done the server is "relayout": the usage poll and the sync leave it alone, and the customer can only
   watch. Billing is unchanged. */
import "server-only";
import { and, eq, like, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { dropCredential, stashCredential } from "../credentials";
import { jobs, serverTasks, servers, users, vpsPower, vpsRelayout, vpsSyncLog } from "../db/schema";
import { enqueue } from "../jobs";
import { sendEmail } from "../messaging";
import { open, seal } from "../secrets";
import { addTask, fail, genPassword, logActivity, notify } from "../util";
import { notifyStaff, provisionFailed } from "../worker/provision";
import { virt, type VirtDriver } from "./driver";
import { saveAllowance, writeLayoutDisks } from "./layout";
import { markPushed, requestSync } from "./sync";

type Server = typeof servers.$inferSelect;
type Row = typeof vpsRelayout.$inferSelect;
const fa = (n: number) => n.toLocaleString("fa-IR");
const gb = (sizes: number[] | string) => (typeof sizes === "string" ? sizes.split("+").map(Number) : sizes).map(fa).join("+");
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).trim().slice(0, 1000);
/** the running task line opened by the request; closed when the job ends */
export const RELAYOUT_TASK = "بازسازی دیسک‌ها";
/** build checks, 15 s apart (~20 minutes) */
const BUILD_CHECKS = 80;
const MAX_ERRORS = 5, PLAN_B_TRIES = 3;

/** a refusal that means the node has no room for a second VPS (no free IP, not enough space/RAM): Plan B. Narrow on
    purpose, since Plan B deletes the old VPS first */
const SHORT = /\b(no (free|available|more|\w+ (left|available))|not enough|insufficient|exhausted|ran out|out of|lack of|(is|are) full|(does not|doesn't|do not) have enough)\b/i;
const WHAT = /\b(ips?|ip ?pool|ip address(es)?|space|storage|ram|memory|disk|resources?)\b/i;
export const isCapacityError = (msg: string) => SHORT.test(msg) && WHAT.test(msg);

/** records the request, shows the transition and queues the job (the caller has validated the layout) */
export async function startRelayout(db: DB, s: Server, req: { sizes: number[]; before: number[]; allowance: number; osid: number; os: string; by: string }) {
  if (s.status !== "running" && s.status !== "stopped") fail("سرور باید روشن یا خاموش باشد تا دیسک‌هایش بازسازی شود.", 409);
  const [row] = await db.insert(vpsRelayout).values({
    serverId: s.id, sizes: req.sizes, before: req.before.join("+"), allowanceGb: req.allowance, osid: req.osid, os: req.os, passEnc: seal(genPassword()), prevStatus: s.status, by: req.by,
  }).onConflictDoNothing().returning();
  if (!row) fail("بازسازی دیسک‌های این سرور در حال انجام است.", 409);
  // a power action still being confirmed belongs to the VPS that is about to go
  await db.delete(vpsPower).where(eq(vpsPower.serverId, s.id));
  await db.update(servers).set({ status: "relayout" }).where(eq(servers.id, s.id));
  await addTask(db, s.id, RELAYOUT_TASK + " " + gb(req.before) + "→" + gb(req.sizes) + " گیگ", "running", 5);
  await enqueue(db, "virt.relayout", { serverId: s.id }, { dedupe: "virt.relayout:" + s.id + ":" + row.requestedAt.getTime() });
}

/** staff retry from Admin › undelivered orders after a Plan B that ran out of tries */
export async function retryRelayout(db: DB, serverId: string) {
  const [r] = await db.update(vpsRelayout).set({ step: "create", plan: "B", errors: 0, checks: 0, lastError: "", updatedAt: new Date() })
    .where(and(eq(vpsRelayout.serverId, serverId), eq(vpsRelayout.step, "failed"))).returning();
  if (!r) return false;
  await db.update(servers).set({ status: "relayout", provisionError: null }).where(eq(servers.id, serverId));
  await addTask(db, serverId, RELAYOUT_TASK + " (تلاش دوباره) " + gb(r.before) + "→" + gb(r.sizes) + " گیگ", "running", 5);
  await enqueue(db, "virt.relayout", { serverId }, { dedupe: "virt.relayout:" + serverId + ":retry:" + Date.now() });
  return true;
}

/** nothing has been touched yet (Plan A, no new VPS made): the request can still be dropped safely */
export const relayoutCancellable = (r: Pick<Row, "plan" | "step" | "newVpsid">) => r.plan === "A" && (r.step === "read" || r.step === "create") && !r.newVpsid;

/** drops a relayout that has not touched Virtualizor yet; the server goes back to how it was */
export async function cancelRelayout(db: DB, serverId: string, by: string) {
  const [r] = await db.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, serverId));
  if (!r || !relayoutCancellable(r)) return false;
  await db.delete(vpsRelayout).where(eq(vpsRelayout.serverId, serverId));
  await db.update(servers).set({ status: r.prevStatus }).where(eq(servers.id, serverId));
  await db.update(jobs).set({ status: "done", lockedAt: null }).where(and(eq(jobs.type, "virt.relayout"), eq(jobs.status, "pending"), sql`${jobs.payload}->>'serverId' = ${serverId}`));
  await closeTask(db, serverId, "failed");
  await addTask(db, serverId, "تغییر چیدمان دیسک " + gb(r.before) + "→" + gb(r.sizes) + " لغو شد (" + by + ")", "done");
  await requestSync(db, serverId);
  return true;
}

/** the job: runs the stored steps until it is done, has to wait for the build, or gives up */
export async function runRelayout(db: DB, p: { serverId: string }) {
  let [r] = await db.select().from(vpsRelayout).where(eq(vpsRelayout.serverId, p.serverId));
  const [s] = await db.select().from(servers).where(eq(servers.id, p.serverId));
  if (!r || !s || r.step === "failed") return "none";
  const v = await virt();
  const save = async (patch: Partial<Row>) => { [r] = await db.update(vpsRelayout).set({ ...patch, updatedAt: new Date() }).where(eq(vpsRelayout.serverId, s.id)).returning(); };
  let counted = false;
  try {
    for (;;) {
      if (r.step === "read") {
        const d = s.vpsid ? (await v.details([s.vpsid])).get(s.vpsid) : undefined;
        if (!d) throw new Error("VPS " + s.vpsid + " از Virtualizor خوانده نشد");
        if (!d.serverId) throw new Error("نود VPS " + s.vpsid + " در Virtualizor مشخص نیست");
        // the site's primary address first, while Virtualizor still has it
        const ipv4 = [...new Set([s.ip, ...d.ipv4])].filter((x) => x && d.ipv4.includes(x));
        let uid = d.uid;
        if (!uid) uid = (await db.select({ u: users.virtUid }).from(users).where(eq(users.id, s.userId)))[0]?.u ?? 0;
        if (!uid) throw new Error("مالک VPS " + s.vpsid + " در Virtualizor مشخص نیست");
        await save({ step: "create", old: { vpsid: d.vpsid, uid, plid: d.plid, cores: d.cores || s.cpu, ramMb: d.ramMb || s.ram * 1024, bwLimit: d.bwLimit, node: d.serverId, ipv4, ipv6: d.ipv6, storage: d.storage ?? "", disks: d.disks.map((x) => x.sizeGb) } });
      } else if (r.step === "create") {
        const o = r.old!;
        if (r.newVpsid) { await save({ step: "build" }); continue; }
        // a crash right after addvs: the VPS exists but its vpsid was never stored
        const found = await v.findVps(s.hostname, o.uid, o.vpsid).catch(() => null);
        if (found) { await save({ newVpsid: found.vpsid, newIp: found.ip, newIpv6: found.ipv6, step: "build" }); continue; }
        let made: Awaited<ReturnType<VirtDriver["create"]>>;
        try {
          made = await v.create({ uid: o.uid, plid: o.plid, osid: r.osid, hostname: s.hostname, rootpass: open(r.passEnc) ?? "", serverGroup: "", node: o.node,
            cores: o.cores, ram: o.ramMb, bandwidth: o.bwLimit, disks: r.sizes, ...(o.storage ? { stUuid: o.storage } : {}), ...(r.plan === "B" && o.ipv4.length ? { ips: o.ipv4 } : {}) });
        } catch (e) {
          if (r.plan === "A" && isCapacityError(why(e))) {
            await addTask(db, s.id, "نود جای VPS دوم را ندارد (" + why(e).slice(0, 200) + ")؛ VPS قدیمی حذف و با همان IP دوباره ساخته می‌شود");
            await save({ plan: "B", step: "delete", lastError: why(e) });
            continue;
          }
          // nothing has changed yet: the old VPS keeps running as it was
          if (r.plan === "A") return giveUp(db, v, s, r, e);
          const tries = r.errors + 1;
          if (tries >= PLAN_B_TRIES) return lost(db, s, r, e);
          await save({ errors: tries, lastError: why(e) });
          counted = true;
          throw e;
        }
        await save({ newVpsid: made.vpsid, newIp: made.ip, newIpv6: made.ipv6, vnc: { host: made.vncHost, port: made.vncPort, password: made.vncPassword }, step: "build", errors: 0 });
        await addTask(db, s.id, "VPS جدید " + made.vpsid + " با دیسک‌های " + gb(r.sizes) + " گیگ ساخته شد");
      } else if (r.step === "build") {
        if (!(await v.buildDone(r.newVpsid!).catch(() => false))) {
          if (r.checks >= BUILD_CHECKS) {
            const e = new Error("VPS جدید " + r.newVpsid + " پس از ۲۰ دقیقه هنوز آماده نشده است");
            return r.plan === "A" ? giveUp(db, v, s, r, e) : lost(db, s, r, e);
          }
          await save({ checks: r.checks + 1 });
          await enqueue(db, "virt.relayout", { serverId: s.id }, { runAt: new Date(Date.now() + 15_000), dedupe: "virt.relayout:" + s.id + ":build:" + r.checks });
          return "waiting";
        }
        await save({ step: r.plan === "A" ? "delete" : "finish" });
      } else if (r.step === "delete") {
        const o = r.old!;
        // already gone (a retry after the delete went through) is fine
        await v.remove(o.vpsid).catch(async (e) => { if ((await v.getVps(o.vpsid).catch(() => undefined)) !== null) throw e; });
        await addTask(db, s.id, "VPS قبلی " + o.vpsid + " حذف شد");
        await save({ step: r.plan === "A" ? "ip" : "create" });
      } else if (r.step === "ip") {
        const o = r.old!;
        let kept = false, err = "";
        if (o.ipv4.length) {
          try {
            // keeps exactly the old addresses: the temporary one goes back to the pool
            await v.setIps(r.newVpsid!, o.ipv4, o.ipv4.length);
            const d = (await v.details([r.newVpsid!])).get(r.newVpsid!);
            kept = !!d && o.ipv4.every((x) => d.ipv4.includes(x));
            if (!kept) err = "Virtualizor پس از ویرایش، IP قبلی را روی VPS جدید نشان نمی‌دهد";
            // the guest takes the moved address on its next boot
            else await v.power(r.newVpsid!, "restart").catch(() => undefined);
          } catch (e) { err = why(e); }
        }
        await save({ ipKept: kept, lastError: err, step: "finish" });
      } else if (r.step === "finish") {
        await finish(db, s, r);
        return "done";
      } else return "none";
    }
  } catch (e) {
    if (!counted) {
      const errors = r.errors + 1;
      await save({ errors, lastError: why(e) });
      if (errors >= MAX_ERRORS) {
        // until the old VPS is gone the safe way back is to drop the new one and keep the old
        if (r.plan === "A" && ["read", "create", "build", "delete"].includes(r.step)) return giveUp(db, v, s, r, e);
        return lost(db, s, r, e);
      }
    }
    throw e;
  }
}

const closeTask = (db: DB, serverId: string, status: "done" | "failed") =>
  db.update(serverTasks).set({ status, progress: 100 }).where(and(eq(serverTasks.serverId, serverId), eq(serverTasks.status, "running"), like(serverTasks.action, RELAYOUT_TASK + "%")));

/** Plan A failed before the old VPS was touched: the new one (if any) goes, the old one stays as it was */
async function giveUp(db: DB, v: VirtDriver, s: Server, r: Row, e: unknown) {
  const text = why(e);
  if (r.newVpsid && r.newVpsid !== s.vpsid) await v.remove(r.newVpsid).catch(() => undefined);
  await db.delete(vpsRelayout).where(eq(vpsRelayout.serverId, s.id));
  await db.update(servers).set({ status: r.prevStatus }).where(eq(servers.id, s.id));
  await closeTask(db, s.id, "failed");
  console.error("[virt.relayout] " + s.id + " " + r.before + "→" + r.sizes.join("+"), e);
  await addTask(db, s.id, "تغییر چیدمان دیسک " + gb(r.before) + "→" + gb(r.sizes) + " ناموفق: " + text.slice(0, 500), "failed", 0);
  await notifyStaff(db, "تغییر چیدمان دیسک " + s.name + " (vpsid " + s.vpsid + ") ناموفق بود؛ VPS قبلی دست‌نخورده ماند: " + text);
  await notify(db, s.userId, "circle-alert", "تغییر چیدمان دیسک سرور " + s.name + " انجام نشد و سرور بدون تغییر ماند: " + text.slice(0, 200));
  await requestSync(db, s.id);
  return "failed";
}

/** the old VPS is gone and no new one could be made: manual delivery (Admin › undelivered orders) */
async function lost(db: DB, s: Server, r: Row, e: unknown) {
  const text = why(e), o = r.old!;
  await db.update(vpsRelayout).set({ step: "failed", lastError: text, updatedAt: new Date() }).where(eq(vpsRelayout.serverId, s.id));
  await db.update(servers).set({ status: "provisioning", vpsid: r.newVpsid ?? null }).where(eq(servers.id, s.id));
  await closeTask(db, s.id, "failed");
  console.error("[virt.relayout] " + s.id + " lost", e);
  await addTask(db, s.id, "ساخت دوباره سرور با دیسک‌های " + gb(r.sizes) + " گیگ ناموفق: " + text.slice(0, 500), "failed", 0);
  await notifyStaff(db, "بازسازی دیسک‌های " + s.name + ": VPS قبلی " + o.vpsid + " حذف شد و ساخت VPS جدید روی نود " + o.node + " با IP " + (o.ipv4.join("، ") || "—") + " و دیسک‌های " + r.sizes.join("+") + " گیگ ناموفق ماند؛ تحویل دستی لازم است. خطا: " + text);
  if (s.provisionTicket) await notify(db, s.userId, "server", "بازسازی سرور " + s.name + " با تأخیر روبه‌رو شد؛ تیم فنی در حال بررسی است");
  await provisionFailed(db, s.id, new Error("بازسازی دیسک‌ها (" + r.before + "→" + r.sizes.join("+") + " گیگ): " + text));
  return "lost";
}

async function finish(db: DB, s: Server, r: Row) {
  const o = r.old!, pass = open(r.passEnc) ?? "";
  const keep = r.plan === "B" || r.ipKept;
  const ip = keep ? o.ipv4[0] ?? r.newIp : r.newIp || o.ipv4[0] || s.ip;
  await db.update(servers).set({
    vpsid: r.newVpsid, ip, ipv6: r.newIpv6, os: r.os, status: "running", rescue: false, iso: "", provisionError: null,
    ...(r.vnc ? { vncHost: r.vnc.host, vncPort: r.vnc.port, vncPassword: r.vnc.password } : {}),
  }).where(eq(servers.id, s.id));
  await writeLayoutDisks(db, s, r.sizes, r.sizes.map((_, i) => i));
  await saveAllowance(db, s.id, r.allowanceGb);
  // the traffic limit sent with addvs is the old VPS's own
  await markPushed(db, s.id, o.bwLimit);
  await db.delete(vpsRelayout).where(eq(vpsRelayout.serverId, s.id));
  await closeTask(db, s.id, "done");
  const after = r.sizes.join("+");
  const text = "چیدمان دیسک " + gb(r.before) + "→" + gb(r.sizes) + " گیگ (با ساخت دوباره سرور و نصب " + r.os + ")";
  await addTask(db, s.id, text + "؛ VPS " + o.vpsid + "→" + r.newVpsid);
  await db.insert(vpsSyncLog).values({ serverId: s.id, userId: s.userId, field: "layout", before: r.before, after, text: text + " توسط " + (r.by || "مشتری") });
  await logActivity(db, s.userId, "hard-drive", text + " روی " + s.name);
  const ipNote = ip !== s.ip ? "\nتوجه: IP سرور از " + s.ip + " به " + ip + " تغییر کرد؛ رکوردهای DNS و تنظیماتی را که به IP قبلی وابسته‌اند به‌روز کنید." : "";
  if (ip !== s.ip) {
    await addTask(db, s.id, "IP سرور " + s.ip + "→" + ip + " (IP قبلی منتقل نشد" + (r.lastError ? ": " + r.lastError.slice(0, 200) : "") + ")", "failed", 100);
    await notify(db, s.userId, "circle-alert", "IP سرور " + s.name + " پس از بازسازی دیسک‌ها از " + s.ip + " به " + ip + " تغییر کرد");
    await notifyStaff(db, "بازسازی دیسک‌های " + s.name + ": IP قبلی " + s.ip + " به VPS جدید " + r.newVpsid + " منتقل نشد و IP " + ip + " ماند" + (r.lastError ? ": " + r.lastError : ""));
  }
  await notify(db, s.userId, "hard-drive", "دیسک‌های سرور " + s.name + " به " + gb(r.sizes) + " گیگ تغییر کرد و " + r.os + " نصب شد");
  await stashCredential(db, { serverId: s.id, userId: s.userId, password: pass });
  // the rescue password belonged to the old VPS
  await dropCredential(db, s.id, "rescue");
  const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, s.userId));
  if (owner) await sendEmail(owner.email, "تغییر چیدمان دیسک " + s.name, "دیسک‌های " + s.name + " (" + ip + ") به " + after + " گیگابایت تغییر کرد و " + r.os + " دوباره نصب شد." + ipNote + "\nرمز root جدید: " + pass + "\nپس از ورود رمز را تغییر دهید.");
  await requestSync(db, s.id);
}
