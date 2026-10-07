CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"from" text NOT NULL,
	"author" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"agent" text,
	"unread" boolean DEFAULT true NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author" text NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_msg_ix" ON "chat_messages" USING btree ("chat_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_token_uq" ON "chats" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "chat_status_ix" ON "chats" USING btree ("status","last_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_slug_uq" ON "posts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "post_pub_ix" ON "posts" USING btree ("status","published_at");