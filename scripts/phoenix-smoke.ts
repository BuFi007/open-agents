/**
 * Phoenix smoke test — verifies creds, collector endpoint, and span
 * ingestion end to end.
 *
 * Run from apps/open-agents:
 *   bun --env-file=apps/web/.env.local scripts/phoenix-smoke.ts
 *
 * Emits one OpenInference-shaped span, flushes, then queries it back
 * via the Phoenix REST API.
 */

import { trace } from "@opentelemetry/api";
import {
  getPhoenixProjectName,
  isPhoenixEnabled,
} from "../packages/arize-phoenix/client";
import {
  flushPhoenixOtel,
  registerPhoenixOtel,
} from "../packages/arize-phoenix/otel";
import { recallSimilarRuns } from "../packages/arize-phoenix/recall";

async function main() {
  if (!isPhoenixEnabled()) {
    console.error("PHOENIX_API_KEY not set — aborting");
    process.exit(1);
  }

  const ok = registerPhoenixOtel();
  if (!ok) {
    console.error("registerPhoenixOtel returned false — aborting");
    process.exit(1);
  }

  const marker = `smoke-${Date.now()}`;
  const tracer = trace.getTracer("phoenix-smoke");
  const span = tracer.startSpan("smoke.llm", {
    attributes: {
      "openinference.span.kind": "LLM",
      "input.value": `phoenix smoke test ${marker} from desk-v1 open-agents`,
      "output.value": "ok",
      "ai.telemetry.metadata.sessionId": marker,
      "ai.telemetry.metadata.source": "smoke",
    },
  });
  span.end();

  await flushPhoenixOtel();
  console.info(
    `[smoke] span exported (marker=${marker}), waiting 8s for ingest...`,
  );
  await new Promise((resolve) => setTimeout(resolve, 8000));

  const recall = await recallSimilarRuns({
    query: marker,
    sessionId: marker,
    minAgeSeconds: 0,
    limit: 3,
  });

  console.info("[smoke] recall result:", JSON.stringify(recall, null, 2));
  console.info(
    `[smoke] project=${getPhoenixProjectName()} → ${
      recall.available && recall.results.length > 0
        ? "TRACE FOUND ✅"
        : "trace not found yet (check Phoenix UI)"
    }`,
  );
}

await main();
