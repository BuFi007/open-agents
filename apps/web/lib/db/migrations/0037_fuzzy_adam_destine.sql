-- Arize Phoenix observability: per-session LLM-as-judge eval score +
-- label, written by the eval pipeline, rendered in the sessions UI.
-- NOTE: drizzle-kit also re-emitted the bufi_callback_* columns here
-- because 0036 was hand-written (snapshot lag); they're trimmed — 0036
-- already applied them with IF NOT EXISTS.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "eval_score" real;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "eval_label" text;
