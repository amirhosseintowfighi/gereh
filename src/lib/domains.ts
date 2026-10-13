/* Domains, DNS and CDN: record types, per-type validation, BIND zone files and shared view types.
   Used by the panel (instant feedback) and by the server (the real check). */

export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "SRV", "CAA", "NS", "PTR", "TLSA", "SSHFP", "URI", "NAPTR", "CERT", "SMIMEA"] as const;
export type DnsType = (typeof DNS_RECORD_TYPES)[number];
/** types whose answer can go through the CDN edge */
export const PROXIABLE: readonly string[] = ["A", "AAAA", "CNAME", "ALIAS"];
/** types that carry a priority field */
export const WITH_PRIORITY: readonly string[] = ["MX", "SRV", "URI"];

export const RECORD_HINT: Record<DnsType, string> = {
  A: "185.143.232.17", AAAA: "2a01:4f8::1", CNAME: "target.example.com", ALIAS: "app.gereh.dev (فقط روی @)", MX: "mail.example.com",
  TXT: "v=spf1 include:example.com ~all", SRV: "وزن پورت مقصد — 5 5060 sip.example.com", CAA: "0 issue \"letsencrypt.org\"", NS: "ns1.example.com", PTR: "host.example.com",
  TLSA: "3 1 1 <hex>", SSHFP: "4 2 <hex>", URI: "1 \"https://example.com/\"", NAPTR: "100 10 \"U\" \"E2U+sip\" \"!^.*$!sip:info@example.com!\" .", CERT: "PKIX 0 0 <base64>", SMIMEA: "3 0 1 <hex>",
};

export type DnsRecordInput = { type: string; name: string; value: string; ttl: number; priority?: number | null; proxied?: boolean };

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIpv4 = (s: string) => IPV4.test(s);
export function isIpv6(s: string) {
  if (!/^[0-9a-f:.]+$/i.test(s) || !s.includes(":") || s.length > 45) return false;
  const dbl = s.split("::");
  if (dbl.length > 2) return false;
  const parts = (p: string) => (p ? p.split(":") : []);
  let groups = [...parts(dbl[0]), ...(dbl[1] !== undefined ? parts(dbl[1]) : [])];
  const last = groups[groups.length - 1];
  let extra = 0;
  if (last && last.includes(".")) { if (!isIpv4(last)) return false; groups = groups.slice(0, -1); extra = 2; }
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return false;
  const n = groups.length + extra;
  return dbl.length === 2 ? n < 8 : n === 8;
}
export const HOST_RE = /^(?=.{1,253}\.?$)([a-z0-9_](?:[a-z0-9-_]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}\.?$/i;
export const DOMAIN_NAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** @, *, *.sub, a.b-c, _sip._tcp */
export const RECORD_NAME_RE = /^(@|\*|(\*\.)?[a-z0-9_]([a-z0-9-_]{0,61}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9-_]{0,61}[a-z0-9_])?)*)$/i;
const HEX = /^[0-9a-f]+$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const QUOTED = /^"(?:[^"\\]|\\.)*"$/;

/** splits rdata on whitespace, keeping quoted strings whole */
export function tokens(s: string): string[] {
  return s.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
}
const int = (s: string | undefined, lo: number, hi: number) => s !== undefined && /^\d+$/.test(s) && +s >= lo && +s <= hi;

