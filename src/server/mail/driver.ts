/* Mail backend. Mailboxes, aliases, SMTP users and domains live on a self-hosted Stalwart Mail Server,
   managed through its REST management API (STALWART_URL + STALWART_TOKEN, or STALWART_ADMIN=user:pass).
   Messages sent through the HTTP API go out over SMTP with nodemailer (MAIL_SMTP_HOST…), DKIM-signed
   here with the domain's key. Inbound mail and SMTP submissions reach the panel through Stalwart's MTA
   hook (/api/mail/hook); delivery results through its webhooks (/api/mail/events). See deploy/mail.
   Without STALWART_URL the simulator keeps everything in memory and the worker invents delivery events
   (dev, tests, demos): nothing ever leaves the machine. */
import "server-only";

export type OutgoingMail = { id: string; domain: string; envelopeFrom: string; recipients: string[]; raw: string; dkim: { selector: string; privateKey: string } };
export type MailboxSpec = { address: string; name: string; password?: string; quotaMb: number; active: boolean };
export type SendResult = { accepted: string[]; rejected: string[]; response: string };

export interface MailDriver {
  readonly name: "stalwart" | "simulator";
  test(): Promise<string>;
  addDomain(domain: string): Promise<void>;
  removeDomain(domain: string): Promise<void>;
  setSmtpUser(u: { username: string; password: string; domain: string }): Promise<void>;
  removeSmtpUser(username: string): Promise<void>;
  setMailbox(m: MailboxSpec): Promise<void>;
  removeMailbox(address: string): Promise<void>;
  /** an address (or "@domain" for catch-all) that redirects to other addresses */
  setForward(address: string, destinations: string[]): Promise<void>;
  removeForward(address: string): Promise<void>;
  send(m: OutgoingMail): Promise<SendResult>;
  /** used storage in MB per address */
  usage(addresses: string[]): Promise<Record<string, number>>;
}

/** what the simulator holds; tests read it */
export type SimState = { domains: Set<string>; smtp: Map<string, string>; mailboxes: Map<string, MailboxSpec>; forwards: Map<string, string[]>; sent: OutgoingMail[] };

export class SimMail implements MailDriver {
  readonly name = "simulator" as const;
  static state: SimState = { domains: new Set(), smtp: new Map(), mailboxes: new Map(), forwards: new Map(), sent: [] };
  static reset() { SimMail.state = { domains: new Set(), smtp: new Map(), mailboxes: new Map(), forwards: new Map(), sent: [] }; }
  async test() { return "شبیه‌ساز (STALWART_URL تنظیم نشده)"; }
  async addDomain(d: string) { SimMail.state.domains.add(d); }
  async removeDomain(d: string) {
    const s = SimMail.state;
    s.domains.delete(d);
    for (const k of [...s.mailboxes.keys()]) if (k.endsWith("@" + d)) s.mailboxes.delete(k);
    for (const k of [...s.forwards.keys()]) if (k.endsWith("@" + d)) s.forwards.delete(k);
  }
  async setSmtpUser(u: { username: string; password: string }) { SimMail.state.smtp.set(u.username, u.password); }
  async removeSmtpUser(username: string) { SimMail.state.smtp.delete(username); }
  async setMailbox(m: MailboxSpec) { const cur = SimMail.state.mailboxes.get(m.address); SimMail.state.mailboxes.set(m.address, { ...cur, ...m, password: m.password ?? cur?.password }); }
  async removeMailbox(address: string) { SimMail.state.mailboxes.delete(address); }
  async setForward(address: string, destinations: string[]) { SimMail.state.forwards.set(address, destinations); }
  async removeForward(address: string) { SimMail.state.forwards.delete(address); }
  async send(m: OutgoingMail): Promise<SendResult> { SimMail.state.sent.push(m); return { accepted: m.recipients, rejected: [], response: "250 simulated" }; }
  async usage(addresses: string[]) { return Object.fromEntries(addresses.map((a) => [a, 0])); }
}

type Principal = { type: "domain" | "individual" | "list"; name: string; secrets?: string[]; emails?: string[]; quota?: number; description?: string; roles?: string[]; externalMembers?: string[]; enabledPermissions?: string[]; disabledPermissions?: string[] };

