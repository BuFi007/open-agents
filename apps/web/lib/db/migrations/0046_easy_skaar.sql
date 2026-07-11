DROP INDEX "knowledge_entities_search_idx";--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "name" || ' ' || "kind" || ' ' || "external_key")) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "knowledge_entities_search_idx" ON "knowledge_entities" USING gin ("search_vector");