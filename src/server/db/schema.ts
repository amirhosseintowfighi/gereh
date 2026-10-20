/* PostgreSQL schema (Drizzle). Money is integer Toman (bigint as JS number; safe below 2^53).
   Timestamps are timestamptz; the UI formats them in the Jalali calendar. Text ids keep the
   human-readable prefixes the panel shows (srv-…, INV-…, TK-…). */
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  /** why delivery is stuck (shown to the customer and on Admin › undelivered orders); null once delivered */
  provisionError: text("provision_error"),
  /** staff ticket opened on the first provisioning failure */
  provisionTicket: text("provision_ticket"),
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
  /** answered by the CDN edge instead of the record's own address */
  proxied: boolean("proxied").notNull().default(false),
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
  /** Virtualizor virt type for this plan ("" = VIRTUALIZOR_VIRT, else kvm) */
  virt: text("virt").notNull().default(""),
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
  /** disk I/O as Virtualizor reports it (0029_vps_panel) */
  ioRead: real("io_read").notNull().default(0), ioWrite: real("io_write").notNull().default(0),
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
  /** app plans: builds per app per 24 hours (0 = unlimited) and the longest build allowed */
  deploysPerDay: integer("deploys_per_day").notNull().default(0),
  maxBuildMinutes: integer("max_build_minutes").notNull().default(30),
  /** app plans: days of application logs kept for search (7, 30 or 60) */
  logDays: integer("log_days").notNull().default(7),
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
  /** build without the layer cache (this deployment only) */
  noCache: boolean("no_cache").notNull().default(false),
  /** why a failed deployment failed (src/lib/paas-runtime.ts FAILURES): port, oom, start, deps, health, timeout */
  failure: text("failure").notNull().default(""),
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
  engine: text("engine", { enum: ["postgres", "mysql", "mariadb", "mongodb", "redis", "mssql", "elasticsearch", "rabbitmq", "clickhouse", "cassandra", "couchdb", "influxdb", "neo4j", "arangodb", "rethinkdb", "prometheus"] }).notNull(),
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
  /** what the model does; decides the endpoint and the price unit (see AI_KIND_PRICE) */
  kind: text("kind", { enum: ["chat", "embedding", "image", "tts", "stt", "rerank"] }).notNull().default("chat"),
  /** Toman per unit for kinds billed per unit: image (per image), stt (per minute), rerank (per 1000 searches) */
  unitPrice: money("unit_price").notNull().default(0),
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
  status: text("status", { enum: ["active", "disabled", "revoked"] }).notNull().default("active"),
  expiresAt: ts("expires_at"),
  lastUsedAt: ts("last_used_at"),
  createdAt: created(),
  /** allowed client IPs (exact or IPv4 CIDR); empty = any */
  ips: jsonb("ips").$type<string[]>().notNull().default([]),
  /** upstream routing preference sent as a header: "" | price | throughput | latency */
  routing: text("routing").notNull().default(""),
  projectId: text("project_id"),
}, (t) => [uniqueIndex("ai_key_hash_uq").on(t.hash), index("ai_key_user_ix").on(t.userId)]);

export const aiUsage = pgTable("ai_usage", {
  id: text("id").primaryKey(), // request id returned in x-gereh-request-id
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  keyId: text("key_id"),
  model: text("model").notNull(),
  /** API surface the customer used */
  format: text("format", { enum: ["openai", "responses", "anthropic", "gemini", "panel", "embeddings", "images", "speech", "transcription", "rerank", "kb"] }).notNull(),
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
  /** finish reason reported by the model (stop, length, tool_calls…) */
  finish: text("finish").notNull().default(""),
  /** non-token quantity billed: images, characters (tts), seconds (stt), searches (rerank) */
  units: real("units").notNull().default(0),
  projectId: text("project_id"),
}, (t) => [index("ai_usage_user_ix").on(t.userId, t.createdAt), index("ai_usage_key_ix").on(t.keyId, t.createdAt), index("ai_usage_bill_ix").on(t.billed), index("ai_usage_project_ix").on(t.projectId, t.createdAt)]);

