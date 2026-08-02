CREATE TYPE "public"."hub_billing_authorization_status" AS ENUM('reserved', 'captured', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "hub_billing_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reserved_amount_micros" bigint NOT NULL,
	"captured_amount_micros" bigint,
	"status" "hub_billing_authorization_status" DEFAULT 'reserved' NOT NULL,
	"reservation_journal_id" uuid NOT NULL,
	"settlement_journal_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_billing_authorizations_amount_check" CHECK ("hub_billing_authorizations"."reserved_amount_micros" > 0 AND ("hub_billing_authorizations"."captured_amount_micros" IS NULL OR "hub_billing_authorizations"."captured_amount_micros" >= 0))
);
--> statement-breakpoint
ALTER TABLE "hub_billing_authorizations" ADD CONSTRAINT "hub_billing_authorizations_request_id_hub_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hub_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_billing_authorizations" ADD CONSTRAINT "hub_billing_authorizations_reservation_journal_id_hub_ledger_journals_id_fk" FOREIGN KEY ("reservation_journal_id") REFERENCES "public"."hub_ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hub_billing_authorizations" ADD CONSTRAINT "hub_billing_authorizations_settlement_journal_id_hub_ledger_journals_id_fk" FOREIGN KEY ("settlement_journal_id") REFERENCES "public"."hub_ledger_journals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hub_billing_authorizations_request_uidx" ON "hub_billing_authorizations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "hub_billing_authorizations_expiry_idx" ON "hub_billing_authorizations" USING btree ("status","expires_at");
