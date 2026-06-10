/**
 * open-agents/arize-phoenix/client — env helpers + enable check.
 *
 * Phoenix is enabled when PHOENIX_API_KEY is set (and optionally
 * PHOENIX_ENABLED=false to force off). Phoenix Cloud is the default;
 * self-host via PHOENIX_COLLECTOR_ENDPOINT pointing at a docker
 * instance.
 */

export function isPhoenixEnabled(): boolean {
  const explicit = process.env.PHOENIX_ENABLED;
  if (explicit === "false") {
    return false;
  }
  if (explicit === "true") {
    return true;
  }
  return Boolean(process.env.PHOENIX_API_KEY);
}

/**
 * Phoenix collector endpoint base — workspace-scoped on Cloud, plain
 * host on self-host. The exporter appends `/v1/traces` (OTLP HTTP).
 */
export function getPhoenixCollectorEndpoint(): string {
  return (
    process.env.PHOENIX_COLLECTOR_ENDPOINT ||
    process.env.PHOENIX_BASE_URL ||
    "https://app.phoenix.arize.com"
  );
}

export function getPhoenixApiKey(): string | undefined {
  return process.env.PHOENIX_API_KEY || undefined;
}

export function getPhoenixProjectName(): string {
  return process.env.PHOENIX_PROJECT_NAME || "bufi-open-agents";
}

/**
 * Base URL for human-facing Phoenix UI links (project traces, a
 * specific trace). Falls back to the collector host.
 */
export function getPhoenixUiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_PHOENIX_BASE_URL ||
    process.env.PHOENIX_BASE_URL ||
    getPhoenixCollectorEndpoint()
  );
}
