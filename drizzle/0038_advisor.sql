CREATE TABLE "advisor_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"rule" text NOT NULL,
	"resource_kind" text DEFAULT '' NOT NULL,
	"resource_id" text DEFAULT '' NOT NULL,
	"resource_name" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"saving" bigint DEFAULT 0 NOT NULL,
	"extra_cost" bigint DEFAULT 0 NOT NULL,
	"one_time" bigint DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"risk" text DEFAULT 'low' NOT NULL,
	"action" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"ignored_until" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"run_rate" bigint DEFAULT 0 NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"burn" bigint DEFAULT 0 NOT NULL,
	"runway_days" real,
	"insufficient" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"summary_hash" text DEFAULT '' NOT NULL,
	"summary_simulated" boolean DEFAULT true NOT NULL,
	"summary_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone,
	"digest_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "advisor_findings" ADD CONSTRAINT "advisor_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "advisor_state" ADD CONSTRAINT "advisor_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "advisor_findings_key_uq" ON "advisor_findings" USING btree ("user_id","key");
--> statement-breakpoint
CREATE INDEX "advisor_findings_status_ix" ON "advisor_findings" USING btree ("status","user_id");
