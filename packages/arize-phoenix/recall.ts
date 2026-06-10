/**
 * open-agents/arize-phoenix/recall — Phoenix span search for the
 * `recall_similar_runs` introspection tool.
 *
 * Reads spans from the Phoenix REST API for this project, filtered by
 * optional session id and time bounds, lexically matched against a
 * query. **Fail-soft** — any non-2xx response or fetch error returns
 * `{ available: false }` so the agent falls through to
 * plan-from-scratch (cold path).
 *
 * v0.1 scope:
 *   - Lexical (token) match — no embedding similarity yet
 *   - 30-day window with min-age guard (anti-injection: a trace must
 *     be ≥ 5 min old before recall picks it up)
 */

import { phoenixFetch } from "./_fetch";
import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  isPhoenixEnabled,
} from "./client";
import { BUFI_SPAN_ATTRS, type Provenance } from "./types";

export interface RecallSimilarRunsArgs {
  /** User intent / mission driving the planning. Used for lexical match. */
  query: string;
  /** Restrict to a single Open Agents session. */
  sessionId?: string;
  /** Restrict to a repo slug (owner/name). */
  repo?: string;
  /** Top-N to return (after filter + sort). Default 3, max 10. */
  limit?: number;
  /** Only include runs that errored — the self-heal lookup path. */
  failuresOnly?: boolean;
  /**
   * Minimum age in seconds before a trace is recall-eligible. Default
   * 300 (5 min). Blocks zero-day pollution of the very next turn.
   */
  minAgeSeconds?: number;
}

export interface RecallSimilarRun {
  traceId: string;
  /** Truncated input value (≤ 300 chars) for the agent to read. */
  summary: string;
  outcome: "completed" | "errored" | "unknown";
  latencyMs: number;
  appliedTools: string[];
  /** Provenance source — always "live-trace" from the spans endpoint. */
  provenance: Provenance | "live-trace";
  /** ISO timestamp of when the original run happened. */
  occurredAt: string;
  /** Open Agents session the trace belongs to, when stamped. */
  sessionId?: string;
  /** Repo slug (owner/name) when stamped. */
  repo?: string;
}

export interface RecallSimilarRunsResult {
  available: boolean;
  /** Reason when `available: false`. */
  reason?: string;
  results: RecallSimilarRun[];
}

const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_AGE_SECONDS = 300;
const RECALL_WINDOW_DAYS = 30;
const FETCH_TIMEOUT_MS = 4000;
const SUMMARY_MAX_CHARS = 300;

export async function recallSimilarRuns(
  args: RecallSimilarRunsArgs,
): Promise<RecallSimilarRunsResult> {
  if (!isPhoenixEnabled()) {
    return { available: false, reason: "phoenix-not-configured", results: [] };
  }

  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, "");
  const apiKey = getPhoenixApiKey();
  const project = getPhoenixProjectName();
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), 10);
  const minAge = args.minAgeSeconds ?? DEFAULT_MIN_AGE_SECONDS;

  // Time bounds: at least minAge old, at most RECALL_WINDOW_DAYS.
  const now = Date.now();
  const endTime = new Date(now - minAge * 1000).toISOString();
  const startTime = new Date(
    now - RECALL_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Project-scoped span list (verified against Phoenix Cloud 2026-06:
  // the older `GET /v1/spans?project_name=` shape now 422s; the
  // project-scoped GET works). Session/repo/time/outcome filters all
  // happen client-side on the overfetched window.
  const url = new URL(
    `${collector}/v1/projects/${encodeURIComponent(project)}/spans`,
  );
  url.searchParams.set("limit", "100");

  try {
    const res = await phoenixFetch(url.toString(), {
      method: "GET",
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        accept: "application/json",
      },
      timeoutMs: FETCH_TIMEOUT_MS,
    });

    if (!res.ok) {
      return {
        available: false,
        reason: `phoenix-http-${res.status}`,
        results: [],
      };
    }

    const data = (await res.json()) as { data?: unknown } | null;
    const spans = Array.isArray(data?.data) ? data.data : [];

    const queryLower = args.query.toLowerCase();
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();

    const filtered: RecallSimilarRun[] = (
      spans as Array<Record<string, unknown>>
    )
      .map((span) => mapSpanToRecall(span))
      .filter((run): run is RecallSimilarRun => run !== null)
      .filter((run) => {
        const occurredMs = new Date(run.occurredAt).getTime();
        return occurredMs >= startMs && occurredMs <= endMs;
      })
      .filter((run) =>
        args.sessionId ? run.sessionId === args.sessionId : true,
      )
      .filter((run) => (args.repo ? run.repo === args.repo : true))
      .filter((run) => (args.failuresOnly ? run.outcome === "errored" : true))
      .filter((run) => {
        if (queryLower.length <= 4) {
          return true;
        }
        // Cheap relevance: at least one query token > 3 chars present.
        const haystack = run.summary.toLowerCase();
        const tokens = queryLower.split(/\W+/).filter((t) => t.length > 3);
        return tokens.length === 0 || tokens.some((t) => haystack.includes(t));
      })
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      )
      .slice(0, limit);

    return { available: true, results: filtered };
  } catch (error) {
    // phoenixFetch normally swallows errors and returns ok=false, but
    // post-fetch processing (json shape, mapper) can still throw.
    return {
      available: false,
      reason:
        error instanceof Error
          ? `phoenix-process-${error.name}`
          : "phoenix-process-error",
      results: [],
    };
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapSpanToRecall(
  span: Record<string, unknown>,
): RecallSimilarRun | null {
  const ctx = (span.context ?? span) as Record<string, unknown>;
  const traceId = readString(ctx.trace_id) ?? readString(span.trace_id);
  if (!traceId) {
    return null;
  }

  const startTime =
    readString(span.start_time) ??
    readString((span as { startTime?: unknown }).startTime);
  const endTime =
    readString(span.end_time) ??
    readString((span as { endTime?: unknown }).endTime);

  const startMs = startTime ? new Date(startTime).getTime() : 0;
  const endMs = endTime ? new Date(endTime).getTime() : startMs;
  const latencyMs = Math.max(0, endMs - startMs);

  const attrs = (span.attributes as Record<string, unknown> | undefined) ?? {};

  const summaryRaw = (
    readString(attrs["input.value"]) ??
    readString(attrs["llm.input_messages"]) ??
    ""
  ).slice(0, SUMMARY_MAX_CHARS);

  const statusCode = readString(span.status_code) ?? readString(span.status);
  let outcome: RecallSimilarRun["outcome"] = "unknown";
  if (statusCode === "OK") {
    outcome = "completed";
  } else if (statusCode === "ERROR") {
    outcome = "errored";
  }

  const toolsRaw = attrs["llm.tools"];
  const appliedTools = Array.isArray(toolsRaw) ? toolsRaw.map(String) : [];

  const sessionId =
    readString(attrs[BUFI_SPAN_ATTRS.SESSION_ID]) ??
    readString(attrs["metadata.sessionId"]) ??
    undefined;
  const repo =
    readString(attrs[BUFI_SPAN_ATTRS.REPO]) ??
    readString(attrs["metadata.repo"]) ??
    undefined;

  return {
    traceId,
    summary: summaryRaw,
    outcome,
    latencyMs,
    appliedTools,
    provenance: "live-trace",
    occurredAt: startTime ?? new Date().toISOString(),
    ...(sessionId ? { sessionId } : {}),
    ...(repo ? { repo } : {}),
  };
}
