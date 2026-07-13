import { describe, expect, test } from "bun:test";
import type {
  KnowledgeEmbeddingProvider,
  KnowledgeSearchProjectionProvider,
  PersistentEntity,
  PersistentKnowledgeEnrichment,
} from "@open-agents/knowledge";
import type { BullMqRuntimeJob } from "./bullmq";
import {
  createKnowledgeAiProcessor,
  createKnowledgeCanonicalWriteProcessor,
  createKnowledgeEmbeddingProcessor,
  createKnowledgeEnrichmentProcessor,
  createKnowledgeRepairProcessor,
  createKnowledgeSearchProjectionProcessor,
} from "./knowledge-processors";

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
        getByExternalKey: async () => undefined,
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
        getByExternalKey: async () => undefined,
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

  test("runs canonical, enrichment, alternate projection, and repair idempotently", async () => {
    let entity: PersistentEntity | undefined;
    let enrichment: PersistentKnowledgeEnrichment | undefined;
    const embeddings: unknown[] = [];
    const receipts: unknown[] = [];
    const projected: unknown[] = [];
    const workspace = {
      getById: async (id: string) => (entity?.id === id ? entity : undefined),
      getByExternalKey: async (_kind: string, externalKey: string) =>
        entity?.externalKey === externalKey ? entity : undefined,
      async resolve(input: {
        externalKey: string;
        kind: string;
        name: string;
      }) {
        entity ??= {
          id: "entity-artifact-1",
          workspaceId: "workspace-1",
          externalKey: input.externalKey,
          kind: input.kind,
          name: input.name,
          version: 1,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        };
        return entity;
      },
      getEnrichment: async () => enrichment,
      async upsertEnrichment(input: {
        entityId: string;
        classifierVersion: string;
        inputHash: string;
        sourceVersion: number;
        classification: string;
        confidence: number;
      }) {
        const replayed = enrichment?.inputHash === input.inputHash;
        enrichment ??= {
          ...input,
          workspaceId: "workspace-1",
          updatedAt: "2026-07-11T00:00:00.000Z",
        };
        return { replayed };
      },
      async upsertEmbedding(input: unknown) {
        const replayed = embeddings.length > 0;
        if (!replayed) embeddings.push(input);
        return { replayed };
      },
      async upsertSearchProjection(input: unknown) {
        const replayed = receipts.length > 0;
        if (!replayed) receipts.push(input);
        return { replayed };
      },
    };
    const artifacts = {
      async getArtifact() {
        return {
          artifactKey: "artifact:one",
          workspaceId: "workspace-1",
          connectorId: "connector-1",
          provider: "pipedream" as const,
          contentHash: `sha256:${"a".repeat(64)}`,
          mimeType: "application/pdf",
          sizeBytes: 123,
          sourceRevision: "revision:one",
          metadata: { filename: "invoice.pdf" },
          observedAt: "2026-07-11T00:00:00.000Z",
        };
      },
    };
    const embeddingProvider: KnowledgeEmbeddingProvider = {
      model: "openai/text-embedding-3-small",
      inputVersion: "entity-search.v1",
      embed: async () => ({
        model: "openai/text-embedding-3-small",
        inputVersion: "entity-search.v1",
        dimensions: 1536,
        embeddings: [vector],
        usageTokens: 3,
      }),
    };
    const searchProvider: KnowledgeSearchProjectionProvider = {
      provider: "typesense",
      collection: "workspace_knowledge",
      schemaVersion: "knowledge-search.v1",
      async upsert(document) {
        projected.push(document);
        return {
          provider: this.provider,
          collection: this.collection,
          schemaVersion: this.schemaVersion,
          providerRevision: document.inputHash,
        };
      },
    };
    const canonical = createKnowledgeCanonicalWriteProcessor({
      artifacts,
      forWorkspace: () => workspace,
    });
    const enrich = createKnowledgeEnrichmentProcessor({
      artifacts,
      forWorkspace: () => workspace,
    });
    const embed = createKnowledgeEmbeddingProcessor({
      forWorkspace: () => workspace,
      provider: embeddingProvider,
    });
    const projection = createKnowledgeSearchProjectionProcessor({
      forWorkspace: () => workspace,
      provider: searchProvider,
    });
    const repair = createKnowledgeRepairProcessor({
      canonical,
      enrichment: enrich,
      embedding: embed,
      projection,
    });
    const ai = createKnowledgeAiProcessor({
      canonical,
      enrichment: enrich,
      embedding: embed,
      projection,
      repair,
    });
    const signal = new AbortController().signal;
    const artifactJob = {
      ...job(),
      payload: {
        artifactKey: "artifact:one",
        sourceRevision: "revision:one",
        connectionId: "connector-1",
      },
    };
    await expect(
      canonical(
        {
          ...artifactJob,
          profile: "source-connectors",
          queue: "canonical-write",
          payload: { ...artifactJob.payload, connectionId: "other-connector" },
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: "SOURCE_ARTIFACT_AUTHORITY_MISMATCH" });
    await canonical(
      {
        ...artifactJob,
        profile: "source-connectors",
        queue: "canonical-write",
      },
      signal,
    );
    await ai({ ...artifactJob, queue: "enrichment" }, signal);
    await Promise.all([
      ai({ ...artifactJob, queue: "embedding" }, signal),
      ai({ ...artifactJob, queue: "projection" }, signal),
    ]);
    await ai({ ...artifactJob, queue: "repair" }, signal);

    expect(entity).toMatchObject({ name: "invoice.pdf", version: 1 });
    expect(enrichment).toMatchObject({
      classification: "invoice-document",
      confidence: 0.98,
    });
    expect(embeddings).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(projected).toHaveLength(2);
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