/** "" when valid, otherwise a Persian message */
export function validateRecord(r: DnsRecordInput): string {
  const name = r.name.trim(), v = r.value.trim(), t = r.type as DnsType;
  if (!DNS_RECORD_TYPES.includes(t)) return "نوع رکورد پشتیبانی نمی‌شود.";
  if (!name) return "نام را وارد کنید (برای خود دامنه @).";
  if (name.length > 253 || !RECORD_NAME_RE.test(name)) return "نام رکورد معتبر نیست.";
  if (!v) return "مقدار را وارد کنید.";
  if (!Number.isInteger(r.ttl) || r.ttl < 60 || r.ttl > 604800) return "TTL باید بین ۶۰ ثانیه و ۷ روز باشد.";
  if (r.proxied && !PROXIABLE.includes(t)) return "فقط رکوردهای A، AAAA، CNAME و ALIAS از CDN عبور می‌کنند.";
  if (WITH_PRIORITY.includes(t) && !(Number.isInteger(r.priority) && r.priority! >= 0 && r.priority! <= 65535)) return "اولویت " + t + " باید عددی بین ۰ تا ۶۵۵۳۵ باشد.";
  const k = tokens(v);
  switch (t) {
    case "A": return isIpv4(v) ? "" : "برای رکورد A یک آدرس IPv4 معتبر لازم است.";
    case "AAAA": return isIpv6(v) ? "" : "برای رکورد AAAA یک آدرس IPv6 معتبر لازم است.";
    case "CNAME":
      if (name === "@") return "رکورد CNAME روی ریشه دامنه مجاز نیست؛ از ALIAS استفاده کنید.";
      return HOST_RE.test(v) ? "" : "مقدار باید یک نام میزبان معتبر باشد؛ مثل mail.example.com";
    case "ALIAS":
      if (name !== "@") return "رکورد ALIAS فقط روی ریشه دامنه (@) کاربرد دارد؛ برای زیردامنه از CNAME استفاده کنید.";
      return HOST_RE.test(v) ? "" : "مقدار باید یک نام میزبان معتبر باشد؛ مثل app.gereh.dev";
    case "MX": case "NS": case "PTR": return HOST_RE.test(v) ? "" : "مقدار باید یک نام میزبان معتبر باشد؛ مثل mail.example.com";
    case "TXT": return v.length <= 2048 ? "" : "متن رکورد TXT حداکثر ۲۰۴۸ نویسه است.";
    case "SRV":
      if (!/^_[a-z0-9-]+\._(tcp|udp|tls|sctp)(\.|$)/i.test(name)) return "نام رکورد SRV باید به شکل _service._tcp باشد.";
      return k.length === 3 && int(k[0], 0, 65535) && int(k[1], 0, 65535) && (k[2] === "." || HOST_RE.test(k[2])) ? "" : "مقدار SRV به شکل «وزن پورت مقصد» است؛ مثل 5 5060 sip.example.com";
    case "CAA":
      return k.length === 3 && int(k[0], 0, 255) && /^(issue|issuewild|iodef)$/i.test(k[1]) && QUOTED.test(k[2]) ? "" : "مقدار CAA به شکل 0 issue \"letsencrypt.org\" است.";
    case "TLSA": case "SMIMEA":
      return k.length === 4 && int(k[0], 0, 3) && int(k[1], 0, 1) && int(k[2], 0, 2) && HEX.test(k[3]) && k[3].length % 2 === 0 && (k[2] !== "1" || k[3].length === 64) && (k[2] !== "2" || k[3].length === 128)
        ? "" : "مقدار " + t + " به شکل «usage selector type hex» است؛ مثل 3 1 1 و هش SHA-256.";
    case "SSHFP":
      return k.length === 3 && ["1", "2", "3", "4", "6"].includes(k[0]) && ["1", "2"].includes(k[1]) && HEX.test(k[2]) && k[2].length === (k[1] === "1" ? 40 : 64)
        ? "" : "مقدار SSHFP به شکل «الگوریتم نوع اثرانگشت» است؛ مثل 4 2 و هش SHA-256.";
    case "URI":
      return k.length === 2 && int(k[0], 0, 65535) && QUOTED.test(k[1]) && /^"[a-z][a-z0-9+.-]*:/i.test(k[1]) ? "" : "مقدار URI به شکل «وزن \"آدرس\"» است؛ مثل 1 \"https://example.com/\"";
    case "NAPTR":
      return k.length === 6 && int(k[0], 0, 65535) && int(k[1], 0, 65535) && QUOTED.test(k[2]) && QUOTED.test(k[3]) && QUOTED.test(k[4]) && (k[5] === "." || HOST_RE.test(k[5]))
        ? "" : "مقدار NAPTR به شکل order pref \"flags\" \"service\" \"regexp\" replacement است.";
    case "CERT":
      return k.length >= 4 && (int(k[0], 0, 65535) || /^(PKIX|SPKI|PGP|IPKIX|ISPKI|IPGP|ACPKIX|IACPKIX|URI|OID)$/i.test(k[0])) && int(k[1], 0, 65535) && int(k[2], 0, 255) && B64.test(k.slice(3).join(""))
        ? "" : "مقدار CERT به شکل «نوع keytag الگوریتم base64» است.";
  }
  return "";
}

