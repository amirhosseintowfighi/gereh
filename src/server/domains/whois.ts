/* WHOIS over TCP 43 (RFC 3912). The server comes from a map of common TLDs (IRNIC for .ir); unknown
   TLDs ask whois.iana.org for the referral. Answers are cached in whois_cache. Tests swap the socket. */
import "server-only";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { eq } from "drizzle-orm";
import type { WhoisView } from "@/lib/domains";
import { faDateTime } from "@/lib/jalali";
import type { DB } from "../db/client";
import { whoisCache } from "../db/schema";

export const WHOIS_SERVERS: Record<string, string> = {
  com: "whois.verisign-grs.com", net: "whois.verisign-grs.com", org: "whois.pir.org", info: "whois.nic.info", biz: "whois.nic.biz",
  io: "whois.nic.io", co: "whois.nic.co", me: "whois.nic.me", tv: "whois.nic.tv", cc: "ccwhois.verisign-grs.com",
  app: "whois.nic.google", dev: "whois.nic.google", xyz: "whois.nic.xyz", online: "whois.nic.online", site: "whois.nic.site", store: "whois.nic.store",
  shop: "whois.nic.shop", tech: "whois.nic.tech", cloud: "whois.nic.cloud", ai: "whois.nic.ai", studio: "whois.nic.studio", agency: "whois.nic.agency",
  de: "whois.denic.de", uk: "whois.nic.uk", eu: "whois.eu", fr: "whois.nic.fr", nl: "whois.domain-registry.nl", ru: "whois.tcinet.ru", tr: "whois.nic.tr",
  ae: "whois.aeda.net.ae", ir: "whois.nic.ir", "ایران": "whois.nic.ir",
};
const IANA = "whois.iana.org";
export const CACHE_MS = 6 * 3600_000;
const MAX_BYTES = 128 * 1024;

export type SocketFactory = (host: string, port: number) => Duplex;
let factory: SocketFactory = (host, port) => connect({ host, port });
/** tests pass a fake socket; null restores the network */
export const setWhoisSocket = (f: SocketFactory | null) => { factory = f ?? ((host, port) => connect({ host, port })); };

export const serverFor = (domain: string) => WHOIS_SERVERS[domain.slice(domain.lastIndexOf(".") + 1)] ?? null;

/** one query: write "<q>\r\n", read until the server closes */
export function query(host: string, q: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = factory(host, 43);
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer); sock.destroy();
      if (err) reject(err); else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(() => finish(new Error("whois timeout: " + host)), timeoutMs);
    sock.on("data", (c: Buffer | string) => {
      const b = typeof c === "string" ? Buffer.from(c) : c;
      size += b.length; chunks.push(b);
      if (size > MAX_BYTES) finish();
    });
    sock.on("end", () => finish());
    sock.on("close", () => finish());
    sock.on("error", (e: Error) => finish(e));
    sock.write(q + "\r\n");
  });
}

const field = (raw: string, ...keys: string[]) => {
  for (const k of keys) {
    const m = raw.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.+)$", "im"));
    if (m) return m[1].trim();
  }
  return "";
};
const NOT_FOUND = /no match|not found|no entries found|no data found|status:\s*free|is available|no object found/i;

/** the common fields out of a WHOIS answer (gTLD, IRNIC and RIPE-style keys) */
export function parseWhois(raw: string) {
  const ns = [...raw.matchAll(/^\s*(?:name server|nserver|nameserver|name servers?)\s*:\s*(\S+)/gim)].map((m) => m[1].toLowerCase().replace(/\.$/, ""));
  const status = [...raw.matchAll(/^\s*(?:domain status|status)\s*:\s*(\S+)/gim)].map((m) => m[1]);
  return {
    registered: !NOT_FOUND.test(raw) && raw.trim().length > 0,
    registrar: field(raw, "registrar", "sponsoring registrar", "source"),
    created: field(raw, "creation date", "created", "registered on", "registered"),
    expires: field(raw, "registry expiry date", "registrar registration expiration date", "expire-date", "expiry date", "expires", "paid-till"),
    status: [...new Set(status)],
    nameservers: [...new Set(ns)],
  };
}

/** WHOIS with cache; IANA referral for TLDs outside the map */
export async function whois(db: DB, domain: string, opts: { fresh?: boolean } = {}): Promise<WhoisView> {
  const name = domain.toLowerCase();
  const [hit] = await db.select().from(whoisCache).where(eq(whoisCache.domain, name));
  if (hit && !opts.fresh && Date.now() - hit.fetchedAt.getTime() < CACHE_MS) return view(name, hit.server, hit.body, true, hit.fetchedAt);
  let server = serverFor(name) ?? "";
  if (!server) {
    const ref = await query(IANA, name.slice(name.lastIndexOf(".") + 1));
    server = field(ref, "whois", "refer");
    if (!/^[a-z0-9.-]+$/i.test(server)) throw new Error("no whois server for " + name);
  }
  let body = await query(server, name);
  // thin registries (Verisign) point at the registrar's own server
  const referral = field(body, "registrar whois server");
  if (referral && referral !== server && /^[a-z0-9.-]+$/i.test(referral)) {
    try { body = body + "\n\n" + (await query(referral, name)); } catch { /* the registry answer is enough */ }
  }
  const at = new Date();
  await db.insert(whoisCache).values({ domain: name, server, body, fetchedAt: at }).onConflictDoUpdate({ target: whoisCache.domain, set: { server, body, fetchedAt: at } });
  return view(name, server, body, false, at);
}
const view = (domain: string, server: string, raw: string, cached: boolean, at: Date): WhoisView => ({ domain, server, cached, at: faDateTime(at), ...parseWhois(raw), raw: raw.slice(0, 20_000) });
