CREATE TABLE "paas_egress" (
	"app_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'off' NOT NULL,
	"proxy_enc" text DEFAULT '' NOT NULL,
	"no_proxy" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paas_egress" ADD CONSTRAINT "paas_egress_app_id_paas_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."paas_apps"("id") ON DELETE cascade ON UPDATE no action;
