import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  signInternalHarnessRequest,
  verifyInternalHarnessRequest,
} from "./internal-request";

const originalSecret = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-internal-harness-secret";
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = originalSecret;
  }
});

describe("internal harness request signatures", () => {
  test("accepts an exact signed body", () => {
    const body = JSON.stringify({ harnessId: "codex", messageId: "message-1" });
    const signature = signInternalHarnessRequest(body);

    expect(verifyInternalHarnessRequest(body, signature)).toBe(true);
    expect(verifyInternalHarnessRequest(`${body}\n`, signature)).toBe(false);
  });

  test("rejects missing and malformed signatures", () => {
    expect(verifyInternalHarnessRequest("{}", null)).toBe(false);
    expect(verifyInternalHarnessRequest("{}", "not-hex")).toBe(false);
  });
});
