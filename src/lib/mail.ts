/* Mail service (سرویس ایمیل): transactional sending (HTTP API + SMTP) and hosted mailboxes on one
   domain. Shared by the panel, the public page and the server. */

export type MailPlan = { id: string; name: string; price: number; dailyLimit: number; monthlyLimit: number; mailboxes: number; quotaMb: number; active: boolean };
export const MAIL_PLAN_DEFAULTS: MailPlan[] = [
  { id: "mail-start", name: "شروع", price: 290_000, dailyLimit: 500, monthlyLimit: 10_000, mailboxes: 5, quotaMb: 2048, active: true },
  { id: "mail-pro", name: "حرفه‌ای", price: 790_000, dailyLimit: 5_000, monthlyLimit: 100_000, mailboxes: 25, quotaMb: 10_240, active: true },
  { id: "mail-business", name: "سازمانی", price: 1_990_000, dailyLimit: 30_000, monthlyLimit: 600_000, mailboxes: 100, quotaMb: 25_600, active: true },
];

export type Tone = "green" | "blue" | "amber" | "red" | "gray";
export const MAIL_DOMAIN_STATUS: Record<string, [string, Tone]> = {
  pending: ["در انتظار تأیید DNS", "amber"], active: ["فعال", "green"], suspended: ["معلق", "red"],
};
export const MAIL_MSG_STATUS: Record<string, [string, Tone]> = {
  queued: ["در صف", "blue"], dev: ["حالت توسعه (ارسال نشد)", "gray"], sent: ["ارسال شد", "blue"], delivered: ["تحویل شد", "green"],
  bounced: ["برگشت خورد", "red"], failed: ["ناموفق", "red"], received: ["دریافت شد", "green"], spam: ["هرزنامه", "amber"], dropped: ["دور ریخته شد", "gray"], rejected: ["رد شد", "red"],
};
export const MAIL_EVENT_LABEL: Record<string, string> = {
  queued: "در صف ارسال", sent: "تحویل به سرور مقصد", delivered: "تحویل به صندوق گیرنده", bounced: "برگشت (bounce)", failed: "خطای ارسال",
  received: "دریافت", forwarded: "هدایت", dropped: "دور ریخته شد",
};
export const MAIL_RECORD_LABEL: Record<string, string> = { dkim: "DKIM", spf: "SPF", mx: "MX (دریافت)", returnPath: "Return-Path", dmarc: "DMARC" };

export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
export const MAX_RECIPIENTS = 50;
export const LOG_DAYS = 90;

export const EMAIL_ADDR_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
export const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;
export const TAG_RE = /^[\w.:-]{1,64}$/;

/** "Name <a@b.ir>" | "a@b.ir" → parts (address lower-cased); null when invalid */
export function parseAddress(s: string): { name: string; address: string } | null {
  const v = s.trim();
  const m = /^(?:"?([^"<>]*?)"?\s*)?<([^<>\s]+)>$/.exec(v);
  const address = (m ? m[2] : v).toLowerCase();
  if (!EMAIL_ADDR_RE.test(address)) return null;
  return { name: (m?.[1] ?? "").trim().slice(0, 100), address };
}
export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

export type Dmarc = { p: "none" | "quarantine" | "reject"; pct: number; rua: string; adkim: "r" | "s"; aspf: "r" | "s" };
export const DMARC_DEFAULT: Dmarc = { p: "none", pct: 100, rua: "", adkim: "r", aspf: "r" };
export const dmarcValue = (d: Dmarc) =>
  ["v=DMARC1", "p=" + d.p, ...(d.pct !== 100 ? ["pct=" + d.pct] : []), ...(d.rua ? ["rua=mailto:" + d.rua] : []), ...(d.adkim === "s" ? ["adkim=s"] : []), ...(d.aspf === "s" ? ["aspf=s"] : [])].join("; ");

