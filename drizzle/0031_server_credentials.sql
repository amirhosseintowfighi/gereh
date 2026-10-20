CREATE TABLE "server_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"username" text DEFAULT 'root' NOT NULL,
	"pass_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revealed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "server_credentials" ADD CONSTRAINT "server_credentials_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_credentials" ADD CONSTRAINT "server_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_credentials_uq" ON "server_credentials" USING btree ("server_id","kind");--> statement-breakpoint
CREATE INDEX "server_credentials_user_idx" ON "server_credentials" USING btree ("user_id");
