ALTER TABLE "ticket_messages" ADD COLUMN "ai" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "support_ai_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text,
	"chat_id" text,
	"message_id" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"needs_human" boolean DEFAULT true NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"escalation" text DEFAULT '' NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"internal_note" text DEFAULT '' NOT NULL,
	"suggested_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"posted_id" integer,
	"decided_by" text DEFAULT '' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_runs" ADD CONSTRAINT "support_ai_runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_ai_runs" ADD CONSTRAINT "support_ai_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "support_ai_runs_ticket_ix" ON "support_ai_runs" USING btree ("ticket_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_ai_runs_chat_ix" ON "support_ai_runs" USING btree ("chat_id","created_at");
--> statement-breakpoint
CREATE INDEX "support_ai_runs_created_ix" ON "support_ai_runs" USING btree ("created_at");
--> statement-breakpoint
CREATE TABLE "support_ai_threads" (
	"key" text PRIMARY KEY NOT NULL,
	"ticket_id" text,
	"chat_id" text,
	"turns" integer DEFAULT 0 NOT NULL,
	"auto_replies" integer DEFAULT 0 NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"first_response_ai" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_ai_threads" ADD CONSTRAINT "support_ai_threads_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "support_ai_threads" ADD CONSTRAINT "support_ai_threads_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "support_ai_threads_ticket_ix" ON "support_ai_threads" USING btree ("ticket_id");
--> statement-breakpoint
CREATE TABLE "platform_ai_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"in_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_ai_usage_ix" ON "platform_ai_usage" USING btree ("purpose","created_at");
