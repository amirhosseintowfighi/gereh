CREATE TABLE "notify_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"secret_enc" text,
	"events" jsonb DEFAULT '["billing","service","security"]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_status" text DEFAULT '' NOT NULL,
	"last_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notify_channels" ADD CONSTRAINT "notify_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notify_channel_user_ix" ON "notify_channels" USING btree ("user_id");