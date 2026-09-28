CREATE TABLE "access_requests" (
	"telegram_id" text PRIMARY KEY NOT NULL,
	"username" text,
	"firstName" text,
	"lastName" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"notified_at" timestamp,
	"decided_at" timestamp,
	"decided_by" text
);
