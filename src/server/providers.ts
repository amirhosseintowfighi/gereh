/* External service providers behind small interfaces, each with a simulator for dev/CI:
   - hosting:   cPanel/WHM API 1        (WHM_HOST, WHM_USER, WHM_TOKEN)
   - dns:       PowerDNS HTTP API       (PDNS_URL, PDNS_API_KEY) — zones for domains on ns1/ns2.gereh.cloud
   - registrar: ResellerClub HTTP API   (RC_USER_ID, RC_API_KEY, RC_CUSTOMER_ID, RC_CONTACT_ID) for gTLDs.
     .ir domains go through IRNIC's EPP interface, which needs a reseller certificate; until IRNIC_EPP_*
     is configured they use the simulator so the rest of the flow (orders, invoices, DNS) still works. */
import "server-only";
import { eq } from "drizzle-orm";
import { isAvailable } from "@/lib/catalog";
import type { DB } from "./db/client";
import { dnsRecords, domains, type hosting } from "./db/schema";

type HostingRow = typeof hosting.$inferSelect;

export interface HostingProvider {
  create(h: { domain: string; plan: string; username: string; password: string; email: string }): Promise<{ server: string }>;
  suspend(h: HostingRow): Promise<void>;
  unsuspend(h: HostingRow): Promise<void>;
  setPassword(h: HostingRow, password: string): Promise<void>;
  sso(h: HostingRow): Promise<string>;
}
export interface DnsProvider { sync(db: DB, domainId: string): Promise<void> }
export interface Registrar {
  check(name: string, tlds: string[]): Promise<{ tld: string; available: boolean }[]>;
  register(domain: string, years: number, ns: string[]): Promise<{ authCode: string }>;
  renew(domain: string, years: number): Promise<void>;
  setNameservers(domain: string, ns: string[]): Promise<void>;
  setLock(domain: string, locked: boolean): Promise<void>;
  setPrivacy(domain: string, on: boolean): Promise<void>;
}

/* ---------------- cPanel / WHM ---------------- */
class Whm implements HostingProvider {
  private base = "https://" + process.env.WHM_HOST + ":2087/json-api/";
  private async call(fn: string, params: Record<string, string>) {
    const res = await fetch(this.base + fn + "?" + new URLSearchParams({ "api.version": "1", ...params }), {
      headers: { Authorization: "whm " + process.env.WHM_USER + ":" + process.env.WHM_TOKEN }, signal: AbortSignal.timeout(60_000),
    });
    const j = (await res.json().catch(() => ({}))) as { metadata?: { result?: number; reason?: string }; data?: Record<string, unknown> };
    if (!res.ok || j.metadata?.result !== 1) throw new Error("WHM " + fn + ": " + (j.metadata?.reason || res.status));
    return j.data || {};
  }
  async create(h: { domain: string; plan: string; username: string; password: string; email: string }) {
    await this.call("createacct", { username: h.username, domain: h.domain, plan: process.env.WHM_PLAN_PREFIX ? process.env.WHM_PLAN_PREFIX + h.plan : h.plan, password: h.password, contactemail: h.email });
    return { server: process.env.WHM_HOST! };
  }
  async suspend(h: HostingRow) { await this.call("suspendacct", { user: h.username, reason: "billing" }); }
  async unsuspend(h: HostingRow) { await this.call("unsuspendacct", { user: h.username }); }
  async setPassword(h: HostingRow, password: string) { await this.call("passwd", { user: h.username, password }); }
  async sso(h: HostingRow) { return String((await this.call("create_user_session", { user: h.username, service: "cpaneld" })).url); }
}
class SimHosting implements HostingProvider {
  async create() { return { server: "thr-web-0" + (1 + Math.floor(Math.random() * 8)) }; }
  async suspend() {}
  async unsuspend() {}
  async setPassword() {}
  async sso(h: HostingRow) { return "/panel/hosting/" + h.id + "?sso=demo"; }
}

