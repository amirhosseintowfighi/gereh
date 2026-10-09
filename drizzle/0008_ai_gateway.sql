CREATE TABLE "ai_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"daily_cap" bigint DEFAULT 0 NOT NULL,
	"monthly_cap" bigint DEFAULT 0 NOT NULL,
	"rpm" integer DEFAULT 120 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"vendor" text NOT NULL,
	"upstream" text DEFAULT '' NOT NULL,
	"in_price" bigint NOT NULL,
	"out_price" bigint NOT NULL,
	"ref_in" bigint DEFAULT 0 NOT NULL,
	"ref_out" bigint DEFAULT 0 NOT NULL,
	"context" integer DEFAULT 128000 NOT NULL,
	"vision" boolean DEFAULT false NOT NULL,
	"tools" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key_id" text,
	"model" text NOT NULL,
	"format" text NOT NULL,
	"stream" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"in_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"billed" boolean DEFAULT false NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_key_hash_uq" ON "ai_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "ai_key_user_ix" ON "ai_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_user_ix" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_key_ix" ON "ai_usage" USING btree ("key_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_bill_ix" ON "ai_usage" USING btree ("billed");