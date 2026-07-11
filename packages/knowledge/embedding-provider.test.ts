import { describe, expect, test } from "bun:test";
import {
  createAiGatewayKnowledgeEmbeddingProvider,
  knowledgeEmbeddingInput,
  knowledgeEmbeddingInputHash,
} from "./embedding-provider";

describe("knowledge embedding provider", () => {
  test("builds stable minimized entity inputs and validates provider vectors", async () => {
    const input = knowledgeEmbeddingInput({
      id: "entity-1",
      workspaceId: "workspace-1",
      externalKey: "customer:acme",
      kind: "Customer",
      name: "Acme Export Services",
      version: 1,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    expect(input).toBe("Customer\nAcme Export Services");
    expect(knowledgeEmbeddingInputHash(input)).toMatch(/^sha256:[a-f0-9]{64}$/);
    const provider = createAiGatewayKnowledgeEmbeddingProvider({
      embedManyImpl: async ({ values }) => ({
        embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.1)),
        usage: { tokens: 8 },
      }),
    });
    await expect(provider.embed([input])).resolves.toMatchObject({
      dimensions: 1536,
      usageTokens: 8,
    });
  });

  test("fails closed on malformed batches and vector dimensions", async () => {
    const provider = createAiGatewayKnowledgeEmbeddingProvider({
      embedManyImpl: async () => ({ embeddings: [[0.1]] }),
    });
    await expect(provider.embed([])).rejects.toThrow("between 1 and 100");
    await expect(provider.embed(["entity"])).rejects.toThrow("invalid vector");
  });
});