/* ---------- Managed databases (DBaaS extras) ---------- */
/** per-database settings beyond the plan: tuning, extensions, firewall, replica set, seeding */
export const paasDbConfig = pgTable("paas_db_config", {
  dbId: text("db_id").primaryKey().references(() => paasDbs.id, { onDelete: "cascade" }),
  /** engine parameters (validated against src/lib/dbaas.ts DB_PARAMS) */
  params: jsonb("params").$type<Record<string, string>>().notNull().default({}),
  /** PostgreSQL extensions the customer switched on */
  extensions: jsonb("extensions").$type<string[]>().notNull().default([]),
  /** public access is limited to these IPv4 CIDRs; empty = anyone */
  allowlist: jsonb("allowlist").$type<string[]>().notNull().default([]),
  /** MongoDB: single-member replica set (transactions, change streams) */
  replicaSet: boolean("replica_set").notNull().default(false),
  /** PostgreSQL: runs the Gereh image with PostGIS and pgvector */
  extImage: boolean("ext_image").notNull().default(false),
  /** one-off restore of another database's backup once this one is ready */
  seed: jsonb("seed").$type<{ location: string; from: string; status: "pending" | "done" | "failed"; detail?: string } | null>(),
  /** engine-specific first-run setup (users, databases, replica set) is done */
  initialized: boolean("initialized").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** extra login users of a database, with read-only or read-write access per database */
export const paasDbUsers = pgTable("paas_db_users", {
  id: text("id").primaryKey(),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  grants: jsonb("grants").$type<{ db: string; access: "ro" | "rw" }[]>().notNull().default([]),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_db_user_uq").on(t.dbId, t.username)]);

/** extra databases (RabbitMQ: vhosts) inside one managed server */
export const paasDbDatabases = pgTable("paas_db_databases", {
  id: text("id").primaryKey(),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_db_database_uq").on(t.dbId, t.name)]);

/** temporary web admin panels (phpMyAdmin, pgAdmin…) behind basic auth; removed when they expire */
export const paasDbPanels = pgTable("paas_db_panels", {
  id: text("id").primaryKey(),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  tool: text("tool").notNull(),
  host: text("host").notNull(),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  status: text("status", { enum: ["ready", "failed", "expired"] }).notNull().default("ready"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
}, (t) => [index("paas_db_panel_ix").on(t.status, t.expiresAt), index("paas_db_panel_db_ix").on(t.dbId)]);

/** uploaded dumps loaded into a database */
export const paasDbImports = pgTable("paas_db_imports", {
  id: text("id").primaryKey(),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  filePath: text("file_path").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull().default("queued"),
  output: text("output").notNull().default(""),
  createdAt: created(),
  finishedAt: ts("finished_at"),
}, (t) => [index("paas_db_import_ix").on(t.dbId, t.createdAt)]);

/** what happened to a database (ready, restarts, users, imports…) for the panel's timeline */
export const paasDbEvents = pgTable("paas_db_events", {
  id: serial("id").primaryKey(),
  dbId: text("db_id").notNull().references(() => paasDbs.id, { onDelete: "cascade" }),
  level: text("level", { enum: ["info", "warn", "error"] }).notNull().default("info"),
  message: text("message").notNull(),
  createdAt: created(),
}, (t) => [index("paas_db_event_ix").on(t.dbId, t.createdAt)]);
/* ---------------- Object Storage (فضای ذخیره‌سازی ابری) ---------------- */
export const storagePlans = pgTable("storage_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sizeGb: integer("size_gb").notNull(),
  price: money("price").notNull(), // Toman per month, billed hourly from the wallet
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

/* ---------------- Mail service (سرویس ایمیل) ---------------- */
/** sending limits and mailbox allowances; one plan per mail domain, billed hourly from the wallet */
export const mailPlans = pgTable("mail_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  price: money("price").notNull(), // Toman per month
  dailyLimit: integer("daily_limit").notNull(), // outgoing recipients per day (Tehran time)
  monthlyLimit: integer("monthly_limit").notNull(),
  mailboxes: integer("mailboxes").notNull(),
  quotaMb: integer("quota_mb").notNull(), // largest quota one mailbox may have
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
});

export type StorageCorsRule = { origins: string[]; methods: string[]; headers: string[]; maxAge: number };
export type StorageLifecycle = { days: number; prefix: string };

export const storageBuckets = pgTable("storage_buckets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** the real bucket name on the S3 backend (globally unique) */
  name: text("name").notNull(),
  planId: text("plan_id").notNull(),
  access: text("access", { enum: ["private", "public"] }).notNull().default("private"),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  versioning: boolean("versioning").notNull().default(false),
  cors: jsonb("cors").$type<StorageCorsRule[]>().notNull().default([]),
  lifecycle: jsonb("lifecycle").$type<StorageLifecycle | null>(),
  usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
  objects: integer("objects").notNull().default(0),
  /** last cumulative request/traffic counters read from the backend (deltas go to storage_usage) */
  counters: jsonb("counters").$type<{ requests: number; bytesIn: number; bytesOut: number }>().notNull().default({ requests: 0, bytesIn: 0, bytesOut: 0 }),
  usageAt: ts("usage_at"),
  suspendedAt: ts("suspended_at"),
  /** "billing" (resumed automatically after a top-up) or "staff" (resumed by staff only) */
  suspendReason: text("suspend_reason", { enum: ["", "billing", "staff"] }).notNull().default(""),
  createdAt: created(),
}, (t) => [uniqueIndex("storage_bucket_name_uq").on(t.name), index("storage_bucket_user_ix").on(t.userId)]);

export const storageKeys = pgTable("storage_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  accessKey: text("access_key").notNull(),
  /** AES-GCM sealed (secrets.ts); shown to the customer once */
  secretEnc: text("secret_enc").notNull(),
  grants: jsonb("grants").$type<{ bucketId: string; perm: "read" | "write" }[]>().notNull().default([]),
  createdAt: created(),
  rotatedAt: ts("rotated_at"),
}, (t) => [uniqueIndex("storage_key_access_uq").on(t.accessKey), index("storage_key_user_ix").on(t.userId)]);

export const storageDomains = pgTable("storage_domains", {
  id: text("id").primaryKey(),
  bucketId: text("bucket_id").notNull().references(() => storageBuckets.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  status: text("status", { enum: ["pending", "active", "failed"] }).notNull().default("pending"),
  ssl: text("ssl", { enum: ["pending", "issued", "failed"] }).notNull().default("pending"),
  checkedAt: ts("checked_at"),
  createdAt: created(),
}, (t) => [uniqueIndex("storage_domain_uq").on(t.host), index("storage_domain_bucket_ix").on(t.bucketId)]);

/** one row per bucket per day (UTC date): peak size and request/traffic totals */
export const storageUsage = pgTable("storage_usage", {
  id: serial("id").primaryKey(),
  bucketId: text("bucket_id").notNull().references(() => storageBuckets.id, { onDelete: "cascade" }),
  day: text("day").notNull(), // YYYY-MM-DD
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  objects: integer("objects").notNull().default(0),
  requests: bigint("requests", { mode: "number" }).notNull().default(0),
  bytesIn: bigint("bytes_in", { mode: "number" }).notNull().default(0),
  bytesOut: bigint("bytes_out", { mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("storage_usage_uq").on(t.bucketId, t.day)]);
export type MailDmarc = { p: "none" | "quarantine" | "reject"; pct: number; rua: string; adkim: "r" | "s"; aspf: "r" | "s" };
export type MailDnsCheck = { ok: boolean; seen: string[]; at: string };

export const mailDomains = pgTable("mail_domains", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  planId: text("plan_id").notNull(),
  /** dev: accepted and logged, never delivered */
  mode: text("mode", { enum: ["dev", "live"] }).notNull().default("dev"),
  /** pending: DKIM/SPF/return-path not verified yet; suspended: no credit or by staff */
  status: text("status", { enum: ["pending", "active", "suspended"] }).notNull().default("pending"),
  suspendReason: text("suspend_reason", { enum: ["", "credit", "staff"] }).notNull().default(""),
  dkimSelector: text("dkim_selector").notNull(),
  dkimPublic: text("dkim_public").notNull(), // base64 SubjectPublicKeyInfo (the p= value)
  dkimPrivateEnc: text("dkim_private_enc").notNull(), // sealed PEM
  returnPath: text("return_path").notNull().default("bounces"), // label of the return-path CNAME
  dmarc: jsonb("dmarc").$type<MailDmarc>().notNull(),
  dnsStatus: jsonb("dns_status").$type<Record<string, MailDnsCheck>>().notNull().default({}),
  dnsCheckedAt: ts("dns_checked_at"),
  /** sha256 of the HTTP API key; the key is shown once */
  apiKeyHash: text("api_key_hash").notNull(),
  apiKeyPrefix: text("api_key_prefix").notNull(),
  catchAll: text("catch_all").notNull().default(""),
  spamThreshold: real("spam_threshold").notNull().default(5),
  createdAt: created(),
}, (t) => [uniqueIndex("mail_domain_uq").on(t.domain), uniqueIndex("mail_domain_key_uq").on(t.apiKeyHash), index("mail_domain_user_ix").on(t.userId)]);

export const mailSmtpUsers = pgTable("mail_smtp_users", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => mailDomains.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("mail_smtp_user_uq").on(t.username), index("mail_smtp_domain_ix").on(t.domainId)]);

export const mailMailboxes = pgTable("mail_mailboxes", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => mailDomains.id, { onDelete: "cascade" }),
  local: text("local").notNull(),
  name: text("name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  quotaMb: integer("quota_mb").notNull(),
  usedMb: real("used_mb").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
}, (t) => [uniqueIndex("mail_mailbox_uq").on(t.domainId, t.local)]);

/** alias (to local mailboxes) or forward (to outside addresses): local part → destinations */
export const mailAliases = pgTable("mail_aliases", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => mailDomains.id, { onDelete: "cascade" }),
  local: text("local").notNull(),
  destinations: jsonb("destinations").$type<string[]>().notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("mail_alias_uq").on(t.domainId, t.local)]);

/** inbound rules, applied in order before delivery: first match wins */
export const mailRules = pgTable("mail_rules", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => mailDomains.id, { onDelete: "cascade" }),
  field: text("field", { enum: ["from", "to", "subject"] }).notNull(),
  op: text("op", { enum: ["contains", "equals", "ends"] }).notNull(),
  value: text("value").notNull(),
  action: text("action", { enum: ["forward", "drop"] }).notNull(),
  target: text("target").notNull().default(""),
  position: serial("position"),
}, (t) => [index("mail_rule_domain_ix").on(t.domainId)]);

/** blocked senders: a full address or "@domain" */
export const mailBlocks = pgTable("mail_blocks", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => mailDomains.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("mail_block_uq").on(t.domainId, t.pattern)]);

