CREATE TABLE "geo_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" bigint NOT NULL,
	"records" integer NOT NULL,
	"health_checks" boolean DEFAULT false NOT NULL,
	"sync" text DEFAULT 'none' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"zone_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"iran" text NOT NULL,
	"world" text DEFAULT '' NOT NULL,
	"ttl" integer DEFAULT 60 NOT NULL,
	"priority" integer,
	"iran_up" boolean,
	"world_up" boolean,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "geo_zones" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ns_ok" boolean DEFAULT false NOT NULL,
	"ns_seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ns_checked_at" timestamp with time zone,
	"health_path" text DEFAULT '/' NOT NULL,
	"sync_status" text DEFAULT 'none' NOT NULL,
	"sync_lag_sec" integer,
	"last_sync_at" timestamp with time zone,
	"sync_token" text NOT NULL,
	"paid_until" timestamp with time zone NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiry_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"account_no" integer NOT NULL,
	"api_key" text NOT NULL,
	"secret_enc" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ip_allow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiry_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"service_id" text NOT NULL,
	"status" text NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"billed" boolean DEFAULT false NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"sandbox" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	"input" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiry_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"service_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"use_case" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inquiry_services" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"approval" boolean DEFAULT false NOT NULL,
	"upstream" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_apps" ADD COLUMN "cdn" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_apps" ADD COLUMN "cache_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "geo_records" ADD CONSTRAINT "geo_records_zone_id_geo_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."geo_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_zones" ADD CONSTRAINT "geo_zones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_accounts" ADD CONSTRAINT "inquiry_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_calls" ADD CONSTRAINT "inquiry_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_grants" ADD CONSTRAINT "inquiry_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_grants" ADD CONSTRAINT "inquiry_grants_service_id_inquiry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."inquiry_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "geo_record_zone_ix" ON "geo_records" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "geo_zone_domain_uq" ON "geo_zones" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "geo_zone_user_ix" ON "geo_zones" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_key_uq" ON "inquiry_accounts" USING btree ("api_key");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_acct_uq" ON "inquiry_accounts" USING btree ("account_no");--> statement-breakpoint
CREATE INDEX "inquiry_call_user_ix" ON "inquiry_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "inquiry_call_bill_ix" ON "inquiry_calls" USING btree ("billed");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_grant_uq" ON "inquiry_grants" USING btree ("user_id","service_id");