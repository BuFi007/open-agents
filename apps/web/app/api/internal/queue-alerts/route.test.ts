import { beforeEach, describe, expect, mock, test } from "bun:test";

const append = mock(async (_input: Readonly<Record<string, unknown>>) => ({
  replayed: false,
  sequence: 7,
}));
mock.module("@/lib/db/operating-pack-runs", () => ({
  appendOperatingPackTraceNext: append,
}));

const { POST } = await import("./route");
const secret = "queue-alert-secret-at-least-thirty-two-characters";
const payload = {
  schemaVersion: 1,
  workspaceId: "workspace-1",
  runId: "run-1",
  exportId: `queue-telemetry:${"a".repeat(64)}`,
  generatedAtMs: 2_000,
  alerts: [
    {
      code: "DEAD_LETTERS_PRESENT",
      profile: "knowledge-ai",
      queue: "repair",
      observed: 1,
      threshold: 0,
    },
  ],
} as const;

function request(body: unknown, authorization = `Bearer ${secret}`) {
  const value = JSON.stringify(body);
  return new Request("https://open-agents.test/api/internal/queue-alerts", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(value)),
    },
    body: value,
  });
}

describe("queue alert ingress", () => {
  beforeEach(() => {
    process.env.OPEN_AGENTS_QUEUE_ALERT_SECRET = secret;
    append.mockClear();
    append.mockImplementation(async (_input) => ({
      replayed: false,
      sequence: 7,
    }));
  });

  test("persists a bounded payload-free alert on the bound run", async () => {
    const response = await POST(request(payload) as never);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      replayed: false,
      sequence: 7,
    });
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      id: `${payload.exportId}:alerts`,
      runId: "run-1",
      workspaceId: "workspace-1",
      type: "queue.alert",
      data: { alerts: payload.alerts },
    });
    expect(JSON.stringify(append.mock.calls[0]?.[0])).not.toContain("job-");
  });

  test("authenticates before parsing and rejects unbounded input", async () => {
    expect((await POST(request(payload, "Bearer wrong") as never)).status).toBe(
      401,
    );
    expect(
      (
        await POST(
          request({
            ...payload,
            alerts: Array.from({ length: 501 }, () => payload.alerts[0]),
          }) as never,
        )
      ).status,
    ).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });

  test("reports an idempotent alert replay", async () => {
    append.mockImplementation(async (_input) => ({
      replayed: true,
      sequence: 7,
    }));
    const response = await POST(request(payload) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      replayed: true,
      sequence: 7,
    });
  });
});
