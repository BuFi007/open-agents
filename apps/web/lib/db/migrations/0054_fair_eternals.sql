CREATE TABLE "tax_invoice_bindings" (
	"workspace_id" text NOT NULL,
	"ledger_invoice_id" text NOT NULL,
	"operating_pack_run_id" text NOT NULL,
	"tax_run_id" text NOT NULL,
	"tax_idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_invoice_bindings_workspace_id_ledger_invoice_id_pk" PRIMARY KEY("workspace_id","ledger_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "tax_settlement_deliveries" (
	"event_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"ledger_invoice_id" text NOT NULL,
	"operating_pack_run_id" text,
	"tax_run_id" text,
	"event_type" text NOT NULL,
	"reverses_event_id" text,
	"replay_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'waiting_for_case' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"processing_token" text,
	"processing_started_at" timestamp,
	"last_error_code" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_invoice_bindings" ADD CONSTRAINT "tax_invoice_bindings_operating_pack_run_id_operating_pack_runs_id_fk" FOREIGN KEY ("operating_pack_run_id") REFERENCES "public"."operating_pack_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_settlement_deliveries" ADD CONSTRAINT "tax_settlement_deliveries_operating_pack_run_id_operating_pack_runs_id_fk" FOREIGN KEY ("operating_pack_run_id") REFERENCES "public"."operating_pack_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_bindings_operating_pack_run_idx" ON "tax_invoice_bindings" USING btree ("operating_pack_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_invoice_bindings_tax_run_idx" ON "tax_invoice_bindings" USING btree ("tax_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_settlement_deliveries_workspace_replay_idx" ON "tax_settlement_deliveries" USING btree ("workspace_id","replay_key");--> statement-breakpoint
CREATE INDEX "tax_settlement_deliveries_pending_run_idx" ON "tax_settlement_deliveries" USING btree ("operating_pack_run_id","status");--> statement-breakpoint
CREATE INDEX "tax_settlement_deliveries_workspace_ledger_invoice_idx" ON "tax_settlement_deliveries" USING btree ("workspace_id","ledger_invoice_id");--> statement-breakpoint
CREATE INDEX "tax_settlement_deliveries_reversal_dependency_idx" ON "tax_settlement_deliveries" USING btree ("workspace_id","reverses_event_id","status");