export const mailMessages = pgTable("mail_messages", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => mailDomains.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  direction: text("direction", { enum: ["out", "in"] }).notNull(),
  /** out: queued → sent → delivered | bounced | failed (dev: logged, never sent); in: received | spam | dropped | rejected */
  status: text("status", { enum: ["queued", "dev", "sent", "delivered", "bounced", "failed", "received", "spam", "dropped", "rejected"] }).notNull(),
  source: text("source", { enum: ["api", "smtp", "console", "inbound"] }).notNull(),
  from: text("from").notNull(),
  to: jsonb("to").$type<string[]>().notNull(),
  cc: jsonb("cc").$type<string[]>().notNull().default([]),
  bcc: jsonb("bcc").$type<string[]>().notNull().default([]),
  /** counted against the plan's limits */
  recipients: integer("recipients").notNull().default(1),
  subject: text("subject").notNull().default(""),
  tag: text("tag").notNull().default(""),
  html: text("html").notNull().default(""),
  text: text("text").notNull().default(""),
  /** the full RFC 5322 message as sent or received */
  raw: text("raw").notNull().default(""),
  size: integer("size").notNull().default(0),
  attachments: jsonb("attachments").$type<{ name: string; type: string; size: number }[]>().notNull().default([]),
  messageId: text("message_id").notNull().default(""),
  mailboxId: text("mailbox_id"),
  spamScore: real("spam_score"),
  read: boolean("read").notNull().default(false),
  error: text("error").notNull().default(""),
  createdAt: created(),
}, (t) => [index("mail_msg_domain_ix").on(t.domainId, t.createdAt), index("mail_msg_status_ix").on(t.status), index("mail_msg_mid_ix").on(t.messageId)]);

export const mailEvents = pgTable("mail_events", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => mailMessages.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["queued", "sent", "delivered", "bounced", "failed", "received", "forwarded", "dropped"] }).notNull(),
  recipient: text("recipient").notNull().default(""),
  detail: text("detail").notNull().default(""),
  createdAt: created(),
}, (t) => [index("mail_event_msg_ix").on(t.messageId)]);

/* ---------- Gereh Apps: build and runtime options (0017_paas_runtime) ---------- */
/** per-app build hooks, health check, build and runtime options, budget and alerts (one row per app,
    created on first save; a missing row means the defaults in src/lib/paas-runtime.ts) */
