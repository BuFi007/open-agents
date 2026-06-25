import { describe, expect, test } from "bun:test";
import {
  getPreferredModelProviderForHarness,
  isPreferredModelProviderForHarness,
} from "./chat-harnesses";

describe("chat harness model preferences", () => {
  test("prefers the native provider for Codex and Claude Code", () => {
    expect(getPreferredModelProviderForHarness("codex")).toBe("openai");
    expect(getPreferredModelProviderForHarness("claude-code")).toBe(
      "anthropic",
    );
  });

  test("does not constrain provider-neutral harnesses", () => {
    expect(getPreferredModelProviderForHarness("open-agent")).toBeUndefined();
    expect(getPreferredModelProviderForHarness("pi")).toBeUndefined();
    expect(isPreferredModelProviderForHarness("pi", "google")).toBe(true);
  });

  test("identifies non-preferred providers without blocking them", () => {
    expect(isPreferredModelProviderForHarness("codex", "openai")).toBe(true);
    expect(isPreferredModelProviderForHarness("codex", "anthropic")).toBe(
      false,
    );
    expect(isPreferredModelProviderForHarness("claude-code", "anthropic")).toBe(
      true,
    );
    expect(isPreferredModelProviderForHarness("claude-code", "openai")).toBe(
      false,
    );
  });
});
