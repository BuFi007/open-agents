import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import {
  type ConnectorManifest,
  createPostgresConnectorRepository,
  createSourceArtifact,
  type SignedConnectorEventInput,
  verifySignedConnectorEvent,
} from "./index";

const shouldRun = process.env.RUN_CONNECTOR_POSTGRES_INTEGRATION === "1";
const connectionString = process.env.DATABASE_URL?.trim();
const liveTest = shouldRun && connectionString ? test : test.skip;
const suffix = randomUUID().replaceAll("-", "");
const workspaceA = `connector-live-a-${suffix}`;
const workspaceB = `connector-live-b-${suffix}`;
const deploymentA = `dep-live-a-${suffix}`;
const deploymentB = `dep-live-b-${suffix}`;
const connectionA = `conn-live-a-${suffix}`;
const connectionB = `conn-live-b-${suffix}`;
const secret = "integration-only-signing-secret";
const repositories = connectionString
  ? [
      createPostgresConnectorRepository({ connectionString }),
      createPostgresConnectorRepository({ connectionString }),
    ]
  : [];
const inspection = connectionString
  ? postgres(connectionString, { max: 1, connect_timeout: 10 })
  : null;
const outboxIds = new Set<string>();

function manifest(input: {
  workspaceId: string;
  deploymentId: string;
  connectionId: string;
}): ConnectorManifest {
  return {
    version: 1,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    adapter: "pipedream",
    appSlug: "magic-inbox",
    ownerMode: "team-shared",
    credentialRef: `vault/pipedream/${input.connectionId}`,
    environment: "development",
    deploymentId: input.deploymentId,
    accounts: [
      {
        accountId: `account-${input.connectionId}`,
        externalAccountId: `external-${input.connectionId}`,
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
}

function sign(
  unsigned: Omit<SignedConnectorEventInput, "signature">,
): SignedConnectorEventInput {
  return {
    ...unsigned,
    signature: createHmac("sha256", secret)
      .update(
        `${unsigned.timestampMs}.${unsigned.eventId}.${unsigned.deploymentId}.${unsigned.rawBody}`,
      )
      .digest("hex"),
  };
}

describe("Postgres connector data plane (live)", () => {
  liveTest(
    "atomically claims signed events and persists artifact plus stage outbox",
    async () => {
      const [first, second] = repositories;
      if (!(first && second && inspection))
        throw new Error("live connector test is not configured");
      const manifestA = manifest({
        workspaceId: workspaceA,
        deploymentId: deploymentA,
        connectionId: connectionA,
      });
      const manifestB = manifest({
        workspaceId: workspaceB,
        deploymentId: deploymentB,
        connectionId: connectionB,
      });
      await Promise.all([
        first.registerDeployment(manifestA),
        first.registerDeployment(manifestB),
      ]);

      const timestampMs = Date.now();
      const event = sign({
        deploymentId: deploymentA,
        environment: "development",
        eventId: `event-live-${suffix}`,
        timestampMs,
        rawBody: '{"attachment":"invoice.pdf"}',
      });
      const raced = await Promise.allSettled([
        verifySignedConnectorEvent(
          event,
          first,
          async () => secret,
          timestampMs,
        ),
        verifySignedConnectorEvent(
          event,
          second,
          async () => secret,
          timestampMs,
        ),
      ]);
      expect(
        raced.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        raced.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);

      const artifact = createSourceArtifact({
        workspaceId: workspaceA,
        connectorId: connectionA,
        provider: "pipedream",
        accountId: `account-${connectionA}`,
        externalContainerId: `message-${suffix}`,
        externalArtifactId: `attachment-${suffix}`,
        contentHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mimeType: "application/pdf",
        sizeBytes: 12_345,
        filename: "invoice.pdf",
        receivedAtMs: timestampMs,
        observedAtMs: timestampMs,
        safeStorageRef: `storage/inbox/${suffix}`,
        schemaVersion: "source-artifact.v1",
        normalizerVersion: "magic-inbox.v1",
        correlationId: `trace-${suffix}`,
        causationId: event.eventId,
        redaction: "standard",
      });
      const persisted = await first.persistArtifactAndStages({
        deploymentId: deploymentA,
        artifact,
      });
      persisted.outboxIds.forEach((id) => outboxIds.add(id));
      expect(persisted.replayed).toBe(false);
      expect(persisted.outboxIds).toHaveLength(4);
      await expect(
        first.getArtifact(workspaceA, artifact.artifactKey),
      ).resolves.toMatchObject({
        artifactKey: artifact.artifactKey,
        sourceRevision: artifact.sourceRevision,
        metadata: { filename: "invoice.pdf" },
      });
      await expect(
        first.getArtifact(workspaceB, artifact.artifactKey),
      ).resolves.toBeUndefined();
      await expect(
        second.persistArtifactAndStages({
          deploymentId: deploymentA,
          artifact,
        }),
      ).resolves.toMatchObject({
        replayed: true,
        outboxIds: persisted.outboxIds,
      });

      const [artifactCount] = await inspection<{ count: number }[]>`
        SELECT count(*)::int AS count FROM source_artifacts
        WHERE artifact_key = ${artifact.artifactKey}
      `;
      const [outboxCount] = await inspection<{ count: number }[]>`
        SELECT count(*)::int AS count FROM knowledge_outbox
        WHERE id IN ${inspection([...persisted.outboxIds])}
      `;
      expect(artifactCount?.count).toBe(1);
      expect(outboxCount?.count).toBe(4);

      const forged = createSourceArtifact({
        ...artifact,
        workspaceId: workspaceB,
        connectorId: connectionB,
      });
      await expect(
        first.persistArtifactAndStages({
          deploymentId: deploymentA,
          artifact: forged,
        }),
      ).rejects.toThrow("workspace mismatch");

      const isolated = await inspection.begin(async (transaction) => {
        await transaction`SET LOCAL ROLE open_agents_connector_runtime`;
        await transaction`SELECT set_config('app.deployment_id', ${deploymentA}, true)`;
        await transaction`SELECT set_config('app.workspace_id', ${workspaceA}, true)`;
        return transaction<{ deployment_id: string }[]>`
          SELECT deployment_id FROM connector_deployments
          WHERE deployment_id = ${deploymentB}
        `;
      });
      expect(isolated).toHaveLength(0);
    },
    30_000,
  );
});

afterAll(async () => {
  if (inspection) {
    if (outboxIds.size)
      await inspection`DELETE FROM knowledge_outbox WHERE id IN ${inspection([...outboxIds])}`;
    await inspection`DELETE FROM source_artifacts WHERE workspace_id IN ${inspection([workspaceA, workspaceB])}`;
    await inspection`DELETE FROM connector_deployments WHERE deployment_id IN ${inspection([deploymentA, deploymentB])}`;
    await inspection.end({ timeout: 5 });
  }
  await Promise.all(repositories.map((repository) => repository.close()));
});
