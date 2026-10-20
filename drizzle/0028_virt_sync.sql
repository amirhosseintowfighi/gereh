CREATE TABLE "vps_sync" (
	"server_id" text PRIMARY KEY NOT NULL,
	"synced_at" timestamp with time zone,
	"state" text DEFAULT 'ok' NOT NULL,
	"missing_since" timestamp with time zone,
	"node" text DEFAULT '' NOT NULL,
	"node_id" integer DEFAULT 0 NOT NULL,
	"osid" integer DEFAULT 0 NOT NULL,
	"plid" integer DEFAULT 0 NOT NULL,
	"ram_mb" integer DEFAULT 0 NOT NULL,
	"net_speed" integer DEFAULT 0 NOT NULL,
	"suspend_reason" text DEFAULT '' NOT NULL,
	"bw_limit" integer DEFAULT 0 NOT NULL,
	"bw_pushed" integer,
	"bw_used" real DEFAULT 0 NOT NULL,
	"ipv4" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ipv6" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vps_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"user_id" text NOT NULL,
	"field" text NOT NULL,
	"before" text DEFAULT '' NOT NULL,
	"after" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vps_sync" ADD CONSTRAINT "vps_sync_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_sync_log" ADD CONSTRAINT "vps_sync_log_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vps_sync_log" ADD CONSTRAINT "vps_sync_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vps_sync_log_server_ix" ON "vps_sync_log" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE INDEX "vps_sync_log_user_ix" ON "vps_sync_log" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "vps_ips" ADD COLUMN "gone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vps_disks" ADD COLUMN "billed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "vps_disks" ADD COLUMN "gone_at" timestamp with time zone;
