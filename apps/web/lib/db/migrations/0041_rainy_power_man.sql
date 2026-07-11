CREATE TABLE "operating_pack_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"harness_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_id" text,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "operating_pack_runs_workflow_run_id_unique" UNIQUE("workflow_run_id")
);
--> statement-breakpoint
CREATE TABLE "operating_pack_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"agent_id" text,
	"summary" text,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operating_pack_runs" ADD CONSTRAINT "operating_pack_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_pack_runs" ADD CONSTRAINT "operating_pack_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_pack_runs" ADD CONSTRAINT "operating_pack_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_pack_traces" ADD CONSTRAINT "operating_pack_traces_run_id_operating_pack_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."operating_pack_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operating_pack_runs_workspace_idempotency_idx" ON "operating_pack_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "operating_pack_runs_session_id_idx" ON "operating_pack_runs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "operating_pack_runs_user_id_idx" ON "operating_pack_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "operating_pack_runs_status_idx" ON "operating_pack_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "operating_pack_traces_run_sequence_idx" ON "operating_pack_traces" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "operating_pack_traces_workspace_run_idx" ON "operating_pack_traces" USING btree ("workspace_id","run_id");
