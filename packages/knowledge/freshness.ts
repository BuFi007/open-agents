export type ProjectionVersion = { sourceVersion: number; projectionVersion: number; observedAt: number; contentHash: string };

export function needsRefresh(source: ProjectionVersion, now = Date.now(), maxAgeMs = 86_400_000): boolean {
  if (!source.contentHash || source.sourceVersion < 1 || source.projectionVersion < 0) throw new Error("invalid projection version");
  return source.sourceVersion > source.projectionVersion || now - source.observedAt > maxAgeMs;
}
