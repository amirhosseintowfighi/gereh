/* Domains: what the DNS server publishes (CDN-proxied records answer with the edge), CDN specs,
   one-click record sets, transfers and traffic alerts. */
import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { CDN_DEFAULT, type AlertMetric, type CdnConfig, type CdnPoint, type CdnRule, type DnsSuggestion, conflictOf, isIpv4, isIpv6, PROXIABLE } from "@/lib/domains";
import type { DB, Tx } from "../db/client";
import { cdnRules, cdnSettings, dnsRecords, domainAlerts, domains, domainTransfers, mailDomains, paasApps, servers, transactions, users } from "../db/schema";
import { appsDomain, defaultHost } from "../paas/service";
import { recordsOf } from "../mail/service";
import { enqueue } from "../jobs";
import { notify, rid } from "../util";
import { cdnDriver, edgeIps, type CdnSpec } from "./cdn";

export type DomainRow = typeof domains.$inferSelect;
type RecordRow = typeof dnsRecords.$inferSelect;
export type Published = { type: string; name: string; value: string; ttl: number; priority: number | null };

export async function cdnConfig(db: DB | Tx, domainId: string): Promise<CdnConfig> {
  const [c] = await db.select().from(cdnSettings).where(eq(cdnSettings.domainId, domainId));
  if (!c) return { ...CDN_DEFAULT };
  const dev = !!c.devUntil && c.devUntil > new Date();
  return {
    enabled: c.enabled, originHost: c.originHost, originHostHeader: c.originHostHeader, originHttps: c.originHttps, forceHttps: c.forceHttps,
    hstsMaxAge: c.hstsMaxAge, hstsSub: c.hstsSub, hstsPreload: c.hstsPreload, minTls: c.minTls as CdnConfig["minTls"], browserTtl: c.browserTtl,
    devMode: dev, devUntil: dev ? c.devUntil!.toISOString() : "", underAttack: c.underAttack, cacheVersion: c.cacheVersion,
  };
}

/** pure: records as published; proxied ones answer with the edge addresses while the CDN is on */
export function publish(recs: Pick<RecordRow, "type" | "name" | "value" | "ttl" | "priority" | "proxied">[], cdnOn: boolean, edge = edgeIps()): Published[] {
  const out: Published[] = [];
  const edged = new Set<string>();
  for (const r of recs) {
    if (cdnOn && r.proxied && PROXIABLE.includes(r.type) && edge.ipv4.length) {
      if (edged.has(r.name)) continue;
      edged.add(r.name);
      for (const ip of edge.ipv4) out.push({ type: "A", name: r.name, value: ip, ttl: 300, priority: null });
      for (const ip of edge.ipv6) out.push({ type: "AAAA", name: r.name, value: ip, ttl: 300, priority: null });
      continue;
    }
    out.push({ type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority });
  }
  // a proxied name must not keep unproxied A/AAAA next to the edge answers
  return out.filter((r) => !(edged.has(r.name) && (r.type === "A" || r.type === "AAAA" || r.type === "CNAME" || r.type === "ALIAS") && !edge.ipv4.includes(r.value) && !edge.ipv6.includes(r.value)));
}

export async function publishedRecords(db: DB | Tx, domainId: string) {
  const recs = await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, domainId)).orderBy(asc(dnsRecords.position));
  return publish(recs, (await cdnConfig(db, domainId)).enabled);
}

/** where the edge fetches from: the configured origin, else the first proxied record at @ or www */
export function originOf(recs: Pick<RecordRow, "type" | "name" | "value" | "proxied">[], cfg: Pick<CdnConfig, "originHost">) {
  if (cfg.originHost) return cfg.originHost;
  const p = recs.filter((r) => r.proxied && PROXIABLE.includes(r.type));
  return (p.find((r) => r.name === "@") ?? p.find((r) => r.name === "www") ?? p[0])?.value ?? "";
}

export async function cdnSpec(db: DB | Tx, d: DomainRow): Promise<CdnSpec> {
  const cfg = await cdnConfig(db, d.id);
  const recs = await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, d.id));
  const rules = await db.select().from(cdnRules).where(eq(cdnRules.domainId, d.id)).orderBy(asc(cdnRules.position));
  const hosts = [...new Set(recs.filter((r) => r.proxied && PROXIABLE.includes(r.type)).map((r) => (r.name === "@" ? d.name : r.name + "." + d.name)))];
  return {
    domain: d.name, hosts, origin: originOf(recs, cfg), originHostHeader: cfg.originHostHeader, originHttps: cfg.originHttps,
    forceHttps: cfg.forceHttps, hsts: { maxAge: cfg.hstsMaxAge, sub: cfg.hstsSub, preload: cfg.hstsPreload }, minTls: cfg.minTls,
    browserTtl: cfg.browserTtl, devMode: cfg.devMode, underAttack: cfg.underAttack, cacheVersion: cfg.cacheVersion,
    rules: rules.map((r) => ({ ...(r.data as CdnRule), id: r.id, ...(r.kind === "auth" ? { htpasswd: r.secret } : {}) })),
  };
}

