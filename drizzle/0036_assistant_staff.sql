ALTER TABLE "assistant_threads" ADD COLUMN "mode" text DEFAULT 'customer' NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "assistant_threads_user_ix";
--> statement-breakpoint
CREATE INDEX "assistant_threads_user_ix" ON "assistant_threads" USING btree ("user_id","account_id","mode");
