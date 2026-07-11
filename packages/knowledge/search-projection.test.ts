import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  createTypesenseKnowledgeProjectionProvider,
  knowledgeSearchDocument,
} from "./search-projection";

const entity = {
  id: "entity-1",
  workspaceId: "workspace-1",
  externalKey: "artifact:one",
  kind: "SourceArtifact",
  name: "invoice.pdf",
  version: 2,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
};

const liveTypesenseUrl = process.env.TYPESENSE_TEST_URL?.trim();
const liveTypesenseKey = process.env.TYPESENSE_TEST_API_KEY?.trim();
const liveTypesense =
  process.env.RUN_LIVE_TYPESENSE === "1" && liveTypesenseUrl && liveTypesenseKey
    ? test
    : test.skip;
const liveCollection = `workspace_knowledge_${randomUUID().replaceAll("-", "")}`;

setDefaultTimeout(30_000);

describe("knowledge alternate search projection", () => {
  test("builds a stable workspace-scoped projection document", () => {
    const enrichment = {
      entityId: entity.id,
      workspaceId: entity.workspaceId,
      classifierVersion: "source-artifact-rules.v1",
      inputHash: `sha256:${"a".repeat(64)}`,
      sourceVersion: 2,
      classification: "invoice-document",
      confidence: 0.98,
      updatedAt: "2026-07-11T00:00:00.000Z",
    };
    const first = knowledgeSearchDocument(entity, enrichment);
    expect(first).toMatchObject({
      id: "entity-1",
      workspaceId: "workspace-1",
      classification: "invoice-document",
      sourceVersion: 2,
    });
    expect(first.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(knowledgeSearchDocument(entity, enrichment).inputHash).toBe(
      first.inputHash,
    );
    expect(() =>
      knowledgeSearchDocument(entity, { ...enrichment, sourceVersion: 1 }),
    ).toThrow("stale");
  });

  test("upserts one idempotent Typesense document without exposing its key", async () => {
    const requests: Array<{ url: string; headers: Headers; body: unknown }> =
      [];
    const provider = createTypesenseKnowledgeProjectionProvider({
      baseUrl: "https://typesense.example.test",
      apiKey: "typesense-test-key-long-enough",
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ id: entity.id });
      },
    });
    const document = knowledgeSearchDocument(entity);
    const result = await provider.upsert(document);
    expect(result).toMatchObject({
      provider: "typesense",
      collection: "workspace_knowledge",
      providerRevision: document.inputHash,
    });
    expect(requests[0]?.url).toEndWith(
      "/collections/workspace_knowledge/documents?action=upsert",
    );
    expect(requests[0]?.headers.get("x-typesense-api-key")).toBe(
      "typesense-test-key-long-enough",
    );
    expect(requests[0]?.body).toEqual(document);
    expect(JSON.stringify(result)).not.toContain("typesense-test-key");
  });

  test("requires HTTPS and validates provider responses", async () => {
    expect(() =>
      createTypesenseKnowledgeProjectionProvider({
        baseUrl: "http://typesense.example.test",
        apiKey: "typesense-test-key-long-enough",
      }),
    ).toThrow("HTTPS");
    const provider = createTypesenseKnowledgeProjectionProvider({
      baseUrl: "https://typesense.example.test",
      apiKey: "typesense-test-key-long-enough",
      fetchImpl: async () => Response.json({ id: "other" }),
    });
    await expect(
      provider.upsert(knowledgeSearchDocument(entity)),
    ).rejects.toThrow("invalid document");
  });

  liveTypesense(
    "upserts and retrieves one tenant-filtered document from real Typesense",
    async () => {
      const baseUrl = liveTypesenseUrl!;
      const apiKey = liveTypesenseKey!;
      const headers = {
        "content-type": "application/json",
        "x-typesense-api-key": apiKey,
      };
      const create = await fetch(new URL("/collections", baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: liveCollection,
          fields: [
            { name: "workspaceId", type: "string", facet: true },
            { name: "kind", type: "string", facet: true },
            { name: "name", type: "string" },
            { name: "sourceVersion", type: "int32" },
            { name: "classification", type: "string", facet: true },
            { name: "classificationConfidence", type: "float" },
            { name: "inputHash", type: "string", index: false },
          ],
        }),
      });
      expect(create.status).toBe(201);
      const provider = createTypesenseKnowledgeProjectionProvider({
        baseUrl,
        apiKey,
        collection: liveCollection,
      });
      const enrichment = {
        entityId: entity.id,
        workspaceId: entity.workspaceId,
        classifierVersion: "source-artifact-rules.v1",
        inputHash: `sha256:${"a".repeat(64)}`,
        sourceVersion: entity.version,
        classification: "invoice-document",
        confidence: 0.98,
        updatedAt: "2026-07-11T00:00:00.000Z",
      };
      const document = knowledgeSearchDocument(entity, enrichment);
      await provider.upsert(document);
      await provider.upsert(document);
      const query = new URL(
        `/collections/${liveCollection}/documents/search`,
        baseUrl,
      );
      query.searchParams.set("q", "invoice");
      query.searchParams.set("query_by", "name");
      query.searchParams.set("filter_by", `workspaceId:=${entity.workspaceId}`);
      const response = await fetch(query, {
        headers: { "x-typesense-api-key": apiKey },
      });
      expect(response.ok).toBe(true);
      const result = (await response.json()) as {
        found: number;
        hits: Array<{ document: { id: string; inputHash: string } }>;
      };
      expect(result.found).toBe(1);
      expect(result.hits[0]?.document).toMatchObject({
        id: entity.id,
        inputHash: document.inputHash,
      });
    },
  );
});

afterAll(async () => {
  if (!(liveTypesenseUrl && liveTypesenseKey)) return;
  await fetch(new URL(`/collections/${liveCollection}`, liveTypesenseUrl), {
    method: "DELETE",
    headers: { "x-typesense-api-key": liveTypesenseKey },
  }).catch(() => undefined);
});
