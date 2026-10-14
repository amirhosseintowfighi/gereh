ALTER TABLE "servers" ADD COLUMN "provision_error" text;
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "provision_ticket" text;
--> statement-breakpoint
ALTER TABLE "plan_map" ADD COLUMN "virt" text DEFAULT '' NOT NULL;
