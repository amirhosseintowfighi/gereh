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

/** where a customer's notifications also go: a Telegram or Bale chat (linked through the bot) or a signed webhook */
export const notifyChannels = pgTable("notify_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["telegram", "bale", "webhook"] }).notNull(),
  /** chat id, or the webhook URL */
  target: text("target").notNull(),
  label: text("label").notNull().default(""),
  /** webhooks: HMAC key, sealed (secrets.ts) */
  secretEnc: text("secret_enc"),
  /** notification kinds delivered: billing, service, security, news */
  events: jsonb("events").$type<string[]>().notNull().default(["billing", "service", "security"]),
  active: boolean("active").notNull().default(true),
  lastStatus: text("last_status").notNull().default(""),
  lastAt: ts("last_at"),
  createdAt: created(),
}, (t) => [index("notify_channel_user_ix").on(t.userId)]);

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

/** public status page: incidents with timestamped updates */
export const incidents = pgTable("incidents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  severity: text("severity", { enum: ["minor", "major", "critical", "maintenance"] }).notNull(),
  status: text("status", { enum: ["investigating", "identified", "monitoring", "resolved", "scheduled"] }).notNull(),
  components: text("components").array().notNull(),
  createdAt: created(),
  resolvedAt: ts("resolved_at"),
});
export const incidentUpdates = pgTable("incident_updates", {
  id: serial("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  text: text("text").notNull(),
  createdAt: created(),
});

/** shared accounts: members work in the owner's panel with a limited role */
export const teamMembers = pgTable("team_members", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "tech", "billing"] }).notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("team_pair_uq").on(t.ownerId, t.memberId), index("team_member_ix").on(t.memberId)]);
export const teamInvites = pgTable("team_invites", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "tech", "billing"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("invite_token_uq").on(t.tokenHash)]);

/** live chat from the site widget: visitors hold a random token (only its hash is stored) */
export const chats = pgTable("chats", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  /** staff member who answered last (shown to the visitor) */
  agent: text("agent"),
  unread: boolean("unread").notNull().default(true),
  page: text("page").notNull().default(""),
  ip: text("ip").notNull().default(""),
  lastAt: ts("last_at").notNull().defaultNow(),
  createdAt: created(),
}, (t) => [uniqueIndex("chat_token_uq").on(t.tokenHash), index("chat_status_ix").on(t.status, t.lastAt)]);
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  from: text("from", { enum: ["visitor", "staff", "system"] }).notNull(),
  author: text("author").notNull().default(""),
  text: text("text").notNull(),
  createdAt: created(),
}, (t) => [index("chat_msg_ix").on(t.chatId, t.id)]);

/** blog posts written by staff (Markdown subset) */
export const posts = pgTable("posts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  body: text("body").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  author: text("author").notNull(),
  publishedAt: ts("published_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  createdAt: created(),
}, (t) => [uniqueIndex("post_slug_uq").on(t.slug), index("post_pub_ix").on(t.status, t.publishedAt)]);

/** DevOps consultation requests from /devops (sales pipeline) */
export const devopsLeads = pgTable("devops_leads", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  website: text("website").notNull().default(""),
  size: text("size").notNull(),
  stage: text("stage").notNull(),
  infra: text("infra").array().notNull(),
  services: text("services").array().notNull(),
  pkg: text("pkg").notNull().default(""),
  budget: text("budget").notNull(),
  urgency: text("urgency").notNull(),
  needsNda: boolean("needs_nda").notNull().default(false),
  message: text("message").notNull(),
  /** pipeline */
  status: text("status", { enum: ["new", "contacted", "meeting", "proposal", "won", "lost"] }).notNull().default("new"),
  assignee: text("assignee").notNull().default(""),
  value: bigint("value", { mode: "number" }).notNull().default(0),
  notes: jsonb("notes").$type<{ at: string; by: string; text: string }[]>().notNull().default([]),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  source: text("source").notNull().default(""),
  ip: text("ip").notNull().default(""),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("devops_lead_status_ix").on(t.status, t.createdAt)]);

