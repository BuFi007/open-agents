import { resumeHook } from "workflow/api";
import { getOwnedOperatingPackRun } from "@/lib/db/operating-pack-runs";
import { decideOperatingPackApprovalSchema } from "@/lib/operating-packs/runtime";
import { getOperatingPackApprovalToken } from "@/lib/operating-packs/approval-token";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requireAuthenticatedUser } from "@/app/api/chat/_lib/chat-context";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const { runId } = await context.params;
  const limited = await checkRateLimit({
    key: rateLimitKey(["operating-pack-approval", auth.userId, runId]),
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const parsed = decideOperatingPackApprovalSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid approval decision" },
      { status: 400 },
    );
  const run = await getOwnedOperatingPackRun(runId, auth.userId);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if (run.status !== "awaiting_approval" || !run.approvalId)
    return Response.json(
      { error: "Run is not awaiting approval" },
      { status: 409 },
    );
  try {
    await resumeHook(getOperatingPackApprovalToken(run.id), {
      ...parsed.data,
      actorId: auth.userId,
    });
    return Response.json({ ok: true, decision: parsed.data.decision });
  } catch {
    return Response.json(
      { error: "Approval was already decided or expired" },
      { status: 409 },
    );
  }
}
