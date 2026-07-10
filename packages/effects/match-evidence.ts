export type MatchEvidence = {
  workspaceId: string;
  billId: string;
  sourceArtifactKey: string;
  threshold: number;
  score: number;
  factors: readonly {
    name: "amount" | "counterparty" | "date" | "currency" | "reference";
    sourceValue: string;
    targetValue: string;
    score: number;
    evidenceHash: string;
  }[];
  overrideByUserId?: string;
  decidedAtMs: number;
};

export function decideMatch(
  evidence: MatchEvidence,
): "matched" | "needs-review" {
  if (
    evidence.threshold < 0 ||
    evidence.threshold > 1 ||
    evidence.score < 0 ||
    evidence.score > 1
  )
    throw new Error("invalid match score");
  if (!evidence.factors.length)
    throw new Error("match evidence requires factors");
  if (evidence.overrideByUserId) return "matched";
  return evidence.score >= evidence.threshold ? "matched" : "needs-review";
}
