import { createHash } from "node:crypto";

export type ContextPacketReference = {
  id: string;
  kind:
    | "entity"
    | "activity"
    | "relationship"
    | "source-artifact"
    | "enrichment-fact";
  sourceId: string;
  observedAtMs: number;
  confidence: number;
  redaction: "metadata-only" | "standard" | "restricted";
  scores: { lexical: number; vector: number; graph: number; recency: number };
  rank: number;
  snippet: string;
  evidenceVersion: number;
};

export type CitationHandle = {
  handle: string;
  referenceId: string;
  kind: ContextPacketReference["kind"];
  sourceId: string;
  observedAtMs: number;
  confidence: number;
};

export type ContextPacketInput = {
  workspaceId: string;
  authorizationScope: string;
  graphWatermark: string;
  projectionWatermark: string;
  ontologyVersion: string;
  query: string;
  intent: string;
  budgets: {
    maxReferences: number;
    maxSnippetChars: number;
    maxRestrictedReferences: number;
  };
  rankFusionVersion: string;
  embedding: { provider: string; model: string; inputVersion: string };
  workflowRunId: string;
  agentRunId: string;
  traceId: string;
  generatedAtMs: number;
  expiresAtMs: number;
  references: readonly ContextPacketReference[];
};

export type ContextPacket = Omit<ContextPacketInput, "references"> & {
  references: readonly ContextPacketReference[];
  citations: readonly CitationHandle[];
  packetHash: string;
};

const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;

function requireId(name: string, value: string): void {
  if (!ID.test(value)) throw new Error(`invalid context packet ${name}`);
}

function boundedScore(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`invalid context packet score ${name}`);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildContextPacket(input: ContextPacketInput): ContextPacket {
  for (const [name, value] of Object.entries({
    workspaceId: input.workspaceId,
    authorizationScope: input.authorizationScope,
    graphWatermark: input.graphWatermark,
    projectionWatermark: input.projectionWatermark,
    ontologyVersion: input.ontologyVersion,
    rankFusionVersion: input.rankFusionVersion,
    workflowRunId: input.workflowRunId,
    agentRunId: input.agentRunId,
    traceId: input.traceId,
  }))
    requireId(name, String(value));
  if (input.generatedAtMs <= 0 || input.expiresAtMs <= input.generatedAtMs)
    throw new Error("invalid context packet time window");
  if (input.budgets.maxReferences < 1 || input.budgets.maxReferences > 200)
    throw new Error("invalid context packet reference budget");
  if (
    input.budgets.maxSnippetChars < 16 ||
    input.budgets.maxSnippetChars > 4000
  )
    throw new Error("invalid context packet snippet budget");
  if (
    input.budgets.maxRestrictedReferences < 0 ||
    input.budgets.maxRestrictedReferences > input.budgets.maxReferences
  )
    throw new Error("invalid restricted reference budget");

  const ranked = [...input.references]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, input.budgets.maxReferences);
  let restricted = 0;
  const references = ranked.map((reference, index) => {
    requireId("referenceId", reference.id);
    requireId("sourceId", reference.sourceId);
    boundedScore("confidence", reference.confidence);
    for (const [name, value] of Object.entries(reference.scores))
      boundedScore(name, value);
    if (reference.redaction === "restricted") restricted += 1;
    if (restricted > input.budgets.maxRestrictedReferences)
      throw new Error("restricted context reference budget exceeded");
    return {
      ...reference,
      rank: index + 1,
      snippet: reference.snippet.slice(0, input.budgets.maxSnippetChars),
    };
  });

  const citations = references.map((reference, index) => ({
    handle: `c${index + 1}`,
    referenceId: reference.id,
    kind: reference.kind,
    sourceId: reference.sourceId,
    observedAtMs: reference.observedAtMs,
    confidence: reference.confidence,
  }));
  const withoutHash = { ...input, references, citations };
  return {
    ...input,
    references,
    citations,
    packetHash: `sha256:${createHash("sha256").update(stable(withoutHash)).digest("hex")}`,
  };
}
