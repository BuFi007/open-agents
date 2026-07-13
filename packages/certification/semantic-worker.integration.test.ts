import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  createAiGatewayKnowledgeEmbeddingProvider,
  createPostgresKnowledgeRepository,
} from "@open-agents/knowledge";
import {
  createBullMqRuntime,
  createKnowledgeEmbeddingProcessor,
  relayKnowledgeOutbox,
} from "@open-agents/queues";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = (
  process.env.QUEUE_REDIS_TEST_URL ??
  process.env.REDIS_QUEUE_URL ??
  process.env.REDIS_URL
)?.trim();
const enabled =
  process.env.RUN_LIVE_SEMANTIC_WORKER === "1" &&
  Boolean(databaseUrl) &&
  Boolean(redisUrl) &&
  Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
const liveTest = enabled ? test : test.skip;
const suffix = randomUUID().replaceAll("-", "");
const workspaceId = `semantic-worker-${suffix}`;
const namespace = `semantic-${suffix.slice(0, 16)}`;
const eventIds: string[] = [];

setDefaultTimeout(60_000);

const knowledge = databaseUrl
  ? createPostgresKnowledgeRepository({ connectionString: databaseUrl })
  : null;
const raw = databaseUrl
  ? postgres(databaseUrl, { max: 1, connect_timeout: 10 })
  : null;
const runtime = redisUrl ? createBullMqRuntime({ redisUrl, namespace }) : null;

describe("durable semantic worker (live Neon + Gateway + BullMQ)", () => {
  liveTest(
    "relays one entity event into the real embedding projection",
    async () => {
      if (!(knowledge && runtime))
        throw new Error("semantic worker integration is not configured");
      const workspace = knowledge.forWorkspace(workspaceId);
      const entityEventId = `event-${randomUUID()}`;
      eventIds.push(entityEventId);
      const created = await workspace.resolveAndEnqueue({
        externalKey: "invoice:semantic-worker",
        kind: "Invoice",
        name: "Cross-border software services receivable",
        outbox: {
          id: entityEventId,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { entityId: "pending-canonical-write" },
        },
      });
      const embeddingEventId = `event-${randomUUID()}`;
      eventIds.push(embeddingEventId);
      await workspace.resolveAndEnqueue({
        externalKey: created.entity.externalKey,
        kind: created.entity.kind,
        name: created.entity.name,
        outbox: {
          id: embeddingEventId,
          topic: "knowledge.embedding",
          schemaVersion: 1,
          payload: { entityId: created.entity.id },
        },
      });

      const provider = createAiGatewayKnowledgeEmbeddingProvider();
      const projected: string[] = [];
      const embeddingProcessor = createKnowledgeEmbeddingProcessor({
        forWorkspace: (id) => knowledge.forWorkspace(id),
        provider,
        onProjected: (result) => {
          projected.push(result.entityId);
        },
      });
      await runtime.start({
        "source-connectors": async () => undefined,
        "knowledge-ai": embeddingProcessor,
      });
      const relayed = await relayKnowledgeOutbox({
        workspace,
        runtime,
        workerId: `relay-${suffix}`,
      });
      expect(relayed).toMatchObject({ claimed: 2, published: 2, dead: 0 });
      await runtime.waitUntilIdle(30_000);
      expect(projected).toEqual([created.entity.id]);

      const query = await provider.embed(["international software invoice"]);
      const results = await workspace.semanticSearch({
        embedding: query.embeddings[0]!,
        model: query.model,
        inputVersion: query.inputVersion,
        limit: 3,
      });
      expect(results[0]).toMatchObject({
        id: created.entity.id,
        workspaceId,
      });
      expect(results[0]!.semanticScore).toBeGreaterThan(0.5);
      await expect(
        relayKnowledgeOutbox({
          workspace,
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
  if (raw) {
    await raw`DELETE FROM knowledge_outbox WHERE workspace_id = ${workspaceId}`;
    await raw`DELETE FROM knowledge_entities WHERE workspace_id = ${workspaceId}`;
    await raw.end({ timeout: 5 });
  }
  await knowledge?.close();
});
