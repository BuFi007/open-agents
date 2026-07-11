import { redactTraceData, sanitizeTraceText } from "@open-agents/traces";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "./client";
import {
  type NewOperatingPackRun,
  operatingPackRuns,
  operatingPackTraces,
} from "./schema";

export type OperatingPackRunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed"
  | "cancelled";

export async function createOperatingPackRun(
  input: NewOperatingPackRun,
): Promise<{ created: boolean; run: typeof operatingPackRuns.$inferSelect }> {
  const [created] = await db
    .insert(operatingPackRuns)
    .values(input)
    .onConflictDoNothing({
      target: [operatingPackRuns.workspaceId, operatingPackRuns.idempotencyKey],
    })
    .returning();
  if (created) return { created: true, run: created };

  const existing = await db.query.operatingPackRuns.findFirst({
    where: and(
      eq(operatingPackRuns.workspaceId, input.workspaceId),
      eq(operatingPackRuns.idempotencyKey, input.idempotencyKey),
    ),
  });
  if (!existing)
    throw new Error("Operating-pack idempotency claim was not persisted");
  return { created: false, run: existing };
}

export async function getOperatingPackRun(runId: string) {
  return db.query.operatingPackRuns.findFirst({
    where: eq(operatingPackRuns.id, runId),
  });
}

export async function getOperatingPackRunByIdempotency(
  workspaceId: string,
  idempotencyKey: string,
) {
  return db.query.operatingPackRuns.findFirst({
    where: and(
      eq(operatingPackRuns.workspaceId, workspaceId),
      eq(operatingPackRuns.idempotencyKey, idempotencyKey),
    ),
  });
}

export async function getOwnedOperatingPackRun(runId: string, userId: string) {
  return db.query.operatingPackRuns.findFirst({
    where: and(
      eq(operatingPackRuns.id, runId),
      eq(operatingPackRuns.userId, userId),
    ),
  });
}

export async function listOwnedOperatingPackRuns(userId: string, limit = 50) {
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  return db
    .select({
      id: operatingPackRuns.id,
      workflowRunId: operatingPackRuns.workflowRunId,
      workspaceId: operatingPackRuns.workspaceId,
      packId: operatingPackRuns.packId,
      workflowId: operatingPackRuns.workflowId,
      harnessId: operatingPackRuns.harnessId,
      status: operatingPackRuns.status,
      approvalId: operatingPackRuns.approvalId,
      errorCode: operatingPackRuns.errorCode,
      createdAt: operatingPackRuns.createdAt,
      updatedAt: operatingPackRuns.updatedAt,
      finishedAt: operatingPackRuns.finishedAt,
    })
    .from(operatingPackRuns)
    .where(eq(operatingPackRuns.userId, userId))
    .orderBy(desc(operatingPackRuns.updatedAt), desc(operatingPackRuns.id))
    .limit(boundedLimit);
}

export async function attachOperatingPackWorkflowRun(
  runId: string,
  workflowRunId: string,
): Promise<void> {
  await db
    .update(operatingPackRuns)
    .set({ workflowRunId, updatedAt: new Date() })
    .where(eq(operatingPackRuns.id, runId));
}

export async function updateOperatingPackRun(
  runId: string,
  input: {
    status: OperatingPackRunStatus;
    approvalId?: string | null;
    result?: Readonly<Record<string, unknown>> | null;
    errorCode?: string | null;
    finished?: boolean;
  },
): Promise<void> {
  await db
    .update(operatingPackRuns)
    .set({
      status: input.status,
      approvalId: input.approvalId,
      result: input.result,
      errorCode: input.errorCode,
      updatedAt: new Date(),
      ...(input.finished ? { finishedAt: new Date() } : {}),
    })
    .where(eq(operatingPackRuns.id, runId));
}

export async function appendOperatingPackTrace(input: {
  id: string;
  runId: string;
  workspaceId: string;
  sequence: number;
  type: string;
  agentId?: string;
  summary?: string;
  data?: Readonly<Record<string, unknown>>;
}): Promise<void> {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1)
    throw new Error("Operating-pack trace sequence must be positive");
  await db
    .insert(operatingPackTraces)
    .values({
      ...input,
      agentId: input.agentId ?? null,
      summary: input.summary
        ? sanitizeTraceText(input.summary).slice(0, 1000)
        : null,
      data: redactTraceData(input.data) ?? null,
    })
    .onConflictDoNothing({
      target: [operatingPackTraces.runId, operatingPackTraces.sequence],
    });
}

export async function listOwnedOperatingPackTraces(input: {
  runId: string;
  userId: string;
  afterSequence?: number;
  limit?: number;
}) {
  const run = await getOwnedOperatingPackRun(input.runId, input.userId);
  if (!run) return null;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const afterSequence = Math.max(input.afterSequence ?? 0, 0);
  const traces = await db
    .select()
    .from(operatingPackTraces)
    .where(
      and(
        eq(operatingPackTraces.runId, run.id),
        eq(operatingPackTraces.workspaceId, run.workspaceId),
        gt(operatingPackTraces.sequence, afterSequence),
      ),
    )
    .orderBy(asc(operatingPackTraces.sequence))
    .limit(limit);
  return { run, traces };
}
