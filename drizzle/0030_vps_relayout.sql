CREATE TABLE "vps_relayout" (
	"server_id" text PRIMARY KEY NOT NULL,
	"sizes" jsonb NOT NULL,
	"before" text NOT NULL,
	"allowance_gb" integer NOT NULL,
	"osid" integer NOT NULL,
	"os" text NOT NULL,
	"pass_enc" text NOT NULL,
	"step" text DEFAULT 'read' NOT NULL,
	"plan" text DEFAULT 'A' NOT NULL,
	"prev_status" text NOT NULL,
	"old" jsonb,
	"new_vpsid" integer,
	"new_ip" text DEFAULT '' NOT NULL,
	"new_ipv6" text DEFAULT '' NOT NULL,
	"vnc" jsonb,
	"ip_kept" boolean DEFAULT false NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vps_relayout" ADD CONSTRAINT "vps_relayout_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;
