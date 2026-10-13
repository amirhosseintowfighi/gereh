CREATE TABLE "storage_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"size_gb" integer NOT NULL,
	"price" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"plan_id" text NOT NULL,
	"access" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"versioning" boolean DEFAULT false NOT NULL,
	"cors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifecycle" jsonb,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"objects" integer DEFAULT 0 NOT NULL,
	"counters" jsonb DEFAULT '{"requests":0,"bytesIn":0,"bytesOut":0}'::jsonb NOT NULL,
	"usage_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspend_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"access_key" text NOT NULL,
	"secret_enc" text NOT NULL,
	"grants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "storage_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"host" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ssl" text DEFAULT 'pending' NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket_id" text NOT NULL,
	"day" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"objects" integer DEFAULT 0 NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"bytes_in" bigint DEFAULT 0 NOT NULL,
	"bytes_out" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_buckets" ADD CONSTRAINT "storage_buckets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_keys" ADD CONSTRAINT "storage_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_domains" ADD CONSTRAINT "storage_domains_bucket_id_storage_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."storage_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_usage" ADD CONSTRAINT "storage_usage_bucket_id_storage_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."storage_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_bucket_name_uq" ON "storage_buckets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "storage_bucket_user_ix" ON "storage_buckets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_key_access_uq" ON "storage_keys" USING btree ("access_key");--> statement-breakpoint
CREATE INDEX "storage_key_user_ix" ON "storage_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_domain_uq" ON "storage_domains" USING btree ("host");--> statement-breakpoint
CREATE INDEX "storage_domain_bucket_ix" ON "storage_domains" USING btree ("bucket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_usage_uq" ON "storage_usage" USING btree ("bucket_id","day");
