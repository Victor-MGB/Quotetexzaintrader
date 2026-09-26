CREATE TABLE "admins" (
	"telegram_id" text PRIMARY KEY NOT NULL,
	"added_by" text,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" integer,
	"method" text,
	"reference" text,
	"address" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "transactions_telegram_id_idx" ON "transactions" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");