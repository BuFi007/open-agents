/**
 * Next.js instrumentation — runs once at server startup.
 *
 * Registers the global OTel TracerProvider with the Arize Phoenix
 * span processor (OpenInference conventions). AI SDK spans emitted by
 * the agent (via `experimental_telemetry`) flow to Phoenix Cloud,
 * where the agent can introspect them at runtime (recall_similar_runs
 * / find_resolved_gap) and evals score them.
 *
 * No-op when PHOENIX_API_KEY is not configured.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerPhoenixOtel } =
      await import("@open-agents/arize-phoenix/otel");
    registerPhoenixOtel();
  }
}
