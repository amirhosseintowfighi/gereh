/* Turns paid order lines into running services. Every handler is idempotent on orderRef
   ("<invoice>:<line>"), so a retried job never creates a second VPS, account or registration.
   A server order gets its `servers` row ("provisioning", no vpsid) before Virtualizor is called, so the
   customer always sees what they paid for; a failure is stored on the row and opens one staff ticket. */
import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { BILLING, CLOUD_SPECS, HOSTING, LOCS, OSES, VPS, type Plan, type Sku } from "@/lib/catalog";
import { toEnDigits } from "@/lib/format";
import { addMonths } from "@/lib/jalali";
import type { DB, Tx } from "../db/client";
import { dnsRecords, domainContacts, domainExtras, domains, hosting, osTemplates, planMap, plans, servers, sshKeys, transactions, tickets, ticketMessages, users } from "../db/schema";
import { enqueue } from "../jobs";
import { getLocations, locationGroup } from "../locations";
import { providers } from "../providers";
import { cloudInitFor } from "../apps";
import { virt } from "../virt/driver";
import { addTask, genPassword, logActivity, nextId, notify, randomSecret, rid } from "../util";

/** override: staff fixes from the order detail (a synced OS template, a Virtualizor Plan ID) */
export type Override = { osid?: number; plid?: number };
export type Payload = { userId: string; invoiceId: string; index: number; sku: Sku; override?: Override };
const ref = (p: Payload) => p.invoiceId + ":" + p.index;

async function owner(db: DB, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new Error("user " + id + " not found");
  return u;
}

/** a failure an admin can fix; the message says where */
export class ProvisionError extends Error {}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).trim().slice(0, 2000);

const VIRT_PAGE = "«اتصال Virtualizor › نگاشت پلن‌ها»";
/** first number in a catalog label ("۲×۱٫۹۲ ترابایت NVMe" → 3840 with the multiplier and unit) */
function amount(label: string | undefined, unitGb = false) {
  const s = toEnDigits(label ?? "").replace(/[٫]/g, ".");
  const m = s.match(/(\d+(?:\.\d+)?)(?:\s*[×x*]\s*(\d+(?:\.\d+)?))?/);
  if (!m) return 0;
  const n = m[2] ? Number(m[1]) * Number(m[2]) : Number(m[1]);
  return Math.round(unitGb && /ترابایت|TB/i.test(s) ? n * 1000 : n);
}
/** cpu cores, ram GB, disk GB, monthly traffic GB (0 = unlimited) of a plan; null when the plan does not say */
export function planResources(id: string, plan: Plan): { cpu: number; ram: number; disk: number; traffic: number } | null {
  const spec = CLOUD_SPECS[id];
  if (spec) return { cpu: spec.cpu, ram: spec.ram, disk: spec.disk, traffic: spec.tb * 1000 };
  const cpu = amount(plan.cpu), ram = amount(plan.ram), disk = amount(plan.disk, true);
  if (!cpu || !ram || !disk) return null;
  return { cpu, ram, disk, traffic: /نامحدود|unlimited/i.test(plan.traffic ?? "") ? 0 : amount(plan.traffic, true) };
}

