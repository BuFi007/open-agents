import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { start } from "workflow/api";
import { checkBotProtection } from "@/lib/botid";
import {
  attachOperatingPackWorkflowRun,
  createOperatingPackRun,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import {
  listOperatingPackCatalog,
  resolveOperatingPackWorkflow,
  startOperatingPackRunSchema,
} from "@/lib/operating-packs/runtime";
import { getOperatingPackApprovalToken } from "@/lib/operating-packs/approval-token";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "@/app/api/chat/_lib/chat-context";
import { runOperatingPackWorkflow } from "@/app/workflows/operating-pack";

function workspaceId(sessionId: string): string {
  return `ws_${createHash("sha256").update(sessionId).digest("hex").slice(0, 32)}`;
}

export async function GET() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  return Response.json({ packs: listOperatingPackCatalog() });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return auth.response;
  const botVerification = await checkBotProtection();
  if (botVerification.isBot)
    return Response.json({ error: "Access denied" }, { status: 403 });
  const limited = await checkRateLimit({
    key: rateLimitKey(["operating-pack-start", auth.userId]),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const parsed = startOperatingPackRunSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid operating-pack run" },
      { status: 400 },
    );
  const input = parsed.data;
  const owned = await requireOwnedSessionChat({
    userId: auth.userId,
    sessionId: input.sessionId,
    chatId: input.chatId,
  });
  if (!owned.ok) return owned.response;
  if (owned.sessionRecord.status === "archived")
    return Response.json({ error: "Session is archived" }, { status: 400 });
  if (input.harnessId === "codex")
    return Response.json(
      {
        error:
          "Codex does not expose built-in read-only approvals in the installed harness adapter",
        code: "HARNESS_PERMISSION_MODE_UNSUPPORTED",
      },
      { status: 422 },
    );

  try {
    resolveOperatingPackWorkflow({
      packId: input.packId,
      workflowId: input.workflowId,
    });
  } catch {
    return Response.json(
      { error: "Unknown operating-pack workflow" },
      { status: 404 },
    );
  }

  const scopedWorkspaceId = workspaceId(input.sessionId);
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        packId: input.packId,
        workflowId: input.workflowId,
        harnessId: input.harnessId,
        prompt: input.prompt,
      }),
    )
    .digest("hex");
  const executionId = `op_${nanoid(24)}`;
  const claimed = await createOperatingPackRun({
    id: executionId,
    workspaceId: scopedWorkspaceId,
    sessionId: input.sessionId,
    chatId: input.chatId,
    userId: auth.userId,
    packId: input.packId,
    workflowId: input.workflowId,
    harnessId: input.harnessId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    status: "pending",
  });
  if (!claimed.created) {
    if (
      claimed.run.packId !== input.packId ||
      claimed.run.workflowId !== input.workflowId ||
      claimed.run.harnessId !== input.harnessId ||
      claimed.run.requestHash !== requestHash
    )
      return Response.json(
        { error: "Idempotency key already identifies a different run" },
        { status: 409 },
      );
    return Response.json(
      {
        executionId: claimed.run.id,
        workflowRunId: claimed.run.workflowRunId,
        status: claimed.run.status,
        replayed: true,
      },
      { status: 200 },
    );
  }

  try {
    const run = await start(runOperatingPackWorkflow, [
      {
        executionId,
        workspaceId: scopedWorkspaceId,
        sessionId: input.sessionId,
        chatId: input.chatId,
        userId: auth.userId,
        packId: input.packId,
        workflowId: input.workflowId,
        harnessId: input.harnessId,
        prompt: input.prompt,
        requestOrigin: new URL(request.url).origin,
        modelId: owned.chat.modelId ?? APP_DEFAULT_MODEL_ID,
        approvalToken: getOperatingPackApprovalToken(executionId),
      },
    ]);
    await attachOperatingPackWorkflowRun(executionId, run.runId);
    return Response.json(
      { executionId, workflowRunId: run.runId, status: "pending" },
      { status: 202 },
    );
  } catch {
    await updateOperatingPackRun(executionId, {
      status: "failed",
      errorCode: "WORKFLOW_START_FAILED",
      finished: true,
    });
    return Response.json(
      { error: "Failed to start operating-pack workflow" },
      { status: 503 },
    );
  }
}