export const paasRuntime = pgTable("paas_runtime", {
  appId: text("app_id").primaryKey().references(() => paasApps.id, { onDelete: "cascade" }),
  preBuild: text("pre_build").notNull().default(""),
  postBuild: text("post_build").notNull().default(""),
  preStart: text("pre_start").notNull().default(""),
  /** http (path from paas_apps.health_path), command (exit 0) or tcp (port open) */
  healthType: text("health_type", { enum: ["http", "command", "tcp"] }).notNull().default("http"),
  healthCommand: text("health_command").notNull().default(""),
  /** allowed HTTP status codes: "200-399" or a list like "200,204,301-302" */
  healthCodes: text("health_codes").notNull().default("200-399"),
  healthInterval: integer("health_interval").notNull().default(5),
  healthTimeout: integer("health_timeout").notNull().default(3),
  healthRetries: integer("health_retries").notNull().default(3),
  healthStartPeriod: integer("health_start_period").notNull().default(0),
  /** rolling update behind the readiness check; off = stop the old version first */
  zeroDowntime: boolean("zero_downtime").notNull().default(true),
  buildCache: boolean("build_cache").notNull().default(true),
  /** npm/pip/composer/Go installs through the Gereh package mirror */
  mirror: boolean("mirror").notNull().default(true),
  buildArgs: jsonb("build_args").$type<Record<string, string>>().notNull().default({}),
  dockerfile: text("dockerfile").notNull().default("Dockerfile"),
  timezone: text("timezone").notNull().default("Asia/Tehran"),
  readOnlyFs: boolean("read_only_fs").notNull().default(false),
  dnsServers: jsonb("dns_servers").$type<string[]>().notNull().default([]),
  nginxConf: text("nginx_conf").notNull().default(""),
  phpIni: text("php_ini").notNull().default(""),
  /** <name>.<apps domain> answers; off when only custom domains should */
  defaultDomain: boolean("default_domain").notNull().default(true),
  /** HTTP basic auth on a path prefix ("" = off); the htpasswd line is {SSHA} hashed */
  authPath: text("auth_path").notNull().default(""),
  authUser: text("auth_user").notNull().default(""),
  authHtpasswd: text("auth_htpasswd").notNull().default(""),
  /** monthly spend cap in Toman (0 = none), alert at this percent, optionally stop the app at the cap */
  budget: money("budget").notNull().default(0),
  budgetAlertPct: integer("budget_alert_pct").notNull().default(80),
  budgetStop: boolean("budget_stop").notNull().default(false),
  /** "<month>:alert" / "<month>:cap": what was already sent this month */
  budgetNotified: text("budget_notified").notNull().default(""),
  /** monthly request + response traffic alert in GB (0 = none) */
  trafficAlertGb: integer("traffic_alert_gb").notNull().default(0),
  trafficNotified: text("traffic_notified").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** what happened to an app: deploys, power actions, crashes, OOM kills, scaling, failed health checks */
export const paasEvents = pgTable("paas_events", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["deploy", "deploy_failed", "start", "stop", "restart", "crash", "oom", "scale", "health_failed", "budget", "traffic"] }).notNull(),
  message: text("message").notNull().default(""),
  createdAt: created(),
}, (t) => [index("paas_event_app_ix").on(t.appId, t.createdAt)]);

/** hourly charges per app, summed per Jalali month ("1405-07") for budgets */
export const paasSpend = pgTable("paas_spend", {
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  amount: money("amount").notNull().default(0),
}, (t) => [uniqueIndex("paas_spend_uq").on(t.appId, t.month)]);

/** request + response bytes through the ingress, per app and Tehran day ("2026-10-12") */
export const paasTraffic = pgTable("paas_traffic", {
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  bytes: money("bytes").notNull().default(0),
}, (t) => [uniqueIndex("paas_traffic_uq").on(t.appId, t.day)]);

/** a custom domain that redirects (301/302) instead of serving the app */
export const paasDomainRedirects = pgTable("paas_domain_redirects", {
  domainId: text("domain_id").primaryKey().references(() => paasDomains.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  code: integer("code").notNull().default(301),
  /** append the request path and query to the target */
  keepPath: boolean("keep_path").notNull().default(true),
});

/* ---------- Gereh Apps: operator tools (0021_paas_tools) ---------- */
/** named persistent disks of an app. paas_apps.disk_gb stays the total (billing) and disk_mount the
    "data" disk's path; an app with disk_gb > 0 and no rows here has one implicit "data" disk */
export const paasDisks = pgTable("paas_disks", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mountPath: text("mount_path").notNull(),
  sizeGb: integer("size_gb").notNull(),
  /** daily automatic backup (the last 3 are kept) */
  backups: boolean("backups").notNull().default(true),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_disk_uq").on(t.appId, t.name), uniqueIndex("paas_disk_mount_uq").on(t.appId, t.mountPath)]);

/** tar.gz snapshots of a disk in the platform backup bucket */
export const paasDiskBackups = pgTable("paas_disk_backups", {
  id: text("id").primaryKey(),
  diskId: text("disk_id").notNull().references(() => paasDisks.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["auto", "manual"] }).notNull(),
  status: text("status", { enum: ["running", "done", "failed", "restoring"] }).notNull().default("running"),
  sizeMb: real("size_mb").notNull().default(0),
  location: text("location").notNull().default(""),
  error: text("error").notNull().default(""),
  createdAt: created(),
}, (t) => [index("paas_disk_backup_ix").on(t.diskId, t.createdAt)]);

/** SFTP accounts, each confined to one disk; the password is sealed (shown again on request) */
export const paasSftpUsers = pgTable("paas_sftp_users", {
  id: text("id").primaryKey(),
  diskId: text("disk_id").notNull().references(() => paasDisks.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  access: text("access", { enum: ["ro", "rw"] }).notNull().default("rw"),
  createdAt: created(),
}, (t) => [uniqueIndex("paas_sftp_user_uq").on(t.username), index("paas_sftp_disk_ix").on(t.diskId)]);

/** per-app tool state: the SFTP NodePort and host key, and how far logs were collected */
export const paasAppTools = pgTable("paas_app_tools", {
  appId: text("app_id").primaryKey().references(() => paasApps.id, { onDelete: "cascade" }),
  sftpPort: integer("sftp_port"),
  /** sealed PEM; stable across restarts so clients keep trusting the host */
  sftpHostKey: text("sftp_host_key").notNull().default(""),
  logsCursor: ts("logs_cursor"),
});

/** application log lines, kept for the plan's log_days */
export const paasLogs = pgTable("paas_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  at: ts("at").notNull(),
  level: text("level", { enum: ["debug", "info", "warn", "error"] }).notNull().default("info"),
  instance: text("instance").notNull().default(""),
  line: text("line").notNull(),
}, (t) => [index("paas_log_app_ix").on(t.appId, t.at)]);

/** ingress bytes per app every 5 minutes (kept 8 days, like paas_metrics) */
export const paasNetSamples = pgTable("paas_net_samples", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  bytes: money("bytes").notNull().default(0),
  createdAt: created(),
}, (t) => [index("paas_net_ix").on(t.appId, t.createdAt)]);

