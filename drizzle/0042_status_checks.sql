CREATE TABLE "status_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"component" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "status_checks_ix" ON "status_checks" USING btree ("component","created_at");