/* ---------------- PowerDNS ---------------- */
class PowerDns implements DnsProvider {
  private base = process.env.PDNS_URL!.replace(/\/$/, "") + "/api/v1/servers/localhost/zones";
  private async req(method: string, path: string, body?: unknown) {
    const res = await fetch(this.base + path, { method, headers: { "X-API-Key": process.env.PDNS_API_KEY!, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    if (!res.ok && res.status !== 404) throw new Error("PowerDNS " + method + " " + path + ": " + res.status + " " + (await res.text()).slice(0, 200));
    return res;
  }
  async sync(db: DB, domainId: string) {
    const [d] = await db.select().from(domains).where(eq(domains.id, domainId));
    if (!d) return;
    const zone = d.name + ".";
    const recs = await db.select().from(dnsRecords).where(eq(dnsRecords.domainId, domainId));
    const fq = (n: string) => (n === "@" ? zone : n.replace(/\.$/, "") + "." + zone);
    const content = (r: typeof recs[number]) => {
      const v = r.type === "TXT" ? '"' + r.value.replace(/"/g, '\\"') + '"' : ["CNAME", "MX", "NS"].includes(r.type) ? r.value.replace(/\.?$/, ".") : r.value;
      return r.type === "MX" || r.type === "SRV" ? (r.priority ?? 10) + " " + v : v;
    };
    const want = new Map<string, { name: string; type: string; ttl: number; records: { content: string; disabled: false }[] }>();
    for (const r of recs) {
      const k = fq(r.name) + "|" + r.type;
      const set = want.get(k) ?? { name: fq(r.name), type: r.type, ttl: r.ttl, records: [] };
      set.records.push({ content: content(r), disabled: false });
      want.set(k, set);
    }
    const cur = await this.req("GET", "/" + zone);
    if (cur.status === 404) {
      await this.req("POST", "", { name: zone, kind: "Native", nameservers: ["ns1.gereh.cloud.", "ns2.gereh.cloud."], rrsets: [...want.values()] });
      return;
    }
    const existing = ((await cur.json()) as { rrsets: { name: string; type: string }[] }).rrsets.filter((s) => s.type !== "SOA" && !(s.type === "NS" && s.name === zone));
    const rrsets = [
      ...[...want.values()].map((s) => ({ ...s, changetype: "REPLACE" })),
      ...existing.filter((s) => !want.has(s.name + "|" + s.type)).map((s) => ({ name: s.name, type: s.type, changetype: "DELETE" })),
    ];
    if (rrsets.length) await this.req("PATCH", "/" + zone, { rrsets });
  }
}
class SimDns implements DnsProvider { async sync() {} }

/* ---------------- registrars ---------------- */
class ResellerClub implements Registrar {
  private base = process.env.RC_SANDBOX === "1" ? "https://test.httpapi.com/api/" : "https://httpapi.com/api/";
  private auth = { "auth-userid": process.env.RC_USER_ID!, "api-key": process.env.RC_API_KEY! };
  private async call(path: string, params: [string, string][], method: "GET" | "POST" = "GET") {
    const qs = new URLSearchParams([...Object.entries(this.auth), ...params]);
    const res = await fetch(this.base + path + "?" + qs, { method, signal: AbortSignal.timeout(30_000) });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { status?: string; message?: string };
    if (!res.ok || j.status === "ERROR") throw new Error("ResellerClub " + path + ": " + (j.message || res.status));
    return j;
  }
  private async orderId(domain: string) { return String((await this.call("domains/orderid.json", [["domain-name", domain]])) as unknown); }
  async check(name: string, tlds: string[]) {
    const j = await this.call("domains/available.json", [["domain-name", name], ...tlds.map((t) => ["tlds", t.slice(1)] as [string, string])]);
    return tlds.map((t) => ({ tld: t, available: (j[name + t] as { status?: string } | undefined)?.status === "available" }));
  }
  async register(domain: string, years: number, ns: string[]) {
    const c = process.env.RC_CONTACT_ID!;
    await this.call("domains/register.json", [["domain-name", domain], ["years", String(years)], ...ns.map((n) => ["ns", n] as [string, string]), ["customer-id", process.env.RC_CUSTOMER_ID!],
      ["reg-contact-id", c], ["admin-contact-id", c], ["tech-contact-id", c], ["billing-contact-id", c], ["invoice-option", "NoInvoice"], ["protect-privacy", "true"]], "POST");
    const details = await this.call("domains/details-by-name.json", [["domain-name", domain], ["options", "OrderDetails"]]);
    return { authCode: String(details.domsecret || "") };
  }
  async renew(domain: string, years: number) {
    const id = await this.orderId(domain);
    const d = await this.call("domains/details.json", [["order-id", id], ["options", "OrderDetails"]]);
    await this.call("domains/renew.json", [["order-id", id], ["years", String(years)], ["exp-date", String(d.endtime)], ["invoice-option", "NoInvoice"]], "POST");
  }
  async setNameservers(domain: string, ns: string[]) { await this.call("domains/modify-ns.json", [["order-id", await this.orderId(domain)], ...ns.map((n) => ["ns", n] as [string, string])], "POST"); }
  async setLock(domain: string, locked: boolean) { await this.call(locked ? "domains/enable-theft-protection.json" : "domains/disable-theft-protection.json", [["order-id", await this.orderId(domain)]], "POST"); }
  async setPrivacy(domain: string, on: boolean) { await this.call("domains/modify-privacy-protection.json", [["order-id", await this.orderId(domain)], ["protect-privacy", String(on)], ["reason", "customer request"]], "POST"); }
}
class SimRegistrar implements Registrar {
  async check(name: string, tlds: string[]) { return tlds.map((tld) => ({ tld, available: isAvailable(name, tld) })); }
  async register() { return { authCode: Math.random().toString(36).slice(2, 8) + "#" + Math.random().toString(36).slice(2, 8).toUpperCase() }; }
  async renew() {}
  async setNameservers() {}
  async setLock() {}
  async setPrivacy() {}
}
/** routes .ir/.co.ir to IRNIC and everything else to the gTLD registrar */
class Router implements Registrar {
  constructor(private ir: Registrar, private g: Registrar) {}
  private pick(domain: string) { return /\.ir$/.test(domain) ? this.ir : this.g; }
  async check(name: string, tlds: string[]) {
    const ir = tlds.filter((t) => /\.ir$/.test(t)), g = tlds.filter((t) => !/\.ir$/.test(t));
    const [a, b] = await Promise.all([ir.length ? this.ir.check(name, ir) : [], g.length ? this.g.check(name, g) : []]);
    const by = new Map([...a, ...b].map((x) => [x.tld, x]));
    return tlds.map((t) => by.get(t) ?? { tld: t, available: false });
  }
  register(d: string, y: number, ns: string[]) { return this.pick(d).register(d, y, ns); }
  renew(d: string, y: number) { return this.pick(d).renew(d, y); }
  setNameservers(d: string, ns: string[]) { return this.pick(d).setNameservers(d, ns); }
  setLock(d: string, l: boolean) { return this.pick(d).setLock(d, l); }
  setPrivacy(d: string, p: boolean) { return this.pick(d).setPrivacy(d, p); }
}

export type Providers = { hosting: HostingProvider; dns: DnsProvider; registrar: Registrar };
const g = globalThis as typeof globalThis & { __gerehProviders?: Providers };
export async function providers(): Promise<Providers> {
  return (g.__gerehProviders ??= {
    hosting: process.env.WHM_HOST && process.env.WHM_TOKEN ? new Whm() : new SimHosting(),
    dns: process.env.PDNS_URL && process.env.PDNS_API_KEY ? new PowerDns() : new SimDns(),
    registrar: new Router(new SimRegistrar(), process.env.RC_USER_ID && process.env.RC_API_KEY ? new ResellerClub() : new SimRegistrar()),
  });
}
export const setProviders = (p: Providers | undefined) => { g.__gerehProviders = p; };
