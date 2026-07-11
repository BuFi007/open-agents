import { getRun } from "workflow/api";
import { getOwnedOperatingPackRun } from "@/lib/db/operating-pack-runs";
import { requireAuthenticatedUser } from "@/app/api/chat/_lib/chat-context";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  const run = await getOwnedOperatingPackRun(runId, auth.userId);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

  let durableStatus: string | null = null;
  if (run.workflowRunId) {
    try {
      durableStatus = await getRun(run.workflowRunId).status;
    } catch {
      durableStatus = "unavailable";
    }
  }
  return Response.json({
    id: run.id,
    workflowRunId: run.workflowRunId,
    workspaceId: run.workspaceId,
    packId: run.packId,
    workflowId: run.workflowId,
    harnessId: run.harnessId,
    status: run.status,
    durableStatus,
    approval:
      run.status === "awaiting_approval" && run.approvalId
        ? { id: run.approvalId, actions: ["approved", "rejected"] }
        : null,
    result: run.result,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
  });
}
