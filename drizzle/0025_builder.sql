CREATE TABLE "builder_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"stack" text DEFAULT 'static' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"app_id" text,
	"db_id" text,
	"preview_token" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"deployed_version" integer,
	"deployment_id" text,
	"deploy_attempt" integer DEFAULT 0 NOT NULL,
	"deploy_error" text DEFAULT '' NOT NULL,
	"auto_maintain" boolean DEFAULT false NOT NULL,
	"maintain_cap" bigint DEFAULT 300000 NOT NULL,
	"maintain_spent" bigint DEFAULT 0 NOT NULL,
	"maintain_month" text DEFAULT '' NOT NULL,
	"checked_at" timestamp with time zone,
	"spent" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_versions" (
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"files" jsonb NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builder_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"in_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"diff" jsonb DEFAULT '{"added":[],"changed":[],"deleted":[]}'::jsonb NOT NULL,
	"version" integer,
	"attempt" integer DEFAULT 0 NOT NULL,
	"incident" text DEFAULT '' NOT NULL,
	"patch" jsonb,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "builder_projects" ADD CONSTRAINT "builder_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD CONSTRAINT "builder_projects_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_projects" ADD CONSTRAINT "builder_projects_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_versions" ADD CONSTRAINT "builder_versions_project_id_builder_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."builder_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_messages" ADD CONSTRAINT "builder_messages_project_id_builder_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."builder_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_runs" ADD CONSTRAINT "builder_runs_project_id_builder_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."builder_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builder_runs" ADD CONSTRAINT "builder_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "builder_project_user_ix" ON "builder_projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "builder_preview_token_uq" ON "builder_projects" USING btree ("preview_token");--> statement-breakpoint
CREATE INDEX "builder_project_app_ix" ON "builder_projects" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "builder_version_uq" ON "builder_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "builder_message_project_ix" ON "builder_messages" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "builder_run_project_ix" ON "builder_runs" USING btree ("project_id","created_at");
