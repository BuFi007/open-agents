ALTER TABLE "knowledge_embeddings" DROP CONSTRAINT "knowledge_embeddings_entity_id_knowledge_entities_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entities_id_workspace_idx" ON "knowledge_entities" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_entity_workspace_fk" FOREIGN KEY ("entity_id","workspace_id") REFERENCES "public"."knowledge_entities"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
