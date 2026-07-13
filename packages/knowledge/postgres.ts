import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { type ContextPacket, validateContextPacket } from "./context-packet";
import type { Entity, Page } from "./store";

const MAX_PAYLOAD_BYTES = 65_536;
const FORBIDDEN_PAYLOAD_KEY =
  /(?:^|_)(?:authorization|cookie|credential|password|private_?key|secret|session|token)(?:$|_)/i;

export type PersistentEntity = Entity & {
  createdAt: string;
  updatedAt: string;
};

export type PersistentOutboxEvent = {
  id: string;
  workspaceId: string;
  topic: string;
  schemaVersion: number;
  payload: Readonly<Record<string, unknown>>;
  status: "pending" | "published" | "dead";
  attempts: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type PersistentKnowledgeEnrichment = Readonly<{
  entityId: string;
  workspaceId: string;
  classifierVersion: string;
  inputHash: string;
  sourceVersion: number;
  classification: string;
  confidence: number;
  updatedAt: string;
}>;

export type PersistentSearchProjection = Readonly<{
  entityId: string;
  workspaceId: string;
  provider: string;
  collection: string;
  schemaVersion: string;
  inputHash: string;
  sourceVersion: number;
  providerRevision: string | null;
  projectedAt: string;
  updatedAt: string;
}>;

export type WorkspaceKnowledgeRepository = {
  readonly workspaceId: string;
  getById(id: string): Promise<PersistentEntity | undefined>;
  getByExternalKey(
    kind: string,
    externalKey: string,
  ): Promise<PersistentEntity | undefined>;
  resolve(input: {
    externalKey: string;
    kind: string;
    name: string;
  }): Promise<PersistentEntity>;
  resolveAndEnqueue(input: {
    externalKey: string;
    kind: string;
    name: string;
    outbox: {
      id: string;
      topic: string;
      schemaVersion: number;
      payload: Readonly<Record<string, unknown>>;
    };
  }): Promise<{ entity: PersistentEntity; event: PersistentOutboxEvent }>;
  page(cursor?: string, limit?: number): Promise<Page<PersistentEntity>>;
  search(
    query: string,
    limit?: number,
  ): Promise<readonly (PersistentEntity & { lexicalScore: number })[]>;
  upsertEmbedding(input: {
    entityId: string;
    model: string;
    inputVersion: string;
    inputHash: string;
    sourceVersion: number;
    embedding: readonly number[];
  }): Promise<{ replayed: boolean }>;
  getEnrichment(
    entityId: string,
    classifierVersion: string,
  ): Promise<PersistentKnowledgeEnrichment | undefined>;
  upsertEnrichment(input: {
    entityId: string;
    classifierVersion: string;
    inputHash: string;
    sourceVersion: number;
    classification: string;
    confidence: number;
  }): Promise<{ replayed: boolean }>;
  getSearchProjection(input: {
    entityId: string;
    provider: string;
    collection: string;
  }): Promise<PersistentSearchProjection | undefined>;
  upsertSearchProjection(input: {
    entityId: string;
    provider: string;
    collection: string;
    schemaVersion: string;
    inputHash: string;
    sourceVersion: number;
    providerRevision?: string;
    projectedAt: string;
  }): Promise<{ replayed: boolean }>;
  persistContextPacket(
    packet: ContextPacket,
  ): Promise<{ packetHash: string; replayed: boolean }>;
  getContextPacket(packetHash: string): Promise<ContextPacket | undefined>;
  semanticSearch(input: {
    embedding: readonly number[];
    model: string;
    inputVersion: string;
    limit?: number;
  }): Promise<
    readonly (PersistentEntity & {
      semanticScore: number;
    })[]
  >;
  claimOutbox(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
  }): Promise<readonly PersistentOutboxEvent[]>;
  markPublished(input: { id: string; workerId: string }): Promise<void>;
  releaseOutbox(input: {
    id: string;
    workerId: string;
    retryAfterMs: number;
    errorCode: string;
    maxAttempts: number;
  }): Promise<"pending" | "dead">;
};

