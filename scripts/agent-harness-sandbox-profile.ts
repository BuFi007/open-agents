import { prepareHarnessSandboxRuntimeProfile } from "@open-agents/harness-runner";
import type { SnapshotSandbox } from "@open-agents/sandbox/vercel";

export async function prepareAgentHarnessSandboxRuntimeProfile(
  sandbox: SnapshotSandbox,
): Promise<void> {
  await prepareHarnessSandboxRuntimeProfile(sandbox);
}
