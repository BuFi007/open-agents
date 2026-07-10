export type OutboxEvent = { id: string; workspaceId: string; topic: string; payload: Readonly<Record<string, unknown>>; status: "pending" | "published"; attempts: number };
export type OutboxStore = { append(event: Omit<OutboxEvent, "status" | "attempts">): Promise<OutboxEvent>; claim(limit: number): Promise<readonly OutboxEvent[]>; markPublished(id: string): Promise<void> };

export function createOutbox(): OutboxStore {
  const events = new Map<string, OutboxEvent>();
  return {
    async append(input) {
      if (!input.id || !input.workspaceId || !input.topic) throw new Error("outbox identity is required");
      const existing = events.get(input.id); if (existing) return existing;
      const event = { ...input, status: "pending" as const, attempts: 0 }; events.set(event.id, event); return event;
    },
    async claim(limit) {
      if (limit < 1 || limit > 1000) throw new Error("invalid claim limit");
      const pending = [...events.values()].filter(event => event.status === "pending").slice(0, limit).map(event => ({ ...event, attempts: event.attempts + 1 }));
      for (const event of pending) events.set(event.id, event);
      return pending;
    },
    async markPublished(id) { const event = events.get(id); if (!event) throw new Error("unknown outbox event"); events.set(id, { ...event, status: "published" }); },
  };
}