/** signed DevOps engagements, visible to the customer in /panel/devops */
export const devopsProjects = pgTable("devops_projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  leadId: text("lead_id").references(() => devopsLeads.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  plan: text("plan", { enum: ["startup", "growth", "enterprise", "project", "audit"] }).notNull(),
  status: text("status", { enum: ["planning", "active", "paused", "done"] }).notNull().default("planning"),
  services: text("services").array().notNull().default(sql`'{}'::text[]`),
  /** retainer fee per month (Toman, excl. VAT); 0 for fixed-price work */
  monthlyFee: bigint("monthly_fee", { mode: "number" }).notNull().default(0),
  hoursIncluded: integer("hours_included").notNull().default(0),
  hoursUsed: real("hours_used").notNull().default(0),
  engineer: text("engineer").notNull().default(""),
  milestones: jsonb("milestones").$type<{ id: string; title: string; due: string; done: boolean }[]>().notNull().default([]),
  /** progress notes the customer can read */
  updates: jsonb("updates").$type<{ at: string; by: string; text: string }[]>().notNull().default([]),
  nextBillAt: ts("next_bill_at"),
  startedAt: ts("started_at"),
  createdAt: created(),
}, (t) => [index("devops_project_user_ix").on(t.userId)]);

/* ---------- Gereh Apps (PaaS) ---------- */
/** sellable sizes for apps and managed databases (staff edit prices in /admin/paas) */
export const paasPlans = pgTable("paas_plans", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["app", "db"] }).notNull(),
  name: text("name").notNull(),
  cpu: real("cpu").notNull(),
  ramMb: integer("ram_mb").notNull(),
  diskGb: integer("disk_gb").notNull().default(0),
  price: bigint("price", { mode: "number" }).notNull(), // Toman per month, billed hourly
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const paasApps = pgTable("paas_apps", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  stack: text("stack").notNull(),
  source: text("source", { enum: ["git", "zip", "image", "compose"] }).notNull(),
  gitUrl: text("git_url").notNull().default(""),
  gitBranch: text("git_branch").notNull().default("main"),
  image: text("image").notNull().default(""),
  rootDir: text("root_dir").notNull().default(""),
  buildCommand: text("build_command").notNull().default(""),
  startCommand: text("start_command").notNull().default(""),
  port: integer("port").notNull(),
  healthPath: text("health_path").notNull().default("/"),
  planId: text("plan_id").notNull().references(() => paasPlans.id),
  instances: integer("instances").notNull().default(1),
  autoscale: boolean("autoscale").notNull().default(false),
  maxInstances: integer("max_instances").notNull().default(3),
  /** autoscaling target: average CPU % of the plan per instance */
  autoscaleCpu: integer("autoscale_cpu").notNull().default(70),
  diskGb: integer("disk_gb").notNull().default(0),
  diskMount: text("disk_mount").notNull().default("/data"),
  region: text("region").notNull().default("thr"),
  status: text("status", { enum: ["creating", "building", "running", "stopped", "failed", "suspended"] }).notNull().default("creating"),
  /** secret for the git push webhook */
  hookToken: text("hook_token").notNull(),
  autoDeploy: boolean("auto_deploy").notNull().default(true),
  /** edge cache in front of the app; bumping cacheVersion invalidates everything cached */
  cdn: boolean("cdn").notNull().default(false),
  cacheVersion: integer("cache_version").notNull().default(1),
  /** runs once per deployment, in a new container from the new image, before traffic switches (migrations) */
  releaseCommand: text("release_command").notNull().default(""),
  /** sum of worker process instances (billed like web instances) */
  workerInstances: integer("worker_instances").notNull().default(0),
  /** "wordpress" for managed WordPress sites (same platform, own panel) */
  product: text("product", { enum: ["app", "wordpress"] }).notNull().default("app"),
  /** managed WordPress package (eco, turbo) */
  wpPlan: text("wp_plan"),
  /** pushes to other branches get a preview at <name>-preview.<apps domain> */
  previews: boolean("previews").notNull().default(false),
  /** the running preview (one per app), billed as one extra instance */
  previewDeployment: text("preview_deployment"),
  liveDeployment: text("live_deployment"),
  suspendedAt: ts("suspended_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_app_name_uq").on(t.name), index("paas_app_user_ix").on(t.userId)]);

export const paasEnv = pgTable("paas_env", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  /** AES-GCM sealed (secrets.ts) */
  valueEnc: text("value_enc").notNull(),
  secret: boolean("secret").notNull().default(false),
  /** set by the platform (e.g. DATABASE_URL from an attached database) */
  managedBy: text("managed_by"),
}, (t) => [uniqueIndex("paas_env_uq").on(t.appId, t.key)]);

