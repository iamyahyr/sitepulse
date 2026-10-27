CREATE TABLE "site_degradations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"baseline_ms" real NOT NULL,
	"peak_ms" real NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "incident_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "degradation_id" uuid;--> statement-breakpoint
ALTER TABLE "site_degradations" ADD CONSTRAINT "site_degradations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_degradations_site_time_idx" ON "site_degradations" USING btree ("site_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "site_degradations_one_open_per_site" ON "site_degradations" USING btree ("site_id") WHERE "site_degradations"."resolved_at" is null;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_degradation_id_site_degradations_id_fk" FOREIGN KEY ("degradation_id") REFERENCES "public"."site_degradations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_degradation_once" ON "notifications" USING btree ("degradation_id","channel_id","kind");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_one_subject" CHECK (("notifications"."incident_id" is null) <> ("notifications"."degradation_id" is null));