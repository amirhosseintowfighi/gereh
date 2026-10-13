/* CDN per domain. The edge is ingress-nginx: each CDN domain becomes Ingresses in CDN_NAMESPACE
   ("gereh-cdn") in front of a Service that points at the customer's origin.

   What the real driver (CDN_DRIVER=nginx, plus PAAS_K8S_API/PAAS_K8S_TOKEN) needs from the controller:
   - the "gereh_cdn" proxy cache zone in its http-snippet (deploy/paas/setup-cluster.sh already adds it);
   - `allow-snippet-annotations: "true"` and `annotations-risk-level: Critical` in its ConfigMap, because
     cache, HSTS, header, redirect and country rules are server/configuration snippets;
   - `use-geoip2: "true"` with a MaxMind licence for country rules ($geoip2_city_country_code);
   - cert-manager with CDN_CLUSTER_ISSUER for the edge certificates;
   - the minimum TLS version is written per server, but nginx applies ssl_protocols per listening
     socket: it only takes effect when the controller's own ssl-protocols allows no lower version.
   Purge by URL or prefix needs an edge purge endpoint (CDN_PURGE_URL, e.g. a sidecar with
   ngx_cache_purge); without it the driver reports "not supported" and the caller purges everything
   by bumping the cache version in the key.
   Without CDN_DRIVER the simulator keeps what would be applied in memory and makes up traffic. */
import "server-only";
import { createHash } from "node:crypto";
import type { CdnPoint, CdnRule } from "@/lib/domains";
import { isIpv4, isIpv6 } from "@/lib/domains";

export type CdnSpec = {
  domain: string;
  /** fully qualified hosts served by the edge (proxied records) */
  hosts: string[];
  origin: string; originHostHeader: string; originHttps: boolean;
  forceHttps: boolean; hsts: { maxAge: number; sub: boolean; preload: boolean }; minTls: string;
  browserTtl: number; devMode: boolean; underAttack: boolean; cacheVersion: number;
  rules: (CdnRule & { id: string; htpasswd?: string })[];
};
export type PurgeTarget = { all: true } | { urls: string[] } | { prefix: string };

export interface CdnDriver {
  readonly name: "nginx" | "simulator";
  apply(spec: CdnSpec): Promise<void>;
  remove(domain: string): Promise<void>;
  /** false when the edge cannot purge selectively (the caller then bumps the cache version) */
  purge(domain: string, target: PurgeTarget): Promise<boolean>;
  analytics(domain: string, hours: number): Promise<CdnPoint[]>;
}

export const edgeIps = () => ({
  ipv4: (process.env.CDN_EDGE_IPV4 || "185.143.233.10,185.143.233.11").split(",").map((s) => s.trim()).filter(isIpv4),
  ipv6: (process.env.CDN_EDGE_IPV6 || "").split(",").map((s) => s.trim()).filter(isIpv6),
});
const ns = () => process.env.CDN_NAMESPACE || "gereh-cdn";
export const slug = (domain: string) => "cdn-" + domain.replace(/[^a-z0-9]/g, "-").slice(0, 40) + "-" + createHash("sha1").update(domain).digest("hex").slice(0, 6);

