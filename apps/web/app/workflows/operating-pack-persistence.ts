import {
  appendOperatingPackTrace as appendTrace,
  attachOperatingPackWorkflowRun as attachWorkflowRun,
  getOperatingPackRun as getRun,
  updateOperatingPackRun as updateRun,
} from "@/lib/db/operating-pack-runs";
import {
  deleteOperatingPackWorkspaceGrant as deleteWorkspaceGrant,
  getOperatingPackWorkspaceGrant as getWorkspaceGrant,
} from "@/lib/operating-packs/credential-vault";

/**
 * Workflow SDK step boundary for all Node-only persistence dependencies.
 * Keeping postgres imports in this module prevents the workflow isolate from
 * bundling the Node driver while retaining the existing grouped persistence
 * calls in the durable operating-pack workflow.
 */
export async function appendOperatingPackTrace(
  input: Parameters<typeof appendTrace>[0],
) {
  "use step";
  return appendTrace(input);
}

export async function attachOperatingPackWorkflowRun(
  executionId: Parameters<typeof attachWorkflowRun>[0],
  workflowRunId: Parameters<typeof attachWorkflowRun>[1],
) {
  "use step";
  return attachWorkflowRun(executionId, workflowRunId);
}

export async function getOperatingPackRun(
  executionId: Parameters<typeof getRun>[0],
) {
  "use step";
  return getRun(executionId);
}

export async function updateOperatingPackRun(
  executionId: Parameters<typeof updateRun>[0],
  patch: Parameters<typeof updateRun>[1],
) {
  "use step";
  return updateRun(executionId, patch);
}

export async function deleteOperatingPackWorkspaceGrant(
  executionId: Parameters<typeof deleteWorkspaceGrant>[0],
) {
  "use step";
  return deleteWorkspaceGrant(executionId);
}

export async function getOperatingPackWorkspaceGrant(
  executionId: Parameters<typeof getWorkspaceGrant>[0],
  workspaceId: Parameters<typeof getWorkspaceGrant>[1],
) {
  "use step";
  return getWorkspaceGrant(executionId, workspaceId);
}
