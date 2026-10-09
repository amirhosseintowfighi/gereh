ALTER TABLE "paas_apps" ADD COLUMN "previews" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_apps" ADD COLUMN "preview_deployment" text;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "target" text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_deployments" ADD COLUMN "branch" text DEFAULT '' NOT NULL;