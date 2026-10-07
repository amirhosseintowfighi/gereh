/* PostgreSQL schema (Drizzle). Money is integer Toman (bigint as JS number; safe below 2^53).
   Timestamps are timestamptz; the UI formats them in the Jalali calendar. Text ids keep the
   human-readable prefixes the panel shows (srv-…, INV-…, TK-…). */
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "number" });
const created = () => ts("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  company: text("company").notNull().default(""),
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  staffRole: text("staff_role", { enum: ["owner", "support", "finance", "sales", "viewer"] }),
  balance: money("balance").notNull().default(0),
  status: text("status").notNull().default("active"),
  kyc: text("kyc").notNull().default("none"),
  twofaSecret: text("twofa_secret"),
  notifPrefs: jsonb("notif_prefs").$type<Record<string, boolean>>().notNull().default({}),
  referralCode: text("referral_code").notNull(),
  referredBy: text("referred_by"),
  /** pay renewal invoices from the wallet automatically */
  autoPay: boolean("auto_pay").notNull().default(true),
  virtUid: integer("virt_uid"),
  createdAt: created(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), uniqueIndex("users_ref_uq").on(t.referralCode), index("users_phone_ix").on(t.phone)]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actingAs: text("acting_as").references(() => users.id, { onDelete: "set null" }), // staff impersonation target
  device: text("device").notNull().default(""),
  ip: text("ip").notNull().default(""),
  createdAt: created(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("sessions_user_ix").on(t.userId)]);

export const otpCodes = pgTable("otp_codes", {
  phone: text("phone").primaryKey(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: ts("reset_at").notNull(),
});

export const servers = pgTable("servers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  plan: text("plan").notNull(),
  cpu: integer("cpu").notNull(), ram: integer("ram").notNull(), disk: integer("disk").notNull(),
  loc: text("loc").notNull(), os: text("os").notNull(),
  ip: text("ip").notNull().default(""), ipv6: text("ipv6").notNull().default(""), rdns: text("rdns").notNull().default(""),
  status: text("status").notNull().default("running"),
  price: money("price").notNull(),
  billing: text("billing", { enum: ["monthly", "hourly"] }).notNull().default("monthly"),
  backups: boolean("backups").notNull().default(false),
  vpsid: integer("vpsid"),
  hostname: text("hostname").notNull(),
  boot: text("boot").notNull().default("cda"),
  iso: text("iso").notNull().default(""),
  rescue: boolean("rescue").notNull().default(false),
  bwLimit: integer("bw_limit").notNull().default(2000),
  vncHost: text("vnc_host").notNull().default(""), vncPort: integer("vnc_port").notNull().default(0), vncPassword: text("vnc_password").notNull().default(""),
  app: text("app").notNull().default(""),
  alerts: jsonb("alerts").$type<{ cpu: number; bw: number }>().notNull().default({ cpu: 0, bw: 0 }),
  paidUntil: ts("paid_until"),
  /** "<invoice>:<line>" that created it — makes provisioning idempotent */
  orderRef: text("order_ref"),
  suspendedAt: ts("suspended_at"),
  createdAt: created(),
}, (t) => [index("servers_user_ix").on(t.userId), uniqueIndex("servers_vpsid_uq").on(t.vpsid), uniqueIndex("servers_order_uq").on(t.orderRef)]);

export const firewallRules = pgTable("firewall_rules", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  proto: text("proto").notNull(), port: text("port").notNull(), source: text("source").notNull(),
  action: text("action", { enum: ["allow", "deny"] }).notNull(), note: text("note").notNull().default(""),
  position: serial("position"),
});

export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  name: text("name").notNull(), size: real("size").notNull(), createdAt: created(),
});

export const backups = pgTable("backups", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  size: real("size").notNull(), createdAt: created(),
});

export const serverTasks = pgTable("server_tasks", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  status: text("status", { enum: ["done", "running", "failed"] }).notNull().default("done"),
  progress: integer("progress").notNull().default(100),
  createdAt: created(),
}, (t) => [index("tasks_server_ix").on(t.serverId)]);