export type PostgresKnowledgeRepository = {
  forWorkspace(workspaceId: string): WorkspaceKnowledgeRepository;
  close(): Promise<void>;
};

type EntityRow = {
  id: string;
  workspace_id: string;
  external_key: string;
  kind: string;
  name: string;
  version: number;
  created_at: Date;
  updated_at: Date;
};

type OutboxRow = {
  id: string;
  workspace_id: string;
  topic: string;
  schema_version: number;
  payload: Record<string, unknown>;
  status: "pending" | "published" | "dead";
  attempts: number;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  last_error_code: string | null;
  created_at: Date;
  published_at: Date | null;
};

type EnrichmentRow = {
  entity_id: string;
  workspace_id: string;
  classifier_version: string;
  input_hash: string;
  source_version: number;
  classification: string;
  confidence: number;
  updated_at: Date;
};

type SearchProjectionRow = {
  entity_id: string;
  workspace_id: string;
  provider: string;
  collection: string;
  schema_version: string;
  input_hash: string;
  source_version: number;
  provider_revision: string | null;
  projected_at: Date;
  updated_at: Date;
};

type ContextPacketRow = {
  packet_hash: string;
  workspace_id: string;
  packet: ContextPacket;
};

export function createPostgresKnowledgeRepository(options: {
  connectionString: string;
  maxConnections?: number;
}): PostgresKnowledgeRepository {
  const connectionString = options.connectionString.trim();
  if (!connectionString)
    throw new Error("Postgres connection string is required");
  const sql = postgres(connectionString, {
    max: options.maxConnections ?? 4,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    forWorkspace(workspaceId) {
      assertIdentifier("workspaceId", workspaceId, 191);
      return {
        workspaceId,
        async getById(id) {
          assertIdentifier("entity.id", id, 191);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<EntityRow[]>`
              SELECT id, workspace_id, external_key, kind, name, version,
                created_at, updated_at
              FROM knowledge_entities
              WHERE id = ${id} AND workspace_id = ${workspaceId}
            `;
            return rows[0] ? mapEntity(rows[0]) : undefined;
          });
        },
        async getByExternalKey(kind, externalKey) {
          assertIdentifier("kind", kind, 120);
          assertIdentifier("externalKey", externalKey, 500);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<EntityRow[]>`
              SELECT id, workspace_id, external_key, kind, name, version,
                created_at, updated_at
              FROM knowledge_entities
              WHERE workspace_id = ${workspaceId}
                AND kind = ${kind}
                AND external_key = ${externalKey}
            `;
            return rows[0] ? mapEntity(rows[0]) : undefined;
          });
        },
        async resolve(input) {
          assertIdentifier("externalKey", input.externalKey, 500);
          assertIdentifier("kind", input.kind, 120);
          assertIdentifier("name", input.name, 500);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await resolveEntity(transaction, workspaceId, input);
            if (!rows[0])
              throw new Error("Knowledge entity write did not return a result");
            return mapEntity(rows[0]);
          });
        },
        async resolveAndEnqueue(input) {
          assertIdentifier("externalKey", input.externalKey, 500);
          assertIdentifier("kind", input.kind, 120);
          assertIdentifier("name", input.name, 500);
          assertIdentifier("outbox.id", input.outbox.id, 191);
          assertIdentifier("outbox.topic", input.outbox.topic, 191);
          if (
            !Number.isInteger(input.outbox.schemaVersion) ||
            input.outbox.schemaVersion < 1
          )
            throw new Error("outbox.schemaVersion must be a positive integer");
          assertSafePayload(input.outbox.payload);

          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const entities = await transaction<EntityRow[]>`
              INSERT INTO knowledge_entities (
                id, workspace_id, external_key, kind, name, version
              ) VALUES (
                ${randomUUID()}, ${workspaceId}, ${input.externalKey},
                ${input.kind}, ${input.name}, 1
              )
              ON CONFLICT (workspace_id, kind, external_key)
              DO UPDATE SET
                name = EXCLUDED.name,
                version = CASE
                  WHEN knowledge_entities.name IS DISTINCT FROM EXCLUDED.name
                    THEN knowledge_entities.version + 1
                  ELSE knowledge_entities.version
                END,
                updated_at = CASE
                  WHEN knowledge_entities.name IS DISTINCT FROM EXCLUDED.name
                    THEN now()
                  ELSE knowledge_entities.updated_at
                END
              RETURNING id, workspace_id, external_key, kind, name, version,
                created_at, updated_at
            `;
            const events = await transaction<OutboxRow[]>`
              INSERT INTO knowledge_outbox (
                id, workspace_id, topic, schema_version, payload
              ) VALUES (
                ${input.outbox.id}, ${workspaceId}, ${input.outbox.topic},
                ${input.outbox.schemaVersion},
                ${transaction.json(input.outbox.payload as postgres.JSONValue)}
              )
              ON CONFLICT (id) DO NOTHING
              RETURNING id, workspace_id, topic, schema_version, payload,
                status, attempts, available_at, lease_owner, lease_expires_at,
                last_error_code, created_at, published_at
            `;
            let event = events[0];
            if (!event) {
              const existing = await transaction<OutboxRow[]>`
                SELECT id, workspace_id, topic, schema_version, payload,
                  status, attempts, available_at, lease_owner, lease_expires_at,
                  last_error_code, created_at, published_at
                FROM knowledge_outbox
                WHERE id = ${input.outbox.id} AND workspace_id = ${workspaceId}
              `;
              event = existing[0];
              if (
                !event ||
                event.topic !== input.outbox.topic ||
                event.schema_version !== input.outbox.schemaVersion ||
                stableJson(event.payload) !== stableJson(input.outbox.payload)
              )
                throw new Error("Outbox idempotency conflict");
            }
            if (!entities[0] || !event)
              throw new Error("Atomic knowledge write did not return a result");
            return { entity: mapEntity(entities[0]), event: mapOutbox(event) };
          });
        },
        async page(cursor, limit = 50) {
          const decodedCursor = cursor ? decodeCursor(cursor) : null;
          if (!Number.isInteger(limit) || limit < 1 || limit > 200)
            throw new Error("Page limit must be between 1 and 200");
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = decodedCursor
              ? await transaction<EntityRow[]>`
                  SELECT id, workspace_id, external_key, kind, name, version,
                    created_at, updated_at
                  FROM knowledge_entities
                  WHERE workspace_id = ${workspaceId}
                    AND (date_trunc('milliseconds', created_at), id) > (
                      ${decodedCursor.createdAt}, ${decodedCursor.id}
                    )
                  ORDER BY date_trunc('milliseconds', created_at) ASC, id ASC
                  LIMIT ${limit + 1}
                `
              : await transaction<EntityRow[]>`
                  SELECT id, workspace_id, external_key, kind, name, version,
                    created_at, updated_at
                  FROM knowledge_entities
                  WHERE workspace_id = ${workspaceId}
                  ORDER BY date_trunc('milliseconds', created_at) ASC, id ASC
                  LIMIT ${limit + 1}
                `;
            const hasMore = rows.length > limit;
            const items = rows.slice(0, limit).map(mapEntity);
            return {
              items,
              ...(hasMore && rows[limit - 1]
                ? { nextCursor: encodeCursor(rows[limit - 1]!) }
                : {}),
            };
          });
        },
        async search(query, limit = 20) {
          const normalized = query.trim();
          if (normalized.length < 2 || normalized.length > 500)
            throw new Error(
              "Search query must be between 2 and 500 characters",
            );
          if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new Error("Search limit must be between 1 and 100");
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<
              (EntityRow & { lexical_score: number })[]
            >`
              SELECT entity.id, entity.workspace_id, entity.external_key,
                entity.kind, entity.name, entity.version, entity.created_at,
                entity.updated_at,
                ts_rank_cd(
                  entity.search_vector,
                  websearch_to_tsquery('simple', ${normalized})
                )::real AS lexical_score
              FROM knowledge_entities AS entity
              WHERE entity.search_vector @@ websearch_to_tsquery('simple', ${normalized})
              ORDER BY lexical_score DESC, entity.updated_at DESC, entity.id ASC
              LIMIT ${limit}
            `;
            return rows.map((row) => ({
              ...mapEntity(row),
              lexicalScore: row.lexical_score,
            }));
          });
        },
        async upsertEmbedding(input) {
          assertIdentifier("entity.id", input.entityId, 191);
          assertIdentifier("embedding.model", input.model, 191);
          assertIdentifier("embedding.inputVersion", input.inputVersion, 120);
          assertSha256("embedding.inputHash", input.inputHash);
          if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)
            throw new Error("Embedding source version must be positive");
          const embedding = vectorLiteral(input.embedding);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const entities = await transaction<{ version: number }[]>`
              SELECT version FROM knowledge_entities
              WHERE id = ${input.entityId} AND workspace_id = ${workspaceId}
            `;
            if (!entities[0])
              throw new Error("Embedding entity is not visible");
            if (entities[0].version !== input.sourceVersion)
              throw new Error("Embedding source version is stale");
            const existing = await transaction<
              { input_hash: string; source_version: number }[]
            >`
              SELECT input_hash, source_version FROM knowledge_embeddings
              WHERE entity_id = ${input.entityId}
                AND workspace_id = ${workspaceId}
                AND model = ${input.model}
                AND input_version = ${input.inputVersion}
            `;
            if (existing[0]) {
              if (
                existing[0].source_version === input.sourceVersion &&
                existing[0].input_hash === input.inputHash
              )
                return { replayed: true };
              if (existing[0].source_version >= input.sourceVersion)
                throw new Error("Embedding idempotency conflict");
            }
            const rows = await transaction<{ entity_id: string }[]>`
              INSERT INTO knowledge_embeddings (
                entity_id, workspace_id, model, input_version, input_hash,
                source_version, embedding
              ) VALUES (
                ${input.entityId}, ${workspaceId}, ${input.model},
                ${input.inputVersion}, ${input.inputHash}, ${input.sourceVersion},
                ${embedding}::vector
              )
              ON CONFLICT (entity_id, model, input_version)
              DO UPDATE SET
                input_hash = EXCLUDED.input_hash,
                source_version = EXCLUDED.source_version,
                embedding = EXCLUDED.embedding,
                updated_at = now()
              WHERE knowledge_embeddings.source_version < EXCLUDED.source_version
              RETURNING entity_id
            `;
            if (!rows[0]) throw new Error("Embedding write did not converge");
            return { replayed: false };
          });
        },
        async getEnrichment(entityId, classifierVersion) {
          assertIdentifier("entity.id", entityId, 191);
          assertIdentifier(
            "enrichment.classifierVersion",
            classifierVersion,
            120,
          );
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<EnrichmentRow[]>`
              SELECT entity_id, workspace_id, classifier_version, input_hash,
                source_version, classification, confidence, updated_at
              FROM knowledge_enrichments
              WHERE entity_id = ${entityId}
                AND workspace_id = ${workspaceId}
                AND classifier_version = ${classifierVersion}
            `;
            return rows[0] ? mapEnrichment(rows[0]) : undefined;
          });
        },
        async upsertEnrichment(input) {
          assertIdentifier("entity.id", input.entityId, 191);
          assertIdentifier(
            "enrichment.classifierVersion",
            input.classifierVersion,
            120,
          );
          assertIdentifier(
            "enrichment.classification",
            input.classification,
            120,
          );
          assertSha256("enrichment.inputHash", input.inputHash);
          if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)
            throw new Error("Enrichment source version must be positive");
          if (
            !Number.isFinite(input.confidence) ||
            input.confidence < 0 ||
            input.confidence > 1
          )
            throw new Error("Enrichment confidence must be between 0 and 1");
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            await assertCurrentEntityVersion(
              transaction,
              workspaceId,
              input.entityId,
              input.sourceVersion,
              "Enrichment",
            );
            const existing = await transaction<
              { input_hash: string; source_version: number }[]
            >`
              SELECT input_hash, source_version FROM knowledge_enrichments
              WHERE entity_id = ${input.entityId}
                AND workspace_id = ${workspaceId}
                AND classifier_version = ${input.classifierVersion}
            `;
            if (
              existing[0]?.source_version === input.sourceVersion &&
              existing[0].input_hash === input.inputHash
            )
              return { replayed: true };
            if (
              existing[0] &&
              existing[0].source_version >= input.sourceVersion
            )
              throw new Error("Enrichment idempotency conflict");
            const rows = await transaction<{ entity_id: string }[]>`
              INSERT INTO knowledge_enrichments (
                entity_id, workspace_id, classifier_version, input_hash,
                source_version, classification, confidence
              ) VALUES (
                ${input.entityId}, ${workspaceId}, ${input.classifierVersion},
                ${input.inputHash}, ${input.sourceVersion},
                ${input.classification}, ${input.confidence}
              )
              ON CONFLICT (entity_id, classifier_version)
              DO UPDATE SET
                input_hash = EXCLUDED.input_hash,
                source_version = EXCLUDED.source_version,
                classification = EXCLUDED.classification,
                confidence = EXCLUDED.confidence,
                updated_at = now()
              WHERE knowledge_enrichments.source_version < EXCLUDED.source_version
              RETURNING entity_id
            `;
            if (!rows[0]) throw new Error("Enrichment write did not converge");
            return { replayed: false };
          });
        },
        async getSearchProjection(input) {
          assertIdentifier("entity.id", input.entityId, 191);
          assertIdentifier("projection.provider", input.provider, 120);
          assertIdentifier("projection.collection", input.collection, 120);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<SearchProjectionRow[]>`
              SELECT entity_id, workspace_id, provider, collection,
                schema_version, input_hash, source_version, provider_revision,
                projected_at, updated_at
              FROM knowledge_search_projections
              WHERE entity_id = ${input.entityId}
                AND workspace_id = ${workspaceId}
                AND provider = ${input.provider}
                AND collection = ${input.collection}
            `;
            return rows[0] ? mapSearchProjection(rows[0]) : undefined;
          });
        },
        async upsertSearchProjection(input) {
          assertIdentifier("entity.id", input.entityId, 191);
          assertIdentifier("projection.provider", input.provider, 120);
          assertIdentifier("projection.collection", input.collection, 120);
          assertIdentifier(
            "projection.schemaVersion",
            input.schemaVersion,
            120,
          );
          assertSha256("projection.inputHash", input.inputHash);
          if (input.providerRevision)
            assertIdentifier(
              "projection.providerRevision",
              input.providerRevision,
              191,
            );
          if (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)
            throw new Error("Projection source version must be positive");
          const projectedAt = new Date(input.projectedAt);
          if (Number.isNaN(projectedAt.getTime()))
            throw new Error("Projection timestamp is invalid");
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            await assertCurrentEntityVersion(
              transaction,
              workspaceId,
              input.entityId,
              input.sourceVersion,
              "Projection",
            );
            const existing = await transaction<
              { input_hash: string; source_version: number }[]
            >`
              SELECT input_hash, source_version
              FROM knowledge_search_projections
              WHERE entity_id = ${input.entityId}
                AND workspace_id = ${workspaceId}
                AND provider = ${input.provider}
                AND collection = ${input.collection}
            `;
            if (
              existing[0]?.source_version === input.sourceVersion &&
              existing[0].input_hash === input.inputHash
            )
              return { replayed: true };
            if (
              existing[0] &&
              existing[0].source_version >= input.sourceVersion
            )
              throw new Error("Projection idempotency conflict");
            const rows = await transaction<{ entity_id: string }[]>`
              INSERT INTO knowledge_search_projections (
                entity_id, workspace_id, provider, collection, schema_version,
                input_hash, source_version, provider_revision, projected_at
              ) VALUES (
                ${input.entityId}, ${workspaceId}, ${input.provider},
                ${input.collection}, ${input.schemaVersion}, ${input.inputHash},
                ${input.sourceVersion}, ${input.providerRevision ?? null},
                ${projectedAt}
              )
              ON CONFLICT (entity_id, provider, collection)
              DO UPDATE SET
                schema_version = EXCLUDED.schema_version,
                input_hash = EXCLUDED.input_hash,
                source_version = EXCLUDED.source_version,
                provider_revision = EXCLUDED.provider_revision,
                projected_at = EXCLUDED.projected_at,
                updated_at = now()
              WHERE knowledge_search_projections.source_version < EXCLUDED.source_version
              RETURNING entity_id
            `;
            if (!rows[0]) throw new Error("Projection write did not converge");
            return { replayed: false };
          });
        },
        async persistContextPacket(candidate) {
          const packet = validateContextPacket(candidate);
          if (packet.workspaceId !== workspaceId)
            throw new Error("Context packet workspace does not match scope");
          assertSha256("contextPacket.packetHash", packet.packetHash);
          const generatedAt = new Date(packet.generatedAtMs);
          const expiresAt = new Date(packet.expiresAtMs);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<{ packet_hash: string }[]>`
              INSERT INTO knowledge_context_packets (
                packet_hash, workspace_id, workflow_run_id, agent_run_id,
                trace_id, authorization_scope, graph_watermark,
                projection_watermark, ontology_version, packet, generated_at,
                expires_at
              ) VALUES (
                ${packet.packetHash}, ${workspaceId}, ${packet.workflowRunId},
                ${packet.agentRunId}, ${packet.traceId},
                ${packet.authorizationScope}, ${packet.graphWatermark},
                ${packet.projectionWatermark}, ${packet.ontologyVersion},
                ${transaction.json(packet as unknown as postgres.JSONValue)},
                ${generatedAt}, ${expiresAt}
              )
              ON CONFLICT (packet_hash) DO NOTHING
              RETURNING packet_hash
            `;
            if (rows[0])
              return { packetHash: rows[0].packet_hash, replayed: false };
            const existing = await transaction<ContextPacketRow[]>`
              SELECT packet_hash, workspace_id, packet
              FROM knowledge_context_packets
              WHERE packet_hash = ${packet.packetHash}
                AND workspace_id = ${workspaceId}
            `;
            if (!existing[0])
              throw new Error("Context packet hash is not visible");
            const persisted = validateContextPacket(existing[0].packet);
            if (stableJson(persisted) !== stableJson(packet))
              throw new Error("Context packet idempotency conflict");
            return { packetHash: persisted.packetHash, replayed: true };
          });
        },
        async getContextPacket(packetHash) {
          assertSha256("contextPacket.packetHash", packetHash);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<ContextPacketRow[]>`
              SELECT packet_hash, workspace_id, packet
              FROM knowledge_context_packets
              WHERE packet_hash = ${packetHash}
                AND workspace_id = ${workspaceId}
            `;
            return rows[0]
              ? validateContextPacket(structuredClone(rows[0].packet))
              : undefined;
          });
        },
        async semanticSearch(input) {
          assertIdentifier("embedding.model", input.model, 191);
          assertIdentifier("embedding.inputVersion", input.inputVersion, 120);
          const limit = input.limit ?? 20;
          if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            throw new Error("Semantic search limit must be between 1 and 100");
          const embedding = vectorLiteral(input.embedding);
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<
              (EntityRow & { semantic_score: number })[]
            >`
              SELECT entity.id, entity.workspace_id, entity.external_key,
                entity.kind, entity.name, entity.version, entity.created_at,
                entity.updated_at,
                (1 - (projection.embedding <=> ${embedding}::vector))::real
                  AS semantic_score
              FROM knowledge_embeddings AS projection
              JOIN knowledge_entities AS entity
                ON entity.id = projection.entity_id
                AND entity.workspace_id = projection.workspace_id
              WHERE projection.workspace_id = ${workspaceId}
                AND projection.model = ${input.model}
                AND projection.input_version = ${input.inputVersion}
              ORDER BY projection.embedding <=> ${embedding}::vector,
                entity.id ASC
              LIMIT ${limit}
            `;
            return rows.map((row) => ({
              ...mapEntity(row),
              semanticScore: row.semantic_score,
            }));
          });
        },
        async claimOutbox(input) {
          assertIdentifier("workerId", input.workerId, 191);
          if (
            !Number.isInteger(input.limit) ||
            input.limit < 1 ||
            input.limit > 500
          )
            throw new Error("Claim limit must be between 1 and 500");
          if (
            !Number.isInteger(input.leaseMs) ||
            input.leaseMs < 1_000 ||
            input.leaseMs > 900_000
          )
            throw new Error("Lease must be between 1s and 15m");
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<OutboxRow[]>`
              WITH candidates AS (
                SELECT id FROM knowledge_outbox
                WHERE workspace_id = ${workspaceId}
                  AND status = 'pending'
                  AND available_at <= now()
                  AND (lease_expires_at IS NULL OR lease_expires_at <= now())
                ORDER BY created_at ASC, id ASC
                FOR UPDATE SKIP LOCKED
                LIMIT ${input.limit}
              )
              UPDATE knowledge_outbox AS event
              SET attempts = event.attempts + 1,
                  lease_owner = ${input.workerId},
                  lease_expires_at = now() + (${input.leaseMs} * interval '1 millisecond')
              FROM candidates
              WHERE event.id = candidates.id
              RETURNING event.id, event.workspace_id, event.topic,
                event.schema_version, event.payload, event.status,
                event.attempts, event.available_at, event.lease_owner,
                event.lease_expires_at, event.last_error_code,
                event.created_at, event.published_at
            `;
            return rows.map(mapOutbox);
          });
        },
        async markPublished(input) {
          assertIdentifier("outbox.id", input.id, 191);
          assertIdentifier("workerId", input.workerId, 191);
          await sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<{ id: string }[]>`
              UPDATE knowledge_outbox
              SET status = 'published', published_at = now(),
                  lease_owner = NULL, lease_expires_at = NULL,
                  last_error_code = NULL
              WHERE id = ${input.id} AND workspace_id = ${workspaceId}
                AND status = 'pending' AND lease_owner = ${input.workerId}
                AND lease_expires_at > now()
              RETURNING id
            `;
            if (rows.length !== 1)
              throw new Error("Outbox lease is missing or expired");
          });
        },
        async releaseOutbox(input) {
          assertIdentifier("outbox.id", input.id, 191);
          assertIdentifier("workerId", input.workerId, 191);
          assertIdentifier("errorCode", input.errorCode, 120);
          if (
            !Number.isInteger(input.retryAfterMs) ||
            input.retryAfterMs < 0 ||
            input.retryAfterMs > 86_400_000
          )
            throw new Error("Retry delay must be between 0 and 24h");
          if (
            !Number.isInteger(input.maxAttempts) ||
            input.maxAttempts < 1 ||
            input.maxAttempts > 100
          )
            throw new Error("maxAttempts must be between 1 and 100");
          return sql.begin(async (transaction) => {
            await setWorkspaceScope(transaction, workspaceId);
            const rows = await transaction<{ status: "pending" | "dead" }[]>`
              UPDATE knowledge_outbox
              SET status = CASE WHEN attempts >= ${input.maxAttempts}
                                THEN 'dead' ELSE 'pending' END,
                  available_at = now() + (${input.retryAfterMs} * interval '1 millisecond'),
                  lease_owner = NULL, lease_expires_at = NULL,
                  last_error_code = ${input.errorCode}
              WHERE id = ${input.id} AND workspace_id = ${workspaceId}
                AND status = 'pending' AND lease_owner = ${input.workerId}
                AND lease_expires_at > now()
              RETURNING status
            `;
            if (!rows[0]) throw new Error("Outbox lease is missing");
            return rows[0].status;
          });
        },
      };
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

