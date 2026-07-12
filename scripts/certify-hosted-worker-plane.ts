import { eq } from "drizzle-orm";
import postgres from "postgres";
import {
  type ConnectorManifest,
  createPostgresConnectorRepository,
  createSourceArtifact,
} from "@open-agents/connectors";
import { createPostgresKnowledgeRepository } from "@open-agents/knowledge";
import { db } from "../apps/web/lib/db/client";
import {
  appendOperatingPackTrace,
  createOperatingPackRun,
} from "../apps/web/lib/db/operating-pack-runs";
import {
  chats,
  operatingPackTraces,
  sessions,
  users,
} from "../apps/web/lib/db/schema";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");
const typesenseUrl = safeTypesenseUrl(process.env.TYPESENSE_CERT_URL);
const typesenseApiKey = process.env.TYPESENSE_CERT_API_KEY?.trim() ?? "";
if (typesenseApiKey.length < 16)
  throw new Error("TYPESENSE_CERT_API_KEY is required");
const typesenseCollection = identifier(
  process.env.TYPESENSE_CERT_COLLECTION ?? "workspace_knowledge",
  "TYPESENSE_CERT_COLLECTION",
);
const workspaceId =
  process.env.KNOWLEDGE_WORKER_CERT_WORKSPACE ??
  "worker-certification-workspace";
const suffix = crypto.randomUUID().replaceAll("-", "");
const userId = `worker-cert-user-${suffix}`;
const sessionId = `worker-cert-session-${suffix}`;
const chatId = `worker-cert-chat-${suffix}`;
const runId = `worker-cert-run-${suffix}`;
const deploymentId = `worker-cert-deployment-${suffix}`;
const connectionId = `worker-cert-connection-${suffix}`;
const accountId = `worker-cert-account-${suffix}`;
const eventId = `worker-cert-event-${suffix}`;
const inspection = postgres(connectionString, { max: 1, connect_timeout: 10 });
const connectors = createPostgresConnectorRepository({
  connectionString,
  maxConnections: 1,
});
const knowledge = createPostgresKnowledgeRepository({
  connectionString,
  maxConnections: 1,
});
let artifactKey: string | null = null;
let entityId: string | null = null;
let outboxIds: readonly string[] = [];
let failure: unknown = null;
const cleanupErrors: string[] = [];