/** hourly averages of paas_metrics plus traffic, for the 30-day charts (kept 31 days) */
export const paasMetricsHourly = pgTable("paas_metrics_hourly", {
  target: text("target").notNull(),
  hour: ts("hour").notNull(),
  cpu: real("cpu").notNull().default(0),
  ramMb: real("ram_mb").notNull().default(0),
  rpm: real("rpm").notNull().default(0),
  netBytes: money("net_bytes").notNull().default(0),
}, (t) => [uniqueIndex("paas_metric_hour_uq").on(t.target, t.hour)]);

/** web console sessions and one-off commands in a running instance (audit trail) */
export const paasConsoleSessions = pgTable("paas_console_sessions", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull().references(() => paasApps.id, { onDelete: "cascade" }),
  /** the person (team members included), not the account owner */
  userId: text("user_id").notNull(),
  kind: text("kind", { enum: ["shell", "run"] }).notNull(),
  instance: text("instance").notNull().default(""),
  command: text("command").notNull().default(""),
  exitCode: integer("exit_code"),
  /** run: the output tail */
  output: text("output").notNull().default(""),
  ip: text("ip").notNull().default(""),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
}, (t) => [index("paas_console_app_ix").on(t.appId, t.startedAt)]);

/* ---------------- AI plus: projects, settings, request bodies, web chat, knowledge bases ---------------- */
export const aiProjects = pgTable("ai_projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Toman per Tehran calendar month over all keys of the project; 0 = no limit */
  monthlyLimit: money("monthly_limit").notNull().default(0),
  createdAt: created(),
}, (t) => [index("ai_project_user_ix").on(t.userId)]);

export const aiSettings = pgTable("ai_settings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  /** days request logs are kept (30 or 60) */
  retentionDays: integer("retention_days").notNull().default(30),
  /** store prompts and answers with the logs (opt-in) */
  logBodies: boolean("log_bodies").notNull().default(false),
  /** notify when the wallet falls under this many Toman; 0 = off */
  lowBalance: money("low_balance").notNull().default(0),
  lowAlertedAt: ts("low_alerted_at"),
});

/** prompts and answers, only for customers who turned body logging on */
export const aiBodies = pgTable("ai_bodies", {
  id: text("id").primaryKey(), // = ai_usage.id
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  request: text("request").notNull().default(""),
  response: text("response").notNull().default(""),
  createdAt: created(),
}, (t) => [index("ai_body_user_ix").on(t.userId, t.createdAt)]);

export const aiChats = pgTable("ai_chats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  model: text("model").notNull(),
  system: text("system").notNull().default(""),
  temperature: real("temperature").notNull().default(0.7),
  kbId: text("kb_id"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("ai_chat_user_ix").on(t.userId, t.updatedAt)]);

export const aiChatMessages = pgTable("ai_chat_messages", {
  id: serial("id").primaryKey(),
  chatId: text("chat_id").notNull().references(() => aiChats.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  /** images as data URLs, text files inline */
  attachments: jsonb("attachments").$type<{ name: string; type: "image" | "text"; data: string }[]>().notNull().default([]),
  charged: money("charged").notNull().default(0),
  createdAt: created(),
}, (t) => [index("ai_chat_msg_chat_ix").on(t.chatId, t.id)]);

export const aiKbs = pgTable("ai_kbs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** embedding model used for every chunk and query of this base */
  model: text("model").notNull(),
  createdAt: created(),
}, (t) => [index("ai_kb_user_ix").on(t.userId)]);

