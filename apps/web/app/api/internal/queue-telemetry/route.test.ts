import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createQueueTelemetryExport } from "@open-agents/queues";

const append = mock(async (_input: Readonly<Record<string, unknown>>) => ({
  replayed: false,
  sequence: 42,
}));
mock.module("@/lib/db/operating-pack-runs", () => ({
  appendOperatingPackTraceNext: append,
}));

const { POST } = await import("./route");

const secret = "queue-telemetry-secret-at-least-thirty-two-chars";
const exported = createQueueTelemetryExport({
  facts: [
    {
      type: "queued",
      jobId: "job-1",
      workspaceId: "workspace-1",
      profile: "knowledge-ai",
      queue: "embedding",
      traceId: "run-1",
      attempt: 0,
      atMs: 1_000,
    },
    {
      type: "started",
      jobId: "job-1",
      workspaceId: "workspace-1",
      profile: "knowledge-ai",
      queue: "embedding",
      traceId: "run-1",
      attempt: 1,
      atMs: 1_100,
    },
  ],
  policy: {
    queueWaitSloMs: 50,
    processingSloMs: 500,
    retryRate: 0.5,
    deadLetters: 0,
    inFlight: 10,
  },
  generatedAtMs: 2_000,
});

function request(body: unknown, authorization = `Bearer ${secret}`) {
  const value = JSON.stringify(body);
  return new Request("https://open-agents.test/api/internal/queue-telemetry", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(value)),
    },
    body: value,
  });
}

describe("queue telemetry ingress", () => {
  beforeEach(() => {
    process.env.OPEN_AGENTS_QUEUE_TELEMETRY_SECRET = secret;
    append.mockClear();
    append.mockImplementation(async (_input) => ({
      replayed: false,
      sequence: 42,
    }));
  });

  test("persists an integrity-checked payload-free snapshot on the bound run", async () => {
    const response = await POST(request(exported) as never);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      replayed: false,
      sequence: 42,
    });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).toMatchObject({
      id: exported.exportId,
      runId: "run-1",
      workspaceId: "workspace-1",
      type: "queue.telemetry",
      data: { factCount: 2 },
    });
    expect(JSON.stringify(append.mock.calls[0]?.[0])).not.toContain("job-1");
  });

  test("authenticates before parsing and rejects tampering", async () => {
    expect(
      (await POST(request(exported, "Bearer wrong") as never)).status,
    ).toBe(401);
    expect(
      (await POST(request({ ...exported, factCount: 99 }) as never)).status,
    ).toBe(400);
    expect(append).not.toHaveBeenCalled();
  });

  test("reports idempotent replay without duplicating a trace", async () => {
    append.mockImplementation(async (_input) => ({
      replayed: true,
      sequence: 42,
    }));
    const response = await POST(request(exported) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      replayed: true,
      sequence: 42,
    });
  });
});
