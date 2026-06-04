import { prepareAdapterSandboxRuntimeProfile } from "@agent-harness-experimental/sandbox-images";
import type { SnapshotSandbox } from "@open-agents/sandbox/vercel";

export async function prepareAgentHarnessSandboxRuntimeProfile(
  sandbox: SnapshotSandbox,
): Promise<void> {
  if (!sandbox.toAgentHarnessWorkspace) {
    throw new Error(
      "Configured sandbox provider does not support agent harness runtime preparation.",
    );
  }

  await prepareAdapterSandboxRuntimeProfile({
    session: sandbox.toAgentHarnessWorkspace(),
    adapters: ["codex", "claude-code"],
  });
}
