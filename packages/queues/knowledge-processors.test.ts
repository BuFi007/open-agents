import { describe, expect, test } from "bun:test";
import type { KnowledgeEmbeddingProvider } from "@open-agents/knowledge";
import type { BullMqRuntimeJob } from "./bullmq";
import { createKnowledgeEmbeddingProcessor } from "./knowledge-processors";

const vector = Array.from({ length: 1536 }, () => 0.1);

describe("knowledge BullMQ processors", () => {
  test("projects a minimized entity input and reports replay-safe metadata", async () => {
    const writes: unknown[] = [];
    const projected: unknown[] = [];
    const provider: KnowledgeEmbeddingProvider = {
      model: "openai/text-embedding-3-small",
      inputVersion: "entity-search.v1",
      async embed(values) {
        expect(values).toEqual(["Customer\nAcme Export Services"]);
        return {
          model: this.model,
          inputVersion: this.inputVersion,
          dimensions: 1536,
          embeddings: [vector],
          usageTokens: 7,
        };
      },
    };
    const process = createKnowledgeEmbeddingProcessor({
      forWorkspace: (workspaceId) => ({
        async getById(id) {
          return {
            id,
            workspaceId,
            externalKey: "customer:acme",
            kind: "Customer",
            name: "Acme Export Services",
            version: 2,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          };
        },
        async upsertEmbedding(input) {
          writes.push(input);
          return { replayed: true };
        },
      }),
      provider,
      onProjected: (result) => {
        projected.push(result);
      },
    });
    await process(job(), new AbortController().signal);
    expect(writes).toEqual([
      expect.objectContaining({
        entityId: "entity-1",
        sourceVersion: 2,
        embedding: vector,
      }),
    ]);
    expect(projected).toEqual([
      expect.objectContaining({
        entityId: "entity-1",
        replayed: true,
        usageTokens: 7,
      }),
    ]);
  });

  test("rejects invalid routes and missing entities as permanent failures", async () => {
    const provider: KnowledgeEmbeddingProvider = {
      model: "model",
      inputVersion: "v1",
      embed: async () => {
        throw new Error("must not run");
      },
    };
    const process = createKnowledgeEmbeddingProcessor({
      forWorkspace: () => ({
        getById: async () => undefined,
        upsertEmbedding: async () => ({ replayed: false }),
      }),
      provider,
    });
    await expect(
      process({ ...job(), queue: "projection" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "EMBEDDING_JOB_ROUTE_INVALID" });
    await expect(
      process(job(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "EMBEDDING_ENTITY_NOT_FOUND" });
  });
});

function job(): BullMqRuntimeJob {
  return {
    id: "embedding-job-1",
    workspaceId: "workspace-1",
    profile: "knowledge-ai",
    queue: "embedding",
    idempotencyKey: "embedding-idempotency-1",
    schemaVersion: 1,
    payload: { entityId: "entity-1" },
    traceId: "trace-embedding-1",
  };
}