export type ServerSpec = {
  name: string; cpu: number; ram: number; disk: number; traffic: number; price: number; months: number;
  plid: number; group: string; virt: string; osLabel: string; tpl: { osid: number; name: string } | null; hourly: boolean; problems: string[];
};
/** what a server order needs from Virtualizor, plus every configuration problem in Persian */
export async function serverSpec(db: DB | Tx, sku: Extract<Sku, { t: "plan" } | { t: "custom" }>, override: Override = {}): Promise<ServerSpec> {
  const locs = await getLocations(db);
  const loc = locs.find((l) => l.id === sku.loc);
  const problems: string[] = [];
  let name: string, price: number, months = 1, res: { cpu: number; ram: number; disk: number; traffic: number } | null, mapId: string;
  if (sku.t === "plan") {
    const [row] = await db.select().from(plans).where(and(eq(plans.id, sku.plan), eq(plans.kind, sku.kind)));
    const plan = (row?.data as Plan | undefined) ?? (sku.kind === "cloud" ? VPS.cloud : VPS.metal).find((x) => x.id === sku.plan);
    name = plan?.name ?? sku.plan;
    res = plan ? planResources(sku.plan, plan) : null;
    months = BILLING.find((b) => b.id === sku.cycle)?.months ?? 1;
    price = plan ? Math.round(plan.price * (LOCS.find((l) => l.id === sku.loc)?.foreign && sku.kind === "cloud" ? 1.12 : 1) / 1000) * 1000 : 0;
    mapId = sku.plan;
  } else {
    const { configPrice } = await import("@/lib/catalog");
    price = configPrice(sku);
    name = "سفارشی";
    res = { cpu: sku.cpu, ram: sku.ram, disk: sku.disk, traffic: (sku.tb ?? 1) * 1000 };
    mapId = "custom";
  }
  const [m] = await db.select().from(planMap).where(eq(planMap.id, mapId));
  const plid = override.plid ?? m?.plid ?? 0;
  if (!plid && !res) problems.push(`پلن «${name}» در ${VIRT_PAGE} به Plan ID وصل نشده است و منابع آن (CPU، رم، دیسک) هم در «محصولات و قیمت» مشخص نیست.`);
  const kind = sku.t === "plan" ? sku.kind : "cloud";
  const group = locationGroup(loc, kind) || (m?.group ? m.group.replace(/^thr/, sku.loc) : "");
  if (!group) problems.push(`برای موقعیت «${loc?.label ?? sku.loc}» گروه سرور Virtualizor (${kind === "metal" ? "اختصاصی" : "ابری"}) تعیین نشده است؛ در «زیرساخت › موقعیت‌ها» فیلد Server Group را پر کنید.`);
  const osLabel = OSES.find((o) => o.id === ((sku as { os?: string }).os || "ubuntu"))?.label ?? (sku as { os?: string }).os ?? "Ubuntu 24.04";
  const distro = osLabel.split(" ")[0].toLowerCase();
  const [tpl] = override.osid
    ? await db.select().from(osTemplates).where(eq(osTemplates.osid, override.osid))
    : await db.select().from(osTemplates)
      .where(sql`${osTemplates.on} and (${osTemplates.name} = ${osLabel} or ${osTemplates.distro} = ${distro} or lower(${osTemplates.name}) like ${distro + "%"})`)
      .orderBy(sql`(${osTemplates.name} = ${osLabel}) desc`, desc(osTemplates.osid)).limit(1);
  if (!tpl && override.osid) problems.push(`قالب سیستم‌عامل OSID ${override.osid} که برای این سفارش انتخاب شده دیگر وجود ندارد؛ در جزئیات سفارش قالب دیگری انتخاب کنید.`);
  else if (!tpl) problems.push(`هیچ قالب سیستم‌عامل فعالی برای «${osLabel}» نیست؛ در «اتصال Virtualizor › قالب‌های سیستم‌عامل» قالب‌ها را همگام و فعال کنید.`);
  return {
    name, cpu: res?.cpu ?? 0, ram: res?.ram ?? 0, disk: res?.disk ?? 0, traffic: res?.traffic ?? 0, price, months, plid, group, virt: m?.virt ?? "",
    osLabel, tpl: tpl ? { osid: tpl.osid, name: tpl.name } : null, hourly: !!(sku as { hourly?: boolean }).hourly, problems,
  };
}

/** in-app notice to every staff member who handles services */
export async function notifyStaff(db: DB | Tx, text: string) {
  const staff = await db.select({ id: users.id, role: users.staffRole }).from(users).where(and(eq(users.role, "admin"), sql`${users.status} <> 'deleted'`));
  for (const s of staff) if (!s.role || s.role === "owner" || s.role === "support") await notify(db, s.id, "triangle-alert", text);
}

