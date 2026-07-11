import { describe, expect, test } from "bun:test";
import { createQueueTelemetry } from "./observability";

const policy = {
  queueWaitSloMs: 50,
  processingSloMs: 100,
  retryRate: 0.2,
  deadLetters: 0,
  inFlight: 10,
};

describe("queue telemetry", () => {
  test("aggregates payload-free latency, retry and dead-letter facts", () => {
    const telemetry = createQueueTelemetry({ now: () => 1_000 });
    const base = {
      jobId: "job-1",
      workspaceId: "workspace-secret",
      profile: "knowledge-ai" as const,
      queue: "enrichment",
      traceId: "trace-1",
      attempt: 1,
    };
    telemetry.record({ ...base, type: "queued", atMs: 100 });
    telemetry.record({ ...base, type: "started", atMs: 180 });
    telemetry.record({
      ...base,
      type: "retrying",
      atMs: 300,
      errorCode: "PROVIDER_RATE_LIMITED",
    });
    telemetry.record({ ...base, type: "started", atMs: 350, attempt: 2 });
    telemetry.record({
      ...base,
      type: "dead-lettered",
      atMs: 500,
      attempt: 2,
      errorCode: "PROVIDER_RATE_LIMITED",
    });

    const snapshot = telemetry.snapshot(policy);
    expect(snapshot).toEqual({
      generatedAtMs: 1_000,
      metrics: [
        {
          profile: "knowledge-ai",
          queue: "enrichment",
          queued: 1,
          completed: 0,
          retrying: 1,
          deadLettered: 1,
          throttled: 0,
          inFlight: 0,
          p95QueueWaitMs: 80,
          p95ProcessingMs: 150,
        },
      ],
      alerts: expect.arrayContaining([
        expect.objectContaining({ code: "QUEUE_WAIT_SLO_EXCEEDED" }),
        expect.objectContaining({ code: "PROCESSING_SLO_EXCEEDED" }),
        expect.objectContaining({ code: "RETRY_RATE_EXCEEDED" }),
        expect.objectContaining({ code: "DEAD_LETTERS_PRESENT" }),
      ]),
      trackedJobs: 0,
      evictedJobs: 0,
    });
    expect(JSON.stringify(snapshot)).not.toContain("workspace-secret");
    expect(JSON.stringify(snapshot)).not.toContain("trace-1");
    expect(JSON.stringify(snapshot)).not.toContain("PROVIDER_RATE_LIMITED");
  });

  test("bounds tracked job state and reports eviction", () => {
    const telemetry = createQueueTelemetry({ maxTrackedJobs: 1 });
    for (const jobId of ["job-1", "job-2"]) {
      telemetry.record({
        type: "queued",
        jobId,
        workspaceId: "workspace-1",
        profile: "source-connectors",
        queue: "source-event",
        traceId: `trace-${jobId}`,
        attempt: 0,
        atMs: 100,
      });
    }
    expect(telemetry.snapshot(policy)).toEqual(
      expect.objectContaining({ trackedJobs: 1, evictedJobs: 1 }),
    );
  });

  test("rejects invalid alert policy", () => {
    const telemetry = createQueueTelemetry();
    expect(() => telemetry.snapshot({ ...policy, retryRate: 1.1 })).toThrow(
      "at most one",
    );
  });
});