/* ---------- nginx rendering (pure, exported for tests) ---------- */
// every value below was validated by the RPC layer; this is a second line of defence for snippets
const safe = (s: string) => { if (/["\\;{}$\n\r`']/.test(s)) throw new Error("unsafe value in CDN rule"); return s; };
const pathMatch = (p: string) => (p.endsWith("*") ? "~ ^" + safe(p.slice(0, -1)).replace(/[.+?^()|[\]]/g, "\\$&") : "= " + safe(p));
const prefixOf = (p: string) => (p.endsWith("*") ? p.slice(0, -1) : p);

export function serverSnippet(s: CdnSpec) {
  const out: string[] = [];
  out.push("ssl_protocols " + ["1.0", "1.1", "1.2", "1.3"].filter((v) => v >= s.minTls).map((v) => "TLSv" + v).join(" ") + ";");
  if (s.hsts.maxAge > 0) out.push(`more_set_headers "Strict-Transport-Security: max-age=${s.hsts.maxAge}${s.hsts.sub ? "; includeSubDomains" : ""}${s.hsts.preload ? "; preload" : ""}";`);
  for (const r of s.rules) if (r.kind === "header") out.push(`more_set_headers "${safe(r.name)}: ${safe(r.value)}";`);
  const allowC = s.rules.filter((r) => r.kind === "access" && r.country && r.action === "allow").map((r) => (r as { country: string }).country);
  const denyC = s.rules.filter((r) => r.kind === "access" && r.country && r.action === "deny").map((r) => (r as { country: string }).country);
  if (allowC.length) out.push(`if ($geoip2_city_country_code !~ ^(${allowC.map(safe).join("|")})$) { return 403; }`);
  if (denyC.length) out.push(`if ($geoip2_city_country_code ~ ^(${denyC.map(safe).join("|")})$) { return 403; }`);
  for (const r of s.rules) if (r.kind === "redirect") out.push(`if ($uri ${pathMatch(r.path).replace(/^= /, "= ")}) { return ${r.code} ${safe(r.to)}; }`);
  if (s.underAttack) {
    // a browser check: visitors without the cookie get a page that sets it with JavaScript and reloads
    out.push('set $gereh_ok "";', 'if ($cookie_gereh_check = "' + slug(s.domain) + '") { set $gereh_ok 1; }',
      'if ($gereh_ok = "") { add_header Content-Type text/html always; return 503 "<!doctype html><meta charset=utf-8><title>Checking</title><p>Checking your browser</p><script>document.cookie=\\"gereh_check=' + slug(s.domain) + '; path=/; max-age=3600\\";setTimeout(function(){location.reload()},1500)</script>"; }');
  }
  return out.join("\n");
}

export function cacheSnippet(s: CdnSpec, ttl?: number, bypass = false) {
  const out: string[] = [];
  if (!s.devMode && !bypass) {
    out.push("proxy_cache gereh_cdn;", `proxy_cache_key "$scheme$host$request_uri|v${Math.max(1, Math.floor(s.cacheVersion))}";`,
      ttl ? `proxy_ignore_headers Cache-Control Expires; proxy_cache_valid 200 301 302 ${ttl}s;` : "proxy_cache_valid 200 301 302 10m;",
      "proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;", "proxy_cache_lock on;");
  } else out.push("proxy_cache off;");
  out.push("more_set_headers \"X-Cache-Status: $upstream_cache_status\";");
  if (s.browserTtl > 0) out.push("proxy_hide_header Cache-Control;", `more_set_headers "Cache-Control: public, max-age=${s.browserTtl}";`);
  return out.join("\n");
}

type Obj = Record<string, unknown> & { apiVersion: string; kind: string; metadata: { name: string; namespace?: string; labels?: Record<string, string>; annotations?: Record<string, string> } };

/** the objects one CDN domain needs on the edge cluster */
export function edgeObjects(s: CdnSpec): Obj[] {
  const name = slug(s.domain), namespace = ns(), labels = { "app.kubernetes.io/managed-by": "gereh", "gereh.net/cdn": name };
  const ip = isIpv4(s.origin) || isIpv6(s.origin);
  const port = s.originHttps ? 443 : 80;
  const out: Obj[] = [];
  out.push(ip
    ? { apiVersion: "v1", kind: "Service", metadata: { name, namespace, labels }, spec: { ports: [{ name: "origin", port, targetPort: port }] } }
    : { apiVersion: "v1", kind: "Service", metadata: { name, namespace, labels }, spec: { type: "ExternalName", externalName: s.origin, ports: [{ name: "origin", port, targetPort: port }] } });
  if (ip) out.push({ apiVersion: "v1", kind: "Endpoints", metadata: { name, namespace, labels }, subsets: [{ addresses: [{ ip: s.origin }], ports: [{ name: "origin", port }] }] });
  const allow = s.rules.flatMap((r) => (r.kind === "access" && r.ip && r.action === "allow" ? [r.ip] : []));
  const deny = s.rules.flatMap((r) => (r.kind === "access" && r.ip && r.action === "deny" ? [r.ip] : []));
  const root = s.rules.find((r) => r.kind === "ratelimit" && r.path === "/") as Extract<CdnRule, { kind: "ratelimit" }> | undefined;
  const base: Record<string, string> = {
    "cert-manager.io/cluster-issuer": process.env.CDN_CLUSTER_ISSUER || "letsencrypt",
    "nginx.ingress.kubernetes.io/upstream-vhost": s.originHostHeader || s.domain,
    "nginx.ingress.kubernetes.io/backend-protocol": s.originHttps ? "HTTPS" : "HTTP",
    "nginx.ingress.kubernetes.io/ssl-redirect": String(s.forceHttps),
    "nginx.ingress.kubernetes.io/force-ssl-redirect": String(s.forceHttps),
    "nginx.ingress.kubernetes.io/proxy-body-size": "100m",
    ...(allow.length ? { "nginx.ingress.kubernetes.io/whitelist-source-range": allow.join(",") } : {}),
    ...(deny.length ? { "nginx.ingress.kubernetes.io/denylist-source-range": deny.join(",") } : {}),
    ...(s.underAttack ? { "nginx.ingress.kubernetes.io/limit-rps": "5", "nginx.ingress.kubernetes.io/limit-burst-multiplier": "2" }
      : root ? { "nginx.ingress.kubernetes.io/limit-rps": String(root.rps), "nginx.ingress.kubernetes.io/limit-burst-multiplier": String(Math.max(1, Math.round(root.burst / Math.max(1, root.rps)))) } : {}),
  };
  const tls = [{ hosts: s.hosts, secretName: name + "-tls" }];
  const ing = (n: string, annotations: Record<string, string>, path: string): Obj => ({
    apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: { name: n, namespace, labels, annotations },
    spec: { ingressClassName: process.env.PAAS_INGRESS_CLASS || "nginx", tls, rules: s.hosts.map((host) => ({ host, http: { paths: [{ path, pathType: "Prefix", backend: { service: { name, port: { name: "origin" } } } }] } })) },
  });
  // the server snippet goes on one Ingress only: nginx merges every Ingress of a host into one server block
  out.push(ing(name, { ...base, "nginx.ingress.kubernetes.io/server-snippet": serverSnippet(s), "nginx.ingress.kubernetes.io/configuration-snippet": cacheSnippet(s) }, "/"));
  s.rules.forEach((r, i) => {
    const n = name + "-r" + i;
    if (r.kind === "cache") out.push(ing(n, { ...base, "nginx.ingress.kubernetes.io/configuration-snippet": cacheSnippet(s, r.action === "cache" ? r.ttl : undefined, r.action === "bypass") }, prefixOf(r.path)));
    if (r.kind === "ratelimit" && r.path !== "/") out.push(ing(n, { ...base, "nginx.ingress.kubernetes.io/configuration-snippet": cacheSnippet(s), "nginx.ingress.kubernetes.io/limit-rps": String(r.rps), "nginx.ingress.kubernetes.io/limit-burst-multiplier": String(Math.max(1, Math.round(r.burst / Math.max(1, r.rps)))) }, prefixOf(r.path)));
    if (r.kind === "auth" && r.htpasswd) {
      out.push({ apiVersion: "v1", kind: "Secret", metadata: { name: n + "-auth", namespace, labels }, type: "Opaque", stringData: { auth: r.htpasswd + "\n" } } as Obj);
      out.push(ing(n, { ...base, "nginx.ingress.kubernetes.io/configuration-snippet": cacheSnippet(s, undefined, true), "nginx.ingress.kubernetes.io/auth-type": "basic", "nginx.ingress.kubernetes.io/auth-secret": n + "-auth", "nginx.ingress.kubernetes.io/auth-realm": "Restricted" }, prefixOf(r.path)));
    }
  });
  return out;
}

/* ---------- simulated traffic: deterministic per domain and hour ---------- */
const h32 = (s: string) => createHash("sha256").update(s).digest().readUInt32BE(0);
export function simTraffic(domain: string, hours: number, now = Date.now(), opts: { underAttack?: boolean; devMode?: boolean } = {}): CdnPoint[] {
  const base = 200 + (h32(domain) % 4000);
  const end = Math.floor(now / 3600_000);
  return Array.from({ length: hours }, (_, i) => {
    const hour = end - hours + 1 + i;
    const tehran = (hour + 3) % 24; // diurnal curve on Tehran time
    const wave = 0.45 + 0.55 * Math.sin(((tehran - 6) / 24) * Math.PI * 2) ** 2;
    const noise = (h32(domain + ":" + hour) % 1000) / 1000;
    const requests = Math.round(base * wave * (0.8 + noise * 0.4));
    const hit = opts.devMode ? 0 : 0.55 + (h32("hit" + domain + hour) % 400) / 1000;
    return {
      at: new Date(hour * 3600_000).toISOString(), requests, cached: Math.round(requests * hit),
      bytes: requests * (20_000 + (h32("b" + domain) % 80_000)), errors: Math.round(requests * (h32("e" + domain + hour) % 20) / 1000),
      blocked: Math.round(requests * (opts.underAttack ? 0.3 : (h32("x" + domain + hour) % 30) / 1000)),
    };
  });
}

export class SimCdn implements CdnDriver {
  readonly name = "simulator" as const;
  static applied = new Map<string, CdnSpec>();
  static purges: { domain: string; target: PurgeTarget }[] = [];
  async apply(s: CdnSpec) { edgeObjects(s); SimCdn.applied.set(s.domain, s); }
  async remove(domain: string) { SimCdn.applied.delete(domain); }
  async purge(domain: string, target: PurgeTarget) { SimCdn.purges.push({ domain, target }); return true; }
  async analytics(domain: string, hours: number) { const s = SimCdn.applied.get(domain); return simTraffic(domain, hours, Date.now(), { underAttack: s?.underAttack, devMode: s?.devMode }); }
}

class NginxEdgeCdn implements CdnDriver {
  readonly name = "nginx" as const;
  private async k() { return import("../paas/kubernetes"); }
  async apply(s: CdnSpec) {
    const { apply, k8s } = await this.k();
    const objs = edgeObjects(s);
    for (const o of objs) {
      if (o.kind === "Endpoints") await k8s("PATCH", `/api/v1/namespaces/${o.metadata.namespace}/endpoints/${o.metadata.name}?fieldManager=gereh&force=true`, o, "application/apply-patch+yaml");
      else await apply(o as never);
    }
    // drop path Ingresses of rules that no longer exist
    const want = new Set(objs.filter((o) => o.kind === "Ingress").map((o) => o.metadata.name));
    const list = await k8s("GET", `/apis/networking.k8s.io/v1/namespaces/${ns()}/ingresses?labelSelector=${encodeURIComponent("gereh.net/cdn=" + slug(s.domain))}`) as { items?: { metadata: { name: string } }[] };
    for (const i of list.items ?? []) if (!want.has(i.metadata.name)) await k8s("DELETE", `/apis/networking.k8s.io/v1/namespaces/${ns()}/ingresses/${i.metadata.name}`).catch(() => null);
  }
  async remove(domain: string) {
    const { k8s } = await this.k();
    const sel = "?labelSelector=" + encodeURIComponent("gereh.net/cdn=" + slug(domain));
    for (const p of [`/apis/networking.k8s.io/v1/namespaces/${ns()}/ingresses`, `/api/v1/namespaces/${ns()}/secrets`, `/api/v1/namespaces/${ns()}/services`, `/api/v1/namespaces/${ns()}/endpoints`]) {
      const list = await k8s("GET", p + sel).catch(() => ({})) as { items?: { metadata: { name: string } }[] };
      for (const i of list.items ?? []) await k8s("DELETE", p + "/" + i.metadata.name).catch(() => null);
    }
  }
  async purge(domain: string, target: PurgeTarget) {
    const url = process.env.CDN_PURGE_URL;
    if (!url || "all" in target) return false;
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(process.env.CDN_PURGE_TOKEN ? { authorization: "Bearer " + process.env.CDN_PURGE_TOKEN } : {}) }, body: JSON.stringify({ host: domain, ...target }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error("edge purge: " + res.status);
    return true;
  }
  /** requests and bytes per hour from ingress-nginx metrics (cache hits are not exported there) */
  async analytics(domain: string, hours: number): Promise<CdnPoint[]> {
    const m = /^([a-z0-9-]+)\/([a-z0-9-]+)(?::(\d+))?$/.exec(process.env.PAAS_PROMETHEUS || "");
    if (!m) return [];
    const { k8s } = await this.k();
    const end = Math.floor(Date.now() / 3600_000) * 3600, start = end - (hours - 1) * 3600;
    const range = async (q: string) => {
      const r = await k8s("GET", `/api/v1/namespaces/${m[1]}/services/${m[2]}:${m[3] ?? "80"}/proxy/api/v1/query_range?query=${encodeURIComponent(q)}&start=${start}&end=${end}&step=3600`).catch(() => null) as { data?: { result?: { values: [number, string][] }[] } } | null;
      return new Map((r?.data?.result?.[0]?.values ?? []).map(([t, v]) => [t, Number(v) || 0]));
    };
    const sel = `namespace="${ns()}",host=~"(.+\\\\.)?${domain.replace(/\./g, "\\\\.")}"`;
    const [req, bytes, err] = await Promise.all([
      range(`sum(increase(nginx_ingress_controller_requests{${sel}}[1h]))`),
      range(`sum(increase(nginx_ingress_controller_response_size_sum{${sel}}[1h]))`),
      range(`sum(increase(nginx_ingress_controller_requests{${sel},status=~"5.."}[1h]))`),
    ]);
    return Array.from({ length: hours }, (_, i) => {
      const t = start + i * 3600;
      return { at: new Date(t * 1000).toISOString(), requests: Math.round(req.get(t) ?? 0), cached: 0, bytes: Math.round(bytes.get(t) ?? 0), errors: Math.round(err.get(t) ?? 0), blocked: 0 };
    });
  }
}

let cached: CdnDriver | null = null;
export const cdnDriver = (): CdnDriver => (cached ??= process.env.CDN_DRIVER === "nginx" && process.env.PAAS_K8S_API ? new NginxEdgeCdn() : new SimCdn());
export const resetCdnDriver = () => { cached = null; };
