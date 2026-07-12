CREATE TABLE "queue_telemetry_exports" (
	"export_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"generated_at_ms" bigint NOT NULL,
	"fact_count" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "queue_telemetry_exports_export_id_check" CHECK (length("export_id") BETWEEN 2 AND 191),
	CONSTRAINT "queue_telemetry_exports_workspace_id_check" CHECK (length("workspace_id") BETWEEN 2 AND 191),
	CONSTRAINT "queue_telemetry_exports_run_id_check" CHECK (length("run_id") BETWEEN 2 AND 191),
	CONSTRAINT "queue_telemetry_exports_generated_at_check" CHECK ("generated_at_ms" > 0),
	CONSTRAINT "queue_telemetry_exports_fact_count_check" CHECK ("fact_count" > 0 AND "fact_count" <= 10000)
);
--> statement-breakpoint
CREATE INDEX "queue_telemetry_exports_workspace_idx" ON "queue_telemetry_exports" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "queue_telemetry_exports_workspace_run_idx" ON "queue_telemetry_exports" USING btree ("workspace_id","run_id");
--> statement-breakpoint
REVOKE ALL ON TABLE "queue_telemetry_exports" FROM PUBLIC;
