/* Builds the ClientDB the UI renders for one session.
   Customers (and staff impersonating one) get only that customer's records plus public catalog data;
   staff in the admin panel get every record. Secrets (password hashes, 2FA secrets, token hashes,
   gateway keys) never leave this file. */
import "server-only";
import { and, asc, count, desc, eq, gte, inArray, ne, sum } from "drizzle-orm";
import type { Plan, Tld } from "@/lib/catalog";
import { faDate, faDateTime } from "@/lib/jalali";
import type { ClientDB, Session, Settings } from "@/lib/types";
import type { DB } from "./db/client";
import * as t from "./db/schema";
import type { Auth } from "./auth";
import { gatewaysFor } from "./pay/gateways";
import { DEFAULT_SETTINGS, DEFAULT_VIRT } from "./seed";

const STAFF_LABEL: Record<string, string> = { owner: "مدیر کل", support: "پشتیبانی فنی", finance: "مالی", sales: "فروش", viewer: "فقط مشاهده" };
export const staffLabel = (r: string | null | undefined) => STAFF_LABEL[r || "viewer"] || "فقط مشاهده";
export const STAFF_ROLE_BY_LABEL = Object.fromEntries(Object.entries(STAFF_LABEL).map(([k, v]) => [v, k])) as Record<string, string>;

export async function getSettings(db: DB): Promise<Settings> {
  const [row] = await db.select().from(t.kv).where(eq(t.kv.key, "settings"));
  const { smsKeyEnc: _secret, payGateway: _derived, ...v } = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings> & { smsKeyEnc?: string }) || {}) };
  return { ...v, payGateway: gatewaysFor(v)[0]?.label ?? "" };
}
/** the stored (encrypted) SMS API key, server-side only */
export async function getSmsKeySealed(db: DB): Promise<string | null> {
  const [row] = await db.select().from(t.kv).where(eq(t.kv.key, "settings"));
  return ((row?.value as { smsKeyEnc?: string }) || {}).smsKeyEnc ?? null;
}
export async function getVirt(db: DB) {
  const [row] = await db.select().from(t.kv).where(eq(t.kv.key, "virt"));
  return { ...DEFAULT_VIRT, ...((row?.value as Record<string, string | number | boolean>) || {}) };
}

const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 2) return "همین حالا";
  if (m < 60) return m.toLocaleString("fa-IR") + " دقیقه پیش";
  if (m < 1440) return Math.round(m / 60).toLocaleString("fa-IR") + " ساعت پیش";
  if (m < 2880) return "دیروز";
  return Math.round(m / 1440).toLocaleString("fa-IR") + " روز پیش";
};

export function clientSession(auth: Auth | null): Session | null {
  if (!auth) return null;
  return { userId: auth.uid, role: auth.user.role, name: auth.user.name, actorId: auth.user.id, staffRole: auth.user.staffRole ?? undefined };
}

