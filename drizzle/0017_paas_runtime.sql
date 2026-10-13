CREATE TABLE "paas_runtime" (
	"app_id" text PRIMARY KEY NOT NULL,
	"pre_build" text DEFAULT '' NOT NULL,
	"post_build" text DEFAULT '' NOT NULL,
	"pre_start" text DEFAULT '' NOT NULL,
	"health_type" text DEFAULT 'http' NOT NULL,
	"health_command" text DEFAULT '' NOT NULL,
	"health_codes" text DEFAULT '200-399' NOT NULL,
	"health_interval" integer DEFAULT 5 NOT NULL,
	"health_timeout" integer DEFAULT 3 NOT NULL,
	"health_retries" integer DEFAULT 3 NOT NULL,
	"health_start_period" integer DEFAULT 0 NOT NULL,
	"zero_downtime" boolean DEFAULT true NOT NULL,
	"build_cache" boolean DEFAULT true NOT NULL,
	"mirror" boolean DEFAULT true NOT NULL,
	"build_args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dockerfile" text DEFAULT 'Dockerfile' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tehran' NOT NULL,
	"read_only_fs" boolean DEFAULT false NOT NULL,
	"dns_servers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nginx_conf" text DEFAULT '' NOT NULL,
	"php_ini" text DEFAULT '' NOT NULL,
	"default_domain" boolean DEFAULT true NOT NULL,
	"auth_path" text DEFAULT '' NOT NULL,
	"auth_user" text DEFAULT '' NOT NULL,
	"auth_htpasswd" text DEFAULT '' NOT NULL,
	"budget" bigint DEFAULT 0 NOT NULL,
	"budget_alert_pct" integer DEFAULT 80 NOT NULL,
	"budget_stop" boolean DEFAULT false NOT NULL,
	"budget_notified" text DEFAULT '' NOT NULL,
	"traffic_alert_gb" integer DEFAULT 0 NOT NULL,
	"traffic_notified" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_spend" (
	"app_id" text NOT NULL,
	"month" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_traffic" (
	"app_id" text NOT NULL,
	"day" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_domain_redirects" (
	"domain_id" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"code" integer DEFAULT 301 NOT NULL,
	"keep_path" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_plans" ADD COLUMN "deploys_per_day" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_plans" ADD COLUMN "max_build_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "no_cache" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "failure" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_runtime" ADD CONSTRAINT "paas_runtime_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_events" ADD CONSTRAINT "paas_events_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_spend" ADD CONSTRAINT "paas_spend_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_traffic" ADD CONSTRAINT "paas_traffic_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_domain_redirects" ADD CONSTRAINT "paas_domain_redirects_domain_id_paas_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."paas_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paas_event_app_ix" ON "paas_events" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_spend_uq" ON "paas_spend" USING btree ("app_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_traffic_uq" ON "paas_traffic" USING btree ("app_id","day");--> statement-breakpoint
UPDATE "paas_plans" SET "deploys_per_day" = 10, "max_build_minutes" = 15 WHERE "id" = 'app-nano';--> statement-breakpoint
UPDATE "paas_plans" SET "deploys_per_day" = 20, "max_build_minutes" = 20 WHERE "id" = 'app-micro';--> statement-breakpoint
UPDATE "paas_plans" SET "deploys_per_day" = 50, "max_build_minutes" = 30 WHERE "id" = 'app-small';--> statement-breakpoint
UPDATE "paas_plans" SET "deploys_per_day" = 100, "max_build_minutes" = 45 WHERE "id" = 'app-medium';--> statement-breakpoint
UPDATE "paas_plans" SET "deploys_per_day" = 0, "max_build_minutes" = 60 WHERE "id" IN ('app-large', 'app-xlarge');
