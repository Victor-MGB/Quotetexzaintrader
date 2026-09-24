CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whitelist" (
	"telegram_id" text PRIMARY KEY NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
