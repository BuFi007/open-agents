/**
 * open-agents/arize-phoenix/otel — OpenInference span processor +
 * global provider registration.
 *
 * Phoenix Cloud accepts standard OTLP HTTP at `<collector>/v1/traces`
 * with the API key as a Bearer token. AI SDK spans (emitted when
 * `experimental_telemetry` is enabled) are converted to OpenInference
 * semantic conventions by `OpenInferenceBatchSpanProcessor` so Phoenix
 * renders inputs/outputs/tool calls natively.
 *
 * **Architecture note.** OTel v2 `BasicTracerProvider` does NOT expose
 * `addSpanProcessor()` — span processors must be passed to the
 * constructor. A single global provider is constructed once at server
 * startup by `registerPhoenixOtel()` (called from
 * `apps/web/instrumentation.ts`).
 */

import { SEMRESATTRS_PROJECT_NAME } from "@arizeai/openinference-semantic-conventions";
import {
  isOpenInferenceSpan,
  OpenInferenceBatchSpanProcessor,
} from "@arizeai/openinference-vercel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  getPhoenixProjectName,
  isPhoenixEnabled,
} from "./client";

let registered = false;
let activeProvider: NodeTracerProvider | null = null;

/**
 * Build a span processor that exports AI SDK spans to Phoenix via OTLP
 * HTTP, converting them to OpenInference conventions. Returns `null`
 * when Phoenix is not configured — caller skips.
 */
export function buildPhoenixSpanProcessor(): SpanProcessor | null {
  if (!isPhoenixEnabled()) {
    return null;
  }

  try {
    const collector = getPhoenixCollectorEndpoint().replace(/\/$/, "");
    const apiKey = getPhoenixApiKey();

    const exporter = new OTLPTraceExporter({
      url: `${collector}/v1/traces`,
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    });

    return new OpenInferenceBatchSpanProcessor({
      exporter,
      spanFilter: isOpenInferenceSpan,
    });
  } catch (error) {
    console.warn(
      "[arize-phoenix] Failed to build span processor:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Construct + register the global NodeTracerProvider with the Phoenix
 * processor. Idempotent — repeat calls are no-ops. Call once from
 * Next.js `instrumentation.ts` (nodejs runtime only).
 */
export function registerPhoenixOtel(): boolean {
  if (registered) {
    return true;
  }

  const processor = buildPhoenixSpanProcessor();
  if (!processor) {
    return false;
  }

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [SEMRESATTRS_PROJECT_NAME]: getPhoenixProjectName(),
    }),
    spanProcessors: [processor],
  });
  provider.register();
  registered = true;
  activeProvider = provider;

  console.info("[arize-phoenix] OTel registered", {
    collector: getPhoenixCollectorEndpoint(),
    project: getPhoenixProjectName(),
  });

  return true;
}

/**
 * Flush pending spans — call before short-lived processes exit
 * (smoke scripts, crons). No-op when Phoenix isn't registered.
 */
export async function flushPhoenixOtel(): Promise<void> {
  await activeProvider?.forceFlush();
}
