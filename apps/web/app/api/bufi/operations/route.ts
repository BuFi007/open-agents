import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getRun, resumeHook, start } from "workflow/api";
import { runOperatingPackWorkflow } from "@/app/workflows/operating-pack";
import { db } from "@/lib/db/client";
import {
  appendOperatingPackTrace,
  attachOperatingPackWorkflowRun,
  createOperatingPackRun,
  getWorkspaceOperatingPackRun,
  listWorkspaceOperatingPackRuns,
  listWorkspaceOperatingPackTraces,
  updateOperatingPackRun,
} from "@/lib/db/operating-pack-runs";
import {
  getWorkspaceOperatingPackComposition,
  getWorkspaceOperatingPackCompositionRevision,
  saveWorkspaceOperatingPackComposition,
} from "@/lib/db/operating-pack-compositions";
import { sessions } from "@/lib/db/schema";
import { createSessionWithInitialChat } from "@/lib/db/sessions";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import { getOperatingPackApprovalToken } from "@/lib/operating-packs/approval-token";
import {
  getOperatingPackControlToken,
  parseOperatingPackControlId,
} from "@/lib/operating-packs/control-token";
import {
  deleteOperatingPackWorkspaceGrant,
  storeOperatingPackWorkspaceGrant,
} from "@/lib/operating-packs/credential-vault";
import { verifyDeskWorkspaceGrant } from "@/lib/operating-packs/desk-grant";
import {
  deskBridgeUserId,
  ensureDeskBridgeUser,
} from "@/lib/operating-packs/desk-bridge-user";
import {
  decideOperatingPackApprovalSchema,
  listOperatingPackCatalog,
  operatingPackCompositionSchema,
  resolveOperatingPackWorkflow,
  validateOperatingPackComposition,
} from "@/lib/operating-packs/runtime";

const baseSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceGrant: z.string().min(80).max(2048),
});

const actionSchema = z.discriminatedUnion("action", [
  baseSchema.extend({
    action: z.literal("start"),
    packId: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/),
    workflowId: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/),
    harnessId: z.enum(["codex", "claude-code", "pi"]),
    prompt: z.string().trim().min(1).max(8000),
    idempotencyKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/),
  }),
  baseSchema.extend({
    action: z.literal("decide"),
    runId: z.string().min(2).max(191),
    decision: decideOperatingPackApprovalSchema.shape.decision,
    reason: decideOperatingPackApprovalSchema.shape.reason,
  }),
  baseSchema.extend({
    action: z.literal("save_composition"),
    expectedRevision: z.number().int().min(0),
    items: operatingPackCompositionSchema,
  }),
  baseSchema.extend({
    action: z.literal("revert_composition"),
    expectedRevision: z.number().int().min(1),
    targetRevision: z.number().int().min(1),
  }),
  baseSchema.extend({
    action: z.literal("pause"),
    runId: z.string().min(2).max(191),
  }),
  baseSchema.extend({
    action: z.literal("resume"),
    runId: z.string().min(2).max(191),
    reason: z.string().trim().min(1).max(1000),
  }),
  baseSchema.extend({
    action: z.literal("cancel"),
    runId: z.string().min(2).max(191),
  }),
]);

function bearerAuthorized(request: Request): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  const actual = request.headers.get("authorization");
  if (!secret || secret.length < 16 || !actual) return false;
  const expected = `Bearer ${secret}`;
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

function authorizeGrant(input: {
  request: Request;
  workspaceId: string;
  workspaceGrant: string;
}) {
  if (!bearerAuthorized(input.request)) return null;
  return verifyDeskWorkspaceGrant({
    token: input.workspaceGrant,
    workspaceId: input.workspaceId,
  });
}

function requiredOperationScope(input: {
  packId: string;
  workflowId: string;
}): "agent-wallet.read" | "agent-wallet.spend" | null {
  if (input.packId !== "agent_wallet") return null;
  return input.workflowId === "agent_wallet_service_discovery"
    ? "agent-wallet.read"
    : "agent-wallet.spend";
}

async function runDetail(
  run: NonNullable<Awaited<ReturnType<typeof getWorkspaceOperatingPackRun>>>,
) {
  let durableStatus: string | null = null;
  if (run.workflowRunId) {
    try {
      durableStatus = await getRun(run.workflowRunId).status;
    } catch {
      durableStatus = "unavailable";
    }
  }
  return {
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
    control: {
      mode: "next_safe_checkpoint",
      state: run.status,
      canPause: ["running", "approved"].includes(run.status),
      canResume: ["pause_requested", "paused"].includes(run.status),
    },
    result: run.result,
    errorCode: run.errorCode,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
  };
}

