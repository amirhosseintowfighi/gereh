CREATE TABLE "vps_power" (
	"server_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vps_layouts" (
	"server_id" text PRIMARY KEY NOT NULL,
	"allowance_gb" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_hourly" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"cpu" real DEFAULT 0 NOT NULL,
	"ram" real DEFAULT 0 NOT NULL,
	"disk" real DEFAULT 0 NOT NULL,
	"net_in" real DEFAULT 0 NOT NULL,
	"net_out" real DEFAULT 0 NOT NULL,
	"io_read" real DEFAULT 0 NOT NULL,
	"io_write" real DEFAULT 0 NOT NULL,
	"n" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_samples" ADD COLUMN "io_read" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_samples" ADD COLUMN "io_write" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vps_power" ADD CONSTRAINT "vps_power_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_layouts" ADD CONSTRAINT "vps_layouts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_hourly" ADD CONSTRAINT "usage_hourly_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_hourly_uq" ON "usage_hourly" USING btree ("server_id","hour");
