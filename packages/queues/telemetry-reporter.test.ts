import { describe, expect, test } from "bun:test";
import type { QueueTraceFact } from "./bullmq";
import { createQueueTelemetryReporter } from "./telemetry-reporter";

const policy = {
  queueWaitSloMs: 50,
  processingSloMs: 100,
  retryRate: 0.1,
  deadLetters: 0,
  inFlight: 2,
};

function fact(
  workspaceId: string,
  traceId: string,
  atMs: number,
): QueueTraceFact {
  return {
    type: "queued",
    jobId: `job-${workspaceId}`,
    workspaceId,
    profile: "knowledge-ai",
    queue: "embedding",
    traceId,
    attempt: 1,
    atMs,
  };
}

describe("queue telemetry reporter", () => {
  test("batches by workspace and run and delivers payload-free exports", async () => {
    const delivered: unknown[] = [];
    const reporter = createQueueTelemetryReporter({
      policy,
      sink: {
        async send(exported) {
          delivered.push(exported);
          return { replayed: false, sequence: delivered.length };
        },
      },
    });
    reporter.record(fact("workspace-a", "run-a", 1_000));
    reporter.record(fact("workspace-a", "run-a", 1_001));
    reporter.record(fact("workspace-b", "run-b", 1_002));
    await expect(reporter.flush()).resolves.toEqual({
      attempted: 2,
      delivered: 2,
      replayed: 0,
      failed: 0,
      droppedFacts: 0,
    });
    expect(delivered).toHaveLength(2);
    expect(JSON.stringify(delivered)).not.toContain("job-workspace");
  });

  test("retains bounded facts after delivery failure and retries", async () => {
    let fail = true;
    const failures: unknown[] = [];
    const reporter = createQueueTelemetryReporter({
      policy,
      maxFactsPerGroup: 2,
      sink: {
        async send() {
          if (fail) throw new Error("provider secret detail");
          return { replayed: true, sequence: 7 };
        },
      },
      onDeliveryFailed: (failure) => {
        failures.push(failure);
      },
    });
    reporter.record(fact("workspace-a", "run-a", 1_000));
    reporter.record(fact("workspace-a", "run-a", 1_001));
    reporter.record(fact("workspace-a", "run-a", 1_002));
    expect(reporter.pending()).toEqual({
      groups: 1,
      facts: 2,
      droppedFacts: 1,
    });
    await expect(reporter.flush()).resolves.toMatchObject({ failed: 1 });
    expect(reporter.pending()).toEqual({
      groups: 1,
      facts: 2,
      droppedFacts: 0,
    });
    expect(failures).toEqual([
      {
        workspaceId: "workspace-a",
        runId: "run-a",
        factCount: 2,
        errorCode: "QUEUE_TELEMETRY_DELIVERY_FAILED",
      },
    ]);
    expect(JSON.stringify(failures)).not.toContain("provider secret detail");
    fail = false;
    await expect(reporter.flush()).resolves.toMatchObject({
      delivered: 1,
      replayed: 1,
    });
  });

  test("drops new groups at the bound and rejects records after close", async () => {
    const reporter = createQueueTelemetryReporter({
      policy,
      maxGroups: 1,
      sink: {
        async send() {
          return { replayed: false, sequence: 1 };
        },
      },
    });
    reporter.record(fact("workspace-a", "run-a", 1_000));
    reporter.record(fact("workspace-b", "run-b", 1_001));
    await expect(reporter.close()).resolves.toMatchObject({ droppedFacts: 1 });
    expect(() => reporter.record(fact("workspace-a", "run-a", 1_002))).toThrow(
      "closed",
    );
  });

  test("does not replay a delivered export when an observer fails", async () => {
    let deliveries = 0;
    const reporter = createQueueTelemetryReporter({
      policy,
      sink: {
        async send() {
          deliveries += 1;
          return { replayed: false, sequence: 1 };
        },
      },
      onDelivered: () => {
        throw new Error("alert webhook unavailable");
      },
    });
    reporter.record(fact("workspace-a", "run-a", 1_000));
    await expect(reporter.flush()).resolves.toMatchObject({
      delivered: 1,
      failed: 0,
    });
    expect(deliveries).toBe(1);
    expect(reporter.pending().facts).toBe(0);
  });
});
