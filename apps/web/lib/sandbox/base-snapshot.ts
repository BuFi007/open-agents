import {
  createVercelSnapshotTemplateName,
  resolveVercelSnapshotTemplateId,
} from "@open-agents/sandbox/vercel";
import { DEFAULT_SANDBOX_BASE_SNAPSHOT_ID } from "./config";

let deploymentSnapshotId: Promise<string> | undefined;

export async function resolveSandboxBaseSnapshotId(): Promise<
  string | undefined
> {
  if (DEFAULT_SANDBOX_BASE_SNAPSHOT_ID) {
    return DEFAULT_SANDBOX_BASE_SNAPSHOT_ID;
  }

  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID?.trim();
  if (!deploymentId) {
    return undefined;
  }

  deploymentSnapshotId ??= resolveVercelSnapshotTemplateId(
    createVercelSnapshotTemplateName(deploymentId),
  ).then((snapshotId) => {
    if (!snapshotId) {
      throw new Error(
        "Vercel sandbox template is missing for this deployment. Ensure the web build runs sandbox:prewarm.",
      );
    }
    return snapshotId;
  });

  return deploymentSnapshotId;
}
