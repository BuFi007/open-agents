import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createPostgresKnowledgeRepository } from "@open-agents/knowledge";
import postgres from "postgres";
import { createBullMqRuntime } from "./bullmq";
import { relayKnowledgeOutbox } from "./outbox-relay";

const configuredPostgresUrl =
  process.env.KNOWLEDGE_POSTGRES_TEST_URL ?? process.env.POSTGRES_URL;
const configuredRedisUrl =
  process.env.QUEUE_REDIS_TEST_URL ?? process.env.REDIS_URL;
const enabled = process.env.RUN_LIVE_DATA_PLANE_TESTS === "1";
const liveDescribe =
  enabled && configuredPostgresUrl && configuredRedisUrl
    ? describe
    : describe.skip;
const postgresUrl =
  configuredPostgresUrl ?? "postgres://disabled@127.0.0.1:1/disabled";
const redisUrl = configuredRedisUrl ?? "redis://127.0.0.1:1";

setDefaultTimeout(30_000);

liveDescribe("Postgres outbox to BullMQ relay", () => {
  const workspaceId = `data-plane-cert-${randomUUID()}`;
  const namespace = `data-plane-${randomUUID().slice(0, 12)}`;
  const repository = createPostgresKnowledgeRepository({
    connectionString: postgresUrl,
    maxConnections: 2,
  });
  const workspace = repository.forWorkspace(workspaceId);
  const runtime = createBullMqRuntime({ redisUrl, namespace });
  const raw = postgres(postgresUrl, { max: 1 });

  afterAll(async () => {
    await runtime.waitUntilIdle(20_000).catch(() => undefined);
    await runtime.purge().catch(() => undefined);
    await runtime.close();
    await raw.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
      await transaction`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
      await transaction`DELETE FROM knowledge_outbox WHERE workspace_id = ${workspaceId}`;
      await transaction`DELETE FROM knowledge_entities WHERE workspace_id = ${workspaceId}`;
    });
    await Promise.all([repository.close(), raw.end({ timeout: 5 })]);
  });

  test("recovers crash-after-enqueue without duplicate processing", async () => {
    const processed: string[] = [];
    await runtime.start({
      "source-connectors": async (job) => {
        processed.push(String(job.payload.entityId));
      },
    });
    const eventId = `event-${randomUUID()}`;
    await workspace.resolveAndEnqueue({
      externalKey: "customer:relay-cert",
      kind: "Customer",
      name: "Relay certification",
      outbox: {
        id: eventId,
        topic: "knowledge.entity.changed",
        schemaVersion: 1,
        payload: {
          entityId: "customer:relay-cert",
          traceId: "trace-relay-cert",
        },
      },
    });

    const crashed = await relayKnowledgeOutbox({
      workspace,
      runtime,
      workerId: "relay-cert-1",
      retryAfterMs: 0,
      onDeliveredBeforeAcknowledge: () => {
        throw new Error("SIMULATED_CRASH_AFTER_ENQUEUE");
      },
    });
    expect(crashed).toEqual(
      expect.objectContaining({ published: 0, released: 1 }),
    );
    const recovered = await relayKnowledgeOutbox({
      workspace,
      runtime,
      workerId: "relay-cert-2",
      retryAfterMs: 0,
    });
    expect(recovered).toEqual(
      expect.objectContaining({ published: 1, replays: 1 }),
    );
    await runtime.waitUntilIdle(20_000);
    expect(processed).toEqual(["customer:relay-cert"]);

    const status = await raw.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
      await transaction`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
      return transaction<{ status: string; attempts: number }[]>`
        SELECT status, attempts FROM knowledge_outbox
        WHERE workspace_id = ${workspaceId} AND id = ${eventId}
      `;
    });
    expect([...status]).toEqual([{ status: "published", attempts: 2 }]);
  });
});