try {
  await db.insert(users).values({
    id: userId,
    username: `worker_cert_${suffix}`,
  });
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    title: "Hosted worker plane certification",
  });
  await db.insert(chats).values({
    id: chatId,
    sessionId,
    title: "Hosted worker plane certification",
    harnessId: "pi",
  });
  await createOperatingPackRun({
    id: runId,
    workspaceId,
    sessionId,
    chatId,
    userId,
    packId: "finance_ops",
    workflowId: "hosted_worker_plane_certification",
    harnessId: "pi",
    idempotencyKey: `hosted-worker-plane:${suffix}`,
    requestHash: "a".repeat(64),
    status: "running",
  });
  await appendOperatingPackTrace({
    id: `${runId}:start`,
    runId,
    workspaceId,
    sequence: 1,
    type: "workflow.started",
  });

  const manifest: ConnectorManifest = {
    version: 1,
    workspaceId,
    connectionId,
    adapter: "pipedream",
    appSlug: "magic-inbox",
    ownerMode: "team-shared",
    credentialRef: `vault/certification/${connectionId}`,
    environment: "development",
    deploymentId,
    accounts: [
      {
        accountId,
        externalAccountId: `external-${accountId}`,
        label: "Hosted worker certification",
        isDefault: true,
      },
    ],
    capabilities: ["trigger", "knowledge-ingestion"],
    stages: ["canonical-write", "enrichment", "embedding", "projection"],
    freshnessSloMs: 300_000,
    schemaVersion: "hosted-worker-cert.v1",
    redactionPolicy: "metadata-only",
  };
  await connectors.registerDeployment(manifest);
  const now = Date.now();
  const artifact = createSourceArtifact({
    workspaceId,
    connectorId: connectionId,
    provider: "pipedream",
    accountId,
    externalContainerId: `container-${suffix}`,
    externalArtifactId: `artifact-${suffix}`,
    contentHash: `sha256:${"b".repeat(64)}`,
    mimeType: "application/pdf",
    sizeBytes: 321,
    filename: "hosted-worker-certification.pdf",
    receivedAtMs: now,
    observedAtMs: now,
    safeStorageRef: `storage/certification/${suffix}`,
    schemaVersion: "source-artifact.v1",
    normalizerVersion: "worker-cert.v1",
    correlationId: runId,
    causationId: eventId,
    redaction: "metadata-only",
  });
  artifactKey = artifact.artifactKey;
  const persisted = await connectors.persistArtifactAndStages({
    deploymentId,
    artifact,
  });
  outboxIds = persisted.outboxIds;

  const result = await waitFor(
    async () => {
      const entity = await knowledge
        .forWorkspace(workspaceId)
        .getByExternalKey("SourceArtifact", artifact.artifactKey);
      const enrichment = entity
        ? await knowledge
            .forWorkspace(workspaceId)
            .getEnrichment(entity.id, "source-artifact-rules.v1")
        : undefined;
      const projection = entity
        ? await knowledge.forWorkspace(workspaceId).getSearchProjection({
            entityId: entity.id,
            provider: "typesense",
            collection: typesenseCollection,
          })
        : undefined;
      const embeddings = entity
        ? await inspection<{ dimensions: number; source_version: number }[]>`
          SELECT vector_dims(embedding)::int AS dimensions, source_version
          FROM knowledge_embeddings
          WHERE workspace_id = ${workspaceId} AND entity_id = ${entity.id}
            AND model = 'openai/text-embedding-3-small'
            AND input_version = 'entity-search.v1'
        `
        : [];
      const typesenseDocument = entity
        ? await readTypesenseDocument(entity.id)
        : null;
      const outbox = await inspection<
        { id: string; status: string; published_at: Date | null }[]
      >`
      SELECT id, status, published_at FROM knowledge_outbox
      WHERE id IN ${inspection([...persisted.outboxIds])}
    `;
      const traces = await db
        .select({
          sequence: operatingPackTraces.sequence,
          type: operatingPackTraces.type,
          summary: operatingPackTraces.summary,
          data: operatingPackTraces.data,
        })
        .from(operatingPackTraces)
        .where(eq(operatingPackTraces.runId, runId));
      const telemetry = traces.filter(
        (trace) => trace.type === "queue.telemetry",
      );
      const metrics = telemetry.flatMap((trace) => {
        const data = trace.data as { metrics?: unknown } | null;
        return Array.isArray(data?.metrics) ? data.metrics : [];
      }) as Array<{ queued?: number; completed?: number; queue?: string }>;
      const queued = metrics.reduce(
        (total, metric) => total + (metric.queued ?? 0),
        0,
      );
      const completed = metrics.reduce(
        (total, metric) => total + (metric.completed ?? 0),
        0,
      );
      if (
        !entity ||
        !enrichment ||
        !projection ||
        embeddings.length !== 1 ||
        embeddings[0]?.dimensions !== 1_536 ||
        embeddings[0]?.source_version !== entity.version ||
        typesenseDocument?.id !== entity.id ||
        typesenseDocument.workspaceId !== workspaceId ||
        typesenseDocument.inputHash !== projection.inputHash ||
        outbox.some((event) => event.status !== "published") ||
        queued < 4 ||
        completed < 4
      )
        return null;
      return {
        entity,
        enrichment,
        projection,
        embeddings,
        typesenseDocument,
        outbox,
        telemetry,
        queued,
        completed,
      };
    },
    120_000,
    "initial four-stage worker plane",
  );
  entityId = result.entity.id;

  const serializedTelemetry = JSON.stringify(result.telemetry);
  if (
    serializedTelemetry.includes(artifact.artifactKey) ||
    serializedTelemetry.includes(artifact.safeStorageRef)
  )
    throw new Error("Hosted worker telemetry leaked source artifact detail");

  // Prove the low-priority repair route against the deployed worker and hosted
  // alternate index. Delete only the external projection, enqueue the same
  // repair event twice, and require one idempotent event to restore it.
  await deleteTypesenseDocument(result.entity.id);
  const repairOutboxId = `worker-cert-repair-${suffix}`;
  const repairInput = {
    externalKey: artifact.artifactKey,
    kind: "SourceArtifact",
    name: result.entity.name,
    outbox: {
      id: repairOutboxId,
      topic: "knowledge.repair",
      schemaVersion: 1,
      payload: {
        artifactKey: artifact.artifactKey,
        sourceRevision: artifact.sourceRevision,
        connectionId,
        traceId: runId,
        stage: "repair",
      },
    },
  } as const;
  const repairFirst = await knowledge
    .forWorkspace(workspaceId)
    .resolveAndEnqueue(repairInput);
  const repairReplay = await knowledge
    .forWorkspace(workspaceId)
    .resolveAndEnqueue(repairInput);
  if (
    repairFirst.event.id !== repairReplay.event.id ||
    repairFirst.entity.id !== repairReplay.entity.id
  )
    throw new Error("Hosted repair enqueue is not idempotent");
  outboxIds = [...outboxIds, repairOutboxId];
  const repaired = await waitFor(
    async () => {
      const [event] = await inspection<
        { status: string; published_at: Date | null }[]
      >`
      SELECT status, published_at FROM knowledge_outbox
      WHERE id = ${repairOutboxId}
    `;
      const document = await readTypesenseDocument(result.entity.id);
      if (event?.status !== "published" || !event.published_at || !document)
        return null;
      return { event, document };
    },
    120_000,
    "idempotent hosted repair",
  );
  if (
    repaired.document.workspaceId !== workspaceId ||
    repaired.document.inputHash !== result.projection.inputHash
  )
    throw new Error("Hosted repair restored the wrong projection");

  console.log(
    JSON.stringify(
      {
        certified: true,
        workspaceId,
        runId,
        artifactKey: artifact.artifactKey,
        outbox: result.outbox.map((event) => ({
          id: event.id,
          status: event.status,
          published: Boolean(event.published_at),
        })),
        entity: {
          id: result.entity.id,
          kind: result.entity.kind,
          version: result.entity.version,
        },
        enrichment: {
          classification: result.enrichment.classification,
          sourceVersion: result.enrichment.sourceVersion,
        },
        embedding: {
          dimensions: result.embeddings[0]!.dimensions,
          sourceVersion: result.embeddings[0]!.source_version,
        },
        projection: {
          provider: result.projection.provider,
          collection: result.projection.collection,
          sourceVersion: result.projection.sourceVersion,
          externalDocument: result.typesenseDocument.id,
        },
        telemetry: {
          traceCount: result.telemetry.length,
          queued: result.queued,
          completed: result.completed,
          payloadFree: true,
        },
        repair: {
          outboxId: repairOutboxId,
          replayedEnqueue: true,
          published: true,
          restoredExternalDocument: repaired.document.id,
          inputHashStable: true,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  failure = error;
} finally {
  if (!entityId && artifactKey) {
    await runCleanup("resolve cleanup entity", async () => {
      const entity = await knowledge
        .forWorkspace(workspaceId)
        .getByExternalKey("SourceArtifact", artifactKey!);
      entityId = entity?.id ?? null;
    });
  }
  if (entityId) {
    await runCleanup("delete Typesense certification document", () =>
      deleteTypesenseDocument(entityId!),
    );
    await runCleanup("delete search projection", () =>
      inspection`DELETE FROM knowledge_search_projections WHERE workspace_id = ${workspaceId} AND entity_id = ${entityId}`,
    );
    await runCleanup("delete enrichment", () =>
      inspection`DELETE FROM knowledge_enrichments WHERE workspace_id = ${workspaceId} AND entity_id = ${entityId}`,
    );
    await runCleanup("delete embedding", () =>
      inspection`DELETE FROM knowledge_embeddings WHERE workspace_id = ${workspaceId} AND entity_id = ${entityId}`,
    );
    await runCleanup("delete knowledge entity", () =>
      inspection`DELETE FROM knowledge_entities WHERE workspace_id = ${workspaceId} AND id = ${entityId}`,
    );
  }
  if (outboxIds.length > 0)
    await runCleanup("delete outbox rows", () =>
      inspection`DELETE FROM knowledge_outbox WHERE id IN ${inspection([...outboxIds])}`,
    );
  if (artifactKey)
    await runCleanup("delete source artifact", () =>
      inspection`DELETE FROM source_artifacts WHERE workspace_id = ${workspaceId} AND artifact_key = ${artifactKey}`,
    );
  await runCleanup("delete connector deployment", () =>
    inspection`DELETE FROM connector_deployments WHERE deployment_id = ${deploymentId}`,
  );
  await runCleanup("delete certification user", () =>
    db.delete(users).where(eq(users.id, userId)),
  );
  await Promise.all([
    runCleanup("close connector repository", () => connectors.close()),
    runCleanup("close knowledge repository", () => knowledge.close()),
    runCleanup("close inspection database", () => inspection.end({ timeout: 5 })),
  ]);
  if (cleanupErrors.length > 0 && !failure) {
    failure = new Error(`Hosted worker cleanup failed: ${cleanupErrors.join("; ")}`);
  }
}

if (failure) {
  console.error(
    failure instanceof Error
      ? failure.message
      : "Hosted worker plane certification failed",
  );
  process.exit(1);
}
process.exit(0);

async function runCleanup(label: string, operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    cleanupErrors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readTypesenseDocument(
  id: string,
): Promise<{ id: string; workspaceId: string; inputHash: string } | null> {
  const response = await fetch(
    new URL(
      `/collections/${encodeURIComponent(typesenseCollection)}/documents/${encodeURIComponent(id)}`,
      typesenseUrl,
    ),
    {
      headers: { "x-typesense-api-key": typesenseApiKey },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Typesense certification read failed (${response.status})`);
  const value = (await response.json().catch(() => null)) as {
    id?: unknown;
    workspaceId?: unknown;
    inputHash?: unknown;
  } | null;
  if (
    typeof value?.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.inputHash !== "string"
  )
    throw new Error("Typesense certification document is invalid");
  return {
    id: value.id,
    workspaceId: value.workspaceId,
    inputHash: value.inputHash,
  };
}

async function deleteTypesenseDocument(id: string): Promise<void> {
  const response = await fetch(
    new URL(
      `/collections/${encodeURIComponent(typesenseCollection)}/documents/${encodeURIComponent(id)}`,
      typesenseUrl,
    ),
    {
      method: "DELETE",
      headers: { "x-typesense-api-key": typesenseApiKey },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!(response.ok || response.status === 404))
    throw new Error(
      `Typesense certification cleanup failed (${response.status})`,
    );
}

function safeTypesenseUrl(value: string | undefined): URL {
  if (!value) throw new Error("TYPESENSE_CERT_URL is required");
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("TYPESENSE_CERT_URL must use HTTPS");
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function identifier(value: string, name: string): string {
  if (
    value.length < 2 ||
    value.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_./-]+$/.test(value)
  )
    throw new Error(`${name} is invalid`);
  return value;
}

async function waitFor<T>(
  inspect: () => Promise<T | null>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await inspect();
    if (result) return result;
    await Bun.sleep(1_000);
  }
  throw new Error(`${label} did not converge before the deadline`);
}
