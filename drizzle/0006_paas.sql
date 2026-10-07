CREATE TABLE "paas_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"stack" text NOT NULL,
	"source" text NOT NULL,
	"git_url" text DEFAULT '' NOT NULL,
	"git_branch" text DEFAULT 'main' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"root_dir" text DEFAULT '' NOT NULL,
	"build_command" text DEFAULT '' NOT NULL,
	"start_command" text DEFAULT '' NOT NULL,
	"port" integer NOT NULL,
	"health_path" text DEFAULT '/' NOT NULL,
	"plan_id" text NOT NULL,
	"instances" integer DEFAULT 1 NOT NULL,
	"autoscale" boolean DEFAULT false NOT NULL,
	"max_instances" integer DEFAULT 3 NOT NULL,
	"disk_gb" integer DEFAULT 0 NOT NULL,
	"disk_mount" text DEFAULT '/data' NOT NULL,
	"region" text DEFAULT 'thr' NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"hook_token" text NOT NULL,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"live_deployment" text,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_db_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"db_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"size_mb" real DEFAULT 0 NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_dbs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"engine" text NOT NULL,
	"version" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"port" integer NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"db_name" text NOT NULL,
	"public_access" boolean DEFAULT false NOT NULL,
	"public_port" integer,
	"backups" boolean DEFAULT true NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"upload_path" text,
	"log" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paas_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"host" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ssl" text DEFAULT 'pending' NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_env" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"secret" boolean DEFAULT false NOT NULL,
	"managed_by" text
);
--> statement-breakpoint
CREATE TABLE "paas_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"db_id" text NOT NULL,
	"env_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"cpu" real NOT NULL,
	"ram_mb" real NOT NULL,
	"rpm" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"cpu" real NOT NULL,
	"ram_mb" integer NOT NULL,
	"disk_gb" integer DEFAULT 0 NOT NULL,
	"price" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_apps" ADD CONSTRAINT "paas_apps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_apps" ADD CONSTRAINT "paas_apps_plan_id_paas_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."paas_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_db_backups" ADD CONSTRAINT "paas_db_backups_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_dbs" ADD CONSTRAINT "paas_dbs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_dbs" ADD CONSTRAINT "paas_dbs_plan_id_paas_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."paas_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD CONSTRAINT "paas_deployments_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_domains" ADD CONSTRAINT "paas_domains_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_env" ADD CONSTRAINT "paas_env_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_links" ADD CONSTRAINT "paas_links_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_links" ADD CONSTRAINT "paas_links_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paas_app_name_uq" ON "paas_apps" USING btree ("name");--> statement-breakpoint
CREATE INDEX "paas_app_user_ix" ON "paas_apps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paas_backup_db_ix" ON "paas_db_backups" USING btree ("db_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_db_name_uq" ON "paas_dbs" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "paas_db_user_ix" ON "paas_dbs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "paas_dep_app_ix" ON "paas_deployments" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_domain_uq" ON "paas_domains" USING btree ("host");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_env_uq" ON "paas_env" USING btree ("app_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_link_uq" ON "paas_links" USING btree ("app_id","db_id");--> statement-breakpoint
CREATE INDEX "paas_metric_ix" ON "paas_metrics" USING btree ("target","created_at");