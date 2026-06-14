import type { HarnessAgentAdapter } from "@ai-sdk/harness/agent";
import { createCodex } from "@ai-sdk/harness-codex";

import { createOpenAgentsClaudeCode } from "./claude-code-adapter.ts";

export const EXTERNAL_HARNESS_IDS = ["codex", "claude-code"] as const;

export type ExternalHarnessId = (typeof EXTERNAL_HARNESS_IDS)[number];

export function isExternalHarnessId(
  value: unknown,
): value is ExternalHarnessId {
  return (
    typeof value === "string" &&
    EXTERNAL_HARNESS_IDS.includes(value as ExternalHarnessId)
  );
}

export function resolveCodexModelId(modelId: string): string | undefined {
  return modelId.startsWith("openai/")
    ? modelId.slice("openai/".length)
    : undefined;
}

export function resolveClaudeCodeModelId(modelId: string): string | undefined {
  return modelId.startsWith("anthropic/")
    ? modelId.slice("anthropic/".length)
    : undefined;
}

export function createHarnessAdapter(
  harnessId: ExternalHarnessId,
  modelId: string,
): HarnessAgentAdapter {
  switch (harnessId) {
    case "codex":
      return createCodex({ model: resolveCodexModelId(modelId) });
    case "claude-code":
      return createOpenAgentsClaudeCode({
        model: resolveClaudeCodeModelId(modelId),
      });
    default: {
      const exhausted: never = harnessId;
      throw new Error(`Unsupported harness: ${String(exhausted)}`);
    }
  }
}
