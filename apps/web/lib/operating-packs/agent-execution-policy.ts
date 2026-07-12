const READ_ONLY_TOOLS = new Set([
  "knowledge_read",
  "workflow_run",
  "circle_get_balance",
  "circle_login",
  "fetch_setup_skill",
  "fetch_sub_skill",
  "circle_list_wallets",
  "circle_get_gateway_balance",
  "circle_search_services",
  "circle_inspect_service",
  "fetch_service",
  "call_free_service",
]);

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_ATTEMPTS = 3;

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export type AgentExecutionPolicy = {
  timeoutMs: number;
  maxAttempts: number;
  retryable: boolean;
};

/**
 * Resolve the durable execution envelope for one filesystem agent.
 *
 * Automatic retries are deliberately limited to read-only grants. A retry of
 * a wallet write/payment could duplicate an external side effect, so those
 * agents get one attempt regardless of the global retry setting.
 */
export function resolveAgentExecutionPolicy(
  toolNames: readonly string[],
  env: Record<string, string | undefined> = process.env,
): AgentExecutionPolicy {
  const retryable = toolNames.every((toolName) =>
    READ_ONLY_TOOLS.has(toolName),
  );
  const configuredAttempts = boundedInteger(
    env.BUFI_AGENT_MAX_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS,
    1,
    MAX_ATTEMPTS,
  );
  return {
    timeoutMs: boundedInteger(
      env.BUFI_AGENT_STEP_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
    maxAttempts: retryable ? configuredAttempts : 1,
    retryable,
  };
}

export function shouldRetryAgent(
  policy: AgentExecutionPolicy,
  attempt: number,
): boolean {
  return policy.retryable && attempt < policy.maxAttempts;
}

