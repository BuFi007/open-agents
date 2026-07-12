import { describe, expect, test } from "bun:test";
import type { QueueTraceFact } from "./bullmq";
import {
  createQueueTelemetryHttpSink,
  createQueueTelemetryExport,
  parseQueueTelemetryExport,
} from "./telemetry-export";

const policy = {
  queueWaitSloMs: 50,
  processingSloMs: 100,
  retryRate: 0.1,
  deadLetters: 0,
  inFlight: 2,
};

function fact(
  type: QueueTraceFact["type"],
  atMs: number,
  overrides: Partial<QueueTraceFact> = {},
): QueueTraceFact {
  return {
    type,
    jobId: "job-1",
    workspaceId: "workspace-1",
    profile: "knowledge-ai",
    queue: "embedding",
    traceId: "run-1",
    attempt: 1,
    atMs,
    ...overrides,
  };
}

describe("queue telemetry export", () => {
  test("creates an integrity-bound payload-free cockpit snapshot", () => {
    const exported = createQueueTelemetryExport({
      facts: [
        fact("queued", 1_000),
        fact("started", 1_100),
        fact("retrying", 1_300, { errorCode: "PROVIDER_TIMEOUT" }),
      ],
      policy,
      generatedAtMs: 2_000,
    });

    expect(parseQueueTelemetryExport(exported)).toEqual(exported);
    expect(exported).toMatchObject({
      workspaceId: "workspace-1",
      runId: "run-1",
      factCount: 3,
      metrics: [
        {
          profile: "knowledge-ai",
          queue: "embedding",
          retrying: 1,
          p95QueueWaitMs: 100,
          p95ProcessingMs: 200,
        },
      ],
    });
    expect(exported.alerts.map((alert) => alert.code)).toEqual([
      "QUEUE_WAIT_SLO_EXCEEDED",
      "PROCESSING_SLO_EXCEEDED",
      "RETRY_RATE_EXCEEDED",
    ]);
    expect(JSON.stringify(exported)).not.toContain("job-1");
    expect(JSON.stringify(exported)).not.toContain("PROVIDER_TIMEOUT");
  });

  test("rejects cross-workspace batches and tampered snapshots", () => {
    expect(() =>
      createQueueTelemetryExport({
        facts: [
          fact("queued", 1_000),
          fact("started", 1_010, { workspaceId: "workspace-2" }),
        ],
        policy,
      }),
    ).toThrow("cannot cross a workspace or run");

    const exported = createQueueTelemetryExport({
      facts: [fact("queued", 1_000)],
      policy,
      generatedAtMs: 2_000,
    });
    expect(() =>
      parseQueueTelemetryExport({ ...exported, factCount: 2 }),
    ).toThrow("integrity check failed");
  });

  test("delivers through an authenticated bounded HTTPS transport", async () => {
    const exported = createQueueTelemetryExport({
      facts: [fact("queued", 1_000)],
      policy,
      generatedAtMs: 2_000,
    });
    let captured: Request | undefined;
    const sink = createQueueTelemetryHttpSink({
      endpoint: "https://open-agents.test/api/internal/queue-telemetry",
      secret: "queue-telemetry-secret-at-least-thirty-two-chars",
      deploymentProtectionBypassSecret: "vercel-automation-bypass-secret",
      fetchImpl: async (input, init) => {
        captured =
          input instanceof Request
            ? new Request(input, init)
            : new Request(input.toString(), init);
        return Response.json({ accepted: true, replayed: false, sequence: 42 });
      },
    });
    await expect(sink.send(exported)).resolves.toEqual({
      replayed: false,
      sequence: 42,
    });
    expect(captured?.headers.get("authorization")).toStartWith("Bearer ");
    expect(captured?.headers.get("x-vercel-protection-bypass")).toBe(
      "vercel-automation-bypass-secret",
    );
    expect(await captured?.json()).toEqual(exported);
  });

  test("retries transient telemetry endpoint failures with a bounded budget", async () => {
    const exported = createQueueTelemetryExport({
      facts: [fact("queued", 1_000)],
      policy,
      generatedAtMs: 2_000,
    });
    let attempts = 0;
    const sink = createQueueTelemetryHttpSink({
      endpoint: "https://open-agents.test/api/internal/queue-telemetry",
      secret: "queue-telemetry-secret-at-least-thirty-two-chars",
      maxAttempts: 3,
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3)
          return Response.json({ error: "busy" }, { status: 503 });
        return Response.json({ accepted: true, replayed: false, sequence: 9 });
      },
    });
    await expect(sink.send(exported)).resolves.toEqual({
      replayed: false,
      sequence: 9,
    });
    expect(attempts).toBe(3);
  });

  test("rejects unsafe transport and malformed acknowledgements", async () => {
    expect(() =>
      createQueueTelemetryHttpSink({
        endpoint: "http://open-agents.test/api/internal/queue-telemetry",
        secret: "queue-telemetry-secret-at-least-thirty-two-chars",
      }),
    ).toThrow("must use HTTPS");
    expect(() =>
      createQueueTelemetryHttpSink({
        endpoint: "https://open-agents.test/api/internal/queue-telemetry",
        secret: "queue-telemetry-secret-at-least-thirty-two-chars",
        deploymentProtectionBypassSecret: "weak\nheader",
      }),
    ).toThrow("bypass secret is invalid");
    const sink = createQueueTelemetryHttpSink({
      endpoint: "https://open-agents.test/api/internal/queue-telemetry",
      secret: "queue-telemetry-secret-at-least-thirty-two-chars",
      fetchImpl: async () => Response.json({ accepted: true }),
    });
    const exported = createQueueTelemetryExport({
      facts: [fact("queued", 1_000)],
      policy,
      generatedAtMs: 2_000,
    });
    await expect(sink.send(exported)).rejects.toThrow("export failed");
  });
});
