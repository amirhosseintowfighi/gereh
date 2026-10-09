/* Shapes the UI renders. The server builds one ClientDB per session (src/server/state.ts):
   customers get only their own records, staff get everything. Dates arrive pre-formatted
   in the Jalali calendar (Asia/Tehran) because that is all the UI ever shows. */
import type { Plan, Sku, Tld } from "./catalog";

export type Status = string;
export type Role = "user" | "admin";
/** fine-grained staff permissions; "owner" implies all */
export type StaffRole = "owner" | "support" | "finance" | "sales" | "viewer";

export type User = { id: string; name: string; email: string; phone: string; company: string; balance: number; status: Status; kyc: Status; joined: string; services: number; role: Role; referralCode: string; autoPay: boolean };
export type Official = { name: string; nationalId: string; economicCode: string; address: string; postalCode: string };
export type FwRule = { id: string; proto: string; port: string; source: string; action: "allow" | "deny"; note: string };
export type Task = { id: string; action: string; status: "done" | "running" | "failed"; at: string; progress: number };
export type Server = {
  id: string; userId: string; name: string; plan: string; cpu: number; ram: number; disk: number; loc: string; os: string; ip: string; ipv6: string; rdns: string;
  status: Status; created: string; price: number; backups: boolean; firewall: FwRule[];
  snapshots: { id: string; name: string; size: number; at: string }[]; backupsList: { id: string; at: string; size: number }[];
  vpsid: number; hostname: string; boot: string; iso: string; rescue: boolean; bwLimit: number; vnc: { host: string; port: number; password: string }; tasks: Task[];
  billing: "monthly" | "hourly"; app: string; alerts: { cpu: number; bw: number };
  /** recent 5-minute hypervisor samples, oldest first (customer view only) */
  usage: { at: string; cpu: number; ram: number; disk: number; netIn: number; netOut: number; bwUsed: number }[];
};
export type Hosting = { id: string; userId: string; domain: string; plan: string; diskUsed: number; diskTotal: number; bwUsed: number; bwTotal: number; emails: number; dbs: number; status: Status; expires: string; price: number; panel: string; server: string; autoRenew: boolean };
export type DnsRecord = { id: string; type: string; name: string; value: string; ttl: number; priority?: number };
export type Domain = { id: string; userId: string; name: string; registered: string; expires: string; autoRenew: boolean; privacy: boolean; locked: boolean; status: Status; ns: string[]; dns: DnsRecord[]; authCode: string };
export type Invoice = { id: string; userId: string; date: string; due: string; status: Status; items: { desc: string; amount: number }[]; tax: number; official: Official | null; paidAt: string };
export type Transaction = { id: string; userId: string; date: string; type: "topup" | "payment" | "refund" | "commission" | "usage"; amount: number; method: string; desc: string };
export type Message = { from: "user" | "staff"; name: string; at: string; text: string };
export type Ticket = { id: string; userId: string; subject: string; dept: string; priority: string; status: Status; service: string; updated: string; assignee: string; messages: Message[] };
export type Coupon = { id: string; code: string; type: "percent" | "fixed"; value: number; used: number; limit: number; expires: string; active: boolean };
export type Announcement = { id: string; title: string; body: string; level: "info" | "warning" | "critical"; at: string };
export type Node = { id: string; loc: string; cpu: number; ram: number; disk: number; vms: number; status: Status; model: string };
/** the cart keeps the SKU (what the server prices) plus a display copy of the price */
export type Incident = { id: string; title: string; severity: "minor" | "major" | "critical" | "maintenance"; status: "investigating" | "identified" | "monitoring" | "resolved" | "scheduled"; components: string[]; at: string; resolvedAt: string; updates: { status: string; text: string; at: string }[] };
export type ChatMsg = { id: number; from: "visitor" | "staff" | "system"; author: string; text: string; at: string };
export type ChatThread = { id: string; name: string; email: string; userId: string | null; status: "open" | "closed"; unread: boolean; agent: string | null; page: string; at: string; lastAt: string; messages: ChatMsg[] };
export type Post = { id: string; slug: string; title: string; excerpt: string; body: string; tags: string[]; status: "draft" | "published"; author: string; publishedAt: string; updatedAt: string };
export type DevopsLead = { id: string; name: string; company: string; role: string; email: string; phone: string; website: string; size: string; stage: string; infra: string[]; services: string[]; pkg: string; budget: string; urgency: string; needsNda: boolean; message: string; status: "new" | "contacted" | "meeting" | "proposal" | "won" | "lost"; assignee: string; value: number; notes: { at: string; by: string; text: string }[]; userId: string | null; source: string; at: string; updatedAt: string };
export type DevopsProject = { id: string; userId: string; leadId: string | null; title: string; plan: "startup" | "growth" | "enterprise" | "project" | "audit"; status: "planning" | "active" | "paused" | "done"; services: string[]; monthlyFee: number; hoursIncluded: number; hoursUsed: number; engineer: string; milestones: { id: string; title: string; due: string; done: boolean }[]; updates: { at: string; by: string; text: string }[]; nextBill: string; started: string };
export type PaasMetric = { at: string; cpu: number; ramMb: number; rpm: number };
export type PaasApp = {
  id: string; userId: string; name: string; stack: string; source: "git" | "zip" | "image" | "compose"; gitUrl: string; gitBranch: string; image: string; rootDir: string;
  buildCommand: string; startCommand: string; port: number; healthPath: string; planId: string; instances: number; autoscale: boolean; maxInstances: number; diskGb: number; diskMount: string;
  status: "creating" | "building" | "running" | "stopped" | "failed" | "suspended"; url: string; hookUrl: string; autoDeploy: boolean; cdn: boolean; liveDeployment: string | null; at: string; hourly: number;
  deployments: { id: string; status: string; trigger: string; ref: string; message: string; at: string; seconds: number | null; image: boolean }[];
  domains: { id: string; host: string; status: "pending" | "active" | "failed"; ssl: string }[];
  /** value is null for secrets (and for staff, who never see values) */
  env: { key: string; value: string | null; secret: boolean }[];
  links: { dbId: string; envKey: string }[];
  metrics: PaasMetric[];
};
export type PaasDb = {
  id: string; userId: string; name: string; engine: string; version: string; planId: string; status: "creating" | "running" | "stopped" | "failed" | "suspended";
  host: string; port: number; username: string; dbName: string; publicAccess: boolean; publicPort: number | null; backups: boolean; at: string; hourly: number;
  backupList: { id: string; kind: "auto" | "manual"; status: string; sizeMb: number; at: string }[];
  links: { appId: string; appName: string; envKey: string }[];
  metrics: PaasMetric[];
};
export type InquiryAccess = "open" | "none" | "pending" | "approved" | "rejected";
export type InquiryState = {
  services: { id: string; name: string; price: number; active: boolean; approval: boolean; upstream: string; access: InquiryAccess; note: string }[];
  /** the customer's API account (no secret: revealed on demand) */
  account: { accountNo: number; apiKey: string; status: "active" | "suspended"; ipAllow: string[]; since: string } | null;
  calls: { id: string; userId: string; serviceId: string; status: string; charged: number; latencyMs: number; sandbox: boolean; source: string; input: string; at: string }[];
  stats: { todayCount: number; todaySpend: number; monthCount: number; monthSpend: number; daily: { day: string; count: number; spend: number }[] };
  /** staff only */
  grants: { id: number; userId: string; userName: string; serviceId: string; status: "pending" | "approved" | "rejected"; useCase: string; note: string; at: string }[];
  accounts: { userId: string; name: string; email: string; accountNo: number; status: "active" | "suspended"; calls30: number; spend30: number }[];
  provider: string;
};
export type AiModelRow = { id: string; name: string; vendor: string; inPrice: number; outPrice: number; context: number; vision: boolean; active: boolean; refIn: number; refOut: number; upstream: string };
export type AiKeyRow = { id: string; name: string; prefix: string; models: string[]; dailyCap: number; monthlyCap: number; rpm: number; status: "active" | "revoked"; expires: string; lastUsed: string; created: string; spentToday: number; spentMonth: number };
export type AiState = {
  models: AiModelRow[]; keys: AiKeyRow[];
  usage: { id: string; userId: string; keyName: string; model: string; format: string; stream: boolean; status: string; inTokens: number; outTokens: number; charged: number; estimated: boolean; latencyMs: number; error: string; at: string }[];
  stats: { todayCount: number; todaySpend: number; monthCount: number; monthSpend: number; daily: { day: string; count: number; spend: number }[]; byModel: { model: string; count: number; spend: number }[] };
  /** public base URL of the gateway, e.g. https://api.gereh.dev */
  endpoint: string;
  /** staff only: upstream driver name */
  upstream: string;
};
export type GeoRecord = { id: number; name: string; type: "A" | "AAAA" | "CNAME" | "TXT" | "MX"; iran: string; world: string; ttl: number; priority: number | null; iranUp: boolean | null; worldUp: boolean | null; checked: string };
export type GeoZone = {
  id: string; userId: string; domain: string; planId: string; status: "pending" | "active" | "suspended"; nsOk: boolean; nsSeen: string[]; nsChecked: string;
  healthPath: string; syncStatus: "none" | "setup" | "ok" | "lagging" | "failed"; syncLagSec: number | null; lastSync: string; paidUntil: string; autoRenew: boolean; at: string;
  records: GeoRecord[]; /** staff only: token for the sync agent */ syncToken: string;
};
export type GeoState = { plans: { id: string; name: string; price: number; records: number; healthChecks: boolean; sync: "none" | "files" | "full"; active: boolean }[]; zones: GeoZone[]; nameservers: string[]; driver: string };
export type PaasPlanRow = { id: string; kind: "app" | "db"; name: string; cpu: number; ramMb: number; diskGb: number; price: number; active: boolean };
export type CartItem = { id: string; sku: Sku; title: string; meta?: string; base: number; icon?: string; ltr?: boolean };
/** userId is whose data the panel shows (differs from actorId while staff impersonate) */
export type TeamRole = "admin" | "tech" | "billing";
export type Session = { userId: string; role: Role; name: string; actorId?: string; staffRole?: StaffRole; teamRole?: TeamRole };

