import { describe, expect, it } from "bun:test";
import { createOutbox } from "./index";

describe("transactional outbox contract", () => {
  it("deduplicates events and exposes bounded retry claims", async () => {
    const outbox = createOutbox(); const input = { id: "event-1", workspaceId: "ws", topic: "knowledge.write", payload: { entityId: "e" } };
    expect(await outbox.append(input)).toEqual({ ...input, status: "pending", attempts: 0 }); expect(await outbox.append(input)).toEqual({ ...input, status: "pending", attempts: 0 });
    expect((await outbox.claim(1))[0]?.attempts).toBe(1); await outbox.markPublished("event-1"); expect(await outbox.claim(1)).toHaveLength(0);
  });
});
