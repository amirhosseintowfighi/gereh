import "server-only";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { PLAN_NUMS, type Plan } from "@/lib/catalog";
import { strength } from "@/lib/format";
import { actor, isStaff, method, needStaff, needUser, type Ctx } from "../ctx";
import { backups, firewallRules, osTemplates, plans, servers, snapshots, users } from "../db/schema";
import { sendEmail } from "../messaging";
import { createInvoice } from "./billing";
import { virt } from "../virt/driver";
import { addTask, fail, genPassword, logActivity, logAudit, rid } from "../util";

const id = z.string().max(40);
export const SNAP_LIMIT = 5;
const PORT_RE = /^(\d{1,5}(-\d{1,5})?)(,\d{1,5}(-\d{1,5})?)*$/;
const CIDR_RE = /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(\/(3[0-2]|[12]?\d))?$|^[0-9a-f:]+(\/\d{1,3})?$/i;
const HOST_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const FQDN_RE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type Row = typeof servers.$inferSelect;
/** the server if the caller owns it (or is staff with "services"); writes are refused while suspended */
async function server(ctx: Ctx, sid: string, opts: { write?: boolean } = { write: true }): Promise<Row> {
  const a = needUser(ctx);
  const staff = isStaff(ctx, "services");
  const [s] = await ctx.db.select().from(servers).where(staff ? eq(servers.id, sid) : and(eq(servers.id, sid), eq(servers.userId, a.uid)));
  if (!s) fail("سرور پیدا نشد.", 404);
  if (opts.write && s!.status === "suspended" && !staff) fail("این سرور معلق است؛ ابتدا صورتحساب‌ها را پرداخت کنید.", 403);
  return s!;
}
const vps = (s: Row) => { if (!s.vpsid) fail("سرور هنوز در حال ساخت است."); return s.vpsid!; };
const log = (ctx: Ctx, s: Row, icon: string, text: string) => logActivity(ctx.db, s.userId, icon, text, ctx.ip);

export const serversRpc = {
  "servers.power": method(z.tuple([id, z.enum(["start", "stop", "reboot"])]), async (ctx, [sid, action]) => {
    const s = await server(ctx, sid);
    await (await virt()).power(vps(s), action === "reboot" ? "restart" : action);
    await ctx.db.update(servers).set({ status: action === "stop" ? "stopped" : "running" }).where(eq(servers.id, s.id));
    await addTask(ctx.db, s.id, { start: "روشن کردن", stop: "خاموش کردن", reboot: "ری‌استارت" }[action]);
    await log(ctx, s, action === "stop" ? "pause" : action === "reboot" ? "refresh-cw" : "play", { start: "روشن کردن", stop: "خاموش کردن", reboot: "ری‌استارت" }[action] + " سرور " + s.name);
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
    if (disk < s.disk) fail("کاهش فضای دیسک ممکن نیست.");
    if (plan.name === s.plan) fail("سرور همین حالا روی این پلن است.");
    await (await virt()).manage(vps(s), { cores: cpu, ram: ram * 1024, space: disk });
    await ctx.db.update(servers).set({ plan: plan.name, cpu, ram, disk, price: plan.price }).where(eq(servers.id, s.id));
    const days = s.paidUntil ? Math.max(0, Math.ceil((s.paidUntil.getTime() - Date.now()) / 86400_000)) : 0;
    const diff = Math.round(((plan.price - s.price) * days) / 30 / 1000) * 1000;
    if (diff > 0 && s.billing === "monthly") await createInvoice(ctx.db, s.userId, [{ desc: "مابه‌التفاوت ارتقای " + s.name + " به " + plan.name + " (" + days.toLocaleString("fa-IR") + " روز)", amount: diff }], { dueDays: 3 });
    await addTask(ctx.db, s.id, "ارتقا به پلن " + plan.name);
    await log(ctx, s, "trending-up", "ارتقای سرور به پلن " + plan.name);
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
    const [owner] = await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, s.userId));
    if (owner) await sendEmail(owner.email, "نصب مجدد " + s.name, "سیستم‌عامل " + tpl!.name + " روی " + s.name + " (" + s.ip + ") نصب شد.\nرمز root جدید: " + pass + "\nپس از ورود رمز را تغییر دهید.");
  }),

  "servers.remove": method(z.tuple([id]), async (ctx, [sid]) => {
    const s = await server(ctx, sid, { write: false });
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
    const [{ n }] = await ctx.db.select({ n: count() }).from(snapshots).where(eq(snapshots.serverId, s.id));
    if (n >= SNAP_LIMIT) fail("به سقف " + SNAP_LIMIT.toLocaleString("fa-IR") + " اسنپ‌شات رسیده‌اید؛ یکی را حذف کنید.");
    const nm = (name || "").trim() || "snapshot-" + (n + 1);
    if (!/^[\w.-]{1,60}$/.test(nm)) fail("نام اسنپ‌شات فقط حروف انگلیسی، عدد، نقطه و خط تیره.");
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
  }),

  "servers.resetRootPassword": method(z.tuple([id, z.string().max(128)]), async (ctx, [sid, pass]) => {
    const s = await server(ctx, sid);
    if (pass.length < 8 || strength(pass) < 2) fail("رمز ضعیف است؛ حداقل ۸ کاراکتر با عدد و حروف بزرگ.");
    await (await virt()).rootPassword(vps(s), pass);
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
    await addTask(ctx.db, s.id, on ? "فعال‌سازی حالت ریسکیو" : "غیرفعال‌سازی حالت ریسکیو");
  }),

  "servers.installPanel": method(z.tuple([id, z.enum(["cPanel", "Plesk", "DirectAdmin", "Webuzo", "Virtualmin"])]), async (ctx, [sid, panel]) => {
    const s = await server(ctx, sid);
    if (s.status !== "running") fail("سرور باید روشن باشد.");
    await (await virt()).controlPanel(vps(s), panel.toLowerCase());
    await addTask(ctx.db, s.id, "نصب " + panel, "running", 5);
    await log(ctx, s, "layout-dashboard", "نصب " + panel + " روی " + s.name);
  }),
};