export type MailHosts = { mx: string; spf: string; returnPath: string };
export type MailRecord = { key: "dkim" | "spf" | "mx" | "returnPath" | "dmarc"; type: "TXT" | "MX" | "CNAME"; name: string; value: string; priority?: number; required: boolean };

/** the DNS records a mail domain needs (names are fully qualified, without the trailing dot) */
export function mailRecords(d: { domain: string; dkimSelector: string; dkimPublic: string; returnPath: string; dmarc: Dmarc }, h: MailHosts): MailRecord[] {
  return [
    { key: "dkim", type: "TXT", name: d.dkimSelector + "._domainkey." + d.domain, value: "v=DKIM1; k=rsa; p=" + d.dkimPublic, required: true },
    { key: "spf", type: "TXT", name: d.domain, value: "v=spf1 include:" + h.spf + " ~all", required: true },
    { key: "returnPath", type: "CNAME", name: d.returnPath + "." + d.domain, value: h.returnPath, required: true },
    { key: "mx", type: "MX", name: d.domain, value: h.mx, priority: 10, required: false },
    { key: "dmarc", type: "TXT", name: "_dmarc." + d.domain, value: dmarcValue(d.dmarc), required: false },
  ];
}

/** start of the current day and month in Tehran (UTC+3:30, no DST) as UTC instants */
export function tehranPeriods(now = new Date()) {
  const off = 3.5 * 3600_000;
  const local = new Date(now.getTime() + off);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - off;
  return { day: new Date(day), month: new Date(month) };
}

/* ---------- shapes the panel reads (mail.* read RPCs) ---------- */
export type MailDomainSummary = { id: string; domain: string; planId: string; mode: "dev" | "live"; status: string; suspendReason: string; apiKeyPrefix: string; dkimSelector: string; returnPath: string; dmarc: Dmarc; catchAll: string; spamThreshold: number; dnsChecked: string; created: string };
export type MailOverview = { plans: MailPlan[]; domains: (MailDomainSummary & { mailboxes: number; smtp: number; usage: { today: number; month: number } })[]; hosts: { imap: string; smtp: string }; driver: string };
export type MailDomainDetail = MailDomainSummary & {
  plan: MailPlan | null; usage: { today: number; month: number }; gerehZone: string;
  records: (MailRecord & { ok: boolean; seen: string[] })[];
  smtp: { id: string; username: string; created: string }[];
  mailboxes: { id: string; local: string; address: string; name: string; quotaMb: number; usedMb: number; active: boolean; unread: number; created: string }[];
  aliases: { id: string; local: string; address: string; destinations: string[] }[];
  rules: { id: string; field: "from" | "to" | "subject"; op: "contains" | "equals" | "ends"; value: string; action: "forward" | "drop"; target: string }[];
  blocks: { id: string; pattern: string }[];
  hosts: { imap: string; smtp: string; mx: string }; apiUrl: string; simulator: boolean;
};
export type MailMsgRow = { id: string; status: string; source: string; from: string; to: string[]; subject: string; tag: string; size: number; read: boolean; spamScore: number | null; attachments: number; at: string };
export type MailMessageView = { id: string; direction: "out" | "in"; status: string; source: string; from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; tag: string; html: string; text: string; raw: string; size: number; attachments: { name: string; type: string; size: number }[]; messageId: string; spamScore: number | null; error: string; at: string; events: { id: number; type: string; recipient: string; detail: string; at: string }[] };
export type MailStats = { days: { date: string; sent: number; delivered: number; bounced: number; failed: number; received: number }[]; tags: { tag: string; total: number; delivered: number; bounced: number; failed: number; dev: number }[] };
export type MailAdminList = { plans: MailPlan[]; driver: string; domains: (MailDomainSummary & { userId: string; owner: string; email: string; mailboxes: number; smtp: number; sent30: number })[] };
export type MailSendInput = { from: string; to: string; cc?: string; bcc?: string; subject: string; html?: string; text?: string; tag?: string; listUnsubscribe?: string; attachments?: { filename: string; content: string; contentType?: string }[] };