/** stores the error on the row; the first failure opens one staff ticket and tells the customer */
export async function provisionFailed(db: DB, serverId: string, e: unknown) {
  const text = errorText(e);
  const [s] = await db.update(servers).set({ provisionError: text }).where(eq(servers.id, serverId)).returning();
  if (!s || s.provisionTicket) return;
  const tid = await openStaffTicket(db, s.userId, "تحویل سرور " + s.name + " با خطا روبه‌رو شد",
    // the ticket belongs to the customer, so it carries no raw error; staff see it on /admin/orders
    "سفارش " + (s.orderRef ?? s.id) + " پرداخت شده و آماده‌سازی سرور با تأخیر روبه‌رو شده است. تیم فنی در حال بررسی است و نتیجه در همین تیکت اعلام می‌شود.", "srv:" + s.id);
  const claimed = await db.update(servers).set({ provisionTicket: tid }).where(and(eq(servers.id, s.id), isNull(servers.provisionTicket))).returning({ id: servers.id });
  if (!claimed.length) return;
  await addTask(db, s.id, "تحویل با تأخیر — تیم فنی در حال بررسی است", "failed", 100);
  await notify(db, s.userId, "server", "تحویل سرور " + s.name + " با تأخیر انجام می‌شود؛ تیم فنی در حال بررسی است");
  await notifyStaff(db, "تحویل سرور " + s.name + " ناموفق بود: " + text.slice(0, 140));
}

