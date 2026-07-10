import { describe, expect, it } from "bun:test";
import { applyStewardDecision, createKnowledgeChangeSet } from "./index";

describe("knowledge steward change sets", () => {
  it("auto-commits deterministic connector facts with evidence", () => {
    const changeSet = createKnowledgeChangeSet({
      id: "cs_1",
      workspaceId: "ws_1",
      version: 1,
      trustTier: "deterministic-source",
      origin: { sourceArtifactKey: "artifact_1" },
      evidenceIds: ["evidence_1"],
      observedAtMs: 1000,
      confidence: 1,
      method: { name: "gmail-normalizer", schemaVersion: "v1" },
      changes: [
        {
          targetId: "entity_1",
          operation: "update",
          field: "legalName",
          nextValue: "Acme",
        },
      ],
      eveTraceId: "trace_1",
    });
    expect(changeSet.decision).toBe("auto-commit");
  });

  it("routes ambiguous identity and destructive changes to review", () => {
    const changeSet = createKnowledgeChangeSet({
      id: "cs_2",
      workspaceId: "ws_1",
      version: 1,
      trustTier: "review-required",
      origin: { contextPacketHash: "packet_1" },
      evidenceIds: ["evidence_1"],
      observedAtMs: 1000,
      confidence: 0.7,
      method: { name: "exa-enrichment", model: "websets", schemaVersion: "v1" },
      changes: [
        {
          targetId: "entity_1",
          operation: "merge",
          destructive: true,
          nextValue: "entity_2",
        },
      ],
      eveTraceId: "trace_1",
    });
    expect(changeSet.decision).toBe("needs-review");
    const approved = applyStewardDecision(changeSet, {
      decision: "approved",
      approverId: "user_1",
      reason: "same provider id",
      appliedGraphVersion: "graph_2",
    });
    expect(approved.appliedGraphVersion).toBe("graph_2");
  });

  it("prevents null enrichment from overwriting trusted fields and records undo", () => {
    expect(() =>
      createKnowledgeChangeSet({
        id: "cs_3",
        workspaceId: "ws_1",
        version: 1,
        trustTier: "additive-enrichment",
        origin: { toolCallId: "tool_1" },
        evidenceIds: ["evidence_1"],
        observedAtMs: 1000,
        confidence: 0.9,
        method: { name: "motora", schemaVersion: "v1" },
        changes: [
          {
            targetId: "entity_1",
            operation: "update",
            field: "website",
            nextValue: null,
          },
        ],
        eveTraceId: "trace_1",
      }),
    ).toThrow("null enrichment");
    const reviewed = createKnowledgeChangeSet({
      id: "cs_4",
      workspaceId: "ws_1",
      version: 1,
      trustTier: "sensitive-approval",
      origin: { contextPacketHash: "packet_1" },
      evidenceIds: ["evidence_1"],
      observedAtMs: 1000,
      confidence: 0.8,
      method: { name: "human-review", schemaVersion: "v1" },
      changes: [
        { targetId: "entity_1", operation: "split", destructive: true },
      ],
      eveTraceId: "trace_1",
    });
    expect(
      applyStewardDecision(reviewed, {
        decision: "undone",
        approverId: "user_1",
        reason: "bad split",
        undoChangeSetId: "cs_undo_1",
      }).undoChangeSetId,
    ).toBe("cs_undo_1");
  });
});
