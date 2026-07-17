import { describe, expect, test } from "bun:test";
import { TaxAutomationRequestError } from "@open-agents/tax-automation";

import { isRetryableTaxError } from "./tax-settlement-delivery";

describe("Tax settlement delivery retry policy", () => {
  test("retains a settlement while the Tax factoring fence is active", () => {
    expect(
      isRetryableTaxError("FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE"),
    ).toBe(true);
  });

  test("does not retry a deterministic contract conflict", () => {
    expect(isRetryableTaxError("AGENT_IDEMPOTENCY_CONFLICT")).toBe(false);
  });

  test("preserves the structured Tax error code independently of HTTP status", () => {
    const error = new TaxAutomationRequestError(
      "FACTURA_E_FACTORING_MUTATION_FENCED_RETRYABLE",
      423,
    );

    expect(isRetryableTaxError(error.code)).toBe(true);
    expect(error.status).toBe(423);
  });
});