/** records that cannot sit next to each other at one name (CNAME rules, one ALIAS) */
export function conflictOf(r: DnsRecordInput, siblings: DnsRecordInput[]): string {
  const same = siblings.filter((x) => x.name.toLowerCase() === r.name.toLowerCase());
  if (r.type === "CNAME" && same.length) return "برای «" + r.name + "» رکورد دیگری هست؛ CNAME نمی‌تواند کنار رکورد دیگری باشد.";
  if (same.some((x) => x.type === "CNAME")) return "«" + r.name + "» یک رکورد CNAME دارد؛ رکورد دیگری کنارش مجاز نیست.";
  if (r.type === "ALIAS" && same.some((x) => x.type === "ALIAS" || x.type === "A" || x.type === "AAAA")) return "ALIAS جای رکوردهای A/AAAA ریشه را می‌گیرد؛ ابتدا آن‌ها را حذف کنید.";
  if ((r.type === "A" || r.type === "AAAA") && same.some((x) => x.type === "ALIAS")) return "ریشه دامنه رکورد ALIAS دارد؛ A/AAAA کنار آن مجاز نیست.";
  return "";
}

/* ---------------- BIND zone files ---------------- */
const dot = (s: string) => (s === "." || s.endsWith(".") ? s : s + ".");
const HOST_TYPES = new Set(["CNAME", "ALIAS", "NS", "PTR", "MX"]);

/** presentation rdata for a record (priority first, hostnames fully qualified) */
export function rdata(r: { type: string; value: string; priority?: number | null }) {
  const v = r.value.trim();
  if (HOST_TYPES.has(r.type)) return (r.type === "MX" ? (r.priority ?? 10) + " " : "") + dot(v);
  if (r.type === "TXT") {
    const raw = QUOTED.test(v) || /^"/.test(v) ? v : null;
    if (raw) return raw;
    const esc = v.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    const parts: string[] = [];
    for (let i = 0; i < esc.length || i === 0; i += 255) parts.push('"' + esc.slice(i, i + 255) + '"');
    return parts.join(" ");
  }
  if (r.type === "SRV") { const k = tokens(v); return (r.priority ?? 10) + " " + k[0] + " " + k[1] + " " + dot(k[2]); }
  if (r.type === "URI") return (r.priority ?? 10) + " " + v;
  if (r.type === "NAPTR") { const k = tokens(v); return [...k.slice(0, 5), dot(k[5])].join(" "); }
  return tokens(v).join(" ");
}

export function exportZone(domain: string, recs: (DnsRecordInput & { proxied?: boolean })[], opts: { ns?: string[]; dnssec?: boolean } = {}) {
  const head = ["; zone file for " + domain + " exported from Gereh", "$ORIGIN " + domain + ".", "$TTL 3600"];
  const ns = (opts.ns ?? []).map((n) => "@\t86400\tIN\tNS\t" + dot(n));
  const body = recs.map((r) => [r.name, r.ttl, "IN", r.type, rdata(r)].join("\t") + (r.proxied ? "\t; proxied" : ""));
  return [...head, ...ns, ...body].join("\n") + "\n";
}

export type ImportResult = { records: (Required<Omit<DnsRecordInput, "priority">> & { priority: number | null })[]; errors: string[]; skipped: number };

/** strips a comment that is not inside quotes; returns [code, comment] */
function splitComment(line: string): [string, string] {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") { i++; continue; }
    if (c === '"') q = !q;
    else if (c === ";" && !q) return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ""];
}
const unquote = (s: string) => s.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");