export const paasDeployments = pgTable("paas_deployments", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "building", "deploying", "live", "failed", "superseded", "cancelled"] }).notNull().default("queued"),
  trigger: text("trigger", { enum: ["create", "manual", "git", "cli", "api", "rollback", "config", "promote"] }).notNull(),
  /** previews run beside production on their own host and never touch its data or release command */
  target: text("target", { enum: ["production", "preview"] }).notNull().default("production"),
  /** git branch built (empty: the app's branch) */
  branch: text("branch").notNull().default(""),
  /** vulnerability scan of the built image (Trivy): "", running, done, failed */
  scanStatus: text("scan_status").notNull().default(""),
  scanCritical: integer("scan_critical").notNull().default(0),
  scanHigh: integer("scan_high").notNull().default(0),
  scanReport: text("scan_report").notNull().default(""),
  /** commit sha, uploaded file name or image tag */
  ref: text("ref").notNull().default(""),
  message: text("message").notNull().default(""),
  /** artifact to roll back to: built image reference */
  image: text("image").notNull().default(""),
  uploadPath: text("upload_path"),
  log: text("log").notNull().default(""),
  createdAt: created(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
}, (t) => [index("paas_dep_app_ix").on(t.appId, t.createdAt)]);

export const paasDomains = pgTable("paas_domains", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  status: text("status", { enum: ["pending", "active", "failed"] }).notNull().default("pending"),
  ssl: text("ssl", { enum: ["pending", "issued", "failed"] }).notNull().default("pending"),
  checkedAt: ts("checked_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_domain_uq").on(t.host)]);

export const paasDbs = pgTable("paas_dbs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  engine: text("engine", { enum: ["postgres", "mysql", "mariadb", "mongodb", "redis"] }).notNull(),
  version: text("version").notNull(),
  planId: text("plan_id").notNull().references(() => paasPlans.id),
  status: text("status", { enum: ["creating", "running", "stopped", "failed", "suspended"] }).notNull().default("creating"),
  host: text("host").notNull().default(""),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  dbName: text("db_name").notNull(),
  publicAccess: boolean("public_access").notNull().default(false),
  publicPort: integer("public_port"),
  backups: boolean("backups").notNull().default(true),
  /** PostgreSQL point-in-time recovery: continuous WAL archiving with WAL-G */
  pitr: boolean("pitr").notNull().default(false),
  /** created as a point-in-time copy of another database */
  restoreFrom: text("restore_from"),
  restoreTime: ts("restore_time"),
  suspendedAt: ts("suspended_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_db_name_uq").on(t.userId, t.name), index("paas_db_user_ix").on(t.userId)]);

export const paasDbBackups = pgTable("paas_db_backups", {
  id: text("id").primaryKey(),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["auto", "manual"] }).notNull(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
  sizeMb: real("size_mb").notNull().default(0),
  location: text("location").notNull().default(""),
  /** weekly restore test into a throwaway server: null = not tested yet */
  verified: boolean("verified"),
  verifyDetail: text("verify_detail").notNull().default(""),
  verifiedAt: ts("verified_at"),
  createdAt: created(),
}, (t) => [index("paas_backup_db_ix").on(t.dbId, t.createdAt)]);

/** background processes of an app (queue workers, bots…): same image, own command, no HTTP */
export const paasProcesses = pgTable("paas_processes", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  command: text("command").notNull(),
  instances: integer("instances").notNull().default(1),
}, (t) => [uniqueIndex("paas_process_uq").on(t.appId, t.name)]);

/** scheduled commands (Kubernetes CronJobs) run from the app's live image */
export const paasCrons = pgTable("paas_crons", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(), // 5-field cron, Tehran time
  command: text("command").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_cron_uq").on(t.appId, t.name)]);

/** one-off containers: release commands, commands run from the panel/CLI/agents */
export const paasJobs = pgTable("paas_jobs", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["release", "run", "import"] }).notNull(),
  command: text("command").notNull(),
  status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull().default("running"),
  output: text("output").notNull().default(""),
  deploymentId: text("deployment_id"),
  /** import jobs: the uploaded archive */
  sourcePath: text("source_path"),
  createdAt: created(),
  finishedAt: ts("finished_at"),
}, (t) => [index("paas_job_app_ix").on(t.appId, t.createdAt)]);

