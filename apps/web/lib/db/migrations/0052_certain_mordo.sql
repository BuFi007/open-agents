CREATE TABLE "operating_pack_composition_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"revision" integer NOT NULL,
	"event_type" text NOT NULL,
	"items" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_pack_compositions" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operating_pack_compositions_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "operating_pack_composition_revisions" ADD CONSTRAINT "operating_pack_composition_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_pack_compositions" ADD CONSTRAINT "operating_pack_compositions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operating_pack_composition_revisions_scope_revision_idx" ON "operating_pack_composition_revisions" USING btree ("workspace_id","user_id","revision");--> statement-breakpoint
CREATE INDEX "operating_pack_composition_revisions_scope_idx" ON "operating_pack_composition_revisions" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "operating_pack_compositions_user_idx" ON "operating_pack_compositions" USING btree ("user_id");