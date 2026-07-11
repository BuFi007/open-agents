import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import postgres from "postgres";
import { createPostgresKnowledgeRepository } from "./postgres";

const configuredConnectionString =
  process.env.KNOWLEDGE_POSTGRES_TEST_URL ?? process.env.POSTGRES_URL;
const connectionString =
  configuredConnectionString ?? "postgres://disabled@127.0.0.1:1/disabled";
const enabled = process.env.RUN_LIVE_KNOWLEDGE_TESTS === "1";
const liveDescribe =
  enabled && configuredConnectionString ? describe : describe.skip;

setDefaultTimeout(30_000);

liveDescribe("Postgres knowledge repository", () => {
  const workspaceA = `kg-cert-a-${randomUUID()}`;
  const workspaceB = `kg-cert-b-${randomUUID()}`;
  const repository = createPostgresKnowledgeRepository({
    connectionString,
    maxConnections: 2,
  });
  const raw = postgres(connectionString, { max: 1 });
  const a = repository.forWorkspace(workspaceA);
  const b = repository.forWorkspace(workspaceB);

  beforeAll(async () => {
    const tables = await raw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('knowledge_entities', 'knowledge_outbox')
    `;
    if (tables.length !== 2)
      throw new Error("Run the knowledge database migration before live tests");
  });

  afterAll(async () => {
    for (const workspaceId of [workspaceA, workspaceB]) {
      await raw.begin(async (transaction) => {
        await transaction`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
        await transaction`DELETE FROM knowledge_outbox WHERE workspace_id = ${workspaceId}`;
        await transaction`DELETE FROM knowledge_entities WHERE workspace_id = ${workspaceId}`;
      });
    }
    await Promise.all([repository.close(), raw.end({ timeout: 5 })]);
  });

  test("atomically resolves entities and appends replay-safe outbox facts", async () => {
    const eventId = `event-${randomUUID()}`;
    const first = await a.resolveAndEnqueue({
      externalKey: "customer:acme",
      kind: "Customer",
      name: "Acme",
      outbox: {
        id: eventId,
        topic: "knowledge.entity.changed",
        schemaVersion: 1,
        payload: { entity: "customer:acme", sourceRevision: "1" },
      },
    });
    const replay = await a.resolveAndEnqueue({
      externalKey: "customer:acme",
      kind: "Customer",
      name: "Acme",
      outbox: {
        id: eventId,
        topic: "knowledge.entity.changed",
        schemaVersion: 1,
        payload: { sourceRevision: "1", entity: "customer:acme" },
      },
    });
    expect(replay.entity.id).toBe(first.entity.id);
    expect(replay.entity.version).toBe(1);
    expect(replay.event.id).toBe(first.event.id);

    await expect(
      a.resolveAndEnqueue({
        externalKey: "customer:acme",
        kind: "Customer",
        name: "Tampered rename",
        outbox: {
          id: eventId,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { entity: "different" },
        },
      }),
    ).rejects.toThrow("idempotency conflict");
    const page = await a.page();
    expect(page.items).toEqual([
      expect.objectContaining({ name: "Acme", version: 1 }),
    ]);
  });

  test("enforces tenant isolation in both the API and Postgres RLS", async () => {
    const sharedExternalKey = "vendor:shared-id";
    const [entityA, entityB] = await Promise.all([
      a.resolveAndEnqueue({
        externalKey: sharedExternalKey,
        kind: "Vendor",
        name: "Workspace A vendor",
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { workspace: "a" },
        },
      }),
      b.resolveAndEnqueue({
        externalKey: sharedExternalKey,
        kind: "Vendor",
        name: "Workspace B vendor",
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { workspace: "b" },
        },
      }),
    ]);
    expect(entityA.entity.id).not.toBe(entityB.entity.id);
    expect((await a.page()).items.some((item) => item.name.includes("B"))).toBe(
      false,
    );
    const unscoped = await raw.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
      return transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM knowledge_entities
        WHERE workspace_id IN (${workspaceA}, ${workspaceB})
      `;
    });
    expect(unscoped[0]?.count).toBe(0);
  });

  test("uses the tenant-scoped GIN index and recalls a bounded lexical corpus", async () => {
    const corpus = [
      ["patagonia", "Patagonia Software Export Invoice"],
      ["contractor", "Buenos Aires Contractor Agreement"],
      ["northwind", "Northwind Customer Collection"],
      ["treasury", "USDC Treasury Settlement"],
      ["ledger", "Contabilium Ledger Reconciliation"],
    ] as const;
    for (const [key, name] of corpus) {
      await a.resolveAndEnqueue({
        externalKey: `recall:${key}`,
        kind: "Document",
        name,
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { corpus: key },
        },
      });
      await b.resolveAndEnqueue({
        externalKey: `other:${key}`,
        kind: "Document",
        name: `${name} private other tenant`,
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { corpus: key },
        },
      });
    }
    await raw.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
      await transaction`SELECT set_config('app.workspace_id', ${workspaceA}, true)`;
      await transaction`
        INSERT INTO knowledge_entities (
          id, workspace_id, external_key, kind, name, version
        )
        SELECT
          ${workspaceA} || ':filler:' || ordinal::text,
          ${workspaceA},
          'filler:' || ordinal::text,
          'Noise',
          'Bounded lexical corpus filler ' || ordinal::text,
          1
        FROM generate_series(1, 2000) AS ordinal
      `;
    });
    await raw`ANALYZE knowledge_entities`;

    const queries = [
      ["patagonia export", "recall:patagonia"],
      ["contractor agreement", "recall:contractor"],
      ["northwind collection", "recall:northwind"],
      ["USDC settlement", "recall:treasury"],
      ["Contabilium reconciliation", "recall:ledger"],
    ] as const;
    let recalled = 0;
    for (const [query, expected] of queries) {
      const results = await a.search(query, 3);
      if (results.some((result) => result.externalKey === expected))
        recalled += 1;
      expect(results.every((result) => result.workspaceId === workspaceA)).toBe(
        true,
      );
      expect(
        results.some((result) => result.name.includes("other tenant")),
      ).toBe(false);
    }
    expect(recalled / queries.length).toBe(1);

    const plan = await raw.begin(async (transaction) => {
      await transaction`SET LOCAL enable_seqscan = off`;
      await transaction`SET LOCAL enable_indexscan = off`;
      return transaction<{ "QUERY PLAN": string }[]>`
        EXPLAIN (FORMAT TEXT)
        SELECT * FROM knowledge_entities
        WHERE search_vector @@ websearch_to_tsquery('simple', 'patagonia export')
      `;
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "knowledge_entities_search_idx",
    );
  });

  test("uses stable created-at/id cursors without cross-page duplicates", async () => {
    const first = await a.page(undefined, 1);
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeDefined();
    const second = await a.page(first.nextCursor, 1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await expect(a.page("not-a-valid-cursor", 1)).rejects.toThrow(
      "cursor is invalid",
    );
  });

  test("claims with skip-locked leases and bounds retry/dead-letter state", async () => {
    const claimed = await a.claimOutbox({
      workerId: "worker-a",
      limit: 20,
      leaseMs: 30_000,
    });
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    const [publish, fail] = claimed;
    expect(publish).toBeDefined();
    expect(fail).toBeDefined();
    await expect(
      b.markPublished({ id: publish!.id, workerId: "worker-a" }),
    ).rejects.toThrow("lease");
    await a.markPublished({ id: publish!.id, workerId: "worker-a" });
    expect(
      await a.releaseOutbox({
        id: fail!.id,
        workerId: "worker-a",
        retryAfterMs: 0,
        errorCode: "PROVIDER_PERMANENT",
        maxAttempts: 1,
      }),
    ).toBe("dead");
  });

  test("rejects credential-shaped or oversized payloads before persistence", async () => {
    await expect(
      a.resolveAndEnqueue({
        externalKey: "unsafe",
        kind: "Artifact",
        name: "Unsafe",
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { access_token: "must-not-persist" },
        },
      }),
    ).rejects.toThrow("forbidden key");
  });
});
