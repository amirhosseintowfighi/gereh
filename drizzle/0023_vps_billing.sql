CREATE TABLE "vps_ips" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ip" text NOT NULL,
	"rdns" text DEFAULT '' NOT NULL,
	"price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vps_disks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_id" text,
	"name" text NOT NULL,
	"loc" text NOT NULL,
	"size_gb" integer NOT NULL,
	"slot" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vps_snap_schedules" (
	"server_id" text PRIMARY KEY NOT NULL,
	"frequency" text NOT NULL,
	"retention" integer DEFAULT 3 NOT NULL,
	"hour" integer DEFAULT 3 NOT NULL,
	"weekday" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vps_traffic" (
	"server_id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"extra_gb" integer DEFAULT 0 NOT NULL,
	"packs" integer DEFAULT 0 NOT NULL,
	"auto_buy" boolean DEFAULT false NOT NULL,
	"alerted" integer DEFAULT 0 NOT NULL,
	"used_gb" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vps_traffic_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"day" text NOT NULL,
	"in_mb" real DEFAULT 0 NOT NULL,
	"out_mb" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fw_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fw_group_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"server_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"from_wallet" text NOT NULL,
	"to_wallet" text NOT NULL,
	"amount" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"server_id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"name" text NOT NULL,
	"national_id" text NOT NULL,
	"economic_code" text DEFAULT '' NOT NULL,
	"address" text NOT NULL,
	"postal_code" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_meta" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'developer' NOT NULL,
	"low_credit" bigint DEFAULT 0 NOT NULL,
	"low_credit_auto" boolean DEFAULT true NOT NULL,
	"low_credit_alerted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"service" text NOT NULL,
	"monthly_cap" bigint NOT NULL,
	"alert_pct" integer DEFAULT 80 NOT NULL,
	"block" boolean DEFAULT false NOT NULL,
	"alerted_month" text DEFAULT '' NOT NULL,
	"alerted_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "twofa_recovery_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"perms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member_roles" (
	"member_row_id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vps_ips" ADD CONSTRAINT "vps_ips_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_ips" ADD CONSTRAINT "vps_ips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_disks" ADD CONSTRAINT "vps_disks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_disks" ADD CONSTRAINT "vps_disks_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_snap_schedules" ADD CONSTRAINT "vps_snap_schedules_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_traffic" ADD CONSTRAINT "vps_traffic_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_traffic_daily" ADD CONSTRAINT "vps_traffic_daily_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fw_groups" ADD CONSTRAINT "fw_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fw_group_servers" ADD CONSTRAINT "fw_group_servers_group_id_fw_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."fw_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fw_group_servers" ADD CONSTRAINT "fw_group_servers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_wallets" ADD CONSTRAINT "sub_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_links" ADD CONSTRAINT "wallet_links_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_links" ADD CONSTRAINT "wallet_links_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_profiles" ADD CONSTRAINT "invoice_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_meta" ADD CONSTRAINT "account_meta_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twofa_recovery_codes" ADD CONSTRAINT "twofa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_member_row_id_team_members_id_fk" FOREIGN KEY ("member_row_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_roles" ADD CONSTRAINT "team_member_roles_role_id_team_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."team_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vps_ips_ip_uq" ON "vps_ips" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "vps_ips_server_ix" ON "vps_ips" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "vps_disks_user_ix" ON "vps_disks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vps_disks_server_ix" ON "vps_disks" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vps_traffic_day_uq" ON "vps_traffic_daily" USING btree ("server_id","day");--> statement-breakpoint
CREATE INDEX "fw_groups_user_ix" ON "fw_groups" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fw_group_server_uq" ON "fw_group_servers" USING btree ("group_id","server_id");--> statement-breakpoint
CREATE INDEX "fw_group_server_ix" ON "fw_group_servers" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "sub_wallets_user_ix" ON "sub_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_transfers_user_ix" ON "wallet_transfers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invoice_profiles_user_ix" ON "invoice_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_service_uq" ON "budgets" USING btree ("user_id","service");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_user_ix" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_user_ix" ON "twofa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "team_roles_owner_ix" ON "team_roles" USING btree ("owner_id");
