CREATE TABLE "ai_explanations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"resource_id" text NOT NULL,
	"error_ref" text DEFAULT '' NOT NULL,
	"error_hash" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"cause" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"request_id" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ai_explanations_lookup_ix" ON "ai_explanations" USING btree ("user_id","error_hash","created_at");
