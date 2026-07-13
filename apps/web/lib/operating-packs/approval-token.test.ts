import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getOperatingPackApprovalToken } from "./approval-token";

const original = process.env.BETTER_AUTH_SECRET;

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-workflow-approval-secret";
});

afterAll(() => {
  if (original === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = original;
});

describe("operating-pack approval tokens", () => {
  test("derives deterministic opaque tokens without embedding the run id", () => {
    const first = getOperatingPackApprovalToken("op_1");
    expect(first).toBe(getOperatingPackApprovalToken("op_1"));
    expect(first).not.toContain("op_1");
    expect(first).not.toBe(getOperatingPackApprovalToken("op_2"));
  });

  test("fails closed without the server secret", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => getOperatingPackApprovalToken("op_1")).toThrow(
      "BETTER_AUTH_SECRET",
    );
    process.env.BETTER_AUTH_SECRET = "test-workflow-approval-secret";
  });
});
