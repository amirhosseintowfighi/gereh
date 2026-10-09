ALTER TABLE "paas_apps" ADD COLUMN "product" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_apps" ADD COLUMN "wp_plan" text;--> statement-breakpoint
ALTER TABLE "paas_jobs" ADD COLUMN "source_path" text;