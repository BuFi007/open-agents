CREATE TABLE "knowledge_context_packets" (
	"packet_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"trace_id" text NOT NULL,
	"authorization_scope" text NOT NULL,
	"graph_watermark" text NOT NULL,
	"projection_watermark" text NOT NULL,
	"ontology_version" text NOT NULL,
	"packet" jsonb NOT NULL,
	"generated_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "knowledge_context_packets_workspace_run_idx" ON "knowledge_context_packets" USING btree ("workspace_id","workflow_run_id","agent_run_id","generated_at");--> statement-breakpoint
CREATE INDEX "knowledge_context_packets_workspace_expiry_idx" ON "knowledge_context_packets" USING btree ("workspace_id","expires_at");
--> statement-breakpoint
ALTER TABLE "knowledge_context_packets"
  ADD CONSTRAINT "knowledge_context_packets_bounded" CHECK (
    length("packet_hash") = 71
    AND "packet_hash" ~ '^sha256:[a-f0-9]{64}$'
    AND length("workspace_id") BETWEEN 1 AND 191
    AND length("workflow_run_id") BETWEEN 2 AND 191
    AND length("agent_run_id") BETWEEN 2 AND 191
    AND length("trace_id") BETWEEN 2 AND 191
    AND length("authorization_scope") BETWEEN 2 AND 191
    AND length("graph_watermark") BETWEEN 2 AND 191
    AND length("projection_watermark") BETWEEN 2 AND 191
    AND length("ontology_version") BETWEEN 2 AND 191
    AND jsonb_typeof("packet") = 'object'
    AND "generated_at" < "expires_at"
  );
--> statement-breakpoint
ALTER TABLE "knowledge_context_packets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_context_packets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "knowledge_context_packets_workspace_isolation" ON "knowledge_context_packets"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "knowledge_context_packets"
  TO open_agents_knowledge_runtime;
