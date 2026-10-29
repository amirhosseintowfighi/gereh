CREATE TABLE "monitor_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_name" text DEFAULT '' NOT NULL,
	"detector" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"explanation_ai" boolean DEFAULT false NOT NULL,
	"abuse" boolean DEFAULT false NOT NULL,
	"clean_count" integer DEFAULT 0 NOT NULL,
	"notified_severity" text DEFAULT '' NOT NULL,
	"notified_at" timestamp with time zone,
	"staff_notified_at" timestamp with time zone,
	"muted_until" timestamp with time zone,
	"feedback" text DEFAULT '' NOT NULL,
	"feedback_at" timestamp with time zone,
	"taken" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitor_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource_kind" text DEFAULT '' NOT NULL,
	"resource_id" text DEFAULT '' NOT NULL,
	"sensitivity" text DEFAULT 'normal' NOT NULL,
	"muted_until" timestamp with time zone,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitor_scan" (
	"key" text PRIMARY KEY NOT NULL,
	"last_sample_at" timestamp with time zone,
	"baseline" jsonb,
	"baseline_at" timestamp with time zone,
	"trend_at" timestamp with time zone,
	"last_status" text DEFAULT '' NOT NULL,
	"down_since" timestamp with time zone,
	"proc_at" timestamp with time zone,
	"scanned_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "monitor_incidents" ADD CONSTRAINT "monitor_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monitor_settings" ADD CONSTRAINT "monitor_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_incidents_live_uq" ON "monitor_incidents" USING btree ("resource_kind","resource_id","detector") WHERE "monitor_incidents"."status" in ('open','muted');
--> statement-breakpoint
CREATE INDEX "monitor_incidents_user_ix" ON "monitor_incidents" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX "monitor_incidents_status_ix" ON "monitor_incidents" USING btree ("status","severity");
--> statement-breakpoint
CREATE UNIQUE INDEX "monitor_settings_uq" ON "monitor_settings" USING btree ("user_id","resource_kind","resource_id");
