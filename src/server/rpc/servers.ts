import "server-only";
import { and, count, eq, notLike } from "drizzle-orm";
import { z } from "zod";
import { PLAN_NUMS, type Plan } from "@/lib/catalog";
import { strength } from "@/lib/format";
import { actor, isStaff, method, needStaff, needUser, type Ctx } from "../ctx";
import { CRED_TTL_DAYS, dropCredential, pendingCredentials, pendingRow, stashCredential, type CredKind } from "../credentials";
import { backups, firewallRules, osTemplates, plans, serverCredentials, servers, snapshots, users } from "../db/schema";
import { sendEmail } from "../messaging";
import { open } from "../secrets";
import { prorate } from "../billing-extras";
import { createInvoice } from "./billing";
import { rateLimit } from "../auth";
import { virt } from "../virt/driver";
import { primaryFor, saveAllowance } from "../virt/layout";
import { confirmPower, pendingPower, POWER_LABEL, requestPower } from "../virt/power";
import { requestSync, SYNCABLE, syncNow } from "../virt/sync";
import { addTask, fail, genPassword, logActivity, logAudit, rid } from "../util";

const id = z.string().max(40);
export const SNAP_LIMIT = 5;
const PORT_RE = /^(\d{1,5}(-\d{1,5})?)(,\d{1,5}(-\d{1,5})?)*$/;
const CIDR_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(\/(3[0-2]|[12]?\d))?$|^[0-9a-f:]+(\/\d{1,3})?$/i;
const HOST_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const FQDN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type Row = typeof servers.$inferSelect;
/** the server if the caller owns it (or is staff with "services"); writes are refused while suspended */
export async function server(ctx: Ctx, sid: string, opts: { write?: boolean } = { write: true }): Promise<Row> {
  const a = needUser(ctx);
  const staff = isStaff(ctx, "services");
  const [s] = await ctx.db.select().from(servers).where(staff ? eq(servers.id, sid) : and(eq(servers.id, sid), eq(servers.userId, a.uid)));
  if (!s) fail("سرور پیدا نشد.", 404);
  if (opts.write && s!.status === "suspended" && !staff) fail("این سرور معلق است؛ ابتدا صورتحساب‌ها را پرداخت کنید.", 403);
  if (opts.write && s!.status === "provisioning" && !staff) fail("سرور هنوز تحویل نشده است؛ پس از آماده شدن قابل مدیریت است.");
  if (opts.write && s!.status === "missing" && !staff) fail("این سرور در زیرساخت پیدا نمی‌شود؛ تیم فنی در حال بررسی است. برای پیگیری تیکت ثبت کنید.", 409);
  if (opts.write && s!.status === "relayout" && !staff) fail("دیسک‌های این سرور در حال بازسازی است؛ چند دقیقه دیگر دوباره امتحان کنید.", 409);
  return s!;
}
/** who may see a server's one-time password: the account owner, or a team member whose role manages servers
    (admin/tech; the billing role cannot call servers.* at all). Never staff, impersonating or not. */
const credentialViewer = (ctx: Ctx) => { const a = ctx.auth; return !!a && (a.uid === a.user.id || a.teamRole === "admin" || a.teamRole === "tech"); };
async function credentialServer(ctx: Ctx, sid: string) {
  const a = needUser(ctx);
  const [s] = credentialViewer(ctx) ? await ctx.db.select().from(servers).where(and(eq(servers.id, sid), eq(servers.userId, a.uid))) : [];
  if (!s) fail("سرور پیدا نشد.", 404);
  return s!;
}
export const vps = (s: Row) => { if (!s.vpsid) fail("سرور هنوز در حال ساخت است."); return s.vpsid!; };
const log = (ctx: Ctx, s: Row, icon: string, text: string) => logActivity(ctx.db, s.userId, icon, text, ctx.ip);

