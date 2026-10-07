CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"icon" text NOT NULL,
	"text" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"size" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"value" bigint NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"limit" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dns_records" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"ttl" integer DEFAULT 3600 NOT NULL,
	"priority" integer,
	"position" serial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"privacy" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ns" text[] NOT NULL,
	"auth_code" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "firewall_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"proto" text NOT NULL,
	"port" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"position" serial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosting" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"plan" text NOT NULL,
	"disk_used" real DEFAULT 0 NOT NULL,
	"disk_total" integer NOT NULL,
	"bw_used" integer DEFAULT 0 NOT NULL,
	"bw_total" integer NOT NULL,
	"emails" integer DEFAULT 0 NOT NULL,
	"dbs" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"price" bigint NOT NULL,
	"panel" text DEFAULT 'cPanel' NOT NULL,
	"server" text DEFAULT '' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"dept" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"desc" text NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"fulfil" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coupon" text,
	"tax_rate" integer DEFAULT 10 NOT NULL,
	"official" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "isos" (
	"filename" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"loc" text NOT NULL,
	"model" text NOT NULL,
	"cpu" integer DEFAULT 0 NOT NULL,
	"ram" integer DEFAULT 0 NOT NULL,
	"disk" integer DEFAULT 0 NOT NULL,
	"vms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'online' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"icon" text NOT NULL,
	"text" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os_templates" (
	"osid" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"distro" text NOT NULL,
	"on" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"phone" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"invoice_id" text,
	"amount" bigint NOT NULL,
	"gateway" text NOT NULL,
	"authority" text,
	"ref_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_map" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plid" integer DEFAULT 0 NOT NULL,
	"group" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"progress" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"plan" text NOT NULL,
	"cpu" integer NOT NULL,
	"ram" integer NOT NULL,
	"disk" integer NOT NULL,
	"loc" text NOT NULL,
	"os" text NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"ipv6" text DEFAULT '' NOT NULL,
	"rdns" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"price" bigint NOT NULL,
	"billing" text DEFAULT 'monthly' NOT NULL,
	"backups" boolean DEFAULT false NOT NULL,
	"vpsid" integer,
	"hostname" text NOT NULL,
	"boot" text DEFAULT 'cda' NOT NULL,
	"iso" text DEFAULT '' NOT NULL,
	"rescue" boolean DEFAULT false NOT NULL,
	"bw_limit" integer DEFAULT 2000 NOT NULL,
	"vnc_host" text DEFAULT '' NOT NULL,
	"vnc_port" integer DEFAULT 0 NOT NULL,
	"vnc_password" text DEFAULT '' NOT NULL,
	"app" text DEFAULT '' NOT NULL,
	"alerts" jsonb DEFAULT '{"cpu":0,"bw":0}'::jsonb NOT NULL,
	"paid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"acting_as" text,
	"device" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"size" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"from" text NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"dept" text NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"assignee" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tlds" (
	"tld" text PRIMARY KEY NOT NULL,
	"reg" bigint NOT NULL,
	"renew" bigint NOT NULL,
	"transfer" bigint NOT NULL,
	"cat" text NOT NULL,
	"hot" boolean DEFAULT false NOT NULL,
	"promo" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"desc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"password_hash" text,
	"role" text DEFAULT 'user' NOT NULL,
	"staff_role" text,
	"balance" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"kyc" text DEFAULT 'none' NOT NULL,
	"twofa_secret" text,
	"notif_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by" text,
	"virt_uid" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "virt_log" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"result" text NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firewall_rules" ADD CONSTRAINT "firewall_rules_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosting" ADD CONSTRAINT "hosting_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_tasks" ADD CONSTRAINT "server_tasks_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_as_users_id_fk" FOREIGN KEY ("acting_as") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_ix" ON "activity" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_hash_uq" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_name_uq" ON "domains" USING btree ("name");--> statement-breakpoint
CREATE INDEX "domains_user_ix" ON "domains" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "hosting_user_ix" ON "hosting" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoices_user_ix" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_due_ix" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe") WHERE "jobs"."status" in ('pending','running');--> statement-breakpoint
CREATE INDEX "notif_user_ix" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_authority_uq" ON "payments" USING btree ("gateway","authority");--> statement-breakpoint
CREATE INDEX "tasks_server_ix" ON "server_tasks" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "servers_user_ix" ON "servers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_vpsid_uq" ON "servers" USING btree ("vpsid");--> statement-breakpoint
CREATE INDEX "sessions_user_ix" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_user_ix" ON "tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tx_user_ix" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_ref_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_phone_ix" ON "users" USING btree ("phone");