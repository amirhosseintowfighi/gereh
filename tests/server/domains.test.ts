import { Duplex } from "node:stream";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conflictOf, exportZone, parseTtl, parseZone, validateRecord, type CdnPoint, type CdnView, type DnsSuggestion, type TransferView, type WhoisView } from "@/lib/domains";
import { cdnSettings, dnsRecords, domainContacts, domains, domainTransfers, notifications, users, whoisCache } from "@/server/db/schema";
import { cacheSnippet, edgeObjects, serverSnippet, SimCdn, simTraffic, type CdnSpec } from "@/server/domains/cdn";
import { domainAlertsJob, publish } from "@/server/domains/service";
import { parseWhois, serverFor, setWhoisSocket } from "@/server/domains/whois";
import { setNsResolver } from "@/server/geo/service";
import { SimRegistrar } from "@/server/providers";
import { asAdmin, asUser, call, db, fails, fresh } from "./helpers";

beforeEach(async () => { await fresh(); SimCdn.applied.clear(); SimCdn.purges.length = 0; SimRegistrar.log.length = 0; });
afterEach(() => setWhoisSocket(null));

const balance = async (uid = "u1") => (await (await db()).select().from(users).where(eq(users.id, uid)))[0].balance;
const recs = async (did = "dom-501") => (await db()).select().from(dnsRecords).where(eq(dnsRecords.domainId, did));
const r = (type: string, name: string, value: string, extra: Record<string, unknown> = {}) => ({ type, name, value, ttl: 3600, ...extra });

describe("record validation", () => {
  it("accepts every supported type in its presentation format", () => {
    const good = [
      r("A", "*", "1.2.3.4"), r("A", "*.dev", "1.2.3.4"), r("AAAA", "@", "2a01:4f8::1"), r("AAAA", "v6", "::ffff:1.2.3.4"), r("CNAME", "www", "app.gereh.dev"), r("ALIAS", "@", "app.gereh.dev"),
      r("MX", "@", "mail.example.com", { priority: 10 }), r("TXT", "@", "v=spf1 -all"), r("SRV", "_sip._tcp", "5 5060 sip.example.com", { priority: 10 }), r("CAA", "@", '0 issue "letsencrypt.org"'),
      r("NS", "sub", "ns1.other.net"), r("PTR", "4", "host.example.com"), r("TLSA", "_443._tcp", "3 1 1 " + "ab".repeat(32)), r("SSHFP", "srv", "4 2 " + "cd".repeat(32)),
      r("URI", "_http._tcp", '1 "https://example.com/"', { priority: 10 }), r("NAPTR", "@", '100 10 "U" "E2U+sip" "!^.*$!sip:info@example.com!" .'), r("CERT", "@", "PKIX 0 0 MIIBIjANBgkq"),
      r("SMIMEA", "x._smimecert", "3 0 1 " + "ef".repeat(32)),
    ];
    for (const g of good) expect([g.type, validateRecord(g)]).toEqual([g.type, ""]);
  });
  it("rejects malformed values with a type-specific message", () => {
    expect(validateRecord(r("A", "x", "1.2.3"))).toContain("IPv4");
    expect(validateRecord(r("AAAA", "x", "1:2:3"))).toContain("IPv6");
    expect(validateRecord(r("CNAME", "@", "x.com"))).toContain("ریشه");
    expect(validateRecord(r("ALIAS", "www", "x.com"))).toContain("@");
    expect(validateRecord(r("MX", "@", "mail.x.com"))).toContain("اولویت");
    expect(validateRecord(r("SRV", "sip", "5 5060 sip.x.com", { priority: 1 }))).toContain("_service");
    expect(validateRecord(r("CAA", "@", "0 issue letsencrypt.org"))).toContain("CAA");
    expect(validateRecord(r("TLSA", "_443._tcp", "3 1 1 abcd"))).toContain("TLSA");
    expect(validateRecord(r("SSHFP", "h", "4 1 " + "cd".repeat(32)))).toContain("SSHFP");
    expect(validateRecord(r("TXT", "bad name!", "x"))).toContain("نام");
    expect(validateRecord(r("TXT", "@", "x", { proxied: true }))).toContain("CDN");
    expect(validateRecord({ ...r("A", "@", "1.1.1.1"), ttl: 10 })).toContain("TTL");
  });
  it("CNAME and ALIAS cannot share a name", () => {
    expect(conflictOf(r("CNAME", "www", "a.com"), [r("A", "www", "1.1.1.1")])).toContain("CNAME");
    expect(conflictOf(r("ALIAS", "@", "a.com"), [r("A", "@", "1.1.1.1")])).toContain("ALIAS");
    expect(conflictOf(r("MX", "@", "m.com", { priority: 1 }), [r("A", "@", "1.1.1.1")])).toBe("");
  });
});

