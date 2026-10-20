ALTER TABLE "builder_projects" ADD COLUMN "self_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD COLUMN "language_setting" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD COLUMN "site_language" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD COLUMN "site_dir" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_runs" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "builder_runs" ADD COLUMN "quality" jsonb;--> statement-breakpoint
ALTER TABLE "builder_runs" ADD COLUMN "review_cost" bigint DEFAULT 0 NOT NULL;