export async function provisionServer(db: DB, p: Payload) {
  const sku = p.sku;
  if (sku.t !== "plan" && sku.t !== "custom") throw new Error("not a server sku");
  let [row] = await db.select().from(servers).where(eq(servers.orderRef, ref(p)));
  // delivered (by the worker or by hand) or refunded
  if (row && (row.vpsid || row.status !== "provisioning")) return;
  const u = await owner(db, p.userId);
  const spec = await serverSpec(db, sku, p.override);

  if (!row) {
    const hostBase = (u.email.split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() || "vps").slice(0, 12);
    const sid = await nextId(db, "srv", 2000);
    const vmName = hostBase + "-" + sid.split("-")[1];
    await db.insert(servers).values({
      id: sid, userId: u.id, name: vmName, plan: spec.name, cpu: spec.cpu, ram: spec.ram, disk: spec.disk, loc: sku.loc, os: spec.tpl?.name ?? spec.osLabel,
      status: "provisioning", price: spec.price, billing: spec.hourly ? "hourly" : "monthly", backups: sku.t === "custom" && sku.backup, hostname: vmName + ".gereh.net",
      app: (sku as { app?: string }).app ?? "", orderRef: ref(p),
    }).onConflictDoNothing();
    [row] = await db.select().from(servers).where(eq(servers.orderRef, ref(p)));
    if (row.id === sid) {
      await addTask(db, sid, "آماده‌سازی سرور", "running", 5);
      await logActivity(db, u.id, "server", "سفارش سرور " + vmName + " ثبت شد و در حال آماده‌سازی است");
    }
  }

  try {
    if (spec.problems.length) throw new ProvisionError(spec.problems.join("\n"));
    const v = await virt();
    let virtUid = u.virtUid;
    if (!virtUid) {
      try { virtUid = await v.ensureUser(u.email, randomSecret(20, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789")); }
      catch (e) { throw new ProvisionError("حساب کاربری Virtualizor برای " + u.email + " ساخته نشد: " + errorText(e)); }
      await db.update(users).set({ virtUid }).where(eq(users.id, u.id));
    }
    let rootpass = genPassword();
    // an earlier attempt may have created the VPS and failed afterwards: adopt it instead of creating a second one
    const existing = await v.findVps(row.hostname, virtUid).catch(() => null);
    let created;
    if (existing) {
      created = { vpsid: existing.vpsid, ip: existing.ip, ipv6: existing.ipv6, vncHost: "", vncPort: 0, vncPassword: "" };
      try { await v.rootPassword(existing.vpsid, rootpass); } catch { rootpass = ""; }
    } else {
      const [key] = await db.select().from(sshKeys).where(eq(sshKeys.userId, u.id)).limit(1);
      const sized = spec.cpu > 0 ? { space: spec.disk, ram: spec.ram * 1024, cores: spec.cpu, bandwidth: spec.traffic } : {};
      created = await v.create({ uid: virtUid, plid: spec.plid, osid: spec.tpl!.osid, hostname: row.hostname, rootpass, serverGroup: spec.group, virt: spec.virt, ...sized,
        sshKey: key?.publicKey, cloudInit: cloudInitFor((sku as { app?: string }).app) });
    }
    const sid = row.id, name = row.name;
    await db.transaction(async (tx) => {
      await tx.update(servers).set({
        vpsid: created.vpsid, ip: created.ip, ipv6: created.ipv6, vncHost: created.vncHost, vncPort: created.vncPort, vncPassword: created.vncPassword,
        status: "building", provisionError: null, cpu: spec.cpu || row.cpu, ram: spec.ram || row.ram, disk: spec.disk || row.disk, os: spec.tpl!.name,
        paidUntil: spec.hourly ? null : addMonths(new Date(), spec.months),
      }).where(eq(servers.id, sid));
      await addTask(tx, sid, "ساخت VPS", "running", 10);
      if (spec.hourly) {
        // the prepaid month becomes wallet credit; usage is then charged hourly (billing.hourly)
        const credit = spec.price * spec.months;
        await tx.update(users).set({ balance: sql`${users.balance} + ${credit}` }).where(eq(users.id, u.id));
        await tx.insert(transactions).values({ id: rid("TX"), userId: u.id, type: "topup", amount: credit, method: "کیف پول", desc: "پیش‌پرداخت سرور ساعتی " + name });
      }
    });
    await enqueue(db, "provision.server", { phase: "wait", serverId: sid, rootpass, tries: 0 }, { runAt: new Date(Date.now() + 15_000) });
  } catch (e) {
    await provisionFailed(db, row.id, e);
    throw e;
  }
}

/** second phase: poll until the hypervisor reports the VPS running, then hand over credentials */
export async function waitForBuild(db: DB, p: { serverId: string; rootpass: string; tries: number }) {
  const [s] = await db.select().from(servers).where(eq(servers.id, p.serverId));
  if (!s || s.status !== "building" || !s.vpsid) return;
  if (!(await (await virt()).buildDone(s.vpsid))) {
    if (p.tries > 80) { // ~20 minutes
      await provisionFailed(db, s.id, new ProvisionError("VPS " + s.vpsid + " پس از ۲۰ دقیقه هنوز آماده نشده است (ساخت در Virtualizor متوقف یا کند است)."));
      return;
    }
    await enqueue(db, "provision.server", { phase: "wait", serverId: s.id, rootpass: p.rootpass, tries: p.tries + 1 }, { runAt: new Date(Date.now() + 15_000) });
    return;
  }
  await db.update(servers).set({ status: "running", provisionError: null }).where(eq(servers.id, s.id));
  await addTask(db, s.id, "سرور آماده شد");
  await logActivity(db, s.userId, "server", "سرور " + s.name + " آماده شد");
  await notify(db, s.userId, "server", "سرور " + s.name + " آماده است");
  await sendCredentials(db, s, p.rootpass);
}

export async function sendCredentials(db: DB | Tx, s: { userId: string; name: string; ip: string; hostname: string }, rootpass: string) {
  await enqueue(db, "notify.send", { userId: s.userId, kind: "service", subject: "سرور " + s.name + " آماده است",
    text: "سرور شما آماده است.\n\nآدرس IP: " + s.ip + "\nنام میزبان: " + s.hostname + "\nکاربر: root\n" +
      (rootpass ? "رمز: " + rootpass + "\n\nلطفا پس از ورود رمز را تغییر دهید. این رمز فقط یک بار ارسال می‌شود." : "\nرمز root را از پنل گره، بخش «دسترسی و اپلیکیشن» تنظیم کنید."), secret: true });
}

export async function provisionHosting(db: DB, p: Payload) {
  const [done] = await db.select({ id: hosting.id }).from(hosting).where(eq(hosting.orderRef, ref(p)));
  if (done || p.sku.t !== "hosting") return;
  const sku = p.sku;
  const u = await owner(db, p.userId);
  const [row] = await db.select().from(plans).where(and(eq(plans.id, sku.plan), eq(plans.kind, "hosting")));
  const plan = (row?.data as Plan) ?? HOSTING.linux.concat(HOSTING.wordpress).find((x) => x.id === sku.plan)!;
  const domain = (sku.domain || "").toLowerCase() || u.email.split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() + ".gereh.site";
  const username = (domain.replace(/[^a-z0-9]/g, "").slice(0, 7) || "user") + randomSecret(1, "abcdefghjkmnpqrstuvwxyz");
  const password = "Gh#" + randomSecret(13, "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  const { server } = await (await providers()).hosting.create({ domain, plan: plan.name, username, password, email: u.email });
  const gb = Number(String(plan.disk).replace(/[^\d۰-۹]/g, "").replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))) || 10;
  const hid = await nextId(db, "hst", 500);
  await db.insert(hosting).values({ id: hid, userId: u.id, domain, plan: plan.name, diskTotal: gb, bwTotal: 200, price: plan.price, server, username, expiresAt: addMonths(new Date(), sku.yearly ? 12 : 1), orderRef: ref(p) });
  await logActivity(db, u.id, "layers", "هاست " + domain + " فعال شد");
  await notify(db, u.id, "layers", "هاست " + domain + " آماده است");
  await enqueue(db, "notify.send", { userId: u.id, kind: "service", subject: "هاست " + domain + " آماده است", text: "هاست شما فعال شد.\n\nدامنه: " + domain + "\nنام کاربری cPanel: " + username + "\nرمز: " + password + "\nنام‌سرورها: ns1.gereh.net و ns2.gereh.net", secret: true });
}

export const NS = ["ns1.gereh.net", "ns2.gereh.net"];
export async function provisionDomain(db: DB, p: Payload & { renew?: string; years?: number }) {
  const reg = (await providers()).registrar;
  if (p.renew) {
    const [d] = await db.select().from(domains).where(eq(domains.id, p.renew));
    if (d) await reg.renew(d.name, p.years ?? 1);
    return;
  }
  if (p.sku.t !== "domain") return;
  const sku = p.sku;
  const name = sku.name.toLowerCase();
  const [exists] = await db.select().from(domains).where(eq(domains.name, name));
  if (exists) {
    if (exists.orderRef === ref(p)) return; // already done
    await openStaffTicket(db, p.userId, "دامنه " + name + " قابل ثبت نبود", "دامنه پیش از تکمیل سفارش " + p.invoiceId + " ثبت شده بود. مبلغ به کیف پول بازگردانده شود.");
    return;
  }
  // .ir needs the holder's IRNIC handle (checked at checkout, saved under the domains page)
  const irnicHandle = /\.ir$/.test(name) ? (await db.select().from(domainContacts).where(eq(domainContacts.userId, p.userId)))[0]?.irnicHandle ?? "" : "";
  const { authCode } = await reg.register(name, sku.years, NS, irnicHandle ? { irnicHandle } : undefined);
  const did = await nextId(db, "dom", 700);
  await db.transaction(async (tx) => {
    await tx.insert(domains).values({ id: did, userId: p.userId, name, registeredAt: new Date(), expiresAt: addMonths(new Date(), 12 * sku.years), ns: NS, authCode, orderRef: ref(p) });
    await tx.insert(dnsRecords).values([
      { id: rid("r"), domainId: did, type: "A", name: "@", value: "185.143.232.10", ttl: 3600 },
      { id: rid("r"), domainId: did, type: "CNAME", name: "www", value: name, ttl: 3600 },
    ]);
    if (irnicHandle) await tx.insert(domainExtras).values({ domainId: did, irnicHandle });
  });
  await (await providers()).dns.sync(db, did);
  await logActivity(db, p.userId, "globe", "دامنه " + name + " ثبت شد");
  await notify(db, p.userId, "globe", "دامنه " + name + " ثبت شد");
}

/** extra IPv4 needs a free address from the right subnet: handed to staff as a ticket */
export async function provisionIp(db: DB, p: Payload) {
  if (p.sku.t !== "ip") return;
  const [s] = await db.select().from(servers).where(eq(servers.id, p.sku.serverId));
  if (!s) return;
  await addTask(db, s.id, "درخواست IPv4 اضافه ثبت شد", "running", 20);
  await openStaffTicket(db, p.userId, "تخصیص IPv4 اضافه برای " + s.name, "پرداخت در " + p.invoiceId + " انجام شده است. VPS " + s.vpsid + " (" + s.ip + ").", "srv:" + s.id);
}

export async function openStaffTicket(db: DB | Tx, userId: string, subject: string, text: string, service = "") {
  const id = await nextId(db, "TK", 3100);
  await db.insert(tickets).values({ id, userId, subject, dept: "فنی", priority: "high", service: service.replace(/^srv:/, ""), status: "open" });
  await db.insert(ticketMessages).values({ ticketId: id, from: "staff", name: "سیستم", text });
  return id;
}
