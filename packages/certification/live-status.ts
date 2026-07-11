export type LiveWorkflowOutcome = "pending" | "completed" | "failed";

export function parseDispatchIdentity(
  value: unknown,
): { sessionId: string; workflowRunId: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string" &&
    record.sessionId.length > 0 &&
    typeof record.workflowRunId === "string" &&
    record.workflowRunId.length > 0
    ? { sessionId: record.sessionId, workflowRunId: record.workflowRunId }
    : null;
}

export function findLiveWorkflowOutcome(
  value: unknown,
  identity: { sessionId: string; workflowRunId: string },
): LiveWorkflowOutcome {
  if (!Array.isArray(value)) return "pending";
  const row = value.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).id === identity.sessionId &&
      (candidate as Record<string, unknown>).latestWorkflowRunId ===
        identity.workflowRunId,
  ) as Record<string, unknown> | undefined;
  if (!row) return "pending";
  if (row.latestWorkflowStatus === "completed") return "completed";
  if (
    row.latestWorkflowStatus === "failed" ||
    row.latestWorkflowStatus === "aborted"
  )
    return "failed";
  return "pending";
}