export const aiKbDocs = pgTable("ai_kb_docs", {
  id: text("id").primaryKey(),
  kbId: text("kb_id").notNull().references(() => aiKbs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  chars: integer("chars").notNull().default(0),
  chunks: integer("chunks").notNull().default(0),
  charged: money("charged").notNull().default(0),
  createdAt: created(),
}, (t) => [index("ai_kb_doc_kb_ix").on(t.kbId)]);

/** chunk vectors as real[]; cosine runs in JS (src/server/ai/vectors.ts), so a pgvector column can replace it later */
export const aiKbChunks = pgTable("ai_kb_chunks", {
  id: serial("id").primaryKey(),
  kbId: text("kb_id").notNull().references(() => aiKbs.id, { onDelete: "cascade" }),
  docId: text("doc_id").notNull().references(() => aiKbDocs.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  text: text("text").notNull(),
  embedding: real("embedding").array().notNull(),
}, (t) => [index("ai_kb_chunk_kb_ix").on(t.kbId)]);

/* ---------------- domains, DNS and CDN: transfers, DNSSEC, WHOIS cache, CDN settings and rules, traffic alerts ---------------- */
export const domainTransfers = pgTable("domain_transfers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  direction: text("direction", { enum: ["in", "out"] }).notNull(),
  /** in: pending → processing → completed | rejected | cancelled | failed; out: auth_sent */
  status: text("status").notNull().default("pending"),
  authCode: text("auth_code").notNull().default(""),
  irnicHandle: text("irnic_handle").notNull().default(""),
  /** Toman taken from the wallet when requested; refunded on reject, cancel or failure */
  price: money("price").notNull().default(0),
  domainId: text("domain_id"),
  note: text("note").notNull().default(""),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("domain_transfer_user_ix").on(t.userId, t.createdAt), index("domain_transfer_status_ix").on(t.status)]);

/** per-domain extras the registrar row does not carry */
export const domainExtras = pgTable("domain_extras", {
  domainId: text("domain_id").primaryKey().references(() => domains.id, { onDelete: "cascade" }),
  dnssec: boolean("dnssec").notNull().default(false),
  /** DS records to publish at the registry, presentation format */
  ds: jsonb("ds").$type<string[]>().notNull().default([]),
  irnicHandle: text("irnic_handle").notNull().default(""),
});

/** registrant contact used for new registrations (IRNIC handle for .ir) */
export const domainContacts = pgTable("domain_contacts", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  irnicHandle: text("irnic_handle").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const whoisCache = pgTable("whois_cache", {
  domain: text("domain").primaryKey(),
  server: text("server").notNull(),
  body: text("body").notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
});

export const cdnSettings = pgTable("cdn_settings", {
  domainId: text("domain_id").primaryKey().references(() => domains.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** origin address; empty = the first proxied record at @ or www */
  originHost: text("origin_host").notNull().default(""),
  originHostHeader: text("origin_host_header").notNull().default(""),
  originHttps: boolean("origin_https").notNull().default(false),
  forceHttps: boolean("force_https").notNull().default(true),
  hstsMaxAge: integer("hsts_max_age").notNull().default(0),
  hstsSub: boolean("hsts_sub").notNull().default(false),
  hstsPreload: boolean("hsts_preload").notNull().default(false),
  minTls: text("min_tls").notNull().default("1.2"),
  /** seconds; 0 = keep the origin's Cache-Control */
  browserTtl: integer("browser_ttl").notNull().default(0),
  /** development mode: caching off until this time */
  devUntil: ts("dev_until"),
  underAttack: boolean("under_attack").notNull().default(false),
  /** part of the cache key: bumping it purges everything */
  cacheVersion: integer("cache_version").notNull().default(1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const cdnRules = pgTable("cdn_rules", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["cache", "redirect", "header", "auth", "access", "ratelimit"] }).notNull(),
  /** the rule (CdnRule in src/lib/domains.ts) */
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  /** basic auth only: {SSHA} htpasswd line, never sent to the browser */
  secret: text("secret").notNull().default(""),
  position: serial("position"),
  createdAt: created(),
}, (t) => [index("cdn_rule_domain_ix").on(t.domainId)]);

export const domainAlerts = pgTable("domain_alerts", {
  id: text("id").primaryKey(),
  domainId: text("domain_id").notNull().references(() => domains.id, { onDelete: "cascade" }),
  metric: text("metric", { enum: ["requests", "bandwidth", "errors", "blocked"] }).notNull(),
  threshold: real("threshold").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastValue: real("last_value").notNull().default(0),
  firedAt: ts("fired_at"),
  createdAt: created(),
}, (t) => [index("domain_alert_domain_ix").on(t.domainId)]);

/* ---------- Cloud server extras + billing and account extras (0023_vps_billing) ---------- */
/** additional IPv4 addresses on a VPS, billed hourly from the wallet; rdns is the PTR of that address */
export const vpsIps = pgTable("vps_ips", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ip: text("ip").notNull(),
  rdns: text("rdns").notNull().default(""),
  price: money("price").notNull(),
  createdAt: created(),
  /** removed from the VPS in Virtualizor by hand (virt sync); no longer charged */
  goneAt: ts("gone_at"),
}, (t) => [uniqueIndex("vps_ips_ip_uq").on(t.ip), index("vps_ips_server_ix").on(t.serverId)]);

/** extra block volumes; detached volumes keep their data (and their cost) until deleted */
export const vpsDisks = pgTable("vps_disks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serverId: text("server_id").references(() => servers.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  loc: text("loc").notNull(),
  sizeGb: integer("size_gb").notNull(),
  /** hypervisor disk index while attached */
  slot: integer("slot"),
  createdAt: created(),
  /** false: a disk an admin added in Virtualizor by hand (virt sync); shown, never charged */
  billed: boolean("billed").notNull().default(true),
  /** removed from the VPS in Virtualizor by hand (virt sync); no longer charged */
  goneAt: ts("gone_at"),
}, (t) => [index("vps_disks_user_ix").on(t.userId), index("vps_disks_server_ix").on(t.serverId)]);

/** automatic snapshots: daily or weekly, keeping the newest `retention` automatic ones */
export const vpsSnapSchedules = pgTable("vps_snap_schedules", {
  serverId: text("server_id").primaryKey().references(() => servers.id, { onDelete: "cascade" }),
  frequency: text("frequency", { enum: ["daily", "weekly"] }).notNull(),
  retention: integer("retention").notNull().default(3),
  /** Tehran hour of day (0-23) and, for weekly, the weekday (0 = Sunday) */
  hour: integer("hour").notNull().default(3),
  weekday: integer("weekday").notNull().default(5),
  active: boolean("active").notNull().default(true),
  nextRunAt: ts("next_run_at").notNull(),
  lastRunAt: ts("last_run_at"),
});

/** monthly traffic state per server: extra packs bought this month, auto-purchase, alert level sent */
export const vpsTraffic = pgTable("vps_traffic", {
  serverId: text("server_id").primaryKey().references(() => servers.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  extraGb: integer("extra_gb").notNull().default(0),
  packs: integer("packs").notNull().default(0),
  autoBuy: boolean("auto_buy").notNull().default(false),
  /** highest alert sent this month: 0, 80 or 100 */
  alerted: integer("alerted").notNull().default(0),
  usedGb: real("used_gb").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
export const vpsTrafficDaily = pgTable("vps_traffic_daily", {
  id: serial("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  day: text("day").notNull(), // YYYY-MM-DD (UTC)
  inMb: real("in_mb").notNull().default(0),
  outMb: real("out_mb").notNull().default(0),
}, (t) => [uniqueIndex("vps_traffic_day_uq").on(t.serverId, t.day)]);

/** cloud firewall groups: one rule set applied to many servers */
export const fwGroups = pgTable("fw_groups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rules: jsonb("rules").$type<{ proto: string; port: string; source: string; action: "allow" | "deny"; note: string }[]>().notNull().default([]),
  createdAt: created(),
}, (t) => [index("fw_groups_user_ix").on(t.userId)]);
export const fwGroupServers = pgTable("fw_group_servers", {
  id: serial("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => fwGroups.id, { onDelete: "cascade" }),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("fw_group_server_uq").on(t.groupId, t.serverId), index("fw_group_server_ix").on(t.serverId)]);

/** project wallets: money moved out of the main wallet for one project; linked servers bill from it first */
export const subWallets = pgTable("sub_wallets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  balance: money("balance").notNull().default(0),
  createdAt: created(),
}, (t) => [index("sub_wallets_user_ix").on(t.userId)]);
export const walletTransfers = pgTable("wallet_transfers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** "" is the main wallet */
  fromWallet: text("from_wallet").notNull(),
  toWallet: text("to_wallet").notNull(),
  amount: money("amount").notNull(),
  note: text("note").notNull().default(""),
  createdAt: created(),
}, (t) => [index("wallet_transfers_user_ix").on(t.userId)]);
export const walletLinks = pgTable("wallet_links", {
  serverId: text("server_id").primaryKey().references(() => servers.id, { onDelete: "cascade" }),
  walletId: text("wallet_id").notNull().references(() => subWallets.id, { onDelete: "cascade" }),
});

/** saved buyer identities for official invoices */
export const invoiceProfiles = pgTable("invoice_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  name: text("name").notNull(),
  nationalId: text("national_id").notNull(),
  economicCode: text("economic_code").notNull().default(""),
  address: text("address").notNull(),
  postalCode: text("postal_code").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: created(),
}, (t) => [index("invoice_profiles_user_ix").on(t.userId)]);

/** per-account billing settings and the level staff assign (SLA and support priority) */
export const accountMeta = pgTable("account_meta", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  level: text("level", { enum: ["developer", "startup", "enterprise"] }).notNull().default("developer"),
  /** fixed threshold; with lowCreditAuto the threshold is three days of the current burn */
  lowCredit: money("low_credit").notNull().default(0),
  lowCreditAuto: boolean("low_credit_auto").notNull().default(true),
  lowCreditAlertedAt: ts("low_credit_alerted_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** monthly spending caps: service "all" is the account-wide cap */
export const budgets = pgTable("budgets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  monthlyCap: money("monthly_cap").notNull(),
  alertPct: integer("alert_pct").notNull().default(80),
  /** refuse new purchases (budgetAllows) once the cap is reached */
  block: boolean("block").notNull().default(false),
  alertedMonth: text("alerted_month").notNull().default(""),
  alertedLevel: integer("alerted_level").notNull().default(0),
  createdAt: created(),
}, (t) => [uniqueIndex("budgets_user_service_uq").on(t.userId, t.service)]);

/** browser push subscriptions (Web Push) */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  device: text("device").notNull().default(""),
  createdAt: created(),
}, (t) => [uniqueIndex("push_endpoint_uq").on(t.endpoint), index("push_user_ix").on(t.userId)]);

/** one-time 2FA recovery codes (SHA-256 only) */
export const recoveryCodes = pgTable("twofa_recovery_codes", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: ts("used_at"),
  createdAt: created(),
}, (t) => [index("recovery_user_ix").on(t.userId)]);

/** owner-defined team roles: a level per service, enforced on top of the member's fixed base role */
export const teamRoles = pgTable("team_roles", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  perms: jsonb("perms").$type<Record<string, "none" | "view" | "deploy" | "operate" | "manage">>().notNull().default({}),
  createdAt: created(),
}, (t) => [index("team_roles_owner_ix").on(t.ownerId)]);
export const teamMemberRoles = pgTable("team_member_roles", {
  memberRowId: text("member_row_id").primaryKey().references(() => teamMembers.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => teamRoles.id, { onDelete: "cascade" }),
});

/* ---------- AI app builder (src/server/builder) ---------- */
/** a project the customer describes in words; the AI writes its files and it deploys as a Gereh app */
export const builderProjects = pgTable("builder_projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  stack: text("stack", { enum: ["static", "node"] }).notNull().default("static"),
  model: text("model").notNull().default(""),
  status: text("status", { enum: ["draft", "generating", "ready", "deploying", "fixing", "live", "failed"] }).notNull().default("draft"),
  appId: text("app_id").references(() => paasApps.id, { onDelete: "set null" }),
  dbId: text("db_id").references(() => paasDbs.id, { onDelete: "set null" }),
  /** capability for the sandboxed preview route; never shown to anyone but the owner */
  previewToken: text("preview_token").notNull(),
  /** current version (0 = no files yet) and the one running on the app */
  version: integer("version").notNull().default(0),
  deployedVersion: integer("deployed_version"),
  deploymentId: text("deployment_id"),
  /** 1-based attempt of the current deploy (the auto-fix loop stops after 3) */
  deployAttempt: integer("deploy_attempt").notNull().default(0),
  deployError: text("deploy_error").notNull().default(""),
  /** maintenance agent: apply its patches and redeploy without asking, within a monthly AI cost cap */
  autoMaintain: boolean("auto_maintain").notNull().default(false),
  maintainCap: money("maintain_cap").notNull().default(300_000),
  maintainSpent: money("maintain_spent").notNull().default(0),
  maintainMonth: text("maintain_month").notNull().default(""),
  /** when the agent looks: continuous (reads the logs every scanEvery minutes), incident (crash, OOM,
      failed health check or a burst of errors in the logs) or manual (only when the owner asks) */
  maintainMode: text("maintain_mode", { enum: ["continuous", "incident", "manual"] }).notNull().default("incident"),
  scanEvery: integer("scan_every").notNull().default(15),
  scannedAt: ts("scanned_at"),
  /** last error line already reported, so one burst of errors starts one diagnosis */
  logSig: text("log_sig").notNull().default(""),
  checkedAt: ts("checked_at"),
  /** AI cost of the project so far (Toman) */
  spent: money("spent").notNull().default(0),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("builder_project_user_ix").on(t.userId), uniqueIndex("builder_preview_token_uq").on(t.previewToken), index("builder_project_app_ix").on(t.appId)]);

