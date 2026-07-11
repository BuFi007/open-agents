import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  type ConnectorManifest,
  createPostgresConnectorRepository,
  createSourceArtifact,
} from "@open-agents/connectors";
import { createPostgresKnowledgeRepository } from "@open-agents/knowledge";
import {
  createBullMqRuntime,
  relayKnowledgeOutbox,
  type BullMqRuntimeJob,
} from "@open-agents/queues";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = process.env.QUEUE_REDIS_TEST_URL?.trim();
const enabled = process.env.RUN_CONNECTED_PIPELINE_INTEGRATION === "1";
const liveTest = enabled && databaseUrl && redisUrl ? test : test.skip;
const suffix = randomUUID().replaceAll("-", "");
const workspaceId = `pipeline-live-${suffix}`;
const deploymentId = `dep-pipeline-${suffix}`;
const connectionId = `conn-pipeline-${suffix}`;
const namespace = `pipeline-${suffix.slice(0, 16)}`;
const outboxIds = new Set<string>();

setDefaultTimeout(30_000);

const connector = databaseUrl
  ? createPostgresConnectorRepository({ connectionString: databaseUrl })
  : null;
const knowledge = databaseUrl
  ? createPostgresKnowledgeRepository({ connectionString: databaseUrl })
  : null;
const inspection = databaseUrl
  ? postgres(databaseUrl, { max: 1, connect_timeout: 10 })
  : null;
const runtime = redisUrl ? createBullMqRuntime({ redisUrl, namespace }) : null;

describe("connected data plane (live Postgres + BullMQ)", () => {
  liveTest(
    "moves one source artifact through the transactional outbox into every worker stage",
    async () => {
      if (!(connector && knowledge && runtime))
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

      const processed: BullMqRuntimeJob[] = [];
      const process = async (job: BullMqRuntimeJob) => {
        processed.push(job);
      };
      await runtime.start({
        "source-connectors": process,
        "knowledge-ai": process,
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
      await runtime.waitUntilIdle(20_000);
      expect(processed.map((job) => job.queue).sort()).toEqual([
        "canonical-write",
        "embedding",
        "enrichment",
        "projection",
      ]);
      expect(
        processed.every(
          (job) =>
            job.workspaceId === workspaceId &&
            job.payload.artifactKey === artifact.artifactKey &&
            job.traceId === artifact.correlationId,
        ),
      ).toBe(true);
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
    await runtime.waitUntilIdle(5_000).catch(() => undefined);
    await runtime.purge().catch(() => undefined);
    await runtime.close();
  }
  if (inspection) {
    if (outboxIds.size)
      await inspection`DELETE FROM knowledge_outbox WHERE id IN ${inspection([...outboxIds])}`;
    await inspection`DELETE FROM source_artifacts WHERE workspace_id = ${workspaceId}`;
    await inspection`DELETE FROM connector_deployments WHERE deployment_id = ${deploymentId}`;
    await inspection.end({ timeout: 5 });
  }
  await connector?.close();
  await knowledge?.close();
});
