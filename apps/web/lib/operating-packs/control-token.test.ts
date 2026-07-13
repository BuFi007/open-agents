import { beforeEach, describe, expect, test } from "bun:test";
import {
  getOperatingPackControlToken,
  parseOperatingPackControlId,
} from "./control-token";

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-at-least-thirty-two-characters";
});

describe("operating-pack control tokens", () => {
  test("binds the token to both execution and checkpoint", () => {
    const first = getOperatingPackControlToken("op_1", "before_agents");
    expect(first).toBe(getOperatingPackControlToken("op_1", "before_agents"));
    expect(first).not.toBe(getOperatingPackControlToken("op_1", "before_join"));
    expect(first).not.toBe(
      getOperatingPackControlToken("op_2", "before_agents"),
    );
  });

  test("parses only known persisted checkpoint ids", () => {
    expect(parseOperatingPackControlId("control:before_agents")).toBe(
      "before_agents",
    );
    expect(parseOperatingPackControlId("control:before_join")).toBe(
      "before_join",
    );
    expect(parseOperatingPackControlId("control:unknown")).toBeNull();
    expect(parseOperatingPackControlId("approval:before_agents")).toBeNull();
  });
});
