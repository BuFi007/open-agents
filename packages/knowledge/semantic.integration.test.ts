import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import postgres from "postgres";
import {
  createAiGatewayKnowledgeEmbeddingProvider,
  createPostgresKnowledgeRepository,
  hybridRank,
  knowledgeEmbeddingInput,
  knowledgeEmbeddingInputHash,
} from "./index";

const configuredConnectionString =
  process.env.KNOWLEDGE_POSTGRES_TEST_URL ?? process.env.POSTGRES_URL;
const connectionString =
  configuredConnectionString ?? "postgres://disabled@127.0.0.1:1/disabled";
const enabled =
  process.env.RUN_LIVE_SEMANTIC_TESTS === "1" &&
  Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) &&
  Boolean(configuredConnectionString);
const liveDescribe = enabled ? describe : describe.skip;

setDefaultTimeout(60_000);

liveDescribe("Postgres + AI Gateway semantic retrieval", () => {
  const workspaceA = `semantic-a-${randomUUID()}`;
  const workspaceB = `semantic-b-${randomUUID()}`;
  const repository = createPostgresKnowledgeRepository({
    connectionString,
    maxConnections: 4,
  });
  const raw = postgres(connectionString, { max: 1 });
  const a = repository.forWorkspace(workspaceA);
  const b = repository.forWorkspace(workspaceB);
  const provider = createAiGatewayKnowledgeEmbeddingProvider();

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

  test("embeds real entities, isolates tenants, rejects stale vectors and reaches combined recall", async () => {
    const corpus = [
      ["export", "Argentine software exporter invoice collection"],
      ["payroll", "Remote team payroll approval"],
      ["contract", "Customer contract renewal pipeline"],
      ["treasury", "USDC treasury wallet balance"],
      ["grant", "Grant application milestone budget"],
    ] as const;
    const created = await Promise.all(
      corpus.map(
        async ([key, name]) =>
          (
            await a.resolveAndEnqueue({
              externalKey: `semantic:${key}`,
              kind: "Document",
              name,
              outbox: {
                id: `event-${randomUUID()}`,
                topic: "knowledge.entity.changed",
                schemaVersion: 1,
                payload: { semanticCorpus: key },
              },
            })
          ).entity,
      ),
    );
    const privateOtherTenant = (
      await b.resolveAndEnqueue({
        externalKey: "semantic:private-export",
        kind: "Document",
        name: "Private Argentine software exporter invoice collection",
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { semanticCorpus: "private" },
        },
      })
    ).entity;
    const inputs = created.map(knowledgeEmbeddingInput);
    const batch = await provider.embed([
      ...inputs,
      knowledgeEmbeddingInput(privateOtherTenant),
    ]);
    await Promise.all(
      created.map((entity, index) =>
        a.upsertEmbedding({
          entityId: entity.id,
          model: batch.model,
          inputVersion: batch.inputVersion,
          inputHash: knowledgeEmbeddingInputHash(inputs[index]!),
          sourceVersion: entity.version,
          embedding: batch.embeddings[index]!,
        }),
      ),
    );
    await b.upsertEmbedding({
      entityId: privateOtherTenant.id,
      model: batch.model,
      inputVersion: batch.inputVersion,
      inputHash: knowledgeEmbeddingInputHash(
        knowledgeEmbeddingInput(privateOtherTenant),
      ),
      sourceVersion: privateOtherTenant.version,
      embedding: batch.embeddings.at(-1)!,
    });
    await expect(
      a.upsertEmbedding({
        entityId: created[0]!.id,
        model: batch.model,
        inputVersion: batch.inputVersion,
        inputHash: knowledgeEmbeddingInputHash(inputs[0]!),
        sourceVersion: 1,
        embedding: batch.embeddings[0]!,
      }),
    ).resolves.toEqual({ replayed: true });

    const queries = [
      ["billing for services sold abroad", "semantic:export"],
      ["pay salaries to a distributed workforce", "semantic:payroll"],
      ["renew a client agreement", "semantic:contract"],
      ["stablecoin cash holdings", "semantic:treasury"],
      ["funding application budget", "semantic:grant"],
    ] as const;
    const queryBatch = await provider.embed(queries.map(([query]) => query));
    let recalled = 0;
    for (const [index, [query, expected]] of queries.entries()) {
      const [semantic, lexical] = await Promise.all([
        a.semanticSearch({
          embedding: queryBatch.embeddings[index]!,
          model: batch.model,
          inputVersion: batch.inputVersion,
          limit: 5,
        }),
        a.search(query, 5),
      ]);
      const lexicalScores = new Map(
        lexical.map((entity) => [entity.id, entity.lexicalScore]),
      );
      const combined = hybridRank(
        workspaceA,
        semantic.map((entity) => ({
          id: entity.id,
          workspaceId: entity.workspaceId,
          lexical: lexicalScores.get(entity.id) ?? 0,
          semantic: Math.max(0, entity.semanticScore),
          observedAt: new Date(entity.updatedAt).getTime(),
          evidenceVersion: entity.version,
        })),
        Date.now(),
        3,
      );
      if (
        combined.some(
          (result) =>
            created.find((entity) => entity.id === result.id)?.externalKey ===
            expected,
        )
      )
        recalled += 1;
      expect(
        semantic.every((entity) => entity.workspaceId === workspaceA),
      ).toBe(true);
      expect(semantic.some((entity) => entity.name.startsWith("Private"))).toBe(
        false,
      );
    }
    expect(recalled / queries.length).toBeGreaterThanOrEqual(0.8);

    const renamed = (
      await a.resolveAndEnqueue({
        externalKey: "semantic:export",
        kind: "Document",
        name: "Argentine cross-border professional services invoice",
        outbox: {
          id: `event-${randomUUID()}`,
          topic: "knowledge.entity.changed",
          schemaVersion: 1,
          payload: { semanticCorpus: "export-v2" },
        },
      })
    ).entity;
    await expect(
      a.upsertEmbedding({
        entityId: renamed.id,
        model: batch.model,
        inputVersion: batch.inputVersion,
        inputHash: knowledgeEmbeddingInputHash(inputs[0]!),
        sourceVersion: 1,
        embedding: batch.embeddings[0]!,
      }),
    ).rejects.toThrow("stale");

    const plan = await raw.begin(async (transaction) => {
      await transaction`SET LOCAL enable_seqscan = off`;
      const vector = `[${queryBatch.embeddings[0]!.join(",")}]`;
      return transaction<{ "QUERY PLAN": string }[]>`
        EXPLAIN (FORMAT TEXT)
        SELECT entity_id FROM knowledge_embeddings
        ORDER BY embedding <=> ${vector}::vector
        LIMIT 3
      `;
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
      "knowledge_embeddings_cosine_idx",
    );
  });
});
