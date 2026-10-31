CREATE TABLE "dbq_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"db_id" text NOT NULL,
	"database" text NOT NULL,
	"question" text DEFAULT '' NOT NULL,
	"query" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"chart" jsonb DEFAULT '{"type":"table","x":"","y":""}'::jsonb NOT NULL,
	"source" text DEFAULT 'panel' NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"charged" integer DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"last_row_count" integer,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbq_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"db_id" text NOT NULL,
	"database" text NOT NULL,
	"engine" text NOT NULL,
	"query_hash" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"impersonated" boolean DEFAULT false NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dbq_settings" (
	"db_id" text PRIMARY KEY NOT NULL,
	"samples" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dbq_history" ADD CONSTRAINT "dbq_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dbq_history" ADD CONSTRAINT "dbq_history_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dbq_settings" ADD CONSTRAINT "dbq_settings_db_id_paas_dbs_id_fk" FOREIGN KEY ("db_id") REFERENCES "public"."paas_dbs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dbq_history_db_ix" ON "dbq_history" USING btree ("db_id","created_at");
--> statement-breakpoint
CREATE INDEX "dbq_history_user_ix" ON "dbq_history" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "dbq_audit_db_ix" ON "dbq_audit" USING btree ("db_id","created_at");
--> statement-breakpoint
CREATE INDEX "dbq_audit_user_ix" ON "dbq_audit" USING btree ("user_id","created_at");