describe("zone files", () => {
  const ZONE = `$ORIGIN shop.ir.
$TTL 1h
@   IN SOA ns1.gereh.net. admin.shop.ir. ( 2024010101 ; serial
        3600 600 1209600 300 )
@        IN NS   ns1.gereh.net.
@  300   IN A    185.1.1.1 ; proxied
         IN AAAA 2a01::1
www      IN CNAME shop.ir.
@        IN MX   10 mail
@        IN TXT  "v=spf1 include:gereh.net" " ~all"
_sip._tcp 600 IN SRV 10 5 5060 sip.shop.ir.
@        IN CAA  0 issue "letsencrypt.org"
other.com. IN A 1.1.1.1
bad      IN A 999.1.1.1
`;
  it("imports BIND master files (SOA/NS skipped, continuation lines, relative names)", () => {
    const p = parseZone(ZONE, "shop.ir");
    expect(p.skipped).toBe(2);
    expect(p.errors).toHaveLength(2);
    expect(p.records).toEqual([
      { type: "A", name: "@", value: "185.1.1.1", ttl: 300, priority: null, proxied: true },
      { type: "AAAA", name: "@", value: "2a01::1", ttl: 3600, priority: null, proxied: false },
      { type: "CNAME", name: "www", value: "shop.ir", ttl: 3600, priority: null, proxied: false },
      { type: "MX", name: "@", value: "mail.shop.ir", ttl: 3600, priority: 10, proxied: false },
      { type: "TXT", name: "@", value: "v=spf1 include:gereh.net ~all", ttl: 3600, priority: null, proxied: false },
      { type: "SRV", name: "_sip._tcp", value: "5 5060 sip.shop.ir", ttl: 600, priority: 10, proxied: false },
      { type: "CAA", name: "@", value: '0 issue "letsencrypt.org"', ttl: 3600, priority: null, proxied: false },
    ]);
    expect(parseTtl("1d2h")).toBe(93600);
  });
  it("export → import round-trips", () => {
    const p = parseZone(ZONE, "shop.ir");
    const text = exportZone("shop.ir", p.records, { ns: ["ns1.gereh.net", "ns2.gereh.net"] });
    expect(text).toContain("$ORIGIN shop.ir.");
    expect(text).toContain("_sip._tcp\t600\tIN\tSRV\t10 5 5060 sip.shop.ir.");
    expect(text).toContain("@\t300\tIN\tA\t185.1.1.1\t; proxied");
    expect(parseZone(text, "shop.ir").records).toEqual(p.records);
  });
});

