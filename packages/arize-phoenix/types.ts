/**
 * open-agents/arize-phoenix/types — public type surface.
 */

/** Provenance tag attached to recall + resolved-gap dataset rows. */
export type Provenance = "auto-promoted" | "human-curated";

/**
 * Telemetry metadata stamped onto AI SDK spans via
 * `experimental_telemetry.metadata`. The AI SDK prefixes these keys
 * with `ai.telemetry.metadata.` on the raw OTel span; the
 * OpenInference-vercel processor surfaces them for Phoenix queries.
 */
export interface AgentTelemetryMetadata {
  /** Open Agents session id — correlates traces to /sessions/<id>. */
  sessionId?: string;
  /** Chat id within the session. */
  chatId?: string;
  /** Origin of the run: "web" (human UI) or "bufi-dispatch" (minion bridge). */
  source?: string;
  /** Linear task id when the run came from the daily-plan coffee cron. */
  linearTaskId?: string;
  /** Target repo slug (owner/name) when known. */
  repo?: string;
}

/** Span attribute keys Phoenix queries filter on. */
export const BUFI_SPAN_ATTRS = {
  SESSION_ID: "ai.telemetry.metadata.sessionId",
  CHAT_ID: "ai.telemetry.metadata.chatId",
  SOURCE: "ai.telemetry.metadata.source",
  LINEAR_TASK_ID: "ai.telemetry.metadata.linearTaskId",
  REPO: "ai.telemetry.metadata.repo",
} as const;

export type BufiSpanAttr =
  (typeof BUFI_SPAN_ATTRS)[keyof typeof BUFI_SPAN_ATTRS];
