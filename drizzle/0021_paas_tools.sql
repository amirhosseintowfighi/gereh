CREATE TABLE "paas_disks" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"mount_path" text NOT NULL,
	"size_gb" integer NOT NULL,
	"backups" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_disk_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"disk_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"size_mb" real DEFAULT 0 NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_sftp_users" (
	"id" text PRIMARY KEY NOT NULL,
	"disk_id" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"access" text DEFAULT 'rw' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_app_tools" (
	"app_id" text PRIMARY KEY NOT NULL,
	"sftp_port" integer,
	"sftp_host_key" text DEFAULT '' NOT NULL,
	"logs_cursor" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paas_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"instance" text DEFAULT '' NOT NULL,
	"line" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_net_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_metrics_hourly" (
	"target" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"cpu" real DEFAULT 0 NOT NULL,
	"ram_mb" real DEFAULT 0 NOT NULL,
	"rpm" real DEFAULT 0 NOT NULL,
	"net_bytes" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_console_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"instance" text DEFAULT '' NOT NULL,
	"command" text DEFAULT '' NOT NULL,
	"exit_code" integer,
	"output" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "paas_plans" ADD COLUMN "log_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_disks" ADD CONSTRAINT "paas_disks_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_disk_backups" ADD CONSTRAINT "paas_disk_backups_disk_id_paas_disks_id_fk" FOREIGN KEY ("disk_id") REFERENCES "public"."paas_disks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_sftp_users" ADD CONSTRAINT "paas_sftp_users_disk_id_paas_disks_id_fk" FOREIGN KEY ("disk_id") REFERENCES "public"."paas_disks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_app_tools" ADD CONSTRAINT "paas_app_tools_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_logs" ADD CONSTRAINT "paas_logs_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_net_samples" ADD CONSTRAINT "paas_net_samples_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_console_sessions" ADD CONSTRAINT "paas_console_sessions_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paas_disk_uq" ON "paas_disks" USING btree ("app_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_disk_mount_uq" ON "paas_disks" USING btree ("app_id","mount_path");--> statement-breakpoint
CREATE INDEX "paas_disk_backup_ix" ON "paas_disk_backups" USING btree ("disk_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_sftp_user_uq" ON "paas_sftp_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "paas_sftp_disk_ix" ON "paas_sftp_users" USING btree ("disk_id");--> statement-breakpoint
CREATE INDEX "paas_log_app_ix" ON "paas_logs" USING btree ("app_id","at");--> statement-breakpoint
CREATE INDEX "paas_net_ix" ON "paas_net_samples" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_metric_hour_uq" ON "paas_metrics_hourly" USING btree ("target","hour");--> statement-breakpoint
CREATE INDEX "paas_console_app_ix" ON "paas_console_sessions" USING btree ("app_id","started_at");--> statement-breakpoint
UPDATE "paas_plans" SET "log_days" = 30 WHERE "id" IN ('app-small', 'app-medium');--> statement-breakpoint
UPDATE "paas_plans" SET "log_days" = 60 WHERE "id" IN ('app-large', 'app-xlarge');--> statement-breakpoint
INSERT INTO "paas_disks" ("id", "app_id", "name", "mount_path", "size_gb") SELECT 'dsk-' || substr(md5("id"), 1, 8), "id", 'data', "disk_mount", "disk_gb" FROM "paas_apps" WHERE "disk_gb" > 0;
