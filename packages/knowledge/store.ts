export type Entity = {
  id: string;
  workspaceId: string;
  externalKey: string;
  kind: string;
  name: string;
  version: number;
};
export type Page<T> = { items: readonly T[]; nextCursor?: string };

export type KnowledgeStore = {
  resolveOrCreate(input: Omit<Entity, "id" | "version">): Promise<Entity>;
  page(
    workspaceId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Page<Entity>>;
};

export function createKnowledgeStore(): KnowledgeStore {
  const entities = new Map<string, Entity>();
  const keys = new Map<string, string>();
  return {
    async resolveOrCreate(input) {
      if (!input.workspaceId || !input.externalKey || !input.kind)
        throw new Error("workspace, externalKey, and kind are required");
      const key = `${input.workspaceId}:${input.kind}:${input.externalKey}`;
      const existing = keys.get(key);
      if (existing) return entities.get(existing)!;
      const id = `${input.workspaceId}:entity:${keys.size + 1}`;
      const entity = { ...input, id, version: 1 };
      keys.set(key, id);
      entities.set(id, entity);
      return entity;
    },
    async page(workspaceId, cursor, limit = 50) {
      if (!workspaceId || limit < 1 || limit > 200)
        throw new Error("invalid workspace or page limit");
      const all = [...entities.values()]
        .filter((entity) => entity.workspaceId === workspaceId)
        .sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor
        ? Math.max(0, all.findIndex((entity) => entity.id === cursor) + 1)
        : 0;
      const items = all.slice(start, start + limit);
      return {
        items,
        nextCursor: start + limit < all.length ? items.at(-1)?.id : undefined,
      };
    },
  };
}
