import { setTimeout as delay } from "node:timers/promises";
import { getRun } from "workflow/api";
import {
  claimSessionActiveHarnessRunId,
  clearSessionActiveHarnessRunIdIfOwned,
  getSessionById,
} from "@/lib/db/sessions";

const OWNERSHIP_MAX_ATTEMPTS = 3;
const OWNERSHIP_RETRY_DELAY_MS = 50;

export type ClaimHarnessOwnershipResult = "claimed" | "conflict";

export async function claimHarnessOwnership(
  sessionId: string,
  workflowRunId: string,
): Promise<ClaimHarnessOwnershipResult> {
  "use step";

  return claimHarnessOwnershipWithDependencies(sessionId, workflowRunId, {
    claim: claimSessionActiveHarnessRunId,
    clear: clearSessionActiveHarnessRunIdIfOwned,
    getOwner: async (id) => (await getSessionById(id))?.activeHarnessRunId,
    isRunLive: isWorkflowRunLive,
  });
}

type HarnessOwnershipDependencies = {
  claim: (sessionId: string, workflowRunId: string) => Promise<boolean>;
  clear: (sessionId: string, workflowRunId: string) => Promise<boolean>;
  getOwner: (sessionId: string) => Promise<string | null | undefined>;
  isRunLive: (workflowRunId: string) => Promise<boolean>;
};

export async function claimHarnessOwnershipWithDependencies(
  sessionId: string,
  workflowRunId: string,
  dependencies: HarnessOwnershipDependencies,
): Promise<ClaimHarnessOwnershipResult> {
  for (let attempt = 1; attempt <= OWNERSHIP_MAX_ATTEMPTS; attempt++) {
    if (await dependencies.claim(sessionId, workflowRunId)) {
      return "claimed";
    }

    const ownerRunId = await dependencies.getOwner(sessionId);
    if (!ownerRunId) {
      await delay(OWNERSHIP_RETRY_DELAY_MS);
      continue;
    }

    if (await dependencies.isRunLive(ownerRunId)) {
      return "conflict";
    }

    await dependencies.clear(sessionId, ownerRunId);
  }

  throw new Error("Failed to claim external harness ownership");
}

export async function releaseHarnessOwnership(
  sessionId: string,
  workflowRunId: string,
): Promise<void> {
  "use step";

  await releaseHarnessOwnershipWithDependencies(sessionId, workflowRunId, {
    clear: clearSessionActiveHarnessRunIdIfOwned,
  });
}

export async function releaseHarnessOwnershipWithDependencies(
  sessionId: string,
  workflowRunId: string,
  dependencies: Pick<HarnessOwnershipDependencies, "clear">,
): Promise<void> {
  for (let attempt = 1; attempt <= OWNERSHIP_MAX_ATTEMPTS; attempt++) {
    try {
      await dependencies.clear(sessionId, workflowRunId);
      return;
    } catch (error) {
      if (attempt === OWNERSHIP_MAX_ATTEMPTS) {
        console.error(
          "[workflow] Failed to release external harness ownership:",
          error,
        );
        return;
      }
      await delay(OWNERSHIP_RETRY_DELAY_MS);
    }
  }
}

async function isWorkflowRunLive(workflowRunId: string): Promise<boolean> {
  const run = getRun(workflowRunId);
  if (!(await run.exists)) {
    return false;
  }

  const status = await run.status;
  return status === "pending" || status === "running";
}