describe("DNS records over RPC", () => {
  it("adds new types with TTL and proxy flag; conflicts and foreign domains are refused", async () => {
    await asUser();
    await call("domains.addRecord", "dom-501", r("CAA", "@", '0 issue "letsencrypt.org"'));
    await call("domains.addRecord", "dom-501", r("SRV", "_xmpp._tcp", "0 5222 chat.novin.studio", { priority: 5 }));
    await call("domains.addRecord", "dom-501", { ...r("A", "*", "185.1.1.9"), ttl: 300, proxied: true });
    expect(await fails("domains.addRecord", "dom-501", r("CNAME", "www", "x.example.com"))).toContain("CNAME");
    expect(await fails("domains.addRecord", "dom-501", r("ALIAS", "@", "x.example.com"))).toContain("ALIAS");
    expect(await fails("domains.addRecord", "dom-600", r("A", "x", "1.1.1.1"))).toContain("پیدا نشد");
    const wild = (await recs()).find((x) => x.name === "*")!;
    expect(wild).toMatchObject({ ttl: 300, proxied: true });
    expect(await fails("domains.setProxied", "dom-501", (await recs()).find((x) => x.type === "MX")!.id, true)).toContain("CDN");
  });

  it("imports (merge and replace) and exports zone files", async () => {
    await asUser();
    const out = await call<{ added: number; errors: string[] }>("domains.importZone", "dom-501", "api 300 IN A 185.1.1.2\nwww IN CNAME x.com.\n@ IN TXT \"hello\"\n", "merge");
    expect(out.added).toBe(2);
    expect(out.errors[0]).toContain("CNAME");
    const text = await call<string>("domains.exportZone", "dom-501");
    expect(text).toContain("api\t300\tIN\tA\t185.1.1.2");
    expect(text).toContain("@\t86400\tIN\tNS\tns1.gereh.net.");
    await call("domains.importZone", "dom-501", "@ IN A 9.9.9.9\n", "replace");
    expect((await recs()).map((x) => x.value)).toEqual(["9.9.9.9"]);
  });

  it("DNSSEC returns the DS record; NS delegation is checked against the registry", async () => {
    await asUser();
    const ds = await call<string[]>("domains.setDnssec", "dom-501", true);
    expect(ds[0]).toMatch(/^\d+ 13 2 [0-9A-F]{64}$/);
    expect((await call<{ dnssec: boolean; ds: string[] }>("domains.extras", "dom-501")).ds).toEqual(ds);
    expect(await call("domains.setDnssec", "dom-501", false)).toEqual([]);
    setNsResolver(async () => ["ns2.gereh.net.", "NS1.gereh.net"]);
    expect(await call("domains.nsCheck", "dom-501")).toMatchObject({ ok: true, managed: true });
    setNsResolver(async () => ["ns1.other.net"]);
    expect(await call("domains.nsCheck", "dom-501")).toMatchObject({ ok: false, seen: ["ns1.other.net"] });
  });

  it("one-click records point the domain at a VPS, app or mail domain", async () => {
    await asUser();
    const list = await call<DnsSuggestion[]>("domains.suggestions", "dom-501");
    const vps = list.find((s) => s.key === "vps:srv-1043")!;
    expect(vps.records.map((x) => x.type + " " + x.name + " " + x.value)).toContain("A @ 185.143.232.44");
    await call("domains.applySuggestion", "dom-501", vps.key);
    const now = await recs();
    expect(now.filter((x) => x.type === "A").map((x) => x.name + "=" + x.value).sort()).toEqual(["@=185.143.232.44", "www=185.143.232.44"]);
    expect(now.some((x) => x.type === "MX")).toBe(true); // untouched
    const app = list.find((s) => s.key.startsWith("app:"));
    if (app) {
      await call("domains.applySuggestion", "dom-501", app.key);
      const after = await recs();
      expect(after.find((x) => x.type === "ALIAS")?.name).toBe("@");
      expect(after.some((x) => x.type === "A" && x.name === "@")).toBe(false);
    }
  });
});

describe("whois", () => {
  const fake = (answers: Record<string, string>, seen: string[]) => (host: string) => new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      const q = String(chunk).trim();
      seen.push(host + " " + q);
      this.push(answers[host + " " + q] ?? "");
      this.push(null);
      cb();
    },
  });
  it("talks to the TLD's server over the injected socket and caches the answer", async () => {
    await asUser();
    const seen: string[] = [];
    setWhoisSocket(fake({ "whois.nic.ir novin.ir": "domain: novin.ir\nnserver: ns1.gereh.net\nnserver: ns2.gereh.net\nexpire-date: 2026-01-01\nsource: IRNIC\n" }, seen));
    expect(serverFor("novin.ir")).toBe("whois.nic.ir");
    const w = await call<WhoisView>("domains.whois", "Novin.ir");
    expect(w).toMatchObject({ server: "whois.nic.ir", registered: true, cached: false, expires: "2026-01-01", nameservers: ["ns1.gereh.net", "ns2.gereh.net"] });
    expect((await call<WhoisView>("domains.whois", "novin.ir")).cached).toBe(true);
    expect(seen).toEqual(["whois.nic.ir novin.ir"]);
    expect((await (await db()).select().from(whoisCache))).toHaveLength(1);
  });
  it("follows the IANA referral and the registrar referral", async () => {
    await asUser();
    const seen: string[] = [];
    setWhoisSocket(fake({
      "whois.iana.org zz": "refer: whois.nic.zz\n",
      "whois.nic.zz free.zz": "No match for \"FREE.ZZ\".\n",
      "whois.verisign-grs.com taken.com": "Domain Name: TAKEN.COM\nRegistrar WHOIS Server: whois.reg.example\nCreation Date: 2001-01-01\nName Server: NS1.X.COM\n",
      "whois.reg.example taken.com": "Registrar: Example Reg\n",
    }, seen));
    expect((await call<WhoisView>("domains.whois", "free.zz")).registered).toBe(false);
    const t = await call<WhoisView>("domains.whois", "taken.com");
    expect(t).toMatchObject({ registered: true, registrar: "Example Reg", created: "2001-01-01", nameservers: ["ns1.x.com"] });
    expect(seen).toContain("whois.reg.example taken.com");
    expect(parseWhois("").registered).toBe(false);
    expect(await fails("domains.whois", "not a domain")).toContain("معتبر");
  });
});

