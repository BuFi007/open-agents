import { describe, expect, it } from "bun:test";
import { findLiveWorkflowOutcome, parseDispatchIdentity } from "./live-status";

describe("live workflow status certification", () => {
  it("does not treat dispatch acceptance or a stale running session as success", () => {
    const identity = parseDispatchIdentity({
      sessionId: "session_1",
      workflowRunId: "run_1",
    });
    expect(identity).not.toBeNull();
    expect(
      findLiveWorkflowOutcome(
        [
          {
            id: "session_1",
            status: "running",
            latestWorkflowRunId: "run_1",
            latestWorkflowStatus: "failed",
          },
        ],
        identity!,
      ),
    ).toBe("failed");
  });

  it("passes only the matching terminal completed workflow", () => {
    const identity = { sessionId: "session_1", workflowRunId: "run_2" };
    expect(
      findLiveWorkflowOutcome(
        [
          {
            id: "session_1",
            latestWorkflowRunId: "run_2",
            latestWorkflowStatus: "completed",
          },
        ],
        identity,
      ),
    ).toBe("completed");
    expect(findLiveWorkflowOutcome({}, identity)).toBe("pending");
  });
});
