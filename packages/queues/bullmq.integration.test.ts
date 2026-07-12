import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  QueueTaskError,
  createBullMqRuntime,
  type BullMqRuntimeJob,
  type QueueTraceFact,
} from "./bullmq";

const configuredRedisUrl =
  process.env.QUEUE_REDIS_TEST_URL ?? process.env.REDIS_URL;
const redisUrl = configuredRedisUrl ?? "redis://127.0.0.1:1";
const enabled = process.env.RUN_LIVE_QUEUE_TESTS === "1";
const liveDescribe = enabled && configuredRedisUrl ? describe : describe.skip;

setDefaultTimeout(60_000);

liveDescribe("BullMQ production runtime", () => {
  const traces: QueueTraceFact[] = [];
  const namespace = `bufi-cert-${randomUUID().slice(0, 12)}`;
  const runtime = createBullMqRuntime({
    redisUrl,
    namespace,
    replicaCount: 2,
    trace: (fact) => {
      traces.push(fact);
    },
  });
  const peerRuntime = createBullMqRuntime({
    redisUrl,
    namespace,
    replicaCount: 2,
    trace: (fact) => {
      traces.push(fact);
    },
  });
  const attempts = new Map<string, number>();
  const active = new Map<string, number>();
  const maxActive = new Map<string, number>();
  const completed: string[] = [];
  let permanentFailureEnabled = true;

  afterAll(async () => {
    await Promise.all([
      runtime.waitUntilIdle(30_000).catch(() => undefined),
      peerRuntime.waitUntilIdle(30_000).catch(() => undefined),
    ]);
    await peerRuntime.close();
    await runtime.purge().catch(() => undefined);
    await runtime.close();
  });

  test("runs real mixed work with profile budgets, deadlines, retries and compact DLQ", async () => {
    const process = async (job: BullMqRuntimeJob, signal: AbortSignal) => {
      const count = (attempts.get(job.id) ?? 0) + 1;
      attempts.set(job.id, count);
      const activeKey = `${job.profile}:${job.workspaceId}`;
      const nextActive = (active.get(activeKey) ?? 0) + 1;
      active.set(activeKey, nextActive);
      maxActive.set(
        activeKey,
        Math.max(maxActive.get(activeKey) ?? 0, nextActive),
      );
      try {
        if (job.payload.mode === "permanent" && permanentFailureEnabled)
          throw new QueueTaskError({
            code: "INVALID_PROVIDER_RECORD",
            retryable: false,
            status: 422,
          });
        if (job.payload.mode === "transient" && count === 1)
          throw new QueueTaskError({
            code: "PROVIDER_RATE_LIMITED",
            retryable: true,
            status: 429,
          });
        if (job.payload.mode === "hang") {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 10_000);
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(
                  new QueueTaskError({
                    code: "DEADLINE_EXCEEDED",
                    retryable: true,
                  }),
                );
              },
              { once: true },
            );
          });
        } else {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        completed.push(job.id);
      } finally {
        const remaining = (active.get(activeKey) ?? 1) - 1;
        if (remaining <= 0) active.delete(activeKey);
        else active.set(activeKey, remaining);
      }
    };

    const jobs: BullMqRuntimeJob[] = [];
    for (let index = 0; index < 16; index += 1) {
      jobs.push(
        job({
          id: `noisy-${index}`,
          workspaceId: "workspace-noisy",
          profile: "source-connectors",
          queue: "connector-page",
        }),
      );
    }
    for (let index = 0; index < 4; index += 1) {
      jobs.push(
        job({
          id: `protected-${index}`,
          workspaceId: "workspace-protected",
          profile: "source-connectors",
          queue: "canonical-write",
        }),
      );
    }
    jobs.push(
      job({
        id: "permanent-error",
        workspaceId: "workspace-noisy",
        profile: "source-connectors",
        queue: "source-event",
        payload: { mode: "permanent" },
      }),
      job({
        id: "transient-error",
        workspaceId: "workspace-protected",
        profile: "source-connectors",
        queue: "source-event",
        payload: { mode: "transient" },
      }),
      job({
        id: "deadline-error",
        workspaceId: "workspace-noisy",
        profile: "knowledge-ai",
        queue: "enrichment",
        payload: { mode: "hang" },
        deadlineMs: 50,
      }),
    );

    const first = await runtime.enqueue(jobs[0]!);
    const replay = await runtime.enqueue(jobs[0]!);
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    await Promise.all(jobs.slice(1).map((item) => runtime.enqueue(item)));
    await expect(
      runtime.enqueue(
        job({
          id: "unsafe",
          workspaceId: "workspace-noisy",
          profile: "knowledge-ai",
          queue: "enrichment",
          payload: { api_token: "must-not-enter-redis" },
        }),
      ),
    ).rejects.toThrow("forbidden key");

    await runtime.start({
      "source-connectors": process,
      "knowledge-ai": process,
    });
    await peerRuntime.start({ "source-connectors": process });
    expect(await runtime.health()).toEqual(
      expect.objectContaining({ ready: true, redis: "ready" }),
    );
    expect(await peerRuntime.health()).toEqual(
      expect.objectContaining({ ready: true, redis: "ready" }),
    );
    await runtime.waitUntilIdle(25_000);

    expect(
      maxActive.get("source-connectors:workspace-noisy"),
    ).toBeLessThanOrEqual(4);
    expect(completed.filter((id) => id.startsWith("protected-"))).toHaveLength(
      4,
    );
    expect(attempts.get("permanent-error")).toBe(1);
    expect(attempts.get("transient-error")).toBe(2);
    expect(attempts.get("deadline-error")).toBe(4);
    const sourceDlq = await runtime.listDlq("source-connectors");
    const knowledgeDlq = await runtime.listDlq("knowledge-ai");
    expect(sourceDlq).toEqual([
      expect.objectContaining({
        jobId: "permanent-error",
        failureClass: "unrecoverable",
        errorCode: "INVALID_PROVIDER_RECORD",
      }),
    ]);
    expect(knowledgeDlq).toEqual([
      expect.objectContaining({
        jobId: "deadline-error",
        failureClass: "deadline",
        errorCode: "DEADLINE_EXCEEDED",
      }),
    ]);
    expect(JSON.stringify([...sourceDlq, ...knowledgeDlq])).not.toContain(
      "must-not-enter-redis",
    );

    const permanentJob = jobs.find((item) => item.id === "permanent-error")!;
    await expect(
      runtime.redrive({
        profile: "source-connectors",
        entryAtMs: sourceDlq[0]!.atMs,
        job: { ...permanentJob, payload: { mode: "tampered" } },
      }),
    ).rejects.toThrow("payload hash");
    permanentFailureEnabled = false;
    const redrive = await runtime.redrive({
      profile: "source-connectors",
      entryAtMs: sourceDlq[0]!.atMs,
      job: permanentJob,
    });
    expect(redrive.replayed).toBe(false);
    await runtime.waitUntilIdle(10_000);
    expect(completed.filter((id) => id === "permanent-error")).toHaveLength(1);
    expect(await runtime.listDlq("source-connectors")).toEqual([]);
    expect(
      await runtime.redrive({
        profile: "source-connectors",
        entryAtMs: sourceDlq[0]!.atMs,
        job: permanentJob,
      }),
    ).toEqual({ ...redrive, replayed: true });
    expect(traces.some((trace) => trace.type === "throttled")).toBe(true);
    expect(traces.some((trace) => trace.type === "retrying")).toBe(true);
    expect(traces.some((trace) => trace.type === "dead-lettered")).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("payload");
  });
});

function job(
  input: Partial<BullMqRuntimeJob> &
    Pick<BullMqRuntimeJob, "id" | "workspaceId" | "profile" | "queue">,
): BullMqRuntimeJob {
  return {
    idempotencyKey: `idempotency-${input.id}`,
    schemaVersion: 1,
    payload: { mode: "success" },
    traceId: `trace-${input.id}`,
    ...input,
  };
}