describe("transfers", () => {
  it("transfer-in: wallet charged, staff approval creates the domain", async () => {
    await asUser();
    const before = await balance();
    expect(await fails("domains.transferIn", { domain: "novin.studio", authCode: "abcdef12" })).toContain("گره");
    expect(await fails("domains.transferIn", { domain: "moved.com", authCode: "x" })).toContain("کد انتقال");
    expect(await fails("domains.transferIn", { domain: "moved.unknowntld", authCode: "abcdef12" })).toContain("پسوند");
    const tid = await call<string>("domains.transferIn", { domain: "https://www.Moved.com/", authCode: "Abc#12345" });
    expect(await balance()).toBe(before - 1_450_000);
    expect(await fails("domains.transferIn", { domain: "moved.com", authCode: "Abc#12345" })).toContain("در جریان");
    expect((await call<TransferView[]>("domains.transfers"))[0]).toMatchObject({ id: tid, status: "pending", domain: "moved.com" });
    expect(await fails("domains.adminApprove", tid)).toContain("اجازه");
    await asAdmin();
    expect((await call<TransferView[]>("domains.adminTransfers")).some((t) => t.id === tid)).toBe(true);
    const res = await call<{ ok: boolean; domainId: string }>("domains.adminApprove", tid);
    expect(res.ok).toBe(true);
    expect(SimRegistrar.log).toContain("transfer moved.com");
    const [d] = await (await db()).select().from(domains).where(eq(domains.name, "moved.com"));
    expect(d).toMatchObject({ userId: "u1", status: "active", locked: true });
    expect(await fails("domains.adminApprove", tid)).toContain("انتظار");
  });

  it("rejected, cancelled and registry-refused transfers are refunded", async () => {
    await asUser();
    const before = await balance();
    const a = await call<string>("domains.transferIn", { domain: "one.net", authCode: "goodcode1" });
    const b = await call<string>("domains.transferIn", { domain: "two.net", authCode: "goodcode2" });
    const c = await call<string>("domains.transferIn", { domain: "three.net", authCode: "invalid-code" });
    await call("domains.cancelTransfer", a);
    expect(await fails("domains.cancelTransfer", a)).toContain("انتظار");
    await asAdmin();
    await call("domains.adminReject", b, "کد اشتباه است");
    expect((await call<{ ok: boolean }>("domains.adminApprove", c)).ok).toBe(false);
    await asUser();
    expect(await balance()).toBe(before);
    const list = await call<TransferView[]>("domains.transfers");
    expect(Object.fromEntries(list.map((t) => [t.domain, t.status]))).toEqual({ "one.net": "cancelled", "two.net": "rejected", "three.net": "failed" });
  });

  it(".ir moves by IRNIC handle; checkout of a .ir name needs one", async () => {
    await asUser();
    const d = await db();
    await d.delete(domainContacts).where(eq(domainContacts.userId, "u1"));
    expect(await fails("domains.transferIn", { domain: "mine.ir" })).toContain("ایرنیک");
    expect(await fails("billing.checkout", [{ t: "domain", name: "newbrand.ir", years: 1 }])).toContain("ایرنیک");
    expect(await fails("domains.setContact", { irnicHandle: "bad" })).toContain("ایرنیک");
    await call("domains.setContact", { irnicHandle: "AB1234-IRNIC" });
    expect(await call("domains.contact")).toEqual({ irnicHandle: "ab1234-irnic" });
    const tid = await call<string>("domains.transferIn", { domain: "mine.ir" });
    expect((await d.select().from(domainTransfers).where(eq(domainTransfers.id, tid)))[0].irnicHandle).toBe("ab1234-irnic");
    await call("billing.checkout", [{ t: "domain", name: "newbrand.ir", years: 1 }]);
  });

  it("transfer-out unlocks the domain and issues the auth code", async () => {
    await asUser();
    const out = await call<{ authCode: string }>("domains.transferOut", "dom-501");
    expect(out.authCode).toMatch(/^[0-9a-f]{6}#[0-9A-F]{6}$/);
    const [d] = await (await db()).select().from(domains).where(eq(domains.id, "dom-501"));
    expect(d).toMatchObject({ locked: false, authCode: out.authCode });
    expect((await call<TransferView[]>("domains.transfers"))[0]).toMatchObject({ direction: "out", status: "auth_sent" });
    await (await db()).update(domains).set({ registeredAt: new Date() }).where(eq(domains.id, "dom-501"));
    expect(await fails("domains.transferOut", "dom-501")).toContain("۶۰ روز");
  });
});

describe("CDN", () => {
  const spec: CdnSpec = {
    domain: "shop.ir", hosts: ["shop.ir", "www.shop.ir"], origin: "185.1.1.1", originHostHeader: "", originHttps: false, forceHttps: true,
    hsts: { maxAge: 31536000, sub: true, preload: true }, minTls: "1.2", browserTtl: 600, devMode: false, underAttack: false, cacheVersion: 3,
    rules: [
      { id: "a", kind: "cache", path: "/static/*", action: "cache", ttl: 86400 }, { id: "b", kind: "cache", path: "/api/*", action: "bypass", ttl: 0 },
      { id: "c", kind: "redirect", path: "/old", to: "https://shop.ir/new", code: 301 }, { id: "d", kind: "header", name: "X-Frame-Options", value: "DENY" },
      { id: "e", kind: "access", action: "deny", ip: "5.6.7.0/24" }, { id: "f", kind: "access", action: "deny", country: "CN" },
      { id: "g", kind: "ratelimit", path: "/login", rps: 5, burst: 10 }, { id: "h", kind: "auth", path: "/admin/*", user: "u", htpasswd: "u:{SSHA}x" },
    ],
  };
  it("renders ingress-nginx objects for the edge", () => {
    const objs = edgeObjects(spec);
    const kinds = objs.map((o) => o.kind + ":" + o.metadata.name.replace(/^cdn-shop-ir-[0-9a-f]+/, "X"));
    expect(kinds).toEqual(["Service:X", "Endpoints:X", "Ingress:X", "Ingress:X-r0", "Ingress:X-r1", "Ingress:X-r6", "Secret:X-r7-auth", "Ingress:X-r7"]);
    const main = objs[2].metadata.annotations!;
    expect(main["nginx.ingress.kubernetes.io/denylist-source-range"]).toBe("5.6.7.0/24");
    expect(main["nginx.ingress.kubernetes.io/force-ssl-redirect"]).toBe("true");
    const ss = serverSnippet(spec);
    expect(ss).toContain("Strict-Transport-Security: max-age=31536000; includeSubDomains; preload");
    expect(ss).toContain("ssl_protocols TLSv1.2 TLSv1.3;");
    expect(ss).toContain("if ($uri = /old) { return 301 https://shop.ir/new; }");
    expect(ss).toContain("^(CN)$");
    expect(cacheSnippet(spec)).toContain('"$scheme$host$request_uri|v3"');
    expect(cacheSnippet({ ...spec, devMode: true })).toContain("proxy_cache off;");
    expect(() => serverSnippet({ ...spec, rules: [{ id: "z", kind: "header", name: "X", value: "a; evil" }] })).toThrow();
  });

  it("proxied records answer with the edge while the CDN is on", () => {
    const rows = [{ type: "A", name: "@", value: "185.1.1.1", ttl: 3600, priority: null, proxied: true }, { type: "MX", name: "@", value: "mail.x.ir", ttl: 3600, priority: 10, proxied: false }, { type: "A", name: "api", value: "185.1.1.2", ttl: 3600, priority: null, proxied: false }];
    const edge = { ipv4: ["10.0.0.1"], ipv6: [] };
    expect(publish(rows, true, edge).map((x) => x.type + " " + x.name + " " + x.value)).toEqual(["A @ 10.0.0.1", "MX @ mail.x.ir", "A api 185.1.1.2"]);
    expect(publish(rows, false, edge).map((x) => x.value)).toEqual(["185.1.1.1", "mail.x.ir", "185.1.1.2"]);
  });

  it("settings, rules, purge and analytics over RPC", async () => {
    await asUser();
    expect(await fails("domains.cdnUpdate", "dom-501", { enabled: true })).toContain("CDN");
    const at = (await recs()).find((x) => x.name === "@" && x.type === "A")!;
    await call("domains.setProxied", "dom-501", at.id, true);
    expect(await fails("domains.cdnUpdate", "dom-501", { originHost: "192.168.1.5" })).toContain("خصوصی");
    expect(await fails("domains.cdnUpdate", "dom-501", { hstsMaxAge: 600, hstsPreload: true })).toContain("preload");
    await call("domains.cdnUpdate", "dom-501", { enabled: true, hstsMaxAge: 31536000, hstsSub: true, minTls: "1.3", originHostHeader: "origin.novin.studio" });
    expect(SimCdn.applied.get("novin.studio")).toMatchObject({ origin: "185.143.232.17", hosts: ["novin.studio"], minTls: "1.3", originHostHeader: "origin.novin.studio" });

    expect(await fails("domains.cdnAddRule", "dom-501", { kind: "header", name: "X-Test", value: "a;b" })).toContain("مقدار هدر");
    expect(await fails("domains.cdnAddRule", "dom-501", { kind: "header", name: "Set-Cookie", value: "a" })).toContain("هدر");
    expect(await fails("domains.cdnAddRule", "dom-501", { kind: "redirect", path: "/x", to: "javascript:alert(1)", code: 301 })).toContain("ریدایرکت");
    expect(await fails("domains.cdnAddRule", "dom-501", { kind: "access", action: "deny", ip: "1.2.3.4/99" })).toContain("CIDR");
    expect(await fails("domains.cdnAddRule", "dom-501", { kind: "cache", path: "no-slash", action: "cache", ttl: 60 })).toContain("مسیر");
    await call("domains.cdnAddRule", "dom-501", { kind: "cache", path: "/static/*", action: "cache", ttl: 3600 });
    await call("domains.cdnAddRule", "dom-501", { kind: "access", action: "deny", country: "cn" });
    await call("domains.cdnAddRule", "dom-501", { kind: "auth", path: "/admin", user: "boss", password: "long-password" });
    const view = await call<CdnView>("domains.cdn", "dom-501");
    expect(view.rules.map((x) => x.kind)).toEqual(["cache", "access", "auth"]);
    expect(JSON.stringify(view)).not.toContain("SSHA");
    expect(SimCdn.applied.get("novin.studio")!.rules.find((x) => x.kind === "auth")!.htpasswd).toMatch(/^boss:\{SSHA\}/);

    expect(await fails("domains.cdnPurge", "dom-501", { urls: ["https://evil.com/a.css"] })).toContain("همین دامنه");
    await call("domains.cdnPurge", "dom-501", { urls: ["https://novin.studio/a.css"] });
    expect(SimCdn.purges.at(-1)).toEqual({ domain: "novin.studio", target: { urls: ["https://novin.studio/a.css"] } });
    await call("domains.cdnPurge", "dom-501", { all: true });
    expect((await call<CdnView>("domains.cdn", "dom-501")).config.cacheVersion).toBe(2);

    await call("domains.cdnUpdate", "dom-501", { devMode: true, underAttack: true });
    const cfg = (await call<CdnView>("domains.cdn", "dom-501")).config;
    expect(cfg).toMatchObject({ devMode: true, underAttack: true });
    const series = await call<CdnPoint[]>("domains.cdnAnalytics", "dom-501", 24);
    expect(series).toHaveLength(24);
    expect(series.every((p) => p.cached === 0 && p.requests > 0)).toBe(true); // dev mode: nothing cached
    expect(simTraffic("a.ir", 5, 1e12)).toEqual(simTraffic("a.ir", 5, 1e12));

    await call("domains.cdnUpdate", "dom-501", { enabled: false });
    expect(SimCdn.applied.has("novin.studio")).toBe(false);
    expect((await (await db()).select().from(cdnSettings))[0].enabled).toBe(false);
  });

  it("traffic alerts notify once the hourly figure crosses the threshold", async () => {
    await asUser();
    expect(await fails("domains.addAlert", "dom-600", { metric: "requests", threshold: 1 })).toContain("پیدا نشد");
    await call("domains.addAlert", "dom-501", { metric: "requests", threshold: 1 });
    await call("domains.addAlert", "dom-501", { metric: "bandwidth", threshold: 1e11 });
    const d = await db();
    const before = (await d.select().from(notifications).where(eq(notifications.userId, "u1"))).length;
    expect((await domainAlertsJob(d)).fired).toBe(1);
    expect((await domainAlertsJob(d)).fired).toBe(0); // not again within six hours
    const after = await d.select().from(notifications).where(eq(notifications.userId, "u1"));
    expect(after.length).toBe(before + 1);
    expect(after.some((n) => n.text.includes("هشدار ترافیک novin.studio"))).toBe(true);
  });
});
