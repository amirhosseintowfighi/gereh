CREATE TABLE "paas_crons" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"schedule" text NOT NULL,
	"command" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"kind" text NOT NULL,
	"command" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paas_processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"instances" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_apps" ADD COLUMN "release_command" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_apps" ADD COLUMN "worker_instances" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paas_crons" ADD CONSTRAINT "paas_crons_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_jobs" ADD CONSTRAINT "paas_jobs_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_processes" ADD CONSTRAINT "paas_processes_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paas_cron_uq" ON "paas_crons" USING btree ("app_id","name");--> statement-breakpoint
CREATE INDEX "paas_job_app_ix" ON "paas_jobs" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_process_uq" ON "paas_processes" USING btree ("app_id","name");