/** every version of a project's files (a full snapshot: path → content), one per AI run or manual edit */
export const builderVersions = pgTable("builder_versions", {
  projectId: text("project_id").notNull().references(() => builderProjects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  files: jsonb("files").$type<Record<string, string>>().notNull(),
  message: text("message").notNull().default(""),
  runId: text("run_id"),
  createdAt: created(),
}, (t) => [uniqueIndex("builder_version_uq").on(t.projectId, t.version)]);

export const builderMessages = pgTable("builder_messages", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => builderProjects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  runId: text("run_id"),
  createdAt: created(),
}, (t) => [index("builder_message_project_ix").on(t.projectId, t.id)]);

/** one agent step: generate, edit, fix (failed deploy) or maintain (incident on the running app) */
export const builderRuns = pgTable("builder_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => builderProjects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["generate", "edit", "fix", "maintain"] }).notNull(),
  status: text("status", { enum: ["running", "succeeded", "failed", "cancelled"] }).notNull().default("running"),
  model: text("model").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  inTokens: integer("in_tokens").notNull().default(0),
  outTokens: integer("out_tokens").notNull().default(0),
  cost: money("cost").notNull().default(0),
  log: text("log").notNull().default(""),
  /** the agent's explanation for the customer (Persian) */
  summary: text("summary").notNull().default(""),
  diff: jsonb("diff").$type<{ added: string[]; changed: string[]; deleted: string[] }>().notNull().default({ added: [], changed: [], deleted: [] }),
  version: integer("version"),
  attempt: integer("attempt").notNull().default(0),
  /** maintain: what was seen (crash, oom, health_failed, manual) and the proposed patch until applied */
  incident: text("incident").notNull().default(""),
  patch: jsonb("patch").$type<Record<string, string | null>>(),
  applied: boolean("applied").notNull().default(false),
  createdAt: created(),
  finishedAt: ts("finished_at"),
}, (t) => [index("builder_run_project_ix").on(t.projectId, t.createdAt)]);