export const hosting = pgTable("hosting", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  domain: text("domain").notNull(), plan: text("plan").notNull(),
  diskUsed: real("disk_used").notNull().default(0), diskTotal: integer("disk_total").notNull(),
  bwUsed: integer("bw_used").notNull().default(0), bwTotal: integer("bw_total").notNull(),
  emails: integer("emails").notNull().default(0), dbs: integer("dbs").notNull().default(0),
  status: text("status").notNull().default("active"),
  expiresAt: ts("expires_at").notNull(),
  price: money("price").notNull(),
  panel: text("panel").notNull().default("cPanel"), server: text("server").notNull().default(""),
  username: text("username").notNull().default(""),
  autoRenew: boolean("auto_renew").notNull().default(true),
  orderRef: text("order_ref"),
  createdAt: created(),
}, (t) => [index("hosting_user_ix").on(t.userId), uniqueIndex("hosting_order_uq").on(t.orderRef)]);

export const domains = pgTable("domains", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  registeredAt: ts("registered_at").notNull(), expiresAt: ts("expires_at").notNull(),
  autoRenew: boolean("auto_renew").notNull().default(true), privacy: boolean("privacy").notNull().default(true), locked: boolean("locked").notNull().default(true),
  status: text("status").notNull().default("active"),
  ns: text("ns").array().notNull(),
  authCode: text("auth_code").notNull().default(""),
  orderRef: text("order_ref"),
}, (t) => [uniqueIndex("domains_name_uq").on(t.name), index("domains_user_ix").on(t.userId)]);

export const dnsRecords = pgTable("dns_records", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
  type: text("type").notNull(), name: text("name").notNull(), value: text("value").notNull(),
  ttl: integer("ttl").notNull().default(3600), priority: integer("priority"),
  position: serial("position"),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").notNull().default("unpaid"),
  /** what to activate/extend when paid: [{kind:"server"|"hosting"|"domain"|"order", ...}] */
  fulfil: jsonb("fulfil").$type<unknown[]>().notNull().default([]),
  coupon: text("coupon"),
  /** VAT % frozen at issue time */
  taxRate: integer("tax_rate").notNull().default(10),
  /** payer's legal details for an official (رسمی) invoice */
  official: jsonb("official").$type<{ name: string; nationalId: string; economicCode: string; address: string; postalCode: string } | null>(),
  createdAt: created(), dueAt: ts("due_at").notNull(), paidAt: ts("paid_at"),
}, (t) => [index("invoices_user_ix").on(t.userId)]);

export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: text("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  desc: text("desc").notNull(), amount: money("amount").notNull(),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  type: text("type", { enum: ["topup", "payment", "refund", "commission", "usage"] }).notNull(),
  amount: money("amount").notNull(), method: text("method").notNull(), desc: text("desc").notNull(),
  createdAt: created(),
}, (t) => [index("tx_user_ix").on(t.userId)]);

export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  invoiceId: text("invoice_id").references(() => invoices.id),
  amount: money("amount").notNull(), // Toman
  gateway: text("gateway").notNull(),
  authority: text("authority"),
  refId: text("ref_id"),
  status: text("status", { enum: ["pending", "paid", "failed"] }).notNull().default("pending"),
  createdAt: created(), verifiedAt: ts("verified_at"),
}, (t) => [uniqueIndex("payments_authority_uq").on(t.gateway, t.authority)]);

export const tickets = pgTable("tickets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  subject: text("subject").notNull(), dept: text("dept").notNull(), priority: text("priority").notNull(),
  status: text("status").notNull().default("open"),
  service: text("service").notNull().default(""), assignee: text("assignee").notNull().default(""),
  createdAt: created(), updatedAt: ts("updated_at").notNull().defaultNow(), firstResponseAt: ts("first_response_at"),
}, (t) => [index("tickets_user_ix").on(t.userId)]);

export const ticketMessages = pgTable("ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  from: text("from", { enum: ["user", "staff"] }).notNull(), name: text("name").notNull(), text: text("text").notNull(),
  createdAt: created(),
});

export const sshKeys = pgTable("ssh_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), fingerprint: text("fingerprint").notNull(), publicKey: text("public_key").notNull(),
  createdAt: created(),
});

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(), scope: text("scope").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: created(), lastUsedAt: ts("last_used_at"), expiresAt: ts("expires_at"),
}, (t) => [uniqueIndex("tokens_hash_uq").on(t.tokenHash)]);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  icon: text("icon").notNull(), text: text("text").notNull(), read: boolean("read").notNull().default(false),
  createdAt: created(),
}, (t) => [index("notif_user_ix").on(t.userId)]);

