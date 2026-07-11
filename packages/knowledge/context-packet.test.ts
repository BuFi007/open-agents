import { describe, expect, it } from "bun:test";
import {
  buildContextPacket,
  diffContextPackets,
  validateContextPacket,
  type ContextPacketInput,
} from "./index";

const base: ContextPacketInput = {
  workspaceId: "ws_1",
  authorizationScope: "scope_read",
  graphWatermark: "graph_10",
  projectionWatermark: "projection_5",
  ontologyVersion: "ontology_1",
  query: "open invoices",
  intent: "cfo-summary",
  budgets: {
    maxReferences: 2,
    maxSnippetChars: 24,
    maxRestrictedReferences: 0,
  },
  rankFusionVersion: "rrf_1",
  embedding: { provider: "typesense", model: "hybrid", inputVersion: "v1" },
  workflowRunId: "workflow_1",
  agentRunId: "agent_1",
  traceId: "trace_1",
  generatedAtMs: 1000,
  expiresAtMs: 2000,
  references: [
    {
      id: "ref_2",
      kind: "source-artifact",
      sourceId: "artifact_2",
      observedAtMs: 900,
      confidence: 0.8,
      redaction: "standard",
      scores: { lexical: 0.3, vector: 0.4, graph: 0.5, recency: 0.6 },
      rank: 2,
      snippet: "second reference",
      evidenceVersion: 1,
    },
    {
      id: "ref_1",
      kind: "entity",
      sourceId: "entity_1",
      observedAtMs: 950,
      confidence: 0.9,
      redaction: "metadata-only",
      scores: { lexical: 0.9, vector: 0.8, graph: 0.7, recency: 0.6 },
      rank: 1,
      snippet: "first reference with a very long snippet",
      evidenceVersion: 2,
    },
    {
      id: "ref_3",
      kind: "enrichment-fact",
      sourceId: "enrich_3",
      observedAtMs: 800,
      confidence: 0.7,
      redaction: "standard",
      scores: { lexical: 0.1, vector: 0.2, graph: 0.3, recency: 0.4 },
      rank: 3,
      snippet: "third",
      evidenceVersion: 1,
    },
  ],
};

describe("context packets", () => {
  it("builds bounded immutable packet citations and stable hashes", () => {
    const packet = buildContextPacket(base);
    const replay = buildContextPacket(base);
    expect(packet.references.map((reference) => reference.id)).toEqual([
      "ref_1",
      "ref_2",
    ]);
    expect(packet.citations.map((citation) => citation.handle)).toEqual([
      "c1",
      "c2",
    ]);
    expect(packet.references[0]?.snippet.length).toBeLessThanOrEqual(24);
    expect(packet.packetHash).toBe(replay.packetHash);
  });

  it("changes packet hash when graph or projection versions change", () => {
    expect(buildContextPacket(base).packetHash).not.toBe(
      buildContextPacket({ ...base, graphWatermark: "graph_11" }).packetHash,
    );
    expect(buildContextPacket(base).packetHash).not.toBe(
      buildContextPacket({ ...base, projectionWatermark: "projection_6" })
        .packetHash,
    );
  });

  it("enforces restricted reference budgets", () => {
    expect(() =>
      buildContextPacket({
        ...base,
        references: [{ ...base.references[0]!, redaction: "restricted" }],
      }),
    ).toThrow("restricted");
  });

  it("rejects tampering and produces a bounded watermark/reference diff", () => {
    const before = buildContextPacket(base);
    expect(() =>
      validateContextPacket({ ...before, query: "tampered" }),
    ).toThrow("hash");
    const after = buildContextPacket({
      ...base,
      graphWatermark: "graph_11",
      references: [base.references[1]!, base.references[2]!],
    });
    expect(diffContextPackets(before, after)).toEqual({
      graphChanged: true,
      projectionChanged: false,
      addedReferenceIds: ["ref_3"],
      removedReferenceIds: ["ref_2"],
    });
    expect(() =>
      diffContextPackets(
        before,
        buildContextPacket({ ...base, workspaceId: "ws_2" }),
      ),
    ).toThrow("workspace");
  });

  it("rejects unbounded queries, duplicate evidence and invalid revisions", () => {
    expect(() =>
      buildContextPacket({ ...base, query: "x".repeat(1_001) }),
    ).toThrow("query");
    expect(() =>
      buildContextPacket({
        ...base,
        references: [base.references[0]!, base.references[0]!],
      }),
    ).toThrow("duplicate");
    expect(() =>
      buildContextPacket({
        ...base,
        references: [{ ...base.references[0]!, evidenceVersion: 0 }],
      }),
    ).toThrow("metadata");
  });
});
