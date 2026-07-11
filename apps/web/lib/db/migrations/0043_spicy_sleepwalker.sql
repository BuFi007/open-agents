CREATE TABLE "connector_deployments" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"environment" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_event_receipts" (
	"deployment_id" text NOT NULL,
	"event_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"timestamp_ms" bigint NOT NULL,
	"body_hash" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connector_event_receipts_deployment_id_event_id_pk" PRIMARY KEY("deployment_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "source_artifacts" (
	"artifact_key" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"connector_id" text NOT NULL,
	"provider" text NOT NULL,
	"content_hash" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"safe_storage_ref" text NOT NULL,
	"source_revision" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"received_at" timestamp NOT NULL,
	"observed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_event_receipts" ADD CONSTRAINT "connector_event_receipts_deployment_id_connector_deployments_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."connector_deployments"("deployment_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_deployments_workspace_connection_env_idx" ON "connector_deployments" USING btree ("workspace_id","connection_id","environment");--> statement-breakpoint
CREATE INDEX "connector_deployments_workspace_idx" ON "connector_deployments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "connector_event_receipts_workspace_received_idx" ON "connector_event_receipts" USING btree ("workspace_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_artifacts_workspace_revision_idx" ON "source_artifacts" USING btree ("workspace_id","source_revision");--> statement-breakpoint
CREATE INDEX "source_artifacts_workspace_observed_idx" ON "source_artifacts" USING btree ("workspace_id","observed_at");
--> statement-breakpoint
ALTER TABLE "connector_deployments"
  ADD CONSTRAINT "connector_deployments_environment_valid" CHECK ("environment" IN ('development', 'staging', 'production')),
  ADD CONSTRAINT "connector_deployments_identity_bounded" CHECK (
    length("deployment_id") BETWEEN 8 AND 191
    AND length("workspace_id") BETWEEN 1 AND 191
    AND length("connection_id") BETWEEN 1 AND 127
    AND length("manifest_hash") = 71
    AND octet_length("manifest"::text) <= 65536
  );
--> statement-breakpoint
ALTER TABLE "connector_event_receipts"
  ADD CONSTRAINT "connector_event_receipts_identity_bounded" CHECK (
    length("event_id") BETWEEN 8 AND 191
    AND length("workspace_id") BETWEEN 1 AND 191
    AND length("body_hash") = 71
    AND "timestamp_ms" > 0
  );
--> statement-breakpoint
ALTER TABLE "source_artifacts"
  ADD CONSTRAINT "source_artifacts_provider_valid" CHECK ("provider" IN ('manual', 'gmail', 'outlook', 'pipedream')),
  ADD CONSTRAINT "source_artifacts_bounded" CHECK (
    length("workspace_id") BETWEEN 1 AND 191
    AND length("connector_id") BETWEEN 1 AND 191
    AND length("content_hash") = 71
    AND length("mime_type") BETWEEN 3 AND 191
    AND length("safe_storage_ref") BETWEEN 1 AND 500
    AND "size_bytes" BETWEEN 0 AND 262144000
    AND octet_length("metadata"::text) <= 65536
  );
--> statement-breakpoint
ALTER TABLE "connector_deployments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "connector_deployments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "connector_deployments_runtime_scope" ON "connector_deployments"
  FOR ALL
  USING ("deployment_id" = current_setting('app.deployment_id', true))
  WITH CHECK ("deployment_id" = current_setting('app.deployment_id', true));
--> statement-breakpoint
ALTER TABLE "connector_event_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "connector_event_receipts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "connector_event_receipts_runtime_scope" ON "connector_event_receipts"
  FOR ALL
  USING (
    "deployment_id" = current_setting('app.deployment_id', true)
    AND "workspace_id" = current_setting('app.workspace_id', true)
  )
  WITH CHECK (
    "deployment_id" = current_setting('app.deployment_id', true)
    AND "workspace_id" = current_setting('app.workspace_id', true)
  );
--> statement-breakpoint
ALTER TABLE "source_artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "source_artifacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "source_artifacts_workspace_isolation" ON "source_artifacts"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_agents_connector_runtime') THEN
    CREATE ROLE open_agents_connector_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT open_agents_connector_runtime TO CURRENT_USER;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
  "connector_deployments", "connector_event_receipts", "source_artifacts"
  TO open_agents_connector_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "knowledge_outbox"
  TO open_agents_connector_runtime;