/** pushes the edge config and the zone (proxied records switch between edge and origin) */
export async function syncCdn(db: DB, d: DomainRow) {
  const cfg = await cdnConfig(db, d.id);
  const spec = await cdnSpec(db, d);
  if (cfg.enabled && spec.hosts.length && spec.origin) await cdnDriver().apply(spec);
  else await cdnDriver().remove(d.name);
  const { providers } = await import("../providers");
  await (await providers()).dns.sync(db, d.id);
}

/* ---------- one-click records ---------- */
type SuggestRec = DnsSuggestion["records"][number];
const rec = (type: string, name: string, value: string, priority: number | null = null, ttl = 3600): SuggestRec => ({ type, name, value, priority, ttl });

/** record sets that point the domain at the customer's apps, servers or mail domains */
export async function suggestRecords(db: DB, userId: string, d: Pick<DomainRow, "name">): Promise<DnsSuggestion[]> {
  const out: DnsSuggestion[] = [];
  const [apps, vps, mail, base] = await Promise.all([
    db.select({ id: paasApps.id, name: paasApps.name }).from(paasApps).where(eq(paasApps.userId, userId)).orderBy(asc(paasApps.createdAt)),
    db.select({ id: servers.id, name: servers.name, ip: servers.ip, ipv6: servers.ipv6 }).from(servers).where(eq(servers.userId, userId)),
    db.select().from(mailDomains).where(eq(mailDomains.userId, userId)),
    appsDomain(db),
  ]);
  for (const a of apps) {
    const host = defaultHost(a.name, base);
    out.push({ key: "app:" + a.id, label: "اپ " + a.name, icon: "rocket", records: [rec("ALIAS", "@", host), rec("CNAME", "www", host)] });
  }
  for (const s of vps) {
    if (!isIpv4(s.ip)) continue;
    out.push({ key: "vps:" + s.id, label: "سرور " + s.name + " (" + s.ip + ")", icon: "server", records: [
      rec("A", "@", s.ip), rec("A", "www", s.ip), ...(s.ipv6 && isIpv6(s.ipv6) ? [rec("AAAA", "@", s.ipv6), rec("AAAA", "www", s.ipv6)] : []),
    ] });
  }
  for (const m of mail) {
    if (m.domain !== d.name && !m.domain.endsWith("." + d.name)) continue;
    const relName = (fq: string) => (fq === d.name ? "@" : fq.slice(0, -(d.name.length + 1)));
    out.push({ key: "mail:" + m.id, label: "سرویس ایمیل " + m.domain, icon: "mail", records: recordsOf(m).map((r) => rec(r.type, relName(r.name), r.value, r.priority ?? null)) });
  }
  return out;
}

/** writes a record set, replacing what would clash at the same names (CNAME rules, one SPF/DMARC, our MX) */
export async function applyRecords(db: DB, domainId: string, set: SuggestRec[]) {
  const existing = await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, domainId));
  const drop = new Set<string>();
  const add: (typeof dnsRecords.$inferInsert)[] = [];
  for (const r of set) {
    const same = existing.filter((x) => x.name === r.name && !drop.has(x.id));
    if (same.some((x) => x.type === r.type && x.value === r.value && (x.priority ?? null) === r.priority)) continue;
    for (const x of same) {
      const clash = r.type === "CNAME" || x.type === "CNAME"
        || (r.type === "ALIAS" && (x.type === "A" || x.type === "AAAA" || x.type === "ALIAS"))
        || ((r.type === "A" || r.type === "AAAA") && (x.type === r.type || x.type === "ALIAS"))
        || (r.type === "MX" && x.type === "MX")
        || (r.type === "TXT" && x.type === "TXT" && (/^v=spf1/i.test(r.value) ? /^v=spf1/i.test(x.value) : /^v=(dmarc1|dkim1)/i.test(r.value)));
      if (clash) drop.add(x.id);
    }
    const left = existing.filter((x) => !drop.has(x.id)).map((x) => ({ ...x, priority: x.priority ?? undefined }));
    if (conflictOf(r, [...left, ...add.map((a) => ({ type: a.type, name: a.name, value: a.value, ttl: a.ttl ?? 3600 }))])) continue;
    // A/AAAA from one set go side by side (several addresses), so only the first one replaces
    add.push({ id: rid("r"), domainId, type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority });
  }
  if (drop.size) await db.delete(dnsRecords).where(inArray(dnsRecords.id, [...drop]));
  if (add.length) await db.insert(dnsRecords).values(add);
  return { added: add.length, replaced: drop.size };
}

/* ---------- transfers ---------- */
/** wallet debit (all or nothing) */
export async function debit(tx: Tx, userId: string, amount: number, desc: string) {
  if (amount <= 0) return true;
  const [u] = await tx.update(users).set({ balance: sql`${users.balance} - ${amount}` }).where(and(eq(users.id, userId), sql`${users.balance} >= ${amount}`)).returning({ id: users.id });
  if (!u) return false;
  await tx.insert(transactions).values({ id: rid("TX"), userId, type: "usage", amount: -amount, method: "کیف پول", desc });
  return true;
}
export async function refund(tx: Tx, userId: string, amount: number, desc: string) {
  if (amount <= 0) return;
  await tx.update(users).set({ balance: sql`${users.balance} + ${amount}` }).where(eq(users.id, userId));
  await tx.insert(transactions).values({ id: rid("TX"), userId, type: "refund", amount, method: "کیف پول", desc });
}

