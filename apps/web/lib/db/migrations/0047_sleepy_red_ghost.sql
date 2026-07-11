CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "knowledge_embeddings" (
	"entity_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"model" text NOT NULL,
	"input_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"source_version" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_embeddings_entity_id_model_input_version_pk" PRIMARY KEY("entity_id","model","input_version")
);
--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_entity_id_knowledge_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."knowledge_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_embeddings_workspace_model_idx" ON "knowledge_embeddings" USING btree ("workspace_id","model","input_version");--> statement-breakpoint
CREATE INDEX "knowledge_embeddings_cosine_idx" ON "knowledge_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);
--> statement-breakpoint
ALTER TABLE "knowledge_embeddings"
  ADD CONSTRAINT "knowledge_embeddings_bounded" CHECK (
    length("workspace_id") BETWEEN 1 AND 191
    AND length("model") BETWEEN 1 AND 191
    AND length("input_version") BETWEEN 1 AND 120
    AND "input_hash" ~ '^sha256:[a-f0-9]{64}$'
    AND "source_version" > 0
  );
--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "knowledge_embeddings_workspace_isolation" ON "knowledge_embeddings"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "knowledge_embeddings"
  TO open_agents_knowledge_runtime;
