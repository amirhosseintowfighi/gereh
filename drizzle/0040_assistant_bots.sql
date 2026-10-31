CREATE TABLE "assistant_bot_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"thread_id" text,
	"staff_mode" boolean DEFAULT false NOT NULL,
	"notify_channel_id" text,
	"cred_mark" text DEFAULT '' NOT NULL,
	"last_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_bot_buttons" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"action_id" text NOT NULL,
	"token_enc" text NOT NULL,
	"message_id" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_bot_chats" ADD CONSTRAINT "assistant_bot_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_bot_chats" ADD CONSTRAINT "assistant_bot_chats_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_bot_chats" ADD CONSTRAINT "assistant_bot_chats_thread_id_assistant_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."assistant_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_bot_chats" ADD CONSTRAINT "assistant_bot_chats_notify_channel_id_notify_channels_id_fk" FOREIGN KEY ("notify_channel_id") REFERENCES "public"."notify_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_bot_buttons" ADD CONSTRAINT "assistant_bot_buttons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_bot_buttons" ADD CONSTRAINT "assistant_bot_buttons_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_bot_buttons" ADD CONSTRAINT "assistant_bot_buttons_action_id_assistant_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."assistant_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_bot_chats_chat_uq" ON "assistant_bot_chats" USING btree ("kind","chat_id");--> statement-breakpoint
CREATE INDEX "assistant_bot_chats_user_ix" ON "assistant_bot_chats" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "assistant_bot_buttons_action_ix" ON "assistant_bot_buttons" USING btree ("action_id");