export async function GET(request: Request) {
  if (!bearerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const workspaceGrant = request.headers.get("x-bufi-workspace-grant") ?? "";
  const parsed = baseSchema.safeParse({ workspaceId, workspaceGrant });
  if (!parsed.success)
    return Response.json({ error: "Invalid operation scope" }, { status: 400 });
  const grant = authorizeGrant({ request, ...parsed.data });
  if (!grant)
    return Response.json({ error: "Invalid workspace grant" }, { status: 403 });
  const userId = deskBridgeUserId(grant.subject);
  const runId = url.searchParams.get("runId");
  if (!runId) {
    const [runs, composition] = await Promise.all([
      listWorkspaceOperatingPackRuns(workspaceId, userId, 50),
      getWorkspaceOperatingPackComposition(workspaceId, userId),
    ]);
    const packs = listOperatingPackCatalog()
      .map((pack) => ({
        ...pack,
        workflows: pack.workflows.filter(
          (workflow) => workflow.executionMode === "harness_agents",
        ),
      }))
      .filter((pack) => pack.workflows.length > 0);
    return Response.json({ packs, runs, ...composition });
  }
  const traces = await listWorkspaceOperatingPackTraces({
    runId,
    workspaceId,
    userId,
    limit: 200,
  });
  if (!traces)
    return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({
    run: await runDetail(traces.run),
    traces: traces.traces,
  });
}

export async function POST(request: Request) {
  if (!bearerAuthorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid operation request" },
      { status: 400 },
    );
  const input = parsed.data;
  const grant = authorizeGrant({ request, ...input });
  if (!grant)
    return Response.json({ error: "Invalid workspace grant" }, { status: 403 });
  const userId = await ensureDeskBridgeUser(grant.subject);

  if (
    input.action === "save_composition" ||
    input.action === "revert_composition"
  ) {
    let items;
    let eventType: "composition.saved" | "composition.reverted" =
      "composition.saved";
    let summary: string | undefined;
    if (input.action === "save_composition") {
      try {
        items = validateOperatingPackComposition(input.items);
      } catch {
        return Response.json(
          { error: "Invalid operating-pack composition" },
          { status: 400 },
        );
      }
    } else {
      const target = await getWorkspaceOperatingPackCompositionRevision({
        workspaceId: input.workspaceId,
        userId,
        revision: input.targetRevision,
      });
      if (!target)
        return Response.json(
          { error: "Composition revision not found" },
          { status: 404 },
        );
      try {
        items = validateOperatingPackComposition(target.items);
      } catch {
        return Response.json(
          { error: "Stored composition revision is invalid" },
          { status: 409 },
        );
      }
      eventType = "composition.reverted";
      summary = `Reverted composition to revision ${input.targetRevision}`;
    }
    const saved = await saveWorkspaceOperatingPackComposition({
      workspaceId: input.workspaceId,
      userId,
      expectedRevision: input.expectedRevision,
      items,
      eventType,
      summary,
    });
    if (!saved.saved)
      return Response.json(
        {
          error: "Composition changed in another session",
          currentRevision: saved.currentRevision,
        },
        { status: 409 },
      );
    return Response.json({ ok: true, composition: saved.composition });
  }

  if (input.action === "pause" || input.action === "resume") {
    const run = await getWorkspaceOperatingPackRun(
      input.runId,
      input.workspaceId,
      userId,
    );
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

    if (input.action === "pause") {
      if (["pause_requested", "paused"].includes(run.status))
        return Response.json({ ok: true, status: run.status });
      if (!["running", "approved"].includes(run.status))
        return Response.json(
          { error: "Run cannot be paused in its current state" },
          { status: 409 },
        );
      await updateOperatingPackRun(run.id, { status: "pause_requested" });
      return Response.json({
        ok: true,
        status: "pause_requested",
        mode: "next_safe_checkpoint",
      });
    }

    if (run.status === "pause_requested") {
      await Promise.all([
        updateOperatingPackRun(run.id, {
          status: "running",
          approvalId: null,
        }),
        appendOperatingPackTrace({
          id: `${run.id}:99`,
          runId: run.id,
          workspaceId: run.workspaceId,
          sequence: 99,
          type: "workflow.pause_cancelled",
          summary: "Pending pause cancelled from Desk",
          data: { reason: input.reason },
        }),
      ]);
      return Response.json({ ok: true, status: "running" });
    }
    if (run.status !== "paused")
      return Response.json({ error: "Run is not paused" }, { status: 409 });
    const checkpoint = parseOperatingPackControlId(run.approvalId);
    if (!checkpoint)
      return Response.json(
        { error: "Paused run has no valid checkpoint" },
        { status: 409 },
      );
    try {
      await resumeHook(getOperatingPackControlToken(run.id, checkpoint), {
        action: "resume",
        reason: input.reason,
        actorId: userId,
      });
      return Response.json({ ok: true, status: "resuming", checkpoint });
    } catch {
      return Response.json(
        { error: "Pause was already resumed or expired" },
        { status: 409 },
      );
    }
  }

  if (input.action === "decide") {
    const run = await getWorkspaceOperatingPackRun(
      input.runId,
      input.workspaceId,
      userId,
    );
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
    if (run.status !== "awaiting_approval" || !run.approvalId)
      return Response.json(
        { error: "Run is not awaiting approval" },
        { status: 409 },
      );
    try {
      await resumeHook(getOperatingPackApprovalToken(run.id), {
        decision: input.decision,
        reason: input.reason,
        actorId: userId,
      });
      return Response.json({ ok: true, decision: input.decision });
    } catch {
      return Response.json(
        { error: "Approval was already decided or expired" },
        { status: 409 },
      );
    }
  }

  if (input.action === "cancel") {
    const run = await getWorkspaceOperatingPackRun(
      input.runId,
      input.workspaceId,
      userId,
    );
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
      updateOperatingPackRun(run.id, { status: "cancelled", finished: true }),
      appendOperatingPackTrace({
        id: `${run.id}:9999`,
        runId: run.id,
        workspaceId: run.workspaceId,
        sequence: 9999,
        type: "run.cancelled",
        summary: "Workflow cancelled from Desk",
      }),
      deleteOperatingPackWorkspaceGrant(run.id),
    ]);
    return Response.json({ ok: true, status: "cancelled" });
  }

  try {
    resolveOperatingPackWorkflow({
      packId: input.packId,
      workflowId: input.workflowId,
    });
  } catch {
    return Response.json({ error: "Unknown workflow" }, { status: 404 });
  }
  const requiredScope = requiredOperationScope(input);
  if (requiredScope && !grant.scopes.includes(requiredScope))
    return Response.json(
      { error: `Workspace grant requires ${requiredScope}` },
      { status: 403 },
    );
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        packId: input.packId,
        workflowId: input.workflowId,
        harnessId: input.harnessId,
        prompt: input.prompt,
        workspaceId: input.workspaceId,
      }),
    )
    .digest("hex");
  const executionId = `op_${nanoid(24)}`;
  const sessionId = `desk_${nanoid(20)}`;
  const chatId = `desk_${nanoid(20)}`;
  await createSessionWithInitialChat({
    session: {
      id: sessionId,
      userId,
      title: `Desk operation: ${input.packId}.${input.workflowId}`,
      repoOwner: null,
      repoName: null,
      branch: null,
      cloneUrl: null,
      autoCommitPushOverride: false,
      autoCreatePrOverride: false,
    },
    initialChat: {
      id: chatId,
      title: "Desk agent team operation",
      modelId: APP_DEFAULT_MODEL_ID,
      harnessId: input.harnessId,
    },
  });
  const claimed = await createOperatingPackRun({
    id: executionId,
    workspaceId: input.workspaceId,
    sessionId,
    chatId,
    userId,
    packId: input.packId,
    workflowId: input.workflowId,
    harnessId: input.harnessId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    status: "pending",
  });
  if (!claimed.created) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (
      claimed.run.userId !== userId ||
      claimed.run.requestHash !== requestHash ||
      claimed.run.packId !== input.packId ||
      claimed.run.workflowId !== input.workflowId ||
      claimed.run.harnessId !== input.harnessId
    )
      return Response.json({ error: "Idempotency conflict" }, { status: 409 });
    return Response.json({
      executionId: claimed.run.id,
      workflowRunId: claimed.run.workflowRunId,
      status: claimed.run.status,
      replayed: true,
    });
  }
  try {
    await storeOperatingPackWorkspaceGrant({
      runId: executionId,
      workspaceId: input.workspaceId,
      grant: input.workspaceGrant,
    });
    const workflow = await start(runOperatingPackWorkflow, [
      {
        executionId,
        workspaceId: input.workspaceId,
        sessionId,
        chatId,
        userId,
        packId: input.packId,
        workflowId: input.workflowId,
        harnessId: input.harnessId,
        prompt: input.prompt,
        requestOrigin: new URL(request.url).origin,
        modelId: APP_DEFAULT_MODEL_ID,
      },
    ]);
    await attachOperatingPackWorkflowRun(executionId, workflow.runId);
    return Response.json(
      {
        executionId,
        workflowRunId: workflow.runId,
        status: "pending",
        replayed: false,
      },
      { status: 202 },
    );
  } catch {
    await deleteOperatingPackWorkspaceGrant(executionId).catch(() => undefined);
    await updateOperatingPackRun(executionId, {
      status: "failed",
      errorCode: "DESK_OPERATION_START_FAILED",
      finished: true,
    });
    return Response.json(
      { error: "Failed to start operation" },
      { status: 503 },
    );
  }
}