export const activity = pgTable("activity", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  icon: text("icon").notNull(), text: text("text").notNull(), ip: text("ip").notNull().default(""),
  createdAt: created(),
}, (t) => [index("activity_user_ix").on(t.userId)]);

export const nodes = pgTable("nodes", {
  id: text("id").primaryKey(),
  loc: text("loc").notNull(), model: text("model").notNull(),
  cpu: integer("cpu").notNull().default(0), ram: integer("ram").notNull().default(0), disk: integer("disk").notNull().default(0), vms: integer("vms").notNull().default(0),
  status: text("status").notNull().default("online"),
});

export const coupons = pgTable("coupons", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  type: text("type", { enum: ["percent", "fixed"] }).notNull(),
  value: money("value").notNull(), used: integer("used").notNull().default(0), limit: integer("limit").notNull().default(0),
  expiresAt: ts("expires_at"), active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("coupons_code_uq").on(t.code)]);

export const announcements = pgTable("announcements", {
  id: text("id").primaryKey(),
  title: text("title").notNull(), body: text("body").notNull(),
  level: text("level", { enum: ["info", "warning", "critical"] }).notNull(),
  createdAt: created(),
});

export const audit = pgTable("audit", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(), action: text("action").notNull(), target: text("target").notNull(), ip: text("ip").notNull().default(""),
  createdAt: created(),
});

/** singleton documents: "settings", "virt" */
export const kv = pgTable("kv", { key: text("key").primaryKey(), value: jsonb("value").notNull() });

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["cloud", "metal", "hosting"] }).notNull(),
  data: jsonb("data").notNull(), // catalog Plan
  position: integer("position").notNull(),
});

export const tlds = pgTable("tlds", {
  tld: text("tld").primaryKey(),
  reg: money("reg").notNull(), renew: money("renew").notNull(), transfer: money("transfer").notNull(),
  cat: text("cat").notNull(), hot: boolean("hot").notNull().default(false), promo: boolean("promo").notNull().default(false),
  position: integer("position").notNull(),
});

export const virtLog = pgTable("virt_log", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(), result: text("result").notNull(), detail: text("detail").notNull(),
  createdAt: created(),
});

export const planMap = pgTable("plan_map", {
  id: text("id").primaryKey(), name: text("name").notNull(), plid: integer("plid").notNull().default(0), group: text("group").notNull(),
});

export const osTemplates = pgTable("os_templates", {
  osid: integer("osid").primaryKey(), name: text("name").notNull(), distro: text("distro").notNull(), on: boolean("on").notNull().default(true),
});

export const isos = pgTable("isos", { filename: text("filename").primaryKey() });

export const inbox = pgTable("inbox", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), email: text("email").notNull(), dept: text("dept").notNull(), subject: text("subject").notNull(), message: text("message").notNull(),
  createdAt: created(),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  /** de-duplication key: a second enqueue with the same key is a no-op while the first is pending */
  dedupe: text("dedupe"),
  status: text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  runAt: ts("run_at").notNull().defaultNow(),
  lockedAt: ts("locked_at"),
  lastError: text("last_error"),
  createdAt: created(),
}, (t) => [index("jobs_due_ix").on(t.status, t.runAt), uniqueIndex("jobs_dedupe_uq").on(t.dedupe).where(sql`${t.status} in ('pending','running')`)]);

/** monotonically increasing counters for human ids (INV-14231, TK-3101…) */
export const counters = pgTable("counters", { name: text("name").primaryKey(), value: integer("value").notNull() });

/** periodic jobs: a worker claims a run by moving next_run_at forward atomically */
export const schedules = pgTable("schedules", { name: text("name").primaryKey(), nextRunAt: ts("next_run_at").notNull() });

/** latest hypervisor readings (5-minute samples, kept 8 days) */
export const usageSamples = pgTable("usage_samples", {
  id: serial("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  cpu: real("cpu").notNull(), ram: real("ram").notNull(), disk: real("disk").notNull(),
  netIn: real("net_in").notNull(), netOut: real("net_out").notNull(), bwUsed: real("bw_used").notNull(),
  createdAt: created(),
}, (t) => [index("usage_server_time_ix").on(t.serverId, t.createdAt)]);
