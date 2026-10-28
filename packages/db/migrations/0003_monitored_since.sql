ALTER TABLE "sites" ADD COLUMN "monitored_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing sites have been monitored since they were created.
UPDATE "sites" SET "monitored_since" = "created_at";
