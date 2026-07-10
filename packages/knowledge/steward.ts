export type TrustTier = "deterministic-source" | "additive-enrichment" | "review-required" | "sensitive-approval";
export type StewardDecision = "auto-commit" | "needs-review" | "approved" | "rejected" | "undone";

export type KnowledgeChange = {
  targetId: string;
  operation: "create" | "update" | "alias" | "relationship" | "merge" | "split" | "delete";
  field?: string;
  previousValue?: unknown;
  nextValue?: unknown;
  destructive?: boolean;
};

export type KnowledgeChangeSet = {
  id: string;
  workspaceId: string;
  version: number;
  trustTier: TrustTier;
  origin: { sourceArtifactKey?: string; contextPacketHash?: string; toolCallId?: string };
  evidenceIds: readonly string[];
  observedAtMs: number;
  confidence: number;
  method: { name: string; model?: string; promptVersion?: string; schemaVersion: string };
  changes: readonly KnowledgeChange[];
  decision: StewardDecision;
  approverId?: string;
  reason?: string;
  eveTraceId: string;
  appliedGraphVersion?: string;
  undoChangeSetId?: string;
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;

function requireId(name: string, value: string | undefined): void {
  if (!value || !ID.test(value)) throw new Error(`invalid knowledge change set ${name}`);
}

function requiresReview(change: KnowledgeChange): boolean {
  return change.destructive === true || change.operation === "merge" || change.operation === "split" || change.operation === "delete" || change.operation === "alias" || change.operation === "relationship";
}

export function createKnowledgeChangeSet(input: Omit<KnowledgeChangeSet, "decision"> & { decision?: StewardDecision }): KnowledgeChangeSet {
  requireId("id", input.id);
  requireId("workspaceId", input.workspaceId);
  requireId("eveTraceId", input.eveTraceId);
  requireId("schemaVersion", input.method.schemaVersion);
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("knowledge change set version must be positive");
  if (input.observedAtMs <= 0) throw new Error("knowledge change set observed time is required");
  if (input.confidence < 0 || input.confidence > 1) throw new Error("knowledge change set confidence is out of range");
  if (!input.evidenceIds.length) throw new Error("knowledge change sets require evidence");
  if (!input.changes.length) throw new Error("knowledge change sets require at least one change");
  for (const evidenceId of input.evidenceIds) requireId("evidenceId", evidenceId);
  for (const change of input.changes) {
    requireId("targetId", change.targetId);
    if (input.trustTier === "additive-enrichment" && change.operation === "update" && change.nextValue == null) throw new Error("null enrichment cannot overwrite trusted values");
  }
  const reviewRequired = input.trustTier === "review-required" || input.trustTier === "sensitive-approval" || input.changes.some(requiresReview);
  const decision = input.decision ?? (reviewRequired ? "needs-review" : "auto-commit");
  if (decision === "auto-commit" && reviewRequired) throw new Error("review-required change cannot auto-commit");
  return { ...input, evidenceIds: [...input.evidenceIds], changes: input.changes.map(change => ({ ...change })), decision };
}

export function applyStewardDecision(changeSet: KnowledgeChangeSet, input: { decision: Exclude<StewardDecision, "auto-commit" | "needs-review">; approverId: string; reason: string; appliedGraphVersion?: string; undoChangeSetId?: string }): KnowledgeChangeSet {
  if (changeSet.decision === "auto-commit") throw new Error("auto-committed changes do not require steward decision");
  requireId("approverId", input.approverId);
  if (input.reason.trim().length < 3) throw new Error("steward decision requires a reason");
  if (input.decision === "approved") requireId("appliedGraphVersion", input.appliedGraphVersion);
  if (input.decision === "undone") requireId("undoChangeSetId", input.undoChangeSetId);
  return { ...changeSet, decision: input.decision, approverId: input.approverId, reason: input.reason, appliedGraphVersion: input.appliedGraphVersion, undoChangeSetId: input.undoChangeSetId };
}
