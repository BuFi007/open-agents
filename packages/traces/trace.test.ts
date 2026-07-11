import { describe, expect, it } from "bun:test";
import {
  createTrace,
  persistTrace,
  redactTraceData,
  sanitizeTraceText,
} from "./index";

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

  it("redacts secret-shaped and personal values from summaries and nested data", () => {
    expect(
      sanitizeTraceText(
        "Authorization: Bearer abc.def user founder@example.com key sk_live_1234567890123456",
      ),
    ).toBe("Authorization: [redacted] user [redacted] key [redacted]");
    const event = createTrace({
      workspaceId: "ws",
      runId: "run",
      type: "agent.completed",
      summary: "Contact founder@example.com",
      data: { output: "Bearer abc.def" },
      at: 2,
    });
    expect(event.summary).toBe("Contact [redacted]");
    expect(event.data).toEqual({ output: "[redacted]" });
  });

  it("creates collision-resistant content ids and awaits durable sinks", async () => {
    const first = createTrace({
      workspaceId: "ws",
      runId: "run",
      type: "tool.called",
      summary: "one",
      at: 3,
    });
    const second = createTrace({
      workspaceId: "ws",
      runId: "run",
      type: "tool.called",
      summary: "two",
      at: 3,
    });
    expect(first.id).not.toBe(second.id);
    let persisted = false;
    const result = await persistTrace(
      {
        workspaceId: "ws",
        runId: "run",
        type: "run.completed",
        at: 4,
      },
      {
        async append() {
          await Promise.resolve();
          persisted = true;
        },
      },
    );
    expect(persisted).toBe(true);
    expect(result.type).toBe("run.completed");
  });
});