const NS = ["ns1.gereh.net", "ns2.gereh.net"];
/** staff approved: ask the registry, then the domain joins the customer's account with a year added */
export async function completeTransfer(db: DB, t: typeof domainTransfers.$inferSelect) {
  const { providers } = await import("../providers");
  const reg = (await providers()).registrar;
  await db.update(domainTransfers).set({ status: "processing", updatedAt: new Date() }).where(eq(domainTransfers.id, t.id));
  try {
    const r = await reg.transfer(t.domain, t.authCode, { irnicHandle: t.irnicHandle || undefined });
    const [taken] = await db.select({ id: domains.id }).from(domains).where(eq(domains.name, t.domain));
    if (taken) throw new Error("domain already in an account");
    const { nextId } = await import("../util");
    const did = await nextId(db, "dom", 700);
    const exp = r.expiresAt ?? new Date(Date.now() + 365 * 86400_000);
    await db.transaction(async (tx) => {
      await tx.insert(domains).values({ id: did, userId: t.userId, name: t.domain, registeredAt: new Date(), expiresAt: exp, ns: NS, authCode: "", locked: true, status: "active" });
      await tx.update(domainTransfers).set({ status: "completed", domainId: did, updatedAt: new Date() }).where(eq(domainTransfers.id, t.id));
    });
    await notify(db, t.userId, "globe", "انتقال دامنه " + t.domain + " به گره انجام شد");
    return { ok: true as const, domainId: did };
  } catch (e) {
    await db.transaction(async (tx) => {
      await tx.update(domainTransfers).set({ status: "failed", note: String((e as Error).message).slice(0, 300), updatedAt: new Date() }).where(eq(domainTransfers.id, t.id));
      await refund(tx, t.userId, t.price, "بازگشت هزینه انتقال دامنه " + t.domain);
    });
    await notify(db, t.userId, "circle-alert", "انتقال دامنه " + t.domain + " انجام نشد؛ کد انتقال یا قفل دامنه نزد ثبت‌کننده قبلی را بررسی کنید. مبلغ به کیف پول بازگشت");
    return { ok: false as const };
  }
}

/* ---------- traffic alerts ---------- */
const metricOf = (p: CdnPoint, m: AlertMetric) => (m === "bandwidth" ? p.bytes / 1e6 : m === "requests" ? p.requests : m === "errors" ? p.errors : p.blocked);
export const ALERT_LABEL: Record<AlertMetric, string> = { requests: "درخواست", bandwidth: "ترافیک (مگابایت)", errors: "خطای ۵xx", blocked: "درخواست مسدودشده" };

/** hourly: compares the last full hour of CDN traffic with each alert; fires at most once per 6 hours */
export async function domainAlertsJob(db: DB) {
  const rows = await db.select({ a: domainAlerts, d: domains }).from(domainAlerts).innerJoin(domains, eq(domains.id, domainAlerts.domainId)).where(eq(domainAlerts.enabled, true));
  const byDomain = new Map<string, { d: DomainRow; alerts: (typeof domainAlerts.$inferSelect)[] }>();
  for (const { a, d } of rows) { const g = byDomain.get(d.id) ?? { d, alerts: [] }; g.alerts.push(a); byDomain.set(d.id, g); }
  let fired = 0;
  for (const { d, alerts } of byDomain.values()) {
    const series = await cdnDriver().analytics(d.name, 2).catch(() => []);
    const last = series[series.length - 1];
    if (!last) continue;
    for (const a of alerts) {
      const v = metricOf(last, a.metric);
      const recent = a.firedAt && Date.now() - a.firedAt.getTime() < 6 * 3600_000;
      const hit = v >= a.threshold && !recent;
      await db.update(domainAlerts).set({ lastValue: v, ...(hit ? { firedAt: new Date() } : {}) }).where(eq(domainAlerts.id, a.id));
      if (!hit) continue;
      fired++;
      const text = "هشدار ترافیک " + d.name + ": " + ALERT_LABEL[a.metric] + " در یک ساعت گذشته " + Math.round(v).toLocaleString("fa-IR") + " شد (آستانه " + a.threshold.toLocaleString("fa-IR") + ")";
      await notify(db, d.userId, "activity", text);
      await enqueue(db, "notify.send", { userId: d.userId, kind: "service", subject: "هشدار ترافیک " + d.name, text: text + "\n\nاگر این افزایش غیرعادی است، حالت «زیر حمله» را در تب CDN دامنه روشن کنید." }, { dedupe: "dom-alert:" + a.id + ":" + new Date().toISOString().slice(0, 13) });
    }
  }
  return { fired };
}