class StalwartMail implements MailDriver {
  readonly name = "stalwart" as const;
  private base = (process.env.STALWART_URL || "").replace(/\/$/, "");
  private auth() {
    if (process.env.STALWART_TOKEN) return "Bearer " + process.env.STALWART_TOKEN;
    return "Basic " + Buffer.from(process.env.STALWART_ADMIN || "admin:").toString("base64");
  }
  private async req(method: string, path: string, body?: unknown, okStatus: number[] = []) {
    const res = await fetch(this.base + "/api" + path, { method, headers: { authorization: this.auth(), "content-type": "application/json", accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok && !okStatus.includes(res.status)) throw new Error("Stalwart " + method + " " + path + ": " + res.status + " " + text.slice(0, 200));
    let j: { error?: string; details?: string; data?: unknown } = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* plain text */ }
    // the management API answers 200 with {"error": "..."} for semantic failures
    if (j.error && j.error !== "notFound" && j.error !== "fieldAlreadyExists") throw new Error("Stalwart " + path + ": " + j.error + (j.details ? " (" + j.details + ")" : ""));
    return { status: res.status, error: j.error, data: j.data };
  }
  /** create, or replace the given fields when it exists */
  private async upsert(p: Principal) {
    const r = await this.req("POST", "/principal", p);
    if (r.error !== "fieldAlreadyExists") return;
    const fields = Object.entries(p).filter(([k]) => k !== "type" && k !== "name").map(([field, value]) => ({ action: "set", field, value }));
    await this.req("PATCH", "/principal/" + encodeURIComponent(p.name), fields);
  }
  private remove = (name: string) => this.req("DELETE", "/principal/" + encodeURIComponent(name), undefined, [404]).then(() => {});

  async test() {
    const r = await fetch(this.base + "/api/principal?types=domain&limit=1", { headers: { authorization: this.auth() }, signal: AbortSignal.timeout(8000) });
    return new URL(this.base).host + (r.ok ? " ✓" : " ✗ " + r.status) + " · SMTP " + (process.env.MAIL_SMTP_HOST || "—");
  }
  addDomain(domain: string) { return this.upsert({ type: "domain", name: domain }); }
  removeDomain(domain: string) { return this.remove(domain); }
  setSmtpUser(u: { username: string; password: string; domain: string }) {
    // a login with no mailbox address: it may submit mail only
    return this.upsert({ type: "individual", name: u.username, secrets: [u.password], emails: [], description: "SMTP " + u.domain, roles: ["user"], disabledPermissions: ["imap-authenticate", "pop3-authenticate", "jmap-email-get"] });
  }
  removeSmtpUser(username: string) { return this.remove(username); }
  setMailbox(m: MailboxSpec) {
    return this.upsert({ type: "individual", name: m.address, emails: [m.address], description: m.name, quota: m.quotaMb * 1024 * 1024, roles: m.active ? ["user"] : [], ...(m.password ? { secrets: [m.password] } : {}) });
  }
  removeMailbox(address: string) { return this.remove(address); }
  setForward(address: string, destinations: string[]) {
    return this.upsert({ type: "list", name: "fwd" + address.replace(/[^a-z0-9.@_-]/gi, "_"), emails: [address], externalMembers: destinations });
  }
  removeForward(address: string) { return this.remove("fwd" + address.replace(/[^a-z0-9.@_-]/gi, "_")); }
  async send(m: OutgoingMail): Promise<SendResult> {
    const t = await transport();
    const info = await t.sendMail({ envelope: { from: m.envelopeFrom, to: m.recipients }, raw: m.raw, dkim: { domainName: m.domain, keySelector: m.dkim.selector, privateKey: m.dkim.privateKey } } as never) as { accepted?: unknown[]; rejected?: unknown[]; response?: string };
    return { accepted: (info.accepted ?? []).map(String), rejected: (info.rejected ?? []).map(String), response: info.response ?? "" };
  }
  async usage(addresses: string[]) {
    const out: Record<string, number> = {};
    for (const a of addresses) {
      const r = await this.req("GET", "/principal/" + encodeURIComponent(a), undefined, [404]);
      const used = (r.data as { usedQuota?: number } | undefined)?.usedQuota;
      if (typeof used === "number") out[a] = Math.round((used / 1024 / 1024) * 10) / 10;
    }
    return out;
  }
}

type Transport = { sendMail: (m: unknown) => Promise<unknown> };
let smtp: Promise<Transport> | null = null;
/** submission relay on Stalwart for API-sent mail (a system login allowed to send for every customer domain) */
const transport = () => (smtp ??= import("nodemailer").then((n) => n.createTransport({
  host: process.env.MAIL_SMTP_HOST, port: Number(process.env.MAIL_SMTP_PORT || 587), secure: Number(process.env.MAIL_SMTP_PORT) === 465,
  auth: process.env.MAIL_SMTP_USER ? { user: process.env.MAIL_SMTP_USER, pass: process.env.MAIL_SMTP_PASS } : undefined,
  pool: true, maxConnections: 4,
}) as unknown as Transport));

let cached: MailDriver | null = null;
export const mailDriver = (): MailDriver => (cached ??= process.env.STALWART_URL ? new StalwartMail() : new SimMail());
export const resetMailDriver = () => { cached = null; };

/** public host names customers point their records and clients at */
export const mailHosts = () => ({
  mx: process.env.MAIL_MX_HOST || "mx.gereh.net",
  spf: process.env.MAIL_SPF_INCLUDE || "_spf.gereh.net",
  returnPath: process.env.MAIL_RETURN_HOST || "return.gereh.net",
  imap: process.env.MAIL_IMAP_HOST || "mail.gereh.net",
  smtp: process.env.MAIL_SUBMIT_HOST || "smtp.gereh.net",
});
