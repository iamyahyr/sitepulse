ALTER TABLE "worker_heartbeats" ADD COLUMN "offline_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "worker_heartbeats" ADD COLUMN "offline_reason" text;