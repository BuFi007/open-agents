import { describe, expect, it } from "bun:test";
import { createQueuePlan } from "./index";

describe("knowledge queue topology", () => {
  it("keeps canonical writes separate from high-throughput leaf work", () => {
    const plan = createQueuePlan([{ id: "1", workspaceId: "ws-a", kind: "canonical-write", idempotencyKey: "event-1", payload: {} }, { id: "2", workspaceId: "ws-a", kind: "embedding", idempotencyKey: "event-1", payload: {} }]);
    expect(plan.profiles.find(profile => profile.name === "canonical-write")?.concurrency).toBeLessThan(plan.profiles.find(profile => profile.name === "embedding")?.concurrency ?? 0);
  });
  it("rejects jobs without tenant and idempotency boundaries", () => {
    expect(() => createQueuePlan([{ id: "1", workspaceId: "", kind: "repair", idempotencyKey: "", payload: {} }])).toThrow();
  });
});
