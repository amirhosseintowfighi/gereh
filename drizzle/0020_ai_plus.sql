ALTER TABLE "ai_models" ADD COLUMN "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "unit_price" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_keys" ADD COLUMN "ips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_keys" ADD COLUMN "routing" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_keys" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "finish" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "units" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "project_id" text;--> statement-breakpoint
CREATE INDEX "ai_usage_project_ix" ON "ai_usage" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE TABLE "ai_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"monthly_limit" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"log_bodies" boolean DEFAULT false NOT NULL,
	"low_balance" bigint DEFAULT 0 NOT NULL,
	"low_alerted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_bodies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request" text DEFAULT '' NOT NULL,
	"response" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"system" text DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"kb_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kbs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kb_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"kb_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"chars" integer DEFAULT 0 NOT NULL,
	"chunks" integer DEFAULT 0 NOT NULL,
	"charged" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_kb_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"kb_id" text NOT NULL,
	"doc_id" text NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" real[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_bodies" ADD CONSTRAINT "ai_bodies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_chat_id_ai_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."ai_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kbs" ADD CONSTRAINT "ai_kbs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_docs" ADD CONSTRAINT "ai_kb_docs_kb_id_ai_kbs_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."ai_kbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_chunks" ADD CONSTRAINT "ai_kb_chunks_kb_id_ai_kbs_id_fk" FOREIGN KEY ("kb_id") REFERENCES "public"."ai_kbs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_kb_chunks" ADD CONSTRAINT "ai_kb_chunks_doc_id_ai_kb_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."ai_kb_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_project_user_ix" ON "ai_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_body_user_ix" ON "ai_bodies" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_chat_user_ix" ON "ai_chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "ai_chat_msg_chat_ix" ON "ai_chat_messages" USING btree ("chat_id","id");--> statement-breakpoint
CREATE INDEX "ai_kb_user_ix" ON "ai_kbs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_kb_doc_kb_ix" ON "ai_kb_docs" USING btree ("kb_id");--> statement-breakpoint
CREATE INDEX "ai_kb_chunk_kb_ix" ON "ai_kb_chunks" USING btree ("kb_id");
