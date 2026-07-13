DROP INDEX "knowledge_entities_search_idx";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint
CREATE INDEX "knowledge_entities_search_idx" ON "knowledge_entities" USING gin ("workspace_id",to_tsvector('simple', "name" || ' ' || "kind" || ' ' || "external_key"));
