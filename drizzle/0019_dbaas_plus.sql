CREATE TABLE "paas_db_config" (
	"db_id" text PRIMARY KEY NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replica_set" boolean DEFAULT false NOT NULL,
	"ext_image" boolean DEFAULT false NOT NULL,
	"seed" jsonb,
	"initialized" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_db_users" (
	"id" text PRIMARY KEY NOT NULL,
	"db_id" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_db_databases" (
	"id" text PRIMARY KEY NOT NULL,
	"db_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_db_panels" (
	"id" text PRIMARY KEY NOT NULL,
	"db_id" text NOT NULL,
	"tool" text NOT NULL,
	"host" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paas_db_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"db_id" text NOT NULL,
	"format" text NOT NULL,
	"file_path" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"output" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "paas_db_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"db_id" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_db_config" ADD CONSTRAINT "paas_db_config_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_db_users" ADD CONSTRAINT "paas_db_users_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_db_databases" ADD CONSTRAINT "paas_db_databases_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_db_panels" ADD CONSTRAINT "paas_db_panels_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_db_imports" ADD CONSTRAINT "paas_db_imports_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paas_db_events" ADD CONSTRAINT "paas_db_events_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paas_db_user_uq" ON "paas_db_users" USING btree ("db_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "paas_db_database_uq" ON "paas_db_databases" USING btree ("db_id","name");--> statement-breakpoint
CREATE INDEX "paas_db_panel_ix" ON "paas_db_panels" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "paas_db_panel_db_ix" ON "paas_db_panels" USING btree ("db_id");--> statement-breakpoint
CREATE INDEX "paas_db_import_ix" ON "paas_db_imports" USING btree ("db_id","created_at");--> statement-breakpoint
CREATE INDEX "paas_db_event_ix" ON "paas_db_events" USING btree ("db_id","created_at");
