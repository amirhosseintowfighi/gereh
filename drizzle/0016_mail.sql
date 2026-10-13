CREATE TABLE "mail_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price" bigint NOT NULL,
	"daily_limit" integer NOT NULL,
	"monthly_limit" integer NOT NULL,
	"mailboxes" integer NOT NULL,
	"quota_mb" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"domain" text NOT NULL,
	"plan_id" text NOT NULL,
	"mode" text DEFAULT 'dev' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suspend_reason" text DEFAULT '' NOT NULL,
	"dkim_selector" text NOT NULL,
	"dkim_public" text NOT NULL,
	"dkim_private_enc" text NOT NULL,
	"return_path" text DEFAULT 'bounces' NOT NULL,
	"dmarc" jsonb NOT NULL,
	"dns_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dns_checked_at" timestamp with time zone,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"catch_all" text DEFAULT '' NOT NULL,
	"spam_threshold" real DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_smtp_users" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_mailboxes" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"local" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"quota_mb" integer NOT NULL,
	"used_mb" real DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"local" text NOT NULL,
	"destinations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"field" text NOT NULL,
	"op" text NOT NULL,
	"value" text NOT NULL,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"position" serial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"pattern" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"domain_id" text NOT NULL,
	"user_id" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"from" text NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bcc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipients" integer DEFAULT 1 NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"tag" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"raw" text DEFAULT '' NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_id" text DEFAULT '' NOT NULL,
	"mailbox_id" text,
	"spam_score" real,
	"read" boolean DEFAULT false NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"type" text NOT NULL,
	"recipient" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_smtp_users" ADD CONSTRAINT "mail_smtp_users_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailboxes" ADD CONSTRAINT "mail_mailboxes_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_aliases" ADD CONSTRAINT "mail_aliases_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_blocks" ADD CONSTRAINT "mail_blocks_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_events" ADD CONSTRAINT "mail_events_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_domain_uq" ON "mail_domains" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_domain_key_uq" ON "mail_domains" USING btree ("api_key_hash");--> statement-breakpoint
CREATE INDEX "mail_domain_user_ix" ON "mail_domains" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_smtp_user_uq" ON "mail_smtp_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "mail_smtp_domain_ix" ON "mail_smtp_users" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_mailbox_uq" ON "mail_mailboxes" USING btree ("domain_id","local");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_alias_uq" ON "mail_aliases" USING btree ("domain_id","local");--> statement-breakpoint
CREATE INDEX "mail_rule_domain_ix" ON "mail_rules" USING btree ("domain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_block_uq" ON "mail_blocks" USING btree ("domain_id","pattern");--> statement-breakpoint
CREATE INDEX "mail_msg_domain_ix" ON "mail_messages" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_msg_status_ix" ON "mail_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "mail_msg_mid_ix" ON "mail_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "mail_event_msg_ix" ON "mail_events" USING btree ("message_id");