/** BIND master file → records relative to `domain`. SOA and apex NS are ours, so they are skipped. */
export function parseZone(text: string, domain: string, max = 500): ImportResult {
  const zone = domain.toLowerCase().replace(/\.$/, "");
  let origin = zone, ttl = 3600, last = "@";
  const out: ImportResult = { records: [], errors: [], skipped: 0 };
  // join parenthesised continuations into one logical line
  const logical: { text: string; comment: string; line: number }[] = [];
  let buf = "", com = "", depth = 0, start = 0;
  text.replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const [code, c] = splitComment(raw);
    if (!depth) { buf = ""; com = ""; start = i + 1; }
    for (const ch of code.replace(/"(?:[^"\\]|\\.)*"/g, "")) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    buf += (buf ? " " : "") + code; com += c;
    if (depth <= 0) { depth = 0; if (buf.trim()) logical.push({ text: buf, comment: com, line: start }); }
  });
  const rel = (n: string) => {
    let abs = n === "@" ? origin : n.endsWith(".") ? n.slice(0, -1) : n + "." + origin;
    abs = abs.toLowerCase();
    if (abs === zone) return "@";
    return abs.endsWith("." + zone) ? abs.slice(0, -(zone.length + 1)) : null;
  };
  const host = (n: string) => (n === "." ? "." : n.endsWith(".") ? n.slice(0, -1) : n === "@" ? origin : n + "." + origin);
  for (const l of logical) {
    if (out.records.length >= max) { out.errors.push("بیش از " + max + " رکورد؛ بقیه نادیده گرفته شد."); break; }
    const startsBlank = /^\s/.test(l.text);
    const k = tokens(l.text.replace(/"(?:[^"\\]|\\.)*"|[()]/g, (m) => (m.length === 1 ? " " : m)));
    if (!k.length) continue;
    if (k[0].toUpperCase() === "$ORIGIN") { origin = (k[1] || zone).replace(/\.$/, "").toLowerCase(); continue; }
    if (k[0].toUpperCase() === "$TTL") { ttl = parseTtl(k[1]) ?? ttl; continue; }
    if (k[0].startsWith("$")) { out.skipped++; continue; }
    let i = 0, owner = last;
    if (!startsBlank) { owner = k[0]; i = 1; }
    let recTtl = ttl;
    for (let n = 0; n < 2 && i < k.length; n++) {
      if (/^(IN|CH|HS)$/i.test(k[i])) i++;
      else if (parseTtl(k[i]) !== null && !DNS_RECORD_TYPES.includes(k[i].toUpperCase() as DnsType)) recTtl = parseTtl(k[i++])!;
    }
    const type = (k[i++] || "").toUpperCase(), rest = k.slice(i);
    last = owner;
    const name = rel(owner);
    if (type === "SOA" || (type === "NS" && name === "@")) { out.skipped++; continue; }
    if (name === null) { out.errors.push("خط " + l.line + ": «" + owner + "» زیر این دامنه نیست."); continue; }
    if (!DNS_RECORD_TYPES.includes(type as DnsType)) { out.errors.push("خط " + l.line + ": نوع «" + type + "» پشتیبانی نمی‌شود."); continue; }
    let priority: number | null = null, value: string;
    if (WITH_PRIORITY.includes(type)) { priority = Number(rest[0]); rest.shift(); }
    if (type === "TXT") value = rest.map(unquote).join("");
    else if (HOST_TYPES.has(type)) value = host(rest[0] ?? "");
    else if (type === "SRV") value = rest.length === 3 ? rest[0] + " " + rest[1] + " " + host(rest[2]) : rest.join(" ");
    else if (type === "NAPTR") value = rest.length === 6 ? [...rest.slice(0, 5), host(rest[5])].join(" ") : rest.join(" ");
    else value = rest.join(" ");
    const rec = { type, name, value, ttl: Math.min(604800, Math.max(60, recTtl)), priority, proxied: /\bproxied\b/i.test(l.comment) && PROXIABLE.includes(type) };
    const err = validateRecord(rec);
    if (err) { out.errors.push("خط " + l.line + " (" + type + " " + name + "): " + err); continue; }
    out.records.push(rec);
  }
  return out;
}
/** 3600, 1h, 1d2h, 1w */
export function parseTtl(s: string | undefined): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return +s;
  const m = s.toLowerCase().match(/^(\d+[smhdw])+$/);
  if (!m) return null;
  const unit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return [...s.toLowerCase().matchAll(/(\d+)([smhdw])/g)].reduce((t, x) => t + Number(x[1]) * unit[x[2]], 0);
}

