import { createHash } from "node:crypto";
import { needsRefresh } from "@open-agents/knowledge";
import type {
  PersistentEntity,
  PersistentSearchProjection,
  WorkspaceKnowledgeRepository,
} from "@open-agents/knowledge";
import type { BullMqRuntime, BullMqRuntimeJob } from "./bullmq";

type RepairArtifactReader = {
  getArtifact(
    workspaceId: string,
    artifactKey: string,
  ): Promise<
    | Readonly<{
        artifactKey: string;
        connectorId: string;
        sourceRevision: string;
      }>
    | undefined
  >;
};

export type KnowledgeRepairScanResult = Readonly<{
  workspaceId: string;
  inspected: number;
  stale: number;
  skippedNonArtifacts: number;
  enqueued: number;
  replayed: number;
  scanId: string;
}>;

/**
 * Scans canonical SourceArtifact entities and schedules only stale or missing
 * search projections. The job payload contains lineage references, never raw
 * documents or credentials. Stable IDs make repeated scheduler ticks
 * idempotent until the source revision changes.
 */
export async function scheduleKnowledgeRepairs(input: {
  workspace: WorkspaceKnowledgeRepository;
  artifacts: RepairArtifactReader;
  runtime: BullMqRuntime;
  provider: string;
  collection: string;
  scanId?: string;
  maxAgeMs?: number;
  pageSize?: number;
  maxJobs?: number;
  nowMs?: number;
}): Promise<KnowledgeRepairScanResult> {
  const scanId = input.scanId ?? `repair-scan-${Date.now()}`;
  const nowMs = input.nowMs ?? Date.now();
  const pageSize = input.pageSize ?? 100;
  const maxJobs = input.maxJobs ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
    throw new Error("Repair scheduler pageSize is invalid");
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10_000)
    throw new Error("Repair scheduler maxJobs is invalid");
  if (!Number.isInteger(nowMs) || nowMs <= 0)
    throw new Error("Repair scheduler nowMs is invalid");

  let cursor: string | undefined;
  let inspected = 0;
  let stale = 0;
  let skippedNonArtifacts = 0;
  let enqueued = 0;
  let replayed = 0;
  while (enqueued < maxJobs) {
    const page = await input.workspace.page(cursor, pageSize);
    if (page.items.length === 0) break;
    for (const entity of page.items) {
      if (enqueued >= maxJobs) break;
      inspected += 1;
      const artifact = await input.artifacts.getArtifact(
        input.workspace.workspaceId,
        entity.externalKey,
      );
      if (!artifact) {
        skippedNonArtifacts += 1;
        continue;
      }
      const projection = await input.workspace.getSearchProjection({
        entityId: entity.id,
        provider: input.provider,
        collection: input.collection,
      });
      if (!isProjectionStale(entity, projection, nowMs, input.maxAgeMs))
        continue;
      stale += 1;
      const job = repairJob({
        workspaceId: input.workspace.workspaceId,
        entity,
        artifact,
        provider: input.provider,
        collection: input.collection,
        scanId,
      });
      const result = await input.runtime.enqueue(job);
      if (result.replayed) replayed += 1;
      else enqueued += 1;
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return {
    workspaceId: input.workspace.workspaceId,
    inspected,
    stale,
    skippedNonArtifacts,
    enqueued,
    replayed,
    scanId,
  };
}

function isProjectionStale(
  entity: PersistentEntity,
  projection: PersistentSearchProjection | undefined,
  nowMs: number,
  maxAgeMs: number | undefined,
): boolean {
  if (!projection) return true;
  const projectedAt = Date.parse(projection.projectedAt);
  if (!Number.isFinite(projectedAt)) return true;
  return needsRefresh(
    {
      sourceVersion: entity.version,
      projectionVersion: projection.sourceVersion,
      observedAt: projectedAt,
      contentHash: projection.inputHash,
    },
    nowMs,
    maxAgeMs,
  );
}

function repairJob(input: {
  workspaceId: string;
  entity: PersistentEntity;
  artifact: Readonly<{
    artifactKey: string;
    connectorId: string;
    sourceRevision: string;
  }>;
  provider: string;
  collection: string;
  scanId: string;
}): BullMqRuntimeJob {
  const lineage = `${input.workspaceId}:${input.artifact.artifactKey}:${input.artifact.sourceRevision}`;
  const digest = createHash("sha256").update(lineage).digest("hex");
  return {
    id: `repair-${digest}`,
    workspaceId: input.workspaceId,
    profile: "knowledge-ai",
    queue: "repair",
    idempotencyKey: `knowledge-repair:${digest}`,
    schemaVersion: 1,
    payload: {
      artifactKey: input.artifact.artifactKey,
      sourceRevision: input.artifact.sourceRevision,
      connectionId: input.artifact.connectorId,
      entityId: input.entity.id,
      provider: input.provider,
      collection: input.collection,
      scanId: input.scanId,
    },
    traceId: `trace-repair-${digest}`,
  };
}
