CREATE TABLE "operating_pack_credentials" (
	"run_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operating_pack_credentials" ADD CONSTRAINT "operating_pack_credentials_run_id_operating_pack_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."operating_pack_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operating_pack_credentials_expiry_idx" ON "operating_pack_credentials" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "operating_pack_credentials"
  ADD CONSTRAINT "operating_pack_credentials_bounded" CHECK (
    length("run_id") BETWEEN 2 AND 191
    AND length("workspace_id") BETWEEN 2 AND 191
    AND length("ciphertext") BETWEEN 1 AND 4096
    AND "ciphertext" ~ '^[A-Za-z0-9_-]+$'
    AND length("iv") = 16
    AND "iv" ~ '^[A-Za-z0-9_-]+$'
    AND length("auth_tag") = 22
    AND "auth_tag" ~ '^[A-Za-z0-9_-]+$'
    AND "expires_at" > "created_at"
  );
--> statement-breakpoint
REVOKE ALL ON TABLE "operating_pack_credentials" FROM PUBLIC;
