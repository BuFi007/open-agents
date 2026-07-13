import { describe, expect, test } from "bun:test";
import {
  resolveAgentExecutionPolicy,
  shouldRetryAgent,
} from "./agent-execution-policy";

describe("agent execution policy", () => {
  test("bounds timeout and retries read-only agents", () => {
    const policy = resolveAgentExecutionPolicy(
      ["knowledge_read", "circle_get_balance"],
      {
        BUFI_AGENT_STEP_TIMEOUT_MS: "999999999",
        BUFI_AGENT_MAX_ATTEMPTS: "99",
      },
    );
    expect(policy).toEqual({
      timeoutMs: 15 * 60_000,
      maxAttempts: 3,
      retryable: true,
    });
    expect(shouldRetryAgent(policy, 1)).toBe(true);
    expect(shouldRetryAgent(policy, 3)).toBe(false);
  });

  test("fails closed to one attempt for wallet mutations", () => {
    const policy = resolveAgentExecutionPolicy(
      ["knowledge_read", "circle_pay_service"],
      { BUFI_AGENT_MAX_ATTEMPTS: "3" },
    );
    expect(policy.maxAttempts).toBe(1);
    expect(policy.retryable).toBe(false);
    expect(shouldRetryAgent(policy, 1)).toBe(false);
  });

  test("uses safe defaults for malformed configuration", () => {
    expect(
      resolveAgentExecutionPolicy(["knowledge_read"], {
        BUFI_AGENT_STEP_TIMEOUT_MS: "nope",
        BUFI_AGENT_MAX_ATTEMPTS: "0.5",
      }),
    ).toMatchObject({
      timeoutMs: 10 * 60_000,
      maxAttempts: 2,
      retryable: true,
    });
  });
});