export const serversRpc = {
  /** sends the action and confirms it with live status reads (../virt/power.ts); the state is never written
      optimistically. Returns "done" when the first read already shows the result, else "pending". */
  "servers.power": method(z.tuple([id, z.enum(["start", "stop", "reboot", "restart", "poweroff"])]), async (ctx, [sid, raw]) => {
    const s = await server(ctx, sid);
    const action = raw === "reboot" ? "restart" : raw;
    vps(s);
    if ((await pendingPower(ctx.db, [s.id])).has(s.id)) fail("عملیات قبلی روی این سرور هنوز در حال انجام است؛ چند لحظه صبر کنید.", 409);
    await rateLimit(ctx.db, "vps:power:" + s.id, 10, 300);
    await requestPower(ctx.db, s, action);
    await log(ctx, s, action === "stop" || action === "poweroff" ? "pause" : action === "restart" ? "refresh-cw" : "play", POWER_LABEL[action] + " سرور " + s.name);
    if (isStaff(ctx, "services") && ctx.auth!.uid !== s.userId) await logAudit(ctx.db, actor(ctx), POWER_LABEL[action] + " سرور", s.id, ctx.ip);
    return (await confirmPower(ctx.db, { serverId: s.id, quick: true })) === "confirmed" ? "done" : "pending";
  }),

  "servers.rename": method(z.tuple([id, z.string().max(60)]), async (ctx, [sid, name]) => {
    const s = await server(ctx, sid);
    const n = name.trim();
    if (!/^[a-z0-9-]{2,40}$/i.test(n)) fail("نام معتبر نیست؛ ۲ تا ۴۰ کاراکتر از حروف انگلیسی، عدد و خط تیره.");
    await ctx.db.update(servers).set({ name: n }).where(eq(servers.id, s.id));
  }),

  "servers.setRdns": method(z.tuple([id, z.string().max(253)]), async (ctx, [sid, raw]) => {
    const s = await server(ctx, sid);
    const v = raw.trim().toLowerCase();
    if (v && !FQDN_RE.test(v)) fail("نام دامنه معتبر نیست.");
    // the PTR lives in Virtualizor's rDNS (it used to be saved on the site only)
    if (s.vpsid && s.ip) await (await virt()).setPtr(s.vpsid, s.ip, v);
    await ctx.db.update(servers).set({ rdns: v }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, "تنظیم Reverse DNS");
  }),

  /** resize to a catalog cloud plan; disk can only grow; prorated difference is invoiced */
  "servers.resize": method(z.tuple([id, z.string().max(20)]), async (ctx, [sid, planId]) => {
    const s = await server(ctx, sid);
    const [p] = await ctx.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.kind, "cloud")));
    const nums = PLAN_NUMS[planId];
    if (!p || !nums) fail("پلن پیدا نشد.");
    const plan = p!.data as Plan;
    if (plan.active === false) fail("این پلن فعلا ارائه نمی‌شود.");
    const [cpu, ram, disk] = nums;
    // a split disk (../virt/layout.ts): the plan's GB is the allowance and the primary takes the difference
    const lay = await primaryFor(ctx.db, s, disk);
    if (disk < lay.allowance) fail("کاهش فضای دیسک ممکن نیست.");
    if (plan.name === s.plan) fail("سرور همین حالا روی این پلن است.");
    await (await virt()).manage(vps(s), { cores: cpu, ram: ram * 1024, space: lay.primary });
    await ctx.db.update(servers).set({ plan: plan.name, cpu, ram, disk: lay.primary, price: plan.price }).where(eq(servers.id, s.id));
    if (lay.split) await saveAllowance(ctx.db, s.id, disk);
    const days = s.paidUntil ? Math.max(0, Math.ceil((s.paidUntil.getTime() - Date.now()) / 86400_000)) : 0;
    const diff = prorate(s, plan.price);
    if (diff > 0) await createInvoice(ctx.db, s.userId, [{ desc: "مابه‌التفاوت ارتقای " + s.name + " به " + plan.name + " (" + days.toLocaleString("fa-IR") + " روز)", amount: diff }], { dueDays: 3 });
    await addTask(ctx.db, s.id, "ارتقا به پلن " + plan.name);
    await log(ctx, s, "trending-up", "ارتقای سرور به پلن " + plan.name);
    await requestSync(ctx.db, s.id);
  }),

  "servers.reinstall": method(z.tuple([id, z.string().max(80)]), async (ctx, [sid, osName]) => {
    const s = await server(ctx, sid);
    const [tpl] = await ctx.db.select().from(osTemplates).where(and(eq(osTemplates.name, osName), eq(osTemplates.on, true)));
    if (!tpl) fail("این سیستم‌عامل در دسترس نیست.");
    const pass = genPassword();
    await (await virt()).reinstall(vps(s), tpl!.osid, pass);
    await ctx.db.update(servers).set({ os: tpl!.name, status: "running", rescue: false, iso: "" }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, "نصب مجدد " + tpl!.name);
    await log(ctx, s, "terminal", "نصب مجدد " + tpl!.name + " روی " + s.name);
    await requestSync(ctx.db, s.id);
    await stashCredential(ctx.db, { serverId: s.id, userId: s.userId, password: pass });
    await dropCredential(ctx.db, s.id, "rescue");
    const [owner] = await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, s.userId));
    if (owner) await sendEmail(owner.email, "نصب مجدد " + s.name, "سیستم‌عامل " + tpl!.name + " روی " + s.name + " (" + s.ip + ") نصب شد.\nرمز root جدید: " + pass + "\nپس از ورود رمز را تغییر دهید.");
  }),

  "servers.remove": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid, { write: false });
    // a paid order still being delivered is closed from Admin › undelivered orders (refund), not deleted
    if (s.status === "provisioning" && !s.vpsid) fail("این سفارش هنوز در حال آماده‌سازی است و حذف نمی‌شود؛ برای انصراف تیکت ثبت کنید.");
    if (s.status === "relayout") fail("دیسک‌های این سرور در حال بازسازی است؛ پس از پایان آن می‌توانید سرور را حذف کنید.", 409);
    if (s.vpsid) await (await virt()).remove(s.vpsid);
    await ctx.db.delete(servers).where(eq(servers.id, s.id));
    await log(ctx, s, "trash-2", "حذف سرور " + s.name);
    if (isStaff(ctx, "services") && ctx.auth!.uid !== s.userId) await logAudit(ctx.db, actor(ctx), "حذف سرور", s.id, ctx.ip);
  }),

  "servers.toggleBackups": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid);
    await ctx.db.update(servers).set({ backups: !s.backups }).where(eq(servers.id, s.id));
    await log(ctx, s, "database-backup", (s.backups ? "غیرفعال‌سازی" : "فعال‌سازی") + " بکاپ خودکار " + s.name);
  }),

  "servers.snapshot": method(z.tuple([id, z.string().max(60).optional()]), async (ctx, [sid, name]) => {
    const s = await server(ctx, sid);
    // scheduled snapshots ("auto-…") have their own retention and do not count here
    const [{ n }] = await ctx.db.select({ n: count() }).from(snapshots).where(and(eq(snapshots.serverId, s.id), notLike(snapshots.name, "auto-%")));
    if (n >= SNAP_LIMIT) fail("به سقف " + SNAP_LIMIT.toLocaleString("fa-IR") + " اسنپ‌شات رسیده‌اید؛ یکی را حذف کنید.");
    const nm = (name || "").trim() || "snapshot-" + (n + 1);
    if (!/^[\w.-]{1,60}$/.test(nm)) fail("نام اسنپ‌شات فقط حروف انگلیسی، عدد، نقطه و خط تیره.");
    if (nm.startsWith("auto-")) fail("پیشوند auto- برای اسنپ‌شات‌های زمان‌بندی‌شده رزرو است.");
    await ctx.db.insert(snapshots).values({ id: rid("snap"), serverId: s.id, name: nm, size: +(s.disk * 0.08).toFixed(1) });
    await addTask(ctx.db, s.id, "ساخت اسنپ‌شات " + nm);
    await log(ctx, s, "camera", "ساخت اسنپ‌شات برای " + s.name);
  }),

  "servers.deleteSnapshot": method(z.tuple([id, id]), async (ctx, [sid, snapId]) => {
    const s = await server(ctx, sid);
    await ctx.db.delete(snapshots).where(and(eq(snapshots.id, snapId), eq(snapshots.serverId, s.id)));
  }),

  "servers.restore": method(z.tuple([id, z.string().max(120)]), async (ctx, [sid, label]) => {
    const s = await server(ctx, sid);
    const [snap] = await ctx.db.select().from(snapshots).where(and(eq(snapshots.serverId, s.id), eq(snapshots.name, label.replace(/^اسنپ‌شات /, ""))));
    const [bk] = snap ? [] : await ctx.db.select().from(backups).where(eq(backups.serverId, s.id));
    if (!snap && !bk) fail("نسخه‌ای برای بازیابی پیدا نشد.");
    await addTask(ctx.db, s.id, "بازیابی " + label);
    await log(ctx, s, "refresh-cw", "بازیابی " + label + " روی " + s.name);
  }),

  "servers.addRule": method(z.tuple([id, z.object({ proto: z.enum(["TCP", "UDP", "ICMP"]), port: z.string().max(100), source: z.string().max(60), action: z.enum(["allow", "deny"]), note: z.string().max(60) })]), async (ctx, [sid, r]) => {
    const s = await server(ctx, sid);
    const port = r.proto === "ICMP" ? "—" : r.port.replace(/\s/g, "");
    if (r.proto !== "ICMP" && (!PORT_RE.test(port) || port.split(/[,-]/).some((p) => +p < 1 || +p > 65535) || port.split(",").some((x) => { const [a, b] = x.split("-").map(Number); return b !== undefined && b < a; })))
      fail("پورت معتبر نیست؛ مثال: 22 یا 8000-8100 یا 80,443");
    if (!CIDR_RE.test(r.source.trim())) fail("مبدأ باید IP یا CIDR معتبر باشد؛ مثل 0.0.0.0/0");
    const [{ n }] = await ctx.db.select({ n: count() }).from(firewallRules).where(eq(firewallRules.serverId, s.id));
    if (n >= 50) fail("حداکثر ۵۰ قانون فایروال.");
    await ctx.db.insert(firewallRules).values({ id: rid("fw"), serverId: s.id, proto: r.proto, port, source: r.source.trim(), action: r.action, note: r.note.trim() });
    await addTask(ctx.db, s.id, "افزودن قانون فایروال " + r.proto + " " + port);
  }),

  "servers.removeRule": method(z.tuple([id, id]), async (ctx, [sid, ruleId]) => {
    const s = await server(ctx, sid);
    await ctx.db.delete(firewallRules).where(and(eq(firewallRules.id, ruleId), eq(firewallRules.serverId, s.id)));
    await addTask(ctx.db, s.id, "حذف قانون فایروال");
  }),

  "servers.setStatus": method(z.tuple([id, z.enum(["running", "stopped", "suspended"])]), async (ctx, [sid, status]) => {
    needStaff(ctx, "services");
    const s = await server(ctx, sid, { write: false });
    const v = await virt();
    if (s.vpsid) { if (status === "suspended") await v.suspend(s.vpsid); else if (s.status === "suspended") await v.unsuspend(s.vpsid); }
    await ctx.db.update(servers).set({ status }).where(eq(servers.id, s.id));
    await logAudit(ctx.db, actor(ctx), "تغییر وضعیت سرور به " + status, s.id, ctx.ip);
  }),

  "servers.setHostname": method(z.tuple([id, z.string().max(253)]), async (ctx, [sid, raw]) => {
    const s = await server(ctx, sid);
    const h = raw.trim().toLowerCase();
    if (!HOST_RE.test(h)) fail("hostname معتبر نیست.");
    await (await virt()).hostname(vps(s), h);
    await ctx.db.update(servers).set({ hostname: h }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, "تغییر hostname به " + h);
    await log(ctx, s, "pencil", "تغییر hostname سرور " + s.name);
    await requestSync(ctx.db, s.id);
  }),

  /** reads this VPS from Virtualizor now (owner or staff); a few times per 10 minutes per server */
  "servers.sync": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid, { write: false });
    const staff = isStaff(ctx, "services");
    if (!s.vpsid || !SYNCABLE.includes(s.status)) fail("این سرور هنوز تحویل نشده است.");
    await rateLimit(ctx.db, "virt-sync:" + s.id + ":" + (staff ? "staff" : "owner"), staff ? 10 : 3, 600);
    const r = await syncNow(ctx.db, s);
    if (r.state === "unanswered") fail("Virtualizor پاسخ نداد؛ چند دقیقه دیگر دوباره امتحان کنید.", 502);
    if (staff && ctx.auth!.uid !== s.userId) await logAudit(ctx.db, actor(ctx), "همگام‌سازی سرور از Virtualizor", s.id, ctx.ip);
    return r;
  }),

  "servers.resetRootPassword": method(z.tuple([id, z.string().max(128)]), async (ctx, [sid, pass]) => {
    const s = await server(ctx, sid);
    if (pass.length < 8 || strength(pass) < 2) fail("رمز ضعیف است؛ حداقل ۸ کاراکتر با عدد و حروف بزرگ.");
    await (await virt()).rootPassword(vps(s), pass);
    await stashCredential(ctx.db, { serverId: s.id, userId: s.userId, password: pass });
    await addTask(ctx.db, s.id, "تغییر رمز root");
    await log(ctx, s, "key-round", "تغییر رمز root سرور " + s.name);
  }),

  "servers.setVncPass": method(z.tuple([id, z.string().max(64)]), async (ctx, [sid, pass]) => {
    const s = await server(ctx, sid);
    if (pass.length < 6) fail("رمز VNC حداقل ۶ کاراکتر است.");
    await (await virt()).vncPassword(vps(s), pass);
    await ctx.db.update(servers).set({ vncPassword: pass }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, "تغییر رمز VNC");
  }),

  "servers.setBoot": method(z.tuple([id, z.enum(["cda", "dca", "n"])]), async (ctx, [sid, boot]) => {
    const s = await server(ctx, sid);
    await (await virt()).manage(vps(s), { boot });
    await ctx.db.update(servers).set({ boot }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, "تغییر ترتیب بوت");
  }),

  "servers.mountIso": method(z.tuple([id, z.string().max(200)]), async (ctx, [sid, iso]) => {
    const s = await server(ctx, sid);
    if (iso) {
      const { isos } = await import("../db/schema");
      const [ok] = await ctx.db.select().from(isos).where(eq(isos.filename, iso));
      if (!ok) fail("فایل ISO پیدا نشد.");
    }
    await (await virt()).manage(vps(s), { iso });
    await ctx.db.update(servers).set({ iso }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, iso ? "اتصال ISO " + iso : "جدا کردن ISO");
  }),

  "servers.setRescue": method(z.tuple([id, z.boolean(), z.string().max(64).optional()]), async (ctx, [sid, on, pass]) => {
    const s = await server(ctx, sid);
    if (on && (!pass || pass.length < 6)) fail("برای حالت ریسکیو یک رمز حداقل ۶ کاراکتری لازم است.");
    await (await virt()).rescue(vps(s), on, pass);
    await ctx.db.update(servers).set({ rescue: on }).where(eq(servers.id, s.id));
    if (on) await stashCredential(ctx.db, { serverId: s.id, userId: s.userId, kind: "rescue", password: pass! });
    else await dropCredential(ctx.db, s.id, "rescue");
    await addTask(ctx.db, s.id, on ? "فعال‌سازی حالت ریسکیو" : "غیرفعال‌سازی حالت ریسکیو");
  }),

  /* ---------- one-time password display (../credentials.ts) ---------- */
  /** the caller's pending root/rescue passwords (servers list and page), never the password itself */
  "servers.pendingCredentials": method(z.tuple([id.optional()]), async (ctx, [sid]) => {
    const a = needUser(ctx);
    if (!credentialViewer(ctx)) return [];
    return (await pendingCredentials(ctx.db, a.uid, sid)).map((r) => ({ serverId: r.serverId, kind: r.kind as CredKind, username: r.username, name: r.name, ip: r.ip,
      createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), revealed: !!r.revealed }));
  }),

  /** the password, on an explicit «نمایش» by the owner; rate limited and logged (without the password) */
  "servers.revealCredential": method(z.tuple([id, z.enum(["root", "rescue"])]), async (ctx, [sid, kind]) => {
    const s = await credentialServer(ctx, sid);
    await rateLimit(ctx.db, "cred:reveal:" + ctx.auth!.user.id, 10, 600);
    const r = await pendingRow(ctx.db, s.id, kind);
    const pass = open(r?.passEnc);
    if (!r || !pass) fail("رمزی برای نمایش نیست؛ رمز فقط یک بار و تا " + CRED_TTL_DAYS.toLocaleString("fa-IR") + " روز در پنل نمایش داده می‌شود و به ایمیل شما هم ارسال شده است.", 404);
    await ctx.db.update(serverCredentials).set({ revealedAt: new Date() }).where(eq(serverCredentials.id, r!.id));
    await log(ctx, s, "eye", (kind === "root" ? "رمز root نمایش داده شد" : "رمز حالت ریسکیو نمایش داده شد") + " (" + s.name + ")");
    return pass!;
  }),

  /** «ذخیره کردم»: the ciphertext is deleted and the card goes away */
  "servers.ackCredential": method(z.tuple([id, z.enum(["root", "rescue"])]), async (ctx, [sid, kind]) => {
    const s = await credentialServer(ctx, sid);
    await ctx.db.update(serverCredentials).set({ passEnc: null, acknowledgedAt: new Date() }).where(and(eq(serverCredentials.serverId, s.id), eq(serverCredentials.kind, kind)));
  }),

  /** CPU % (sustained 15 min) and monthly-bandwidth % thresholds; 0 disables */
  "servers.setAlerts": method(z.tuple([id, z.object({ cpu: z.number().int().min(0).max(100), bw: z.number().int().min(0).max(100) })]), async (ctx, [sid, alerts]) => {
    const s = await server(ctx, sid, { write: false });
    await ctx.db.update(servers).set({ alerts }).where(eq(servers.id, s.id));
  }),

  "servers.installPanel": method(z.tuple([id, z.enum(["cPanel", "Plesk", "DirectAdmin", "Webuzo", "Virtualmin"])]), async (ctx, [sid, panel]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور باید روشن باشد.");
    await (await virt()).controlPanel(vps(s), panel.toLowerCase());
    await addTask(ctx.db, s.id, "نصب " + panel, "running", 5);
    await log(ctx, s, "layout-dashboard", "نصب " + panel + " روی " + s.name);
  }),
};
