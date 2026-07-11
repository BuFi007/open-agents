import { randomUUID } from "node:crypto";
import postgres from "postgres";
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

export type WorkspaceKnowledgeRepository = {
  readonly workspaceId: string;
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
              RETURNING *
            `;
            let event = events[0];
            if (!event) {
              const existing = await transaction<OutboxRow[]>`
                SELECT * FROM knowledge_outbox
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
              RETURNING event.*
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
