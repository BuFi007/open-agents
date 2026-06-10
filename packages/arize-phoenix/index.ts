/**
 * open-agents/arize-phoenix — Arize Phoenix observability for Open
 * Agents.
 *
 * This is the ONLY package that imports `@arizeai/*` and the Phoenix
 * OTLP exporter directly. All surfaces (web app, agent runtime, crons)
 * import from here.
 *
 * Quick start:
 *   1. Set PHOENIX_API_KEY (+ PHOENIX_COLLECTOR_ENDPOINT) in env
 *   2. `apps/web/instrumentation.ts` calls registerPhoenixOtel()
 *   3. The agent enables `experimental_telemetry` per call — AI SDK
 *      spans flow to Phoenix as OpenInference traces
 *   4. Read-side introspection: recallSimilarRuns / findResolvedGap
 *   5. Auto-curation: promoteSuccesses / promoteResolutions
 */

export {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  getPhoenixUiBaseUrl,
  isPhoenixEnabled,
} from "./client";
export {
  findResolvedGap,
  RESOLVED_GAPS_DATASET,
  resetResolvedGapsDatasetCache,
  type FindResolvedGapArgs,
  type FindResolvedGapResult,
  type ResolvedGapHit,
} from "./experiments";
export { buildPhoenixSpanProcessor, registerPhoenixOtel } from "./otel";
export {
  extractMustMention,
  promoteResolutions,
  promoteSuccesses,
  RECALL_DATASET,
  type CompletedSessionRow,
  type KnowledgeGapRow,
  type PromoteReport,
  type PromoteResolutionsArgs,
  type PromoteSuccessesArgs,
} from "./promote";
export {
  recallSimilarRuns,
  type RecallSimilarRun,
  type RecallSimilarRunsArgs,
  type RecallSimilarRunsResult,
} from "./recall";
export {
  BUFI_SPAN_ATTRS,
  type AgentTelemetryMetadata,
  type BufiSpanAttr,
  type Provenance,
} from "./types";
