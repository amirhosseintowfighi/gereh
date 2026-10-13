ALTER TABLE "dns_records" ADD COLUMN "proxied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE "domain_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auth_code" text DEFAULT '' NOT NULL,
	"irnic_handle" text DEFAULT '' NOT NULL,
	"price" bigint DEFAULT 0 NOT NULL,
	"domain_id" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_extras" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"dnssec" boolean DEFAULT false NOT NULL,
	"ds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"irnic_handle" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_contacts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"irnic_handle" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whois_cache" (
	"domain" text PRIMARY KEY NOT NULL,
	"server" text NOT NULL,
	"body" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cdn_settings" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"origin_host" text DEFAULT '' NOT NULL,
	"origin_host_header" text DEFAULT '' NOT NULL,
	"origin_https" boolean DEFAULT false NOT NULL,
	"force_https" boolean DEFAULT true NOT NULL,
	"hsts_max_age" integer DEFAULT 0 NOT NULL,
	"hsts_sub" boolean DEFAULT false NOT NULL,
	"hsts_preload" boolean DEFAULT false NOT NULL,
	"min_tls" text DEFAULT '1.2' NOT NULL,
	"browser_ttl" integer DEFAULT 0 NOT NULL,
	"dev_until" timestamp with time zone,
	"under_attack" boolean DEFAULT false NOT NULL,
	"cache_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cdn_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"secret" text DEFAULT '' NOT NULL,
	"position" serial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"metric" text NOT NULL,
	"threshold" real NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_value" real DEFAULT 0 NOT NULL,
	"fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_transfers" ADD CONSTRAINT "domain_transfers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_extras" ADD CONSTRAINT "domain_extras_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_contacts" ADD CONSTRAINT "domain_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdn_settings" ADD CONSTRAINT "cdn_settings_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdn_rules" ADD CONSTRAINT "cdn_rules_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_alerts" ADD CONSTRAINT "domain_alerts_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_transfer_user_ix" ON "domain_transfers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_transfer_status_ix" ON "domain_transfers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cdn_rule_domain_ix" ON "cdn_rules" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "domain_alert_domain_ix" ON "domain_alerts" USING btree ("domain_id");
