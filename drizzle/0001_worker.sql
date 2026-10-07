CREATE TABLE "schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"cpu" real NOT NULL,
	"ram" real NOT NULL,
	"disk" real NOT NULL,
	"net_in" real NOT NULL,
	"net_out" real NOT NULL,
	"bw_used" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "hosting" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_pay" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_samples" ADD CONSTRAINT "usage_samples_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_server_time_ix" ON "usage_samples" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hosting_order_uq" ON "hosting" USING btree ("order_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_order_uq" ON "servers" USING btree ("order_ref");