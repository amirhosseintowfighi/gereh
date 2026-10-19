ALTER TABLE "builder_projects" ADD COLUMN "maintain_mode" text DEFAULT 'incident' NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD COLUMN "scan_every" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD COLUMN "log_sig" text DEFAULT '' NOT NULL;
