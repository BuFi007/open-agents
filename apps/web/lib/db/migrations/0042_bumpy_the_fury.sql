CREATE TABLE "knowledge_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"external_key" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"topic" text NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"last_error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"published_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entities_workspace_kind_external_idx" ON "knowledge_entities" USING btree ("workspace_id","kind","external_key");--> statement-breakpoint
CREATE INDEX "knowledge_entities_workspace_id_idx" ON "knowledge_entities" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "knowledge_outbox_workspace_claim_idx" ON "knowledge_outbox" USING btree ("workspace_id","status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_outbox_lease_expiry_idx" ON "knowledge_outbox" USING btree ("lease_expires_at");--> statement-breakpoint
ALTER TABLE "knowledge_entities"
  ADD CONSTRAINT "knowledge_entities_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "knowledge_entities_identity_bounded" CHECK (
    length("workspace_id") BETWEEN 1 AND 191
    AND length("external_key") BETWEEN 1 AND 500
    AND length("kind") BETWEEN 1 AND 120
    AND length("name") BETWEEN 1 AND 500
  );--> statement-breakpoint
ALTER TABLE "knowledge_outbox"
  ADD CONSTRAINT "knowledge_outbox_status_valid" CHECK ("status" IN ('pending', 'published', 'dead')),
  ADD CONSTRAINT "knowledge_outbox_attempts_nonnegative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "knowledge_outbox_schema_version_positive" CHECK ("schema_version" > 0),
  ADD CONSTRAINT "knowledge_outbox_identity_bounded" CHECK (
    length("workspace_id") BETWEEN 1 AND 191
    AND length("topic") BETWEEN 1 AND 191
  );--> statement-breakpoint
ALTER TABLE "knowledge_entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_entities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "knowledge_entities_workspace_isolation" ON "knowledge_entities"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));--> statement-breakpoint
ALTER TABLE "knowledge_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "knowledge_outbox_workspace_isolation" ON "knowledge_outbox"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'open_agents_knowledge_runtime') THEN
    CREATE ROLE open_agents_knowledge_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT open_agents_knowledge_runtime TO CURRENT_USER;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "knowledge_entities", "knowledge_outbox"
  TO open_agents_knowledge_runtime;
