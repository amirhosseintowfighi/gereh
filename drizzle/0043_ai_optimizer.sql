ALTER TABLE "ai_models" ADD COLUMN "cost_in" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "cost_out" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_keys" ADD COLUMN "optimize" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "sent_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cached_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_ai_usage" ADD COLUMN "sent_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_ai_usage" ADD COLUMN "cached_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE "ai_opt_events" (
	"id" text PRIMARY KEY NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"format" text DEFAULT '' NOT NULL,
	"policy" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"changed" boolean DEFAULT false NOT NULL,
	"orig_est" integer DEFAULT 0 NOT NULL,
	"opt_est" integer DEFAULT 0 NOT NULL,
	"billed_in" integer DEFAULT 0 NOT NULL,
	"actual_in" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"usage_reported" boolean DEFAULT false NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"actual_cost" real DEFAULT 0 NOT NULL,
	"unopt_cost" real DEFAULT 0 NOT NULL,
	"cost_source" text DEFAULT 'sale-proxy' NOT NULL,
	"upstream_usd_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" real DEFAULT 0 NOT NULL,
	"validator_failures" integer DEFAULT 0 NOT NULL,
	"fallback" text DEFAULT '' NOT NULL,
	"over_budget" boolean DEFAULT false NOT NULL,
	"cache_family" text DEFAULT '' NOT NULL,
	"cache_breakpoints" integer DEFAULT 0 NOT NULL,
	"cache_skipped" text DEFAULT '' NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"prefix_hash" text DEFAULT '' NOT NULL,
	"translated" integer DEFAULT 0 NOT NULL,
	"lang_mismatch" boolean DEFAULT false NOT NULL,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_opt_events_ix" ON "ai_opt_events" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "ai_opt_events_feature_ix" ON "ai_opt_events" USING btree ("feature","created_at");
--> statement-breakpoint
CREATE TABLE "ai_opt_calibration" (
	"model" text PRIMARY KEY NOT NULL,
	"factor" real DEFAULT 1 NOT NULL,
	"samples" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_opt_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"by_user" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"budget_usd" real DEFAULT 5 NOT NULL,
	"spent_usd" real DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
