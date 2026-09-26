CREATE TABLE "referrals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "referrals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"referrer_id" text NOT NULL,
	"invitee_id" text NOT NULL,
	"status" text DEFAULT 'joined' NOT NULL,
	"reward_paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_invitee_id_idx" ON "referrals" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_id_idx" ON "referrals" USING btree ("referrer_id");