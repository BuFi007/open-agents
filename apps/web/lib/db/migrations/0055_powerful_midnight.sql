CREATE TABLE "tax_domain_event_deliveries" (
	"event_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"case_ref" text,
	"operating_pack_run_id" text,
	"tax_run_id" text,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'waiting_for_case' NOT NULL,
	"woken_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_domain_event_deliveries" ADD CONSTRAINT "tax_domain_event_deliveries_operating_pack_run_id_operating_pack_runs_id_fk" FOREIGN KEY ("operating_pack_run_id") REFERENCES "public"."operating_pack_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_domain_event_deliveries_workspace_idempotency_idx" ON "tax_domain_event_deliveries" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "tax_domain_event_deliveries_case_idx" ON "tax_domain_event_deliveries" USING btree ("workspace_id","tax_run_id","status");