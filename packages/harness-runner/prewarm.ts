import { prewarmHarness } from "@ai-sdk/harness/agent";
import { createCodex } from "@ai-sdk/harness-codex";
import { createPi } from "@ai-sdk/harness-pi";
import type { SnapshotSandbox } from "@open-agents/sandbox/vercel";

import { createOpenAgentsClaudeCode } from "./claude-code-adapter.ts";

export async function prepareHarnessSandboxRuntimeProfile(
  sandbox: SnapshotSandbox,
): Promise<void> {
  if (!sandbox.toHarnessSandboxProvider) {
    throw new Error(
      "Configured sandbox provider does not support AI SDK harness prewarming.",
    );
  }

  const sandboxProvider = sandbox.toHarnessSandboxProvider();

  await prewarmHarness({
    harness: createCodex(),
    sandboxProvider,
  });
  await prewarmHarness({
    harness: createOpenAgentsClaudeCode(),
    sandboxProvider,
  });
  await prewarmHarness({
    harness: createPi(),
    sandboxProvider,
  });
}
