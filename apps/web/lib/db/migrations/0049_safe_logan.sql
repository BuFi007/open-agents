CREATE TABLE "knowledge_enrichments" (
	"entity_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"classifier_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"source_version" integer NOT NULL,
	"classification" text NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_enrichments_entity_id_classifier_version_pk" PRIMARY KEY("entity_id","classifier_version")
);
--> statement-breakpoint
CREATE TABLE "knowledge_search_projections" (
	"entity_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"collection" text NOT NULL,
	"schema_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"source_version" integer NOT NULL,
	"provider_revision" text,
	"projected_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_search_projections_entity_id_provider_collection_pk" PRIMARY KEY("entity_id","provider","collection")
);
--> statement-breakpoint
ALTER TABLE "knowledge_enrichments" ADD CONSTRAINT "knowledge_enrichments_entity_workspace_fk" FOREIGN KEY ("entity_id","workspace_id") REFERENCES "public"."knowledge_entities"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_search_projections" ADD CONSTRAINT "knowledge_search_projections_entity_workspace_fk" FOREIGN KEY ("entity_id","workspace_id") REFERENCES "public"."knowledge_entities"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_enrichments_workspace_classification_idx" ON "knowledge_enrichments" USING btree ("workspace_id","classification");--> statement-breakpoint
CREATE INDEX "knowledge_search_projections_workspace_version_idx" ON "knowledge_search_projections" USING btree ("workspace_id","source_version");
--> statement-breakpoint
ALTER TABLE "knowledge_enrichments"
  ADD CONSTRAINT "knowledge_enrichments_bounded" CHECK (
    length("workspace_id") BETWEEN 1 AND 191
    AND length("classifier_version") BETWEEN 1 AND 120
    AND length("input_hash") = 71
    AND "input_hash" ~ '^sha256:[a-f0-9]{64}$'
    AND "source_version" > 0
    AND length("classification") BETWEEN 1 AND 120
    AND "confidence" BETWEEN 0 AND 1
  );
--> statement-breakpoint
ALTER TABLE "knowledge_search_projections"
  ADD CONSTRAINT "knowledge_search_projections_bounded" CHECK (
    length("workspace_id") BETWEEN 1 AND 191
    AND length("provider") BETWEEN 1 AND 120
    AND length("collection") BETWEEN 1 AND 120
    AND length("schema_version") BETWEEN 1 AND 120
    AND length("input_hash") = 71
    AND "input_hash" ~ '^sha256:[a-f0-9]{64}$'
    AND "source_version" > 0
    AND ("provider_revision" IS NULL OR length("provider_revision") BETWEEN 1 AND 191)
  );
--> statement-breakpoint
ALTER TABLE "knowledge_enrichments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_enrichments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "knowledge_enrichments_workspace_isolation" ON "knowledge_enrichments"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));
--> statement-breakpoint
ALTER TABLE "knowledge_search_projections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "knowledge_search_projections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "knowledge_search_projections_workspace_isolation" ON "knowledge_search_projections"
  FOR ALL
  USING ("workspace_id" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspace_id" = current_setting('app.workspace_id', true));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE
  "knowledge_enrichments", "knowledge_search_projections"
  TO open_agents_knowledge_runtime;
