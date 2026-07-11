import { createHash } from "node:crypto";
import postgres from "postgres";
import type { ConnectorManifest, ConnectorStage } from "./manifest";
import { validateConnectorManifest } from "./manifest";
import type {
  ConnectorEventReceiptInput,
  ConnectorEventRegistry,
} from "./signed-event";
import type { SourceArtifact } from "./source-artifact";
import { createSourceArtifact } from "./source-artifact";

const STAGE_TOPIC: Readonly<Record<ConnectorStage, string>> = {
  "canonical-write": "knowledge.canonical-write",
  enrichment: "knowledge.enrichment",
  embedding: "knowledge.embedding",
  projection: "knowledge.projection",
};

type DeploymentRow = {
  manifest: ConnectorManifest;
  manifest_hash: string;
  active: boolean;
};

type ArtifactRow = {
  artifact_key: string;
  workspace_id: string;
  connector_id: string;
  provider: SourceArtifact["provider"];
  content_hash: string;
  mime_type: string;
  size_bytes: number;
  safe_storage_ref: string;
  source_revision: string;
  metadata: Record<string, unknown>;
  received_at: Date;
  observed_at: Date;
};

export type PersistentConnectorRepository = ConnectorEventRegistry & {
  registerDeployment(manifest: ConnectorManifest): Promise<void>;
  persistArtifactAndStages(input: {
    deploymentId: string;
    artifact: SourceArtifact;
  }): Promise<{ artifactKey: string; replayed: boolean; outboxIds: string[] }>;
  close(): Promise<void>;
};

