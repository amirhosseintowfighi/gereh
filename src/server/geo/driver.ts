/* Geo DNS on PowerDNS. Each geo record becomes a LUA record:
     visitors resolving from Iran  → the Iranian address
     everyone else (Googlebot too) → the address abroad
   With health checks, `ifurlup` checks each server over HTTPS and falls back to the other one.
   The zone is written to every server in GEO_PDNS (one inside Iran, one abroad: during a cut each
   side answers its own visitors). PowerDNS needs `enable-lua-records=yes` and a GeoIP database
   (see deploy/geo/README.md).
   Without GEO_PDNS the simulator keeps the rendered zones in memory (dev, tests, demos). */
import "server-only";
import { GEO_TYPES, type GeoRecordType } from "@/lib/geo";

export type GeoZoneSpec = { domain: string; geo: boolean; failover: boolean; healthPath: string; records: { name: string; type: GeoRecordType; iran: string; world: string; ttl: number; priority: number | null }[] };
export type RRSet = { name: string; type: string; ttl: number; records: { content: string; disabled: false }[] };

export const nameservers = () => (process.env.GEO_NAMESERVERS || "ns1.gereh.net,ns2.gereh.net").split(",").map((s) => s.trim()).filter(Boolean);

const q = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
const dot = (s: string) => s.replace(/\.?$/, ".");

/** pure: zone records → PowerDNS rrsets (exported for tests) */
export function renderZone(z: GeoZoneSpec): RRSet[] {
  const zone = dot(z.domain);
  const fq = (n: string) => (n === "@" ? zone : n + "." + zone);
  const sets = new Map<string, RRSet>();
  const push = (name: string, type: string, ttl: number, content: string) => {
    const k = name + "|" + type;
    const s = sets.get(k) ?? { name, type, ttl, records: [] };
    s.records.push({ content, disabled: false });
    sets.set(k, s);
  };
  for (const r of z.records) {
    const name = fq(r.name);
    const geo = z.geo && GEO_TYPES.find((t) => t.id === r.type)!.geo && r.world && r.world !== r.iran;
    if (!geo) {
      const v = r.type === "TXT" ? '"' + r.iran + '"' : r.type === "CNAME" ? dot(r.iran) : r.type === "MX" ? (r.priority ?? 10) + " " + dot(r.iran) : r.iran;
      push(name, r.type, r.ttl, v);
      continue;
    }
    if (r.type === "CNAME") {
      push(name, "LUA", r.ttl, "CNAME \";if country('IR') then return " + q(dot(r.iran)) + " else return " + q(dot(r.world)) + " end\"");
      continue;
    }
    const ir = "{" + q(r.iran) + "}", w = "{" + q(r.world) + "}";
    const host = r.name === "@" || r.name === "*" ? z.domain : r.name.replace(/^\*\./, "") + "." + z.domain;
    const body = z.failover
      ? (() => { const url = q("https://" + host + (z.healthPath || "/")); return ";if country('IR') then return ifurlup(" + url + ", {" + ir + ", " + w + "}, {timeout=3}) else return ifurlup(" + url + ", {" + w + ", " + ir + "}, {timeout=3}) end"; })()
      : ";if country('IR') then return " + q(r.iran) + " else return " + q(r.world) + " end";
    push(name, "LUA", r.ttl, r.type + " \"" + body + "\"");
  }
  return [...sets.values()];
}

export interface GeoDriver {
  readonly name: "powerdns" | "simulator";
  test(): Promise<string>;
  sync(z: GeoZoneSpec): Promise<void>;
  remove(domain: string): Promise<void>;
}

class PowerDnsGeo implements GeoDriver {
  readonly name = "powerdns" as const;
  /** GEO_PDNS="https://ns-ir.example:8081|KEY,https://ns-eu.example:8081|KEY" */
  private servers = (process.env.GEO_PDNS || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [url, key] = s.split("|"); return { url: url.replace(/\/$/, "") + "/api/v1/servers/localhost/zones", key }; });
  private async req(srv: { url: string; key: string }, method: string, path: string, body?: unknown) {
    const res = await fetch(srv.url + path, { method, headers: { "X-API-Key": srv.key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    if (!res.ok && res.status !== 404) throw new Error("PowerDNS " + method + " " + path + ": " + res.status + " " + (await res.text()).slice(0, 200));
    return res;
  }
  async test() {
    const out: string[] = [];
    for (const s of this.servers) { const r = await fetch(s.url.replace(/\/zones$/, ""), { headers: { "X-API-Key": s.key }, signal: AbortSignal.timeout(8000) }); out.push(new URL(s.url).host + (r.ok ? " ✓" : " ✗ " + r.status)); }
    return out.join("، ");
  }
  async sync(z: GeoZoneSpec) {
    const zone = dot(z.domain), want = renderZone(z);
    for (const srv of this.servers) {
      const cur = await this.req(srv, "GET", "/" + zone);
      if (cur.status === 404) { await this.req(srv, "POST", "", { name: zone, kind: "Native", nameservers: nameservers().map(dot), rrsets: want }); continue; }
      const existing = ((await cur.json()) as { rrsets: { name: string; type: string }[] }).rrsets.filter((s) => s.type !== "SOA" && !(s.type === "NS" && s.name === zone));
      const keys = new Set(want.map((s) => s.name + "|" + s.type));
      const rrsets = [...want.map((s) => ({ ...s, changetype: "REPLACE" })), ...existing.filter((s) => !keys.has(s.name + "|" + s.type)).map((s) => ({ name: s.name, type: s.type, changetype: "DELETE" }))];
      if (rrsets.length) await this.req(srv, "PATCH", "/" + zone, { rrsets });
    }
  }
  async remove(domain: string) { for (const srv of this.servers) await this.req(srv, "DELETE", "/" + dot(domain)); }
}

/** keeps what would be published; tests read it */
export class SimGeo implements GeoDriver {
  readonly name = "simulator" as const;
  static zones = new Map<string, RRSet[]>();
  async test() { return "شبیه‌ساز"; }
  async sync(z: GeoZoneSpec) { SimGeo.zones.set(z.domain, renderZone(z)); }
  async remove(domain: string) { SimGeo.zones.delete(domain); }
}

let cached: GeoDriver | null = null;
export const geoDriver = (): GeoDriver => (cached ??= process.env.GEO_PDNS ? new PowerDnsGeo() : new SimGeo());
export const resetGeoDriver = () => { cached = null; };