/* ---------------- CDN ---------------- */
export type CdnRule =
  | { kind: "cache"; path: string; action: "cache" | "bypass"; ttl: number }
  | { kind: "redirect"; path: string; to: string; code: 301 | 302 }
  | { kind: "header"; name: string; value: string }
  | { kind: "auth"; path: string; user: string }
  | { kind: "access"; action: "allow" | "deny"; ip?: string; country?: string }
  | { kind: "ratelimit"; path: string; rps: number; burst: number };
export type CdnRuleView = CdnRule & { id: string };
export type CdnConfig = {
  enabled: boolean; originHost: string; originHostHeader: string; originHttps: boolean;
  forceHttps: boolean; hstsMaxAge: number; hstsSub: boolean; hstsPreload: boolean; minTls: "1.0" | "1.1" | "1.2" | "1.3";
  browserTtl: number; devMode: boolean; devUntil: string; underAttack: boolean; cacheVersion: number;
};
export const CDN_DEFAULT: CdnConfig = {
  enabled: false, originHost: "", originHostHeader: "", originHttps: false, forceHttps: true, hstsMaxAge: 0, hstsSub: false, hstsPreload: false, minTls: "1.2",
  browserTtl: 0, devMode: false, devUntil: "", underAttack: false, cacheVersion: 1,
};
export type CdnPoint = { at: string; requests: number; cached: number; bytes: number; errors: number; blocked: number };
export type CdnView = { config: CdnConfig; rules: CdnRuleView[]; edge: { ipv4: string[]; ipv6: string[] }; origin: string; driver: string; proxied: number };

export const CDN_RULE_LABEL: Record<CdnRule["kind"], string> = { cache: "قانون کش", redirect: "ریدایرکت", header: "هدر پاسخ", auth: "رمز روی مسیر", access: "دسترسی IP/کشور", ratelimit: "محدودیت نرخ" };
export const ALERT_METRICS = { requests: "درخواست در ساعت", bandwidth: "ترافیک (مگابایت در ساعت)", errors: "خطای ۵xx در ساعت", blocked: "درخواست مسدودشده در ساعت" } as const;
export type AlertMetric = keyof typeof ALERT_METRICS;
export type DomainAlertView = { id: string; metric: AlertMetric; threshold: number; enabled: boolean; lastValue: number; fired: string };

export const TRANSFER_STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "gray"]> = {
  pending: ["در انتظار تأیید", "amber"], processing: ["در حال انتقال", "blue"], completed: ["انجام شد", "green"], rejected: ["رد شد", "red"],
  cancelled: ["لغو شد", "gray"], failed: ["ناموفق", "red"], auth_sent: ["کد انتقال صادر شد", "blue"],
};
export type TransferView = { id: string; userId: string; domain: string; direction: "in" | "out"; status: string; price: number; note: string; irnicHandle: string; domainId: string | null; at: string; updated: string; user?: string };

/** IRNIC contact handles look like ab1234-irnic */
export const IRNIC_RE = /^[a-z]{2}\d{2,6}-irnic$/i;
export const isIr = (domain: string) => /\.ir$/i.test(domain);

export type WhoisView = { domain: string; server: string; cached: boolean; at: string; registered: boolean; registrar: string; created: string; expires: string; status: string[]; nameservers: string[]; raw: string };
export type DnsSuggestion = { key: string; label: string; icon: string; records: { type: string; name: string; value: string; priority: number | null; ttl: number }[] };