export function createPostgresConnectorRepository(options: {
  connectionString: string;
  maxConnections?: number;
}): PersistentConnectorRepository {
  if (!options.connectionString.trim())
    throw new Error("Postgres connection string is required");
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    async registerDeployment(candidate) {
      const manifest = validateConnectorManifest(candidate);
      if (!manifest.deploymentId)
        throw new Error("connector deployment id is required");
      const deploymentId = manifest.deploymentId;
      const manifestHash = hashJson(manifest);
      await sql.begin(async (transaction) => {
        await setConnectorScope(transaction, {
          deploymentId,
          workspaceId: manifest.workspaceId,
        });
        const inserted = await transaction<{ deployment_id: string }[]>`
          INSERT INTO connector_deployments (
            deployment_id, workspace_id, connection_id, environment,
            manifest, manifest_hash, active
          ) VALUES (
            ${deploymentId}, ${manifest.workspaceId},
            ${manifest.connectionId}, ${manifest.environment},
            ${transaction.json(manifest as unknown as postgres.JSONValue)},
            ${manifestHash}, true
          )
          ON CONFLICT (deployment_id) DO UPDATE SET
            manifest = EXCLUDED.manifest,
            manifest_hash = EXCLUDED.manifest_hash,
            active = true,
            updated_at = now()
          WHERE connector_deployments.workspace_id = EXCLUDED.workspace_id
            AND connector_deployments.connection_id = EXCLUDED.connection_id
            AND connector_deployments.environment = EXCLUDED.environment
          RETURNING deployment_id
        `;
        if (!inserted[0])
          throw new Error("connector deployment identity conflict");
      });
    },
    async getByDeploymentId(deploymentId) {
      assertId("deploymentId", deploymentId, 191);
      return sql.begin(async (transaction) => {
        await setDeploymentScope(transaction, deploymentId);
        const rows = await transaction<DeploymentRow[]>`
          SELECT manifest, manifest_hash, active
          FROM connector_deployments
          WHERE deployment_id = ${deploymentId}
        `;
        const row = rows[0];
        if (!row || !row.active) return undefined;
        const manifest = validateConnectorManifest(row.manifest);
        if (hashJson(manifest) !== row.manifest_hash)
          throw new Error("connector manifest integrity check failed");
        return manifest;
      });
    },
    async consumeEvent(input) {
      validateReceipt(input);
      return sql.begin(async (transaction) => {
        await setDeploymentScope(transaction, input.deploymentId);
        const deployments = await transaction<DeploymentRow[]>`
          SELECT manifest, manifest_hash, active
          FROM connector_deployments
          WHERE deployment_id = ${input.deploymentId}
        `;
        const deployment = deployments[0];
        if (!deployment || !deployment.active)
          throw new Error("unknown connector deployment");
        const manifest = validateConnectorManifest(deployment.manifest);
        if (
          hashJson(manifest) !== deployment.manifest_hash ||
          manifest.workspaceId !== input.workspaceId
        )
          throw new Error("connector event authority mismatch");
        await transaction`SELECT set_config('app.workspace_id', ${manifest.workspaceId}, true)`;
        const rows = await transaction<{ event_id: string }[]>`
          INSERT INTO connector_event_receipts (
            deployment_id, event_id, workspace_id, timestamp_ms, body_hash
          ) VALUES (
            ${input.deploymentId}, ${input.eventId}, ${input.workspaceId},
            ${input.timestampMs}, ${input.bodyHash}
          )
          ON CONFLICT (deployment_id, event_id) DO NOTHING
          RETURNING event_id
        `;
        return rows.length === 1;
      });
    },
    async persistArtifactAndStages(input) {
      assertId("deploymentId", input.deploymentId, 191);
      return sql.begin(async (transaction) => {
        await setDeploymentScope(transaction, input.deploymentId);
        const deployments = await transaction<DeploymentRow[]>`
          SELECT manifest, manifest_hash, active
          FROM connector_deployments
          WHERE deployment_id = ${input.deploymentId}
        `;
        const deployment = deployments[0];
        if (!deployment || !deployment.active)
          throw new Error("unknown connector deployment");
        const manifest = validateConnectorManifest(deployment.manifest);
        if (hashJson(manifest) !== deployment.manifest_hash)
          throw new Error("connector manifest integrity check failed");
        await transaction`SELECT set_config('app.workspace_id', ${manifest.workspaceId}, true)`;

        const artifact = createSourceArtifact(input.artifact);
        if (
          artifact.artifactKey !== input.artifact.artifactKey ||
          artifact.sourceRevision !== input.artifact.sourceRevision
        )
          throw new Error("source artifact derivation mismatch");
        if (artifact.workspaceId !== manifest.workspaceId)
          throw new Error("source artifact workspace mismatch");
        if (artifact.connectorId !== manifest.connectionId)
          throw new Error("source artifact connector mismatch");
        const metadata = safeArtifactMetadata(artifact);
        const outboxIds = manifest.stages.map((stage) =>
          deterministicId(
            "connector",
            `${artifact.sourceRevision}:${stage}:${manifest.version}:${manifest.schemaVersion}`,
          ),
        );
        const inserted = await transaction<{ artifact_key: string }[]>`
          INSERT INTO source_artifacts (
            artifact_key, workspace_id, connector_id, provider, content_hash,
            mime_type, size_bytes, safe_storage_ref, source_revision, metadata,
            received_at, observed_at
          ) VALUES (
            ${artifact.artifactKey}, ${artifact.workspaceId},
            ${artifact.connectorId}, ${artifact.provider}, ${artifact.contentHash},
            ${artifact.mimeType}, ${artifact.sizeBytes}, ${artifact.safeStorageRef},
            ${artifact.sourceRevision},
            ${transaction.json(metadata as postgres.JSONValue)},
            ${new Date(artifact.receivedAtMs)}, ${new Date(artifact.observedAtMs)}
          )
          ON CONFLICT (artifact_key) DO NOTHING
          RETURNING artifact_key
        `;
        const replayed = inserted.length === 0;
        if (replayed) {
          const rows = await transaction<ArtifactRow[]>`
            SELECT * FROM source_artifacts
            WHERE artifact_key = ${artifact.artifactKey}
              AND workspace_id = ${artifact.workspaceId}
          `;
          if (!rows[0] || !sameArtifact(rows[0], artifact, metadata))
            throw new Error("source artifact idempotency conflict");
        }

        for (const [index, stage] of manifest.stages.entries()) {
          const id = outboxIds[index]!;
          const payload = {
            artifactKey: artifact.artifactKey,
            sourceRevision: artifact.sourceRevision,
            connectionId: manifest.connectionId,
            schemaVersion: manifest.schemaVersion,
            traceId: artifact.correlationId,
            stage,
          };
          const rows = await transaction<{ id: string }[]>`
            INSERT INTO knowledge_outbox (
              id, workspace_id, topic, schema_version, payload
            ) VALUES (
              ${id}, ${manifest.workspaceId}, ${STAGE_TOPIC[stage]},
              ${manifest.version},
              ${transaction.json(payload as postgres.JSONValue)}
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `;
          if (!rows[0]) {
            const existing = await transaction<
              { topic: string; schema_version: number; payload: unknown }[]
            >`
              SELECT topic, schema_version, payload FROM knowledge_outbox
              WHERE id = ${id} AND workspace_id = ${manifest.workspaceId}
            `;
            if (
              !existing[0] ||
              existing[0].topic !== STAGE_TOPIC[stage] ||
              existing[0].schema_version !== manifest.version ||
              stableJson(existing[0].payload) !== stableJson(payload)
            )
              throw new Error("connector outbox idempotency conflict");
          }
        }
        return { artifactKey: artifact.artifactKey, replayed, outboxIds };
      });
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

async function setDeploymentScope(
  transaction: postgres.TransactionSql,
  deploymentId: string,
): Promise<void> {
  await transaction`SET LOCAL ROLE open_agents_connector_runtime`;
  await transaction`SELECT set_config('app.deployment_id', ${deploymentId}, true)`;
}

async function setConnectorScope(
  transaction: postgres.TransactionSql,
  input: { deploymentId: string; workspaceId: string },
): Promise<void> {
  await setDeploymentScope(transaction, input.deploymentId);
  await transaction`SELECT set_config('app.workspace_id', ${input.workspaceId}, true)`;
}

function validateReceipt(input: ConnectorEventReceiptInput): void {
  assertId("deploymentId", input.deploymentId, 191);
  assertId("workspaceId", input.workspaceId, 191);
  assertId("eventId", input.eventId, 191);
  if (!Number.isSafeInteger(input.timestampMs) || input.timestampMs <= 0)
    throw new Error("invalid connector event timestamp");
  if (!/^sha256:[a-f0-9]{64}$/.test(input.bodyHash))
    throw new Error("invalid connector event body hash");
}

function safeArtifactMetadata(
  artifact: SourceArtifact,
): Readonly<Record<string, unknown>> {
  return {
    ...(artifact.accountId ? { accountId: artifact.accountId } : {}),
    ...(artifact.externalContainerId
      ? { externalContainerId: artifact.externalContainerId }
      : {}),
    ...(artifact.externalArtifactId
      ? { externalArtifactId: artifact.externalArtifactId }
      : {}),
    ...(artifact.filename ? { filename: artifact.filename.slice(0, 500) } : {}),
    schemaVersion: artifact.schemaVersion,
    normalizerVersion: artifact.normalizerVersion,
    correlationId: artifact.correlationId,
    ...(artifact.causationId ? { causationId: artifact.causationId } : {}),
    redaction: artifact.redaction,
    tombstone: artifact.tombstone === true,
  };
}

function sameArtifact(
  row: ArtifactRow,
  artifact: SourceArtifact,
  metadata: Readonly<Record<string, unknown>>,
): boolean {
  return (
    row.workspace_id === artifact.workspaceId &&
    row.connector_id === artifact.connectorId &&
    row.provider === artifact.provider &&
    row.content_hash === artifact.contentHash &&
    row.mime_type === artifact.mimeType &&
    row.size_bytes === artifact.sizeBytes &&
    row.safe_storage_ref === artifact.safeStorageRef &&
    row.source_revision === artifact.sourceRevision &&
    row.received_at.getTime() === artifact.receivedAtMs &&
    row.observed_at.getTime() === artifact.observedAtMs &&
    stableJson(row.metadata) === stableJson(metadata)
  );
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertId(name: string, value: string, max: number): void {
  if (
    !value ||
    value.length > max ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_./@-]*$/.test(value)
  )
    throw new Error(`invalid connector ${name}`);
}