/** which database is wired into which app (its URL is injected as an env var) */
export const paasLinks = pgTable("paas_links", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  envKey: text("env_key").notNull(),
}, (t) => [uniqueIndex("paas_link_uq").on(t.appId, t.dbId)]);

/** 5-minute samples for app and database charts (kept 8 days) */
export const paasMetrics = pgTable("paas_metrics", {
  id: serial("id").primaryKey(),
  target: text("target").notNull(), // app or database id
  cpu: real("cpu").notNull(), // % of the plan
  ramMb: real("ram_mb").notNull(),
  rpm: real("rpm").notNull().default(0), // requests per minute (apps)
  createdAt: created(),
}, (t) => [index("paas_metric_ix").on(t.target, t.createdAt)]);

/* ---------- Inquiry API (استعلام) ---------- */
/** the sellable catalog; definitions (inputs, sample output) live in src/lib/inquiry.ts */
export const inquiryServices = pgTable("inquiry_services", {
  id: text("id").primaryKey(), // technical id used in the API path, e.g. identity_v2
  name: text("name").notNull(),
  price: money("price").notNull(), // Toman per billable request
  active: boolean("active").notNull().default(true),
  /** customers must request access and staff approve (personal-data services) */
  approval: boolean("approval").notNull().default(false),
  /** path at the upstream provider; empty = same as id */
  upstream: text("upstream").notNull().default(""),
  position: integer("position").notNull().default(0),
});

export const inquiryAccounts = pgTable("inquiry_accounts", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  accountNo: integer("account_no").notNull(),
  apiKey: text("api_key").notNull(),
  secretEnc: text("secret_enc").notNull(),
  secretHash: text("secret_hash").notNull(),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  ipAllow: jsonb("ip_allow").$type<string[]>().notNull().default([]),
  createdAt: created(),
}, (t) => [uniqueIndex("inquiry_key_uq").on(t.apiKey), uniqueIndex("inquiry_acct_uq").on(t.accountNo)]);

export const inquiryGrants = pgTable("inquiry_grants", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceId: text("service_id").notNull().references(() => inquiryServices.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  useCase: text("use_case").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: created(),
  decidedAt: ts("decided_at"),
}, (t) => [uniqueIndex("inquiry_grant_uq").on(t.userId, t.serviceId)]);

export const inquiryCalls = pgTable("inquiry_calls", {
  id: text("id").primaryKey(), // tracking id returned to the caller
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceId: text("service_id").notNull(),
  status: text("status", { enum: ["success", "not_found", "invalid", "error", "denied"] }).notNull(),
  charged: money("charged").notNull().default(0),
  billed: boolean("billed").notNull().default(false),
  latencyMs: integer("latency_ms").notNull().default(0),
  sandbox: boolean("sandbox").notNull().default(false),
  source: text("source", { enum: ["api", "panel"] }).notNull().default("api"),
  /** masked inputs only (last digits); full personal data is never stored */
  input: text("input").notNull().default(""),
  ip: text("ip").notNull().default(""),
  createdAt: created(),
}, (t) => [index("inquiry_call_user_ix").on(t.userId, t.createdAt), index("inquiry_call_bill_ix").on(t.billed)]);

/* ---------- Geo DNS (دسترسی دوطرفه) ---------- */
export const geoPlans = pgTable("geo_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: money("price").notNull(), // Toman per month, billed monthly from the wallet
  records: integer("records").notNull(), // max records per zone
  healthChecks: boolean("health_checks").notNull().default(false), // automatic failover
  sync: text("sync", { enum: ["none", "files", "full"] }).notNull().default("none"), // managed mirror sync
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const geoZones = pgTable("geo_zones", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  planId: text("plan_id").notNull(),
  /** pending: nameservers not delegated yet; suspended: unpaid (served without geo rules) */
  status: text("status", { enum: ["pending", "active", "suspended"] }).notNull().default("pending"),
  nsOk: boolean("ns_ok").notNull().default(false),
  nsSeen: jsonb("ns_seen").$type<string[]>().notNull().default([]),
  nsCheckedAt: ts("ns_checked_at"),
  /** path PowerDNS requests over HTTPS on each server to decide whether it is up */
  healthPath: text("health_path").notNull().default("/"),
  /** managed mirror sync, run by Gereh's team; their agent reports through /api/geo/sync */
  syncStatus: text("sync_status", { enum: ["none", "setup", "ok", "lagging", "failed"] }).notNull().default("none"),
  syncLagSec: integer("sync_lag_sec"),
  lastSyncAt: ts("last_sync_at"),
  syncToken: text("sync_token").notNull(),
  paidUntil: ts("paid_until").notNull(),
  autoRenew: boolean("auto_renew").notNull().default(true),
  createdAt: created(),
}, (t) => [uniqueIndex("geo_zone_domain_uq").on(t.domain), index("geo_zone_user_ix").on(t.userId)]);