async function resolveEntity(
  transaction: postgres.TransactionSql,
  workspaceId: string,
  input: { externalKey: string; kind: string; name: string },
): Promise<EntityRow[]> {
  return transaction<EntityRow[]>`
    INSERT INTO knowledge_entities (
      id, workspace_id, external_key, kind, name, version
    ) VALUES (
      ${randomUUID()}, ${workspaceId}, ${input.externalKey},
      ${input.kind}, ${input.name}, 1
    )
    ON CONFLICT (workspace_id, kind, external_key)
    DO UPDATE SET
      name = EXCLUDED.name,
      version = CASE
        WHEN knowledge_entities.name IS DISTINCT FROM EXCLUDED.name
          THEN knowledge_entities.version + 1
        ELSE knowledge_entities.version
      END,
      updated_at = CASE
        WHEN knowledge_entities.name IS DISTINCT FROM EXCLUDED.name
          THEN now()
        ELSE knowledge_entities.updated_at
      END
    RETURNING id, workspace_id, external_key, kind, name, version,
      created_at, updated_at
  `;
}

async function assertCurrentEntityVersion(
  transaction: postgres.TransactionSql,
  workspaceId: string,
  entityId: string,
  sourceVersion: number,
  projectionName: string,
): Promise<void> {
  const rows = await transaction<{ version: number }[]>`
    SELECT version FROM knowledge_entities
    WHERE id = ${entityId} AND workspace_id = ${workspaceId}
  `;
  if (!rows[0]) throw new Error(`${projectionName} entity is not visible`);
  if (rows[0].version !== sourceVersion)
    throw new Error(`${projectionName} source version is stale`);
}

