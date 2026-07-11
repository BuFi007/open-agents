import { getRun } from "workflow/api";
import {
  appendOperatingPackTrace,
  getOwnedOperatingPackRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import { requireAuthenticatedUser } from "@/app/api/chat/_lib/chat-context";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  const limited = await checkRateLimit({
    key: rateLimitKey(["operating-pack-cancel", auth.userId, runId]),
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const run = await getOwnedOperatingPackRun(runId, auth.userId);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if (["completed", "failed", "cancelled", "rejected"].includes(run.status))
    return Response.json({ ok: true, status: run.status });
  if (run.workflowRunId) {
    try {
      await getRun(run.workflowRunId).cancel();
    } catch {
      return Response.json(
        { error: "Durable run could not be cancelled" },
        { status: 503 },
      );
    }
  }
  await Promise.all([
    updateOperatingPackRun(run.id, {
      status: "cancelled",
      finished: true,
    }),
    appendOperatingPackTrace({
      id: `${run.id}:9999`,
      runId: run.id,
      workspaceId: run.workspaceId,
      sequence: 9999,
      type: "run.cancelled",
      summary: "Workflow cancelled by its owner",
    }),
  ]);
  return Response.json({ ok: true, status: "cancelled" });
}
