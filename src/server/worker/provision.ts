/* Turns paid order lines into running services. Every handler is idempotent on orderRef
   ("<invoice>:<line>"), so a retried job never creates a second VPS, account or registration. */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { BILLING, HOSTING, LOCS, OSES, PLAN_NUMS, VPS, type Plan, type Sku } from "@/lib/catalog";
import { addMonths } from "@/lib/jalali";
import type { DB } from "../db/client";
import { dnsRecords, domains, hosting, osTemplates, planMap, plans, servers, sshKeys, transactions, tickets, ticketMessages, users } from "../db/schema";
import { enqueue } from "../jobs";
import { providers } from "../providers";
import { cloudInitFor } from "../apps";
import { virt } from "../virt/driver";
import { addTask, genPassword, logActivity, nextId, notify, randomSecret, rid } from "../util";

type Payload = { userId: string; invoiceId: string; index: number; sku: Sku };
const ref = (p: Payload) => p.invoiceId + ":" + p.index;

async function owner(db: DB, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new Error("user " + id + " not found");
  return u;
}

export async function provisionServer(db: DB, p: Payload) {
  const [done] = await db.select({ id: servers.id }).from(servers).where(eq(servers.orderRef, ref(p)));
  if (done) return;
  const sku = p.sku;
  if (sku.t !== "plan" && sku.t !== "custom") throw new Error("not a server sku");
  const u = await owner(db, p.userId);

  // resources, plan and location
  let name: string, cpu: number, ram: number, disk: number, price: number, plid = 0, group: string, months = 1;
  if (sku.t === "plan") {
    const [row] = await db.select().from(plans).where(and(eq(plans.id, sku.plan), eq(plans.kind, sku.kind)));
    const plan = (row?.data as Plan) ?? (sku.kind === "cloud" ? VPS.cloud : VPS.metal).find((x) => x.id === sku.plan)!;
    [cpu, ram, disk] = PLAN_NUMS[sku.plan] ?? [8, 64, 2000];
    const [m] = await db.select().from(planMap).where(eq(planMap.id, sku.plan));
    plid = m?.plid ?? 0;
    group = m?.group.replace(/^thr/, sku.loc) ?? sku.loc + "-cloud";
    name = plan.name;
    const cycle = BILLING.find((b) => b.id === sku.cycle)!;
    months = cycle.months;
    price = Math.round(plan.price * (LOCS.find((l) => l.id === sku.loc)?.foreign && sku.kind === "cloud" ? 1.12 : 1) / 1000) * 1000;
  } else {
    ({ cpu, ram, disk } = sku);
    const { configPrice } = await import("@/lib/catalog");
    price = configPrice(sku);
    name = "سفارشی";
    group = sku.loc + "-cloud";
    const [m] = await db.select().from(planMap).where(eq(planMap.id, "c1"));
    plid = m?.plid ?? 0;
  }
  const osLabel = OSES.find((o) => o.id === ((sku as { os?: string }).os || "ubuntu"))?.label ?? "Ubuntu 24.04";
  const [tpl] = await db.select().from(osTemplates).where(sql`${osTemplates.on} and (${osTemplates.name} = ${osLabel} or ${osTemplates.distro} = ${osLabel.split(" ")[0].toLowerCase()})`).limit(1);
  const hostBase = (u.email.split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() || "vps").slice(0, 12);
  const sid = await nextId(db, "srv", 2000);
  const vmName = hostBase + "-" + sid.split("-")[1];
  const rootpass = genPassword();
  const [key] = await db.select().from(sshKeys).where(eq(sshKeys.userId, u.id)).limit(1);

  const v = await virt();
  const virtUid = u.virtUid ?? (await v.ensureUser(u.email, randomSecret(20, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789")));
  if (!u.virtUid) await db.update(users).set({ virtUid }).where(eq(users.id, u.id));
  const created = await v.create({ uid: virtUid, plid, osid: tpl?.osid ?? 347, hostname: vmName + ".gereh.cloud", rootpass, serverGroup: group, sshKey: key?.publicKey, cloudInit: cloudInitFor((sku as { app?: string }).app) });
  if (sku.t === "custom") await v.manage(created.vpsid, { cores: cpu, ram: ram * 1024, space: disk });

  const hourly = !!(sku as { hourly?: boolean }).hourly;
  await db.transaction(async (tx) => {
    await tx.insert(servers).values({
      id: sid, userId: u.id, name: vmName, plan: name, cpu, ram, disk, loc: sku.loc, os: tpl?.name ?? osLabel, ip: created.ip, ipv6: created.ipv6,
      status: "building", price, billing: hourly ? "hourly" : "monthly", backups: sku.t === "custom" && sku.backup, vpsid: created.vpsid, hostname: vmName + ".gereh.cloud",
      vncHost: created.vncHost, vncPort: created.vncPort, vncPassword: created.vncPassword, app: (sku as { app?: string }).app ?? "",
      paidUntil: hourly ? null : addMonths(new Date(), months), orderRef: ref(p),
    });
    await addTask(tx, sid, "ساخت VPS", "running", 10);
    if (hourly) {
      // the prepaid month becomes wallet credit; usage is then charged hourly (billing.hourly)
      const credit = price * months;
      await tx.update(users).set({ balance: sql`${users.balance} + ${credit}` }).where(eq(users.id, u.id));
      await tx.insert(transactions).values({ id: rid("TX"), userId: u.id, type: "topup", amount: credit, method: "کیف پول", desc: "پیش‌پرداخت سرور ساعتی " + vmName });
    }
  });
  await enqueue(db, "provision.server", { phase: "wait", serverId: sid, rootpass, tries: 0 }, { runAt: new Date(Date.now() + 15_000) });
}

/** second phase: poll until the hypervisor reports the VPS running, then hand over credentials */
export async function waitForBuild(db: DB, p: { serverId: string; rootpass: string; tries: number }) {
  const [s] = await db.select().from(servers).where(eq(servers.id, p.serverId));
  if (!s || s.status !== "building") return;
  if (!(await (await virt()).buildDone(s.vpsid!))) {
    if (p.tries > 80) { // ~20 minutes
      await addTask(db, s.id, "ساخت VPS ناموفق بود؛ پشتیبانی بررسی می‌کند", "failed", 100);
      await openStaffTicket(db, s.userId, "ساخت سرور " + s.name + " ناموفق بود", "VPS " + s.vpsid + " پس از ۲۰ دقیقه آماده نشد. لطفا بررسی شود.");
      return;
    }
    await enqueue(db, "provision.server", { phase: "wait", serverId: s.id, rootpass: p.rootpass, tries: p.tries + 1 }, { runAt: new Date(Date.now() + 15_000) });
    return;
  }
  await db.update(servers).set({ status: "running" }).where(eq(servers.id, s.id));
  await addTask(db, s.id, "سرور آماده شد");
  await logActivity(db, s.userId, "server", "سرور " + s.name + " آماده شد");
  await notify(db, s.userId, "server", "سرور " + s.name + " آماده است");
  await enqueue(db, "notify.send", { userId: s.userId, kind: "service", subject: "سرور " + s.name + " آماده است",
    text: "سرور شما آماده است.\n\nآدرس IP: " + s.ip + "\nنام میزبان: " + s.hostname + "\nکاربر: root\nرمز: " + p.rootpass + "\n\nلطفا پس از ورود رمز را تغییر دهید. این رمز فقط یک بار ارسال می‌شود.", secret: true });
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
  await enqueue(db, "notify.send", { userId: u.id, kind: "service", subject: "هاست " + domain + " آماده است", text: "هاست شما فعال شد.\n\nدامنه: " + domain + "\nنام کاربری cPanel: " + username + "\nرمز: " + password + "\nنام‌سرورها: ns1.gereh.cloud و ns2.gereh.cloud", secret: true });
}

const NS = ["ns1.gereh.cloud", "ns2.gereh.cloud"];
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
  const { authCode } = await reg.register(name, sku.years, NS);
  const did = await nextId(db, "dom", 700);
  await db.transaction(async (tx) => {
    await tx.insert(domains).values({ id: did, userId: p.userId, name, registeredAt: new Date(), expiresAt: addMonths(new Date(), 12 * sku.years), ns: NS, authCode, orderRef: ref(p) });
    await tx.insert(dnsRecords).values([
      { id: rid("r"), domainId: did, type: "A", name: "@", value: "185.143.232.10", ttl: 3600 },
      { id: rid("r"), domainId: did, type: "CNAME", name: "www", value: name, ttl: 3600 },
    ]);
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

export async function openStaffTicket(db: DB, userId: string, subject: string, text: string, service = "") {
  const id = await nextId(db, "TK", 3100);
  await db.insert(tickets).values({ id, userId, subject, dept: "فنی", priority: "high", service: service.replace(/^srv:/, ""), status: "open" });
  await db.insert(ticketMessages).values({ ticketId: id, from: "staff", name: "سیستم", text });
  return id;
}
