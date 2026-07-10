export type RetrievalCandidate = { id: string; workspaceId: string; lexical: number; semantic: number; observedAt: number; evidenceVersion: number };
export type RetrievalResult = RetrievalCandidate & { score: number; freshnessMs: number };

export function hybridRank(workspaceId: string, candidates: readonly RetrievalCandidate[], now = Date.now(), limit = 20): readonly RetrievalResult[] {
  if (!workspaceId || limit < 1 || limit > 100) throw new Error("invalid retrieval request");
  const scoped = candidates.filter(candidate => candidate.workspaceId === workspaceId);
  const maxAge = Math.max(1, ...scoped.map(candidate => Math.max(0, now - candidate.observedAt)));
  return scoped.map(candidate => { const freshnessMs = Math.max(0, now - candidate.observedAt); const freshness = 1 - freshnessMs / maxAge; return { ...candidate, freshnessMs, score: candidate.lexical * 0.4 + candidate.semantic * 0.4 + freshness * 0.2 }; }).sort((a, b) => b.score - a.score).slice(0, limit);
}
