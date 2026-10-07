/* Shapes the UI renders. The server builds one ClientDB per session (src/server/state.ts):
   customers get only their own records, staff get everything. Dates arrive pre-formatted
   in the Jalali calendar (Asia/Tehran) because that is all the UI ever shows. */
import type { Plan, Sku, Tld } from "./catalog";

export type Status = string;
export type Role = "user" | "admin";
/** fine-grained staff permissions; "owner" implies all */
export type StaffRole = "owner" | "support" | "finance" | "sales" | "viewer";

export type User = { id: string; name: string; email: string; phone: string; company: string; balance: number; status: Status; kyc: Status; joined: string; services: number; role: Role; referralCode: string };
export type FwRule = { id: string; proto: string; port: string; source: string; action: "allow" | "deny"; note: string };
export type Task = { id: string; action: string; status: "done" | "running" | "failed"; at: string; progress: number };
export type Server = {
  id: string; userId: string; name: string; plan: string; cpu: number; ram: number; disk: number; loc: string; os: string; ip: string; ipv6: string; rdns: string;
  status: Status; created: string; price: number; backups: boolean; firewall: FwRule[];
  snapshots: { id: string; name: string; size: number; at: string }[]; backupsList: { id: string; at: string; size: number }[];
  vpsid: number; hostname: string; boot: string; iso: string; rescue: boolean; bwLimit: number; vnc: { host: string; port: number; password: string }; tasks: Task[];
  billing: "monthly" | "hourly"; app: string; alerts: { cpu: number; bw: number };
};
export type Hosting = { id: string; userId: string; domain: string; plan: string; diskUsed: number; diskTotal: number; bwUsed: number; bwTotal: number; emails: number; dbs: number; status: Status; expires: string; price: number; panel: string; server: string; autoRenew: boolean };
export type DnsRecord = { id: string; type: string; name: string; value: string; ttl: number; priority?: number };
export type Domain = { id: string; userId: string; name: string; registered: string; expires: string; autoRenew: boolean; privacy: boolean; locked: boolean; status: Status; ns: string[]; dns: DnsRecord[]; authCode: string };
export type Invoice = { id: string; userId: string; date: string; due: string; status: Status; items: { desc: string; amount: number }[]; tax: number; official: boolean };
export type Transaction = { id: string; userId: string; date: string; type: "topup" | "payment" | "refund" | "commission" | "usage"; amount: number; method: string; desc: string };
export type Message = { from: "user" | "staff"; name: string; at: string; text: string };
export type Ticket = { id: string; userId: string; subject: string; dept: string; priority: string; status: Status; service: string; updated: string; assignee: string; messages: Message[] };
export type Coupon = { id: string; code: string; type: "percent" | "fixed"; value: number; used: number; limit: number; expires: string; active: boolean };
export type Announcement = { id: string; title: string; body: string; level: "info" | "warning" | "critical"; at: string };
export type Node = { id: string; loc: string; cpu: number; ram: number; disk: number; vms: number; status: Status; model: string };
/** the cart keeps the SKU (what the server prices) plus a display copy of the price */
export type CartItem = { id: string; sku: Sku; title: string; meta?: string; base: number; icon?: string; ltr?: boolean };
/** userId is whose data the panel shows (differs from actorId while staff impersonate) */
export type Session = { userId: string; role: Role; name: string; actorId?: string; staffRole?: StaffRole };

export type Settings = {
  siteName: string; supportEmail: string; supportPhone: string; registration: boolean; maintenance: boolean; tax: number;
  gateways: Record<string, boolean>; smsProvider: string; smsKeySet: boolean; smtpHost: string; smtpPort: number;
  affiliateRate: number;
  /** label of the gateway that will actually take online payments ("" = none available) */
  payGateway?: string;
};

export type ClientDB = {
  users: User[]; servers: Server[]; hosting: Hosting[]; domains: Domain[]; invoices: Invoice[]; transactions: Transaction[]; tickets: Ticket[];
  sshKeys: { id: string; name: string; fingerprint: string; added: string }[];
  apiTokens: { id: string; name: string; scope: string; created: string; lastUsed: string; expires: string }[];
  sessions: { id: string; device: string; ip: string; place: string; last: string; current: boolean }[];
  notifPrefs: Record<string, boolean>;
  twofa: boolean;
  inbox: { id: string; at: string; name: string; email: string; dept: string; subject: string; message: string }[];
  notifications: { id: string; icon: string; text: string; at: string; read: boolean }[];
  activity: { id: string; icon: string; text: string; at: string; ip: string }[];
  nodes: Node[]; coupons: Coupon[]; announcements: Announcement[];
  audit: { id: string; actor: string; action: string; target: string; at: string; ip: string }[];
  staff: { id: string; name: string; email: string; role: string }[];
  settings: Settings;
  plans: Record<"cloud" | "metal" | "hosting", Plan[]>;
  tlds: Tld[];
  virt: Record<string, string | number | boolean>;
  virtLog: { id: string; at: string; kind: string; result: string; detail: string }[];
  planMap: { id: string; name: string; plid: number; group: string }[];
  osTemplates: { osid: number; name: string; distro: string; on: boolean }[];
  isos: string[];
};
