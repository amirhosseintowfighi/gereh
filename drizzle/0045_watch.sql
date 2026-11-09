CREATE TABLE "watch_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"renew" boolean DEFAULT true NOT NULL,
	"next_mode" text,
	"price" bigint DEFAULT 0 NOT NULL,
	"paid_until" timestamp with time zone,
	"trial_ends" timestamp with time zone,
	"trial_notice_at" timestamp with time zone,
	"auto_fix" boolean DEFAULT false NOT NULL,
	"uptime_url" text DEFAULT '' NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_daily_at" timestamp with time zone,
	"last_weekly_at" timestamp with time zone,
	"last_sig" text DEFAULT '' NOT NULL,
	"last_event_id" integer DEFAULT 0 NOT NULL,
	"ping_fails" integer DEFAULT 0 NOT NULL,
	"down_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"resource_kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"plan_id" text,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_pings" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"ok" boolean NOT NULL,
	"ms" integer DEFAULT 0 NOT NULL,
	"code" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watch_plans" ADD CONSTRAINT "watch_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "watch_checks" ADD CONSTRAINT "watch_checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "watch_pings" ADD CONSTRAINT "watch_pings_plan_id_watch_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."watch_plans"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "watch_plan_res_uq" ON "watch_plans" USING btree ("resource_kind","resource_id");
--> statement-breakpoint
CREATE INDEX "watch_plan_user_ix" ON "watch_plans" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "watch_plan_status_ix" ON "watch_plans" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "watch_checks_res_ix" ON "watch_checks" USING btree ("resource_kind","resource_id","created_at");
--> statement-breakpoint
CREATE INDEX "watch_checks_at_ix" ON "watch_checks" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "watch_pings_plan_ix" ON "watch_pings" USING btree ("plan_id","at");