/* ---------- Virtualizor sync: the hypervisor is the source of truth for every VPS (0028_virt_sync) ---------- */
/** what the last sync saw for a VPS, and the monthly traffic limit the site itself last pushed */
export const vpsSync = pgTable("vps_sync", {
  serverId: text("server_id").primaryKey().references(() => servers.id, { onDelete: "cascade" }),
  syncedAt: ts("synced_at"),
  /** ok | missing (deleted in Virtualizor) */
  state: text("state").notNull().default("ok"),
  missingSince: ts("missing_since"),
  node: text("node").notNull().default(""),
  nodeId: integer("node_id").notNull().default(0),
  osid: integer("osid").notNull().default(0),
  plid: integer("plid").notNull().default(0),
  ramMb: integer("ram_mb").notNull().default(0),
  /** KB/s, 0 = unlimited */
  netSpeed: integer("net_speed").notNull().default(0),
  suspendReason: text("suspend_reason").notNull().default(""),
  /** GB/month as Virtualizor has it (0 = unlimited) and as the site last set it (null = never) */
  bwLimit: integer("bw_limit").notNull().default(0),
  bwPushed: integer("bw_pushed"),
  bwUsed: real("bw_used").notNull().default(0),
  ipv4: jsonb("ipv4").$type<string[]>().notNull().default([]),
  ipv6: jsonb("ipv6").$type<string[]>().notNull().default([]),
  disks: jsonb("disks").$type<{ slot: number; sizeGb: number; primary: boolean }[]>().notNull().default([]),
  lastError: text("last_error").notNull().default(""),
});
/** every change the sync found, once (shown to staff; the customer sees a server task line) */
export const vpsSyncLog = pgTable("vps_sync_log", {
  id: serial("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  before: text("before").notNull().default(""),
  after: text("after").notNull().default(""),
  text: text("text").notNull(),
  createdAt: created(),
}, (t) => [index("vps_sync_log_server_ix").on(t.serverId, t.createdAt), index("vps_sync_log_user_ix").on(t.userId, t.createdAt)]);

/* ---------- VPS panel: confirmed power actions, disk layouts, usage history (0029_vps_panel) ---------- */
/** a power action sent to Virtualizor and not yet confirmed by a live status read; while it exists the panel shows
    the transition and no poll may overwrite the server's power state */
export const vpsPower = pgTable("vps_power", {
  serverId: text("server_id").primaryKey().references(() => servers.id, { onDelete: "cascade" }),
  /** start | stop | restart | poweroff */
  action: text("action").notNull(),
  /** the state that confirms it: running | stopped */
  target: text("target").notNull(),
  checks: integer("checks").notNull().default(0),
  requestedAt: ts("requested_at").notNull().defaultNow(),
});
/** the disk GB a server's plan covers, split by the customer into disks (primary + unbilled vps_disks rows) */
export const vpsLayouts = pgTable("vps_layouts", {
  serverId: text("server_id").primaryKey().references(() => servers.id, { onDelete: "cascade" }),
  allowanceGb: integer("allowance_gb").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
/** hourly averages of usage_samples for the 7- and 30-day charts (kept 400 days) */
export const usageHourly = pgTable("usage_hourly", {
  id: serial("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  hour: ts("hour").notNull(),
  cpu: real("cpu").notNull().default(0), ram: real("ram").notNull().default(0), disk: real("disk").notNull().default(0),
  netIn: real("net_in").notNull().default(0), netOut: real("net_out").notNull().default(0),
  ioRead: real("io_read").notNull().default(0), ioWrite: real("io_write").notNull().default(0),
  n: integer("n").notNull().default(0),
}, (t) => [uniqueIndex("usage_hourly_uq").on(t.serverId, t.hour)]);