export type Settings = {
  siteName: string; supportEmail: string; supportPhone: string; registration: boolean; maintenance: boolean; tax: number;
  gateways: Record<string, boolean>; smsProvider: string; smsKeySet: boolean; smtpHost: string; smtpPort: number;
  affiliateRate: number;
  /** seller details printed on official invoices */
  legalName: string; sellerNationalId: string; sellerEconomicCode: string; sellerAddress: string; sellerPostalCode: string;
  /** domain for default app URLs (<app>.<paasDomain>); must not be a subdomain of the main site */
  paasDomain: string;
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
  incidents: Incident[];
  /** live chats (staff only): open ones plus the latest closed */
  chats: ChatThread[];
  /** blog posts incl. drafts (staff only) */
  posts: Post[];
  /** DevOps: sales pipeline (staff) and engagements (customer: own; staff: all) */
  devopsLeads: DevopsLead[];
  devopsProjects: DevopsProject[];
  /** Gereh Apps (PaaS): own resources (staff: all, without env values) */
  paasApps: PaasApp[];
  paasDbs: PaasDb[];
  paasPlans: PaasPlanRow[];
  /** staff only: "kubernetes" or "simulator" */
  paasDriver: string;
  inquiry: InquiryState;
  ai: AiState;
  geo: GeoState;
  /** team: members of the owner's account (owner view) and accounts the user belongs to */
  team: { members: { id: string; name: string; email: string; role: TeamRole; since: string }[]; invites: { id: string; email: string; role: TeamRole; expires: string }[]; memberships: { ownerId: string; ownerName: string; role: TeamRole }[] };
  /** referral programme stats for the signed-in customer */
  affiliate: { code: string; referred: number; earned: number };
};
