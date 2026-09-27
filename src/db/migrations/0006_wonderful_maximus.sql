CREATE TABLE "testimonies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "testimonies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"message" text NOT NULL,
	"plan" text,
	"media" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_by" text NOT NULL,
	"by_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "testimonies_status_idx" ON "testimonies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "testimonies_submitted_by_idx" ON "testimonies" USING btree ("submitted_by");