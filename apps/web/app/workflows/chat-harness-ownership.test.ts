import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  claimHarnessOwnershipWithDependencies,
  releaseHarnessOwnershipWithDependencies,
} from "./chat-harness-ownership";

let activeHarnessRunId: string | null = null;
const runStatuses = new Map<string, string>();

const spies = {
  claimSessionActiveHarnessRunId: mock(
    async (_sessionId: string, runId: string) => {
      if (activeHarnessRunId !== null && activeHarnessRunId !== runId) {
        return false;
      }
      activeHarnessRunId = runId;
      return true;
    },
  ),
  clearSessionActiveHarnessRunIdIfOwned: mock(
    async (_sessionId: string, runId: string) => {
      if (activeHarnessRunId !== runId) {
        return false;
      }
      activeHarnessRunId = null;
      return true;
    },
  ),
};

const dependencies = {
  claim: spies.claimSessionActiveHarnessRunId,
  clear: spies.clearSessionActiveHarnessRunIdIfOwned,
  getOwner: async () => activeHarnessRunId,
  isRunLive: async (runId: string) => {
    const status = runStatuses.get(runId);
    return status === "pending" || status === "running";
  },
};

beforeEach(() => {
  activeHarnessRunId = null;
  runStatuses.clear();
  Object.values(spies).forEach((spy) => spy.mockClear());
});

describe("external harness ownership", () => {
  test("claims an unowned session idempotently", async () => {
    expect(
      await claimHarnessOwnershipWithDependencies(
        "session-1",
        "workflow-1",
        dependencies,
      ),
    ).toBe("claimed");
    expect(
      await claimHarnessOwnershipWithDependencies(
        "session-1",
        "workflow-1",
        dependencies,
      ),
    ).toBe("claimed");
    expect(activeHarnessRunId).toBe("workflow-1");
  });

  test("rejects a different live workflow", async () => {
    activeHarnessRunId = "workflow-1";
    runStatuses.set("workflow-1", "running");

    expect(
      await claimHarnessOwnershipWithDependencies(
        "session-1",
        "workflow-2",
        dependencies,
      ),
    ).toBe("conflict");
    expect(activeHarnessRunId).toBe("workflow-1");
  });

  test("reclaims ownership from a completed workflow", async () => {
    activeHarnessRunId = "workflow-1";
    runStatuses.set("workflow-1", "completed");

    expect(
      await claimHarnessOwnershipWithDependencies(
        "session-1",
        "workflow-2",
        dependencies,
      ),
    ).toBe("claimed");
    expect(activeHarnessRunId).toBe("workflow-2");
  });

  test("only releases ownership held by the calling workflow", async () => {
    activeHarnessRunId = "workflow-1";

    await releaseHarnessOwnershipWithDependencies(
      "session-1",
      "workflow-2",
      dependencies,
    );
    expect(activeHarnessRunId).toBe("workflow-1");

    await releaseHarnessOwnershipWithDependencies(
      "session-1",
      "workflow-1",
      dependencies,
    );
    expect(activeHarnessRunId).toBeNull();
  });
});
