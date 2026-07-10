import { describe, expect, it } from "bun:test";
import { createTrace, redactTraceData } from "./index";

describe("BUFI native traces", () => {
  it("redacts credentials and chain of thought while retaining useful summaries", () => {
    const event = createTrace({
      workspaceId: "ws",
      runId: "run",
      type: "tool.called",
      toolName: "knowledge.read",
      summary: "Read 3 entities",
      at: 1,
      data: {
        token: "secret",
        reasoning: "private",
        entityCount: 3,
        nested: { apiKey: "x", ok: true },
      },
    });
    expect(event.summary).toBe("Read 3 entities");
    expect(event.data).toEqual({ entityCount: 3, nested: { ok: true } });
  });
  it("keeps traces team-scoped and never changes caller data", () => {
    const source = { authorization: "Bearer x", period: "2026-Q3" };
    const redacted = redactTraceData(source);
    expect(source.authorization).toBe("Bearer x");
    expect(redacted).toEqual({ period: "2026-Q3" });
  });
});