async function setWorkspaceScope(
  transaction: postgres.TransactionSql,
  workspaceId: string,
): Promise<void> {
  await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
  await transaction`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
}

function mapEntity(row: EntityRow): PersistentEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    externalKey: row.external_key,
    kind: row.kind,
    name: row.name,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapOutbox(row: OutboxRow): PersistentOutboxEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    topic: row.topic,
    schemaVersion: row.schema_version,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at.toISOString(),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at?.toISOString() ?? null,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}

function mapEnrichment(row: EnrichmentRow): PersistentKnowledgeEnrichment {
  return {
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    classifierVersion: row.classifier_version,
    inputHash: row.input_hash,
    sourceVersion: row.source_version,
    classification: row.classification,
    confidence: row.confidence,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSearchProjection(
  row: SearchProjectionRow,
): PersistentSearchProjection {
  return {
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    collection: row.collection,
    schemaVersion: row.schema_version,
    inputHash: row.input_hash,
    sourceVersion: row.source_version,
    providerRevision: row.provider_revision,
    projectedAt: row.projected_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function encodeCursor(row: EntityRow): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  assertIdentifier("cursor", cursor, 500);
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof value.createdAt !== "string" || typeof value.id !== "string")
      throw new Error("shape");
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw new Error("date");
    assertIdentifier("cursor.id", value.id, 191);
    return { createdAt, id: value.id };
  } catch {
    throw new Error("Knowledge cursor is invalid");
  }
}

function assertIdentifier(name: string, value: string, maximum: number): void {
  if (
    !value ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  )
    throw new Error(`${name} is invalid`);
}

function assertSha256(name: string, value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(value))
    throw new Error(`${name} must be a SHA-256 reference`);
}

function vectorLiteral(values: readonly number[]): string {
  if (values.length !== 1536)
    throw new Error("Embedding vector must contain 1536 dimensions");
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error("Embedding vector must contain only finite values");
  return `[${values.join(",")}]`;
}

function assertSafePayload(payload: Readonly<Record<string, unknown>>): void {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12) throw new Error("Outbox payload is too deep");
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return;
    if (typeof value !== "object")
      throw new Error("Outbox payload is not JSON-safe");
    if (seen.has(value)) throw new Error("Outbox payload contains a cycle");
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 2_000)
        throw new Error("Outbox payload array is too large");
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error("Outbox payload has an unsafe prototype");
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_PAYLOAD_KEY.test(key))
        throw new Error(`Outbox payload contains forbidden key: ${key}`);
      visit(item, depth + 1);
    }
  };
  visit(payload, 0);
  if (Buffer.byteLength(stableJson(payload)) > MAX_PAYLOAD_BYTES)
    throw new Error("Outbox payload exceeds 64 KiB");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
