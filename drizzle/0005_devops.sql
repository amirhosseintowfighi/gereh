CREATE TABLE "devops_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"size" text NOT NULL,
	"stage" text NOT NULL,
	"infra" text[] NOT NULL,
	"services" text[] NOT NULL,
	"pkg" text DEFAULT '' NOT NULL,
	"budget" text NOT NULL,
	"urgency" text NOT NULL,
	"needs_nda" boolean DEFAULT false NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"assignee" text DEFAULT '' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_id" text,
	"source" text DEFAULT '' NOT NULL,
	"ip" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devops_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lead_id" text,
	"title" text NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"monthly_fee" bigint DEFAULT 0 NOT NULL,
	"hours_included" integer DEFAULT 0 NOT NULL,
	"hours_used" real DEFAULT 0 NOT NULL,
	"engineer" text DEFAULT '' NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_bill_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devops_leads" ADD CONSTRAINT "devops_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devops_projects" ADD CONSTRAINT "devops_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devops_projects" ADD CONSTRAINT "devops_projects_lead_id_devops_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."devops_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devops_lead_status_ix" ON "devops_leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "devops_project_user_ix" ON "devops_projects" USING btree ("user_id");