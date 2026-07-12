import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  type ConnectorManifest,
  createPostgresConnectorRepository,
  createSourceArtifact,
} from "@open-agents/connectors";
import {
  type KnowledgeEmbeddingProvider,
  type KnowledgeSearchDocument,
  type KnowledgeSearchProjectionProvider,
  createPostgresKnowledgeRepository,
} from "@open-agents/knowledge";
import {
  createBullMqRuntime,
  createKnowledgeAiProcessor,
  createKnowledgeCanonicalWriteProcessor,
  createKnowledgeEmbeddingProcessor,
  createKnowledgeEnrichmentProcessor,
  createKnowledgeRepairProcessor,
  createKnowledgeSearchProjectionProcessor,
  relayKnowledgeOutbox,
  type QueueTraceFact,
} from "@open-agents/queues";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = (
  process.env.QUEUE_REDIS_TEST_URL ??
  process.env.REDIS_QUEUE_URL ??
  process.env.REDIS_URL
)?.trim();
const enabled = process.env.RUN_CONNECTED_PIPELINE_INTEGRATION === "1";
const liveTest = enabled && databaseUrl && redisUrl ? test : test.skip;
const suffix = randomUUID().replaceAll("-", "");
const workspaceId = `pipeline-live-${suffix}`;
const deploymentId = `dep-pipeline-${suffix}`;
const connectionId = `conn-pipeline-${suffix}`;
const namespace = `pipeline-${suffix.slice(0, 16)}`;
const outboxIds = new Set<string>();
const externalIndex = new Map<string, KnowledgeSearchDocument>();
let projectionAttempts = 0;

setDefaultTimeout(60_000);

const connector = databaseUrl
  ? createPostgresConnectorRepository({ connectionString: databaseUrl })
  : null;
const knowledge = databaseUrl
  ? createPostgresKnowledgeRepository({ connectionString: databaseUrl })
  : null;
const inspection = databaseUrl
  ? postgres(databaseUrl, { max: 1, connect_timeout: 10 })
  : null;
const queueFacts: QueueTraceFact[] = [];
const runtime = redisUrl
  ? createBullMqRuntime({
      redisUrl,
      namespace,
      trace: (fact) => {
        queueFacts.push(fact);
      },
    })
  : null;
const embeddingProvider: KnowledgeEmbeddingProvider = {
  model: "certification/1536",
  inputVersion: "entity-search.v1",
  async embed(values) {
    return {
      model: this.model,
      inputVersion: this.inputVersion,
      dimensions: 1536,
      embeddings: values.map(() =>
        Array.from({ length: 1536 }, (_value, index) => (index === 0 ? 1 : 0)),
      ),
      usageTokens: values.length,
    };
  },
};
const searchProvider: KnowledgeSearchProjectionProvider = {
  provider: "typesense-certification",
  collection: "workspace-knowledge",
  schemaVersion: "knowledge-search.v1",
  async upsert(document) {
    projectionAttempts += 1;
    externalIndex.set(document.id, document);
    if (projectionAttempts === 1)
      throw new Error("SIMULATED_CRASH_AFTER_EFFECT");
    return {
      provider: this.provider,
      collection: this.collection,
      schemaVersion: this.schemaVersion,
      providerRevision: document.inputHash,
    };
  },
};

describe("connected data plane (live Postgres + BullMQ)", () => {
  liveTest(
    "moves one source artifact through the transactional outbox into every worker stage",
    async () => {
      if (!(connector && knowledge && runtime && inspection))
        throw new Error("connected pipeline test is not configured");
      const manifest: ConnectorManifest = {
        version: 1,
        workspaceId,
        connectionId,
        adapter: "pipedream",
        appSlug: "magic-inbox",
        ownerMode: "team-shared",
        credentialRef: `vault/pipedream/${connectionId}`,
        environment: "development",
        deploymentId,
        accounts: [
          {
            accountId: `account-${suffix}`,
            externalAccountId: `external-${suffix}`,
            label: "Magic Inbox",
            isDefault: true,
          },
        ],
        capabilities: ["trigger", "delta", "knowledge-ingestion"],
        stages: ["canonical-write", "enrichment", "embedding", "projection"],
        freshnessSloMs: 300_000,
        schemaVersion: "magic-inbox.v1",
        redactionPolicy: "standard",
      };
      await connector.registerDeployment(manifest);
      const now = Date.now();
      const artifact = createSourceArtifact({
        workspaceId,
        connectorId: connectionId,
        provider: "pipedream",
        accountId: `account-${suffix}`,
        externalContainerId: `message-${suffix}`,
        externalArtifactId: `attachment-${suffix}`,
        contentHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mimeType: "application/pdf",
        sizeBytes: 4096,
        filename: "invoice.pdf",
        receivedAtMs: now,
        observedAtMs: now,
        safeStorageRef: `storage/pipeline/${suffix}`,
        schemaVersion: "source-artifact.v1",
        normalizerVersion: "magic-inbox.v1",
        correlationId: `trace-${suffix}`,
        redaction: "standard",
      });
      const persisted = await connector.persistArtifactAndStages({
        deploymentId,
        artifact,
      });
      persisted.outboxIds.forEach((id) => outboxIds.add(id));

      const canonical = createKnowledgeCanonicalWriteProcessor({
        artifacts: connector,
        forWorkspace: (id) => knowledge.forWorkspace(id),
      });
      const enrichment = createKnowledgeEnrichmentProcessor({
        artifacts: connector,
        forWorkspace: (id) => knowledge.forWorkspace(id),
      });
      const embedding = createKnowledgeEmbeddingProcessor({
        forWorkspace: (id) => knowledge.forWorkspace(id),
        provider: embeddingProvider,
      });
      const projection = createKnowledgeSearchProjectionProcessor({
        forWorkspace: (id) => knowledge.forWorkspace(id),
        provider: searchProvider,
      });
      const repair = createKnowledgeRepairProcessor({
        canonical,
        enrichment,
        embedding,
        projection,
      });
      await runtime.start({
        "source-connectors": canonical,
        "knowledge-ai": createKnowledgeAiProcessor({
          canonical,
          enrichment,
          embedding,
          projection,
          repair,
        }),
      });
      const relayed = await relayKnowledgeOutbox({
        workspace: knowledge.forWorkspace(workspaceId),
        runtime,
        workerId: `relay-${suffix}`,
      });
      expect(relayed).toEqual(
        expect.objectContaining({
          claimed: 4,
          published: 4,
          released: 0,
          dead: 0,
        }),
      );
      try {
        await runtime.waitUntilIdle(45_000);
      } catch (error) {
        console.error("connected pipeline queue facts", queueFacts);
        throw error;
      }
      const entity = await knowledge
        .forWorkspace(workspaceId)
        .getByExternalKey("SourceArtifact", artifact.artifactKey);
      expect(entity).toMatchObject({ name: "invoice.pdf", version: 1 });
      const enrichmentRecord = await knowledge
        .forWorkspace(workspaceId)
        .getEnrichment(entity!.id, "source-artifact-rules.v1");
      expect(enrichmentRecord).toMatchObject({
        classification: "invoice-document",
        sourceVersion: 1,
      });
      const projectionRecord = await knowledge
        .forWorkspace(workspaceId)
        .getSearchProjection({
          entityId: entity!.id,
          provider: searchProvider.provider,
          collection: searchProvider.collection,
        });
      expect(projectionRecord).toMatchObject({
        sourceVersion: 1,
        providerRevision: externalIndex.get(entity!.id)?.inputHash,
      });
      expect(externalIndex.size).toBe(1);
      expect(projectionAttempts).toBe(2);
      const [embeddingCount] = await inspection<{ count: number }[]>`
        SELECT count(*)::int AS count FROM knowledge_embeddings
        WHERE workspace_id = ${workspaceId} AND entity_id = ${entity!.id}
      `;
      expect(embeddingCount?.count).toBe(1);
      await expect(
        relayKnowledgeOutbox({
          workspace: knowledge.forWorkspace(workspaceId),
          runtime,
          workerId: `relay-replay-${suffix}`,
        }),
      ).resolves.toMatchObject({ claimed: 0, published: 0 });
    },
  );
});

afterAll(async () => {
  if (runtime) {
    await cleanup(runtime.waitUntilIdle(5_000));
    await cleanup(runtime.purge());
    await cleanup(runtime.close());
  }
  if (inspection) {
    if (outboxIds.size)
      await inspection`DELETE FROM knowledge_outbox WHERE id IN ${inspection([...outboxIds])}`;
    await inspection`DELETE FROM knowledge_entities WHERE workspace_id = ${workspaceId}`;
    await inspection`DELETE FROM source_artifacts WHERE workspace_id = ${workspaceId}`;
    await inspection`DELETE FROM connector_deployments WHERE deployment_id = ${deploymentId}`;
    await cleanup(inspection.end({ timeout: 5 }));
  }
  if (connector) await cleanup(connector.close());
  if (knowledge) await cleanup(knowledge.close());
});

async function cleanup(operation: Promise<unknown>): Promise<void> {
  await Promise.race([operation.catch(() => undefined), Bun.sleep(3_000)]);
}