/** scope "admin" only for staff on /admin; customers and impersonation get "customer" */
export async function buildState(db: DB, auth: Auth | null, scope: "customer" | "admin"): Promise<{ session: Session | null; db: ClientDB }> {
  const settings = await getSettings(db);
  const [planRows, tldRows] = await Promise.all([
    db.select().from(t.plans).orderBy(asc(t.plans.position)),
    db.select().from(t.tlds).orderBy(asc(t.tlds.position)),
  ]);
  const plans = { cloud: [] as Plan[], metal: [] as Plan[], hosting: [] as Plan[] };
  for (const p of planRows) plans[p.kind].push(p.data as Plan);
  const tlds: Tld[] = tldRows.map((x) => ({ tld: x.tld, reg: x.reg, renew: x.renew, transfer: x.transfer, cat: x.cat, hot: x.hot, promo: x.promo }));
  const empty: ClientDB = {
    users: [], servers: [], hosting: [], domains: [], invoices: [], transactions: [], tickets: [], sshKeys: [], apiTokens: [], sessions: [],
    notifPrefs: {}, twofa: false, inbox: [], notifications: [], activity: [], nodes: [], coupons: [], announcements: [], audit: [], staff: [],
    settings: { ...settings, smsKeySet: false }, plans, tlds, virt: {}, virtLog: [], planMap: [], osTemplates: [], isos: [], affiliate: { code: "", referred: 0, earned: 0 },
  };
  if (!auth) return { session: null, db: empty };

  const admin = scope === "admin" && auth.user.role === "admin";
  const uid = auth.uid;
  const own = <T extends { userId: unknown }>(col: T["userId"]) => (admin ? undefined : eq(col as never, uid));

  const [users, servers, hosting, domains, invoices, items, txs, tickets, msgs, anns, osT, isoRows, nodes] = await Promise.all([
    admin ? db.select().from(t.users).orderBy(asc(t.users.createdAt)) : db.select().from(t.users).where(eq(t.users.id, uid)),
    db.select().from(t.servers).where(own(t.servers.userId)).orderBy(asc(t.servers.createdAt)),
    db.select().from(t.hosting).where(own(t.hosting.userId)).orderBy(asc(t.hosting.createdAt)),
    db.select().from(t.domains).where(own(t.domains.userId)).orderBy(asc(t.domains.registeredAt)),
    db.select().from(t.invoices).where(own(t.invoices.userId)).orderBy(desc(t.invoices.createdAt), desc(t.invoices.id)),
    admin ? db.select().from(t.invoiceItems).orderBy(asc(t.invoiceItems.id))
      : db.select({ id: t.invoiceItems.id, invoiceId: t.invoiceItems.invoiceId, desc: t.invoiceItems.desc, amount: t.invoiceItems.amount }).from(t.invoiceItems).innerJoin(t.invoices, eq(t.invoices.id, t.invoiceItems.invoiceId)).where(eq(t.invoices.userId, uid)).orderBy(asc(t.invoiceItems.id)),
    db.select().from(t.transactions).where(own(t.transactions.userId)).orderBy(desc(t.transactions.createdAt)),
    db.select().from(t.tickets).where(own(t.tickets.userId)).orderBy(desc(t.tickets.updatedAt)),
    admin ? db.select().from(t.ticketMessages).orderBy(asc(t.ticketMessages.id))
      : db.select({ id: t.ticketMessages.id, ticketId: t.ticketMessages.ticketId, from: t.ticketMessages.from, name: t.ticketMessages.name, text: t.ticketMessages.text, createdAt: t.ticketMessages.createdAt }).from(t.ticketMessages).innerJoin(t.tickets, eq(t.tickets.id, t.ticketMessages.ticketId)).where(eq(t.tickets.userId, uid)).orderBy(asc(t.ticketMessages.id)),
    db.select().from(t.announcements).orderBy(desc(t.announcements.createdAt)),
    db.select().from(t.osTemplates).orderBy(asc(t.osTemplates.osid)),
    db.select().from(t.isos),
    db.select().from(t.nodes).orderBy(asc(t.nodes.id)),
  ]);

  const sids = servers.map((s) => s.id);
  const [fw, snaps, bks, tasks] = sids.length ? await Promise.all([
    db.select().from(t.firewallRules).where(inArray(t.firewallRules.serverId, sids)).orderBy(asc(t.firewallRules.position)),
    db.select().from(t.snapshots).where(inArray(t.snapshots.serverId, sids)).orderBy(desc(t.snapshots.createdAt)),
    db.select().from(t.backups).where(inArray(t.backups.serverId, sids)).orderBy(desc(t.backups.createdAt)),
    db.select().from(t.serverTasks).where(inArray(t.serverTasks.serverId, sids)).orderBy(desc(t.serverTasks.createdAt)),
  ]) : [[], [], [], []];
  const samples = !admin && sids.length ? await db.select().from(t.usageSamples).where(and(inArray(t.usageSamples.serverId, sids), gte(t.usageSamples.createdAt, new Date(Date.now() - 4 * 3600_000)))).orderBy(asc(t.usageSamples.createdAt)) : [];
  const dids = domains.map((d) => d.id);
  const dns = dids.length ? await db.select().from(t.dnsRecords).where(inArray(t.dnsRecords.domainId, dids)).orderBy(asc(t.dnsRecords.position)) : [];
  const group = <T, K extends keyof T>(rows: T[], key: K) => { const m = new Map<T[K], T[]>(); for (const r of rows) { const a = m.get(r[key]); if (a) a.push(r); else m.set(r[key], [r]); } return m; };
  const usageBy = group(samples, "serverId"), fwBy = group(fw, "serverId"), snapBy = group(snaps, "serverId"), bkBy = group(bks, "serverId"), taskBy = group(tasks, "serverId"), dnsBy = group(dns, "domainId");
  const itemsBy = group(items, "invoiceId"), msgBy = group(msgs, "ticketId");
  const servicesBy = new Map<string, number>();
  for (const r of [...servers, ...hosting, ...domains]) servicesBy.set(r.userId, (servicesBy.get(r.userId) || 0) + 1);

  const me = users.find((u) => u.id === uid) || (await db.select().from(t.users).where(eq(t.users.id, uid)))[0];
  const [keys, tokens, sess, notifs, acts] = await Promise.all([
    db.select().from(t.sshKeys).where(eq(t.sshKeys.userId, uid)).orderBy(asc(t.sshKeys.createdAt)),
    db.select().from(t.apiTokens).where(eq(t.apiTokens.userId, uid)).orderBy(asc(t.apiTokens.createdAt)),
    db.select().from(t.sessions).where(eq(t.sessions.userId, auth.user.id)).orderBy(desc(t.sessions.lastSeenAt)),
    db.select().from(t.notifications).where(eq(t.notifications.userId, uid)).orderBy(desc(t.notifications.createdAt)).limit(30),
    db.select().from(t.activity).where(eq(t.activity.userId, uid)).orderBy(desc(t.activity.createdAt)).limit(50),
  ]);

  const out: ClientDB = {
    ...empty,
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, company: u.company, balance: u.balance, status: u.status, kyc: u.kyc, joined: faDate(u.createdAt), services: servicesBy.get(u.id) || 0, role: u.role, referralCode: u.referralCode, autoPay: u.autoPay })),
    servers: servers.map((s) => ({
      id: s.id, userId: s.userId, name: s.name, plan: s.plan, cpu: s.cpu, ram: s.ram, disk: s.disk, loc: s.loc, os: s.os, ip: s.ip, ipv6: s.ipv6, rdns: s.rdns,
      status: s.status, created: faDate(s.createdAt), price: s.price, backups: s.backups, billing: s.billing, app: s.app, alerts: s.alerts,
      firewall: (fwBy.get(s.id) || []).map((r) => ({ id: r.id, proto: r.proto, port: r.port, source: r.source, action: r.action, note: r.note })),
      snapshots: (snapBy.get(s.id) || []).map((x) => ({ id: x.id, name: x.name, size: x.size, at: faDate(x.createdAt) })),
      backupsList: (bkBy.get(s.id) || []).map((x) => ({ id: x.id, size: x.size, at: faDateTime(x.createdAt) })),
      vpsid: s.vpsid || 0, hostname: s.hostname, boot: s.boot, iso: s.iso, rescue: s.rescue, bwLimit: s.bwLimit,
      vnc: { host: s.vncHost, port: s.vncPort, password: s.vncPassword },
      usage: (usageBy.get(s.id) || []).map((u) => ({ at: faDateTime(u.createdAt), cpu: u.cpu, ram: u.ram, disk: u.disk, netIn: u.netIn, netOut: u.netOut, bwUsed: u.bwUsed })),
      tasks: (taskBy.get(s.id) || []).map((x) => ({ id: x.id, action: x.action, status: x.status, progress: x.progress, at: faDateTime(x.createdAt) })),
    })),
    hosting: hosting.map((h) => ({ id: h.id, userId: h.userId, domain: h.domain, plan: h.plan, diskUsed: h.diskUsed, diskTotal: h.diskTotal, bwUsed: h.bwUsed, bwTotal: h.bwTotal, emails: h.emails, dbs: h.dbs, status: h.status, expires: faDate(h.expiresAt), price: h.price, panel: h.panel, server: h.server, autoRenew: h.autoRenew })),
    domains: domains.map((d) => ({ id: d.id, userId: d.userId, name: d.name, registered: faDate(d.registeredAt), expires: faDate(d.expiresAt), autoRenew: d.autoRenew, privacy: d.privacy, locked: d.locked, status: d.status, ns: d.ns, authCode: d.locked ? "" : d.authCode,
      dns: (dnsBy.get(d.id) || []).map((r) => ({ id: r.id, type: r.type, name: r.name, value: r.value, ttl: r.ttl, ...(r.priority !== null ? { priority: r.priority } : {}) })) })),
    invoices: invoices.map((i) => ({ id: i.id, userId: i.userId, date: faDate(i.createdAt), due: faDate(i.dueAt), status: i.status, tax: i.taxRate, official: i.official ?? null, paidAt: i.paidAt ? faDateTime(i.paidAt) : "", items: (itemsBy.get(i.id) || []).map((x) => ({ desc: x.desc, amount: x.amount })) })),
    transactions: txs.map((x) => ({ id: x.id, userId: x.userId, date: faDate(x.createdAt), type: x.type, amount: x.amount, method: x.method, desc: x.desc })),
    tickets: tickets.map((x) => ({ id: x.id, userId: x.userId, subject: x.subject, dept: x.dept, priority: x.priority, status: x.status, service: x.service, assignee: x.assignee, updated: faDate(x.updatedAt),
      messages: (msgBy.get(x.id) || []).map((m) => ({ from: m.from, name: m.name, text: m.text, at: faDateTime(m.createdAt) })) })),
    sshKeys: keys.map((k) => ({ id: k.id, name: k.name, fingerprint: k.fingerprint, added: faDate(k.createdAt) })),
    apiTokens: tokens.map((k) => ({ id: k.id, name: k.name, scope: k.scope, created: faDate(k.createdAt), lastUsed: k.lastUsedAt ? faDate(k.lastUsedAt) : "—", expires: k.expiresAt ? faDate(k.expiresAt) : "بدون انقضا" })),
    sessions: sess.map((x) => ({ id: x.id.slice(0, 16), device: x.device || "مرورگر", ip: x.ip, place: "", last: ago(x.lastSeenAt), current: x.id === auth.sessionId })),
    notifPrefs: me?.notifPrefs || {},
    twofa: !!me?.twofaSecret,
    notifications: notifs.map((n) => ({ id: n.id, icon: n.icon, text: n.text, read: n.read, at: ago(n.createdAt) })),
    activity: acts.map((a) => ({ id: a.id, icon: a.icon, text: a.text, ip: a.ip, at: faDateTime(a.createdAt) })),
    announcements: anns.map((a) => ({ id: a.id, title: a.title, body: a.body, level: a.level, at: faDate(a.createdAt) })),
    osTemplates: osT, isos: isoRows.map((x) => x.filename),
    settings: { ...settings, smsKeySet: admin ? settings.smsKeySet : false },
  };
  if (me) {
    const [[ref], [earned]] = await Promise.all([
      db.select({ n: count() }).from(t.users).where(eq(t.users.referredBy, me.id)),
      db.select({ s: sum(t.transactions.amount) }).from(t.transactions).where(and(eq(t.transactions.userId, me.id), eq(t.transactions.type, "commission"))),
    ]);
    out.affiliate = { code: me.referralCode, referred: ref.n, earned: Number(earned.s || 0) };
  }
  if (!admin) {
    out.nodes = nodes.map((n) => ({ ...n, cpu: 0, ram: 0, disk: 0, vms: 0, model: "" })); // locations/status only
    return { session: clientSession(auth), db: out };
  }

  const [coupons, audit, staff, virtLog, planMap, inbox] = await Promise.all([
    db.select().from(t.coupons).orderBy(asc(t.coupons.id)),
    db.select().from(t.audit).orderBy(desc(t.audit.createdAt)).limit(500),
    db.select().from(t.users).where(and(eq(t.users.role, "admin"), ne(t.users.status, "deleted"))).orderBy(asc(t.users.createdAt)),
    db.select().from(t.virtLog).orderBy(desc(t.virtLog.createdAt)).limit(200),
    db.select().from(t.planMap),
    db.select().from(t.inbox).orderBy(desc(t.inbox.createdAt)).limit(200),
  ]);
  const virt = await getVirt(db);
  out.nodes = nodes;
  out.coupons = coupons.map((c) => ({ id: c.id, code: c.code, type: c.type, value: c.value, used: c.used, limit: c.limit, expires: c.expiresAt ? faDate(c.expiresAt) : "—", active: c.active }));
  out.audit = audit.map((a) => ({ id: a.id, actor: a.actor, action: a.action, target: a.target, ip: a.ip, at: faDateTime(a.createdAt) }));
  out.staff = staff.map((s) => ({ id: s.id, name: s.name, email: s.email, role: staffLabel(s.staffRole) }));
  const { passEnc: _secret, ...virtPublic } = virt;
  out.virt = { ...virtPublic, lastSync: virt.lastSync ? faDateTime(new Date(String(virt.lastSync))) : "—" };
  out.virtLog = virtLog.map((v) => ({ id: v.id, kind: v.kind, result: v.result, detail: v.detail, at: faDateTime(v.createdAt) }));
  out.planMap = planMap;
  out.inbox = inbox.map((m) => ({ id: m.id, name: m.name, email: m.email, dept: m.dept, subject: m.subject, message: m.message, at: faDateTime(m.createdAt) }));
  return { session: clientSession(auth), db: out };
}
