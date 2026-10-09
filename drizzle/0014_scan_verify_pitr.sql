ALTER TABLE "paas_db_backups" ADD COLUMN "verified" boolean;--> statement-breakpoint
ALTER TABLE "paas_db_backups" ADD COLUMN "verify_detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_db_backups" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paas_dbs" ADD COLUMN "pitr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_dbs" ADD COLUMN "restore_from" text;--> statement-breakpoint
ALTER TABLE "paas_dbs" ADD COLUMN "restore_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "scan_status" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "scan_critical" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "scan_high" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "scan_report" text DEFAULT '' NOT NULL;