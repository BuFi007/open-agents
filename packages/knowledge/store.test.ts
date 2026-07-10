import { describe, expect, it } from "bun:test";
import { createKnowledgeStore } from "./index";

describe("tenant-safe knowledge store", () => {
  it("resolves concurrent-style duplicate keys idempotently and isolates tenants", async () => {
    const store = createKnowledgeStore();
    const [a, duplicate] = await Promise.all([store.resolveOrCreate({ workspaceId: "a", externalKey: "stripe:1", kind: "customer", name: "A" }), store.resolveOrCreate({ workspaceId: "a", externalKey: "stripe:1", kind: "customer", name: "A" })]);
    await store.resolveOrCreate({ workspaceId: "b", externalKey: "stripe:1", kind: "customer", name: "B" });
    expect(a.id).toBe(duplicate.id); expect((await store.page("a")).items).toHaveLength(1); expect((await store.page("b")).items).toHaveLength(1);
  });
  it("uses bounded cursors instead of unbounded graph downloads", async () => {
    const store = createKnowledgeStore(); for (let i = 0; i < 3; i++) await store.resolveOrCreate({ workspaceId: "a", externalKey: String(i), kind: "entity", name: String(i) });
    const first = await store.page("a", undefined, 2); const second = await store.page("a", first.nextCursor, 2);
    expect(first.items).toHaveLength(2); expect(second.items).toHaveLength(1); expect(second.nextCursor).toBeUndefined();
  });
});
