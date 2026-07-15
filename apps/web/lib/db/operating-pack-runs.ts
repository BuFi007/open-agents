import { redactTraceData, sanitizeTraceText } from "@open-agents/traces";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import {
  type NewOperatingPackRun,
  operatingPackRuns,
  operatingPackTraces,
  queueTelemetryExports,
} from "./schema";

export type OperatingPackRunStatus =
  | "pending"
  | "running"
  | "pause_requested"
  | "paused"
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

export async function claimOperatingPackWorkflowRestart(runId: string) {
  const [run] = await db
    .update(operatingPackRuns)
    .set({
      status: "pending",
      errorCode: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatingPackRuns.id, runId),
        eq(operatingPackRuns.status, "failed"),
        eq(operatingPackRuns.errorCode, "WORKFLOW_START_FAILED"),
        isNull(operatingPackRuns.workflowRunId),
      ),
    )
    .returning();
  return run;
}

export async function getOwnedOperatingPackRun(runId: string, userId: string) {
  return db.query.operatingPackRuns.findFirst({
    where: and(
      eq(operatingPackRuns.id, runId),
      eq(operatingPackRuns.userId, userId),
    ),
  });
}

export async function getWorkspaceOperatingPackRun(
  runId: string,
  workspaceId: string,
  userId: string,
) {
  return db.query.operatingPackRuns.findFirst({
    where: and(
      eq(operatingPackRuns.id, runId),
      eq(operatingPackRuns.workspaceId, workspaceId),
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

export async function listWorkspaceOperatingPackRuns(
  workspaceId: string,
  userId: string,
  limit = 50,
) {
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
    .where(
      and(
        eq(operatingPackRuns.workspaceId, workspaceId),
        eq(operatingPackRuns.userId, userId),
      ),
    )
    .orderBy(desc(operatingPackRuns.updatedAt), desc(operatingPackRuns.id))
    .limit(boundedLimit);
}

export async function listWorkspaceOperatingPackTraces(input: {
  runId: string;
  workspaceId: string;
  userId: string;
  afterSequence?: number;
  limit?: number;
}) {
  const run = await getWorkspaceOperatingPackRun(
    input.runId,
    input.workspaceId,
    input.userId,
  );
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
    reopen?: boolean;
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
      ...(input.reopen
        ? { finishedAt: null }
        : input.finished
          ? { finishedAt: new Date() }
          : {}),
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

export async function appendOperatingPackTraceNext(input: {
  id: string;
  runId: string;
  workspaceId: string;
  type: string;
  agentId?: string;
  summary?: string;
  data?: Readonly<Record<string, unknown>>;
}): Promise<{ replayed: boolean; sequence: number }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/.test(input.id))
    throw new Error("Operating-pack trace id is invalid");
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.runId}, 0))`,
    );
    const existing = await transaction
      .select({ sequence: operatingPackTraces.sequence })
      .from(operatingPackTraces)
      .where(eq(operatingPackTraces.id, input.id))
      .limit(1);
    if (existing[0]) return { replayed: true, sequence: existing[0].sequence };
    const run = await transaction
      .select({ workspaceId: operatingPackRuns.workspaceId })
      .from(operatingPackRuns)
      .where(eq(operatingPackRuns.id, input.runId))
      .limit(1);
    if (!run[0] && input.type === "queue.telemetry") {
      const existingExport = await transaction
        .select({
          exportId: queueTelemetryExports.exportId,
          workspaceId: queueTelemetryExports.workspaceId,
          runId: queueTelemetryExports.runId,
        })
        .from(queueTelemetryExports)
        .where(eq(queueTelemetryExports.exportId, input.id))
        .limit(1);
      if (existingExport[0]) {
        if (
          existingExport[0].workspaceId !== input.workspaceId ||
          existingExport[0].runId !== input.runId
        )
          throw new Error("Queue telemetry export is outside the workspace");
        return { replayed: true, sequence: 1 };
      }
      const data = redactTraceData(input.data) ?? {};
      const generatedAtMs =
        typeof data.generatedAtMs === "number" &&
        Number.isSafeInteger(data.generatedAtMs) &&
        data.generatedAtMs > 0
          ? data.generatedAtMs
          : Date.now();
      const factCount =
        typeof data.factCount === "number" &&
        Number.isSafeInteger(data.factCount) &&
        data.factCount > 0
          ? Math.min(data.factCount, 10_000)
          : 1;
      await transaction.insert(queueTelemetryExports).values({
        exportId: input.id,
        workspaceId: input.workspaceId,
        runId: input.runId,
        generatedAtMs,
        factCount,
        data,
      });
      return { replayed: false, sequence: 1 };
    }
    if (!run[0] || run[0].workspaceId !== input.workspaceId)
      throw new Error("Operating-pack trace run is outside the workspace");
    const latest = await transaction
      .select({ sequence: operatingPackTraces.sequence })
      .from(operatingPackTraces)
      .where(eq(operatingPackTraces.runId, input.runId))
      .orderBy(desc(operatingPackTraces.sequence))
      .limit(1);
    const sequence = (latest[0]?.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence) || sequence > 2_147_483_647)
      throw new Error("Operating-pack trace sequence is exhausted");
    await transaction.insert(operatingPackTraces).values({
      ...input,
      sequence,
      agentId: input.agentId ?? null,
      summary: input.summary
        ? sanitizeTraceText(input.summary).slice(0, 1000)
        : null,
      data: redactTraceData(input.data) ?? null,
    });
    return { replayed: false, sequence };
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