export const geoRecords = pgTable("geo_records", {
  id: serial("id").primaryKey(),
  zoneId: text("zone_id").notNull().references(() => geoZones.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "@", "www", "api"…
  type: text("type", { enum: ["A", "AAAA", "CNAME", "TXT", "MX"] }).notNull(),
  /** answer for visitors inside Iran */
  iran: text("iran").notNull(),
  /** answer for everyone else (search engine bots included); empty = same as iran */
  world: text("world").notNull().default(""),
  ttl: integer("ttl").notNull().default(60),
  priority: integer("priority"),
  iranUp: boolean("iran_up"),
  worldUp: boolean("world_up"),
  checkedAt: ts("checked_at"),
}, (t) => [index("geo_record_zone_ix").on(t.zoneId)]);

/* ---------------- AI API gateway (api.gereh.dev) ---------------- */
export const aiModels = pgTable("ai_models", {
  id: text("id").primaryKey(), // public model id customers send, e.g. claude-opus-5.5
  name: text("name").notNull(),
  vendor: text("vendor").notNull(),
  /** model id at the upstream provider; empty = same as id */
  upstream: text("upstream").notNull().default(""),
  /** Toman per 1M tokens */
  inPrice: money("in_price").notNull(),
  outPrice: money("out_price").notNull(),
  /** competitor reference (Toman per 1M) used by the pricing rule; 0 = unknown */
  refIn: money("ref_in").notNull().default(0),
  refOut: money("ref_out").notNull().default(0),
  context: integer("context").notNull().default(128000),
  vision: boolean("vision").notNull().default(false),
  tools: boolean("tools").notNull().default(true),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const aiKeys = pgTable("ai_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** sha256 of the full key; the key itself is shown once */
  hash: text("hash").notNull(),
  prefix: text("prefix").notNull(),
  /** empty = every active model */
  models: jsonb("models").$type<string[]>().notNull().default([]),
  dailyCap: money("daily_cap").notNull().default(0), // 0 = no cap
  monthlyCap: money("monthly_cap").notNull().default(0),
  rpm: integer("rpm").notNull().default(120),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  expiresAt: ts("expires_at"),
  lastUsedAt: ts("last_used_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("ai_key_hash_uq").on(t.hash), index("ai_key_user_ix").on(t.userId)]);

export const aiUsage = pgTable("ai_usage", {
  id: text("id").primaryKey(), // request id returned in x-gereh-request-id
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  keyId: text("key_id"),
  model: text("model").notNull(),
  /** API surface the customer used */
  format: text("format", { enum: ["openai", "responses", "anthropic", "gemini", "panel"] }).notNull(),
  stream: boolean("stream").notNull().default(false),
  status: text("status", { enum: ["success", "error", "denied", "cancelled"] }).notNull(),
  inTokens: integer("in_tokens").notNull().default(0),
  outTokens: integer("out_tokens").notNull().default(0),
  /** true when the upstream reported no usage and tokens were estimated */
  estimated: boolean("estimated").notNull().default(false),
  charged: money("charged").notNull().default(0),
  billed: boolean("billed").notNull().default(false),
  latencyMs: integer("latency_ms").notNull().default(0),
  error: text("error").notNull().default(""),
  createdAt: created(),
}, (t) => [index("ai_usage_user_ix").on(t.userId, t.createdAt), index("ai_usage_key_ix").on(t.keyId, t.createdAt), index("ai_usage_bill_ix").on(t.billed)]);
