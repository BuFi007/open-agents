CREATE TABLE "tax_case_bindings" (
	"workspace_id" text NOT NULL,
	"tax_run_id" text NOT NULL,
	"operating_pack_run_id" text NOT NULL,
	"case_kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_case_bindings_workspace_id_tax_run_id_pk" PRIMARY KEY("workspace_id","tax_run_id")
);
--> statement-breakpoint
CREATE TABLE "tax_domain_event_targets" (
	"event_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"operating_pack_run_id" text NOT NULL,
	"tax_run_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_token" text,
	"lease_until" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"woken_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_domain_event_targets_event_id_operating_pack_run_id_pk" PRIMARY KEY("event_id","operating_pack_run_id")
);
--> statement-breakpoint
ALTER TABLE "tax_case_bindings" ADD CONSTRAINT "tax_case_bindings_operating_pack_run_id_operating_pack_runs_id_fk" FOREIGN KEY ("operating_pack_run_id") REFERENCES "public"."operating_pack_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_domain_event_targets" ADD CONSTRAINT "tax_domain_event_targets_event_id_tax_domain_event_deliveries_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."tax_domain_event_deliveries"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_case_bindings_operating_pack_run_idx" ON "tax_case_bindings" USING btree ("operating_pack_run_id");--> statement-breakpoint
CREATE INDEX "tax_case_bindings_workspace_status_idx" ON "tax_case_bindings" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "tax_domain_event_targets_pending_idx" ON "tax_domain_event_targets" USING btree ("event_id","status","lease_until");--> statement-breakpoint
CREATE INDEX "tax_domain_event_targets_workspace_case_idx" ON "tax_domain_event_targets" USING btree ("workspace_id","tax_run_id");