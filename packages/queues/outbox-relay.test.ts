import { describe, expect, test } from "bun:test";
import type {
  PersistentOutboxEvent,
  WorkspaceKnowledgeRepository,
} from "@open-agents/knowledge";
import type { BullMqRuntime, BullMqRuntimeJob } from "./bullmq";
import { relayKnowledgeOutbox } from "./outbox-relay";

describe("knowledge outbox relay", () => {
  test("replays enqueue after a crash and acknowledges exactly one delivery", async () => {
    const repository = fakeRepository([
      event({ id: "event-1", topic: "knowledge.entity.changed" }),
    ]);
    const runtime = fakeRuntime();
    const crashed = await relayKnowledgeOutbox({
      workspace: repository,
      runtime,
      workerId: "relay-1",
      retryAfterMs: 0,
      onDeliveredBeforeAcknowledge: () => {
        throw new Error("SIMULATED_CRASH_AFTER_ENQUEUE");
      },
    });
    expect(crashed).toEqual(
      expect.objectContaining({ published: 0, released: 1, replays: 0 }),
    );
    const recovered = await relayKnowledgeOutbox({
      workspace: repository,
      runtime,
      workerId: "relay-2",
      retryAfterMs: 0,
    });
    expect(recovered).toEqual(
      expect.objectContaining({ published: 1, released: 0, replays: 1 }),
    );
    expect(runtime.enqueued).toHaveLength(1);
    expect(repository.published).toEqual(["event-1"]);
  });

  test("dead-letters unsupported topics without entering BullMQ", async () => {
    const repository = fakeRepository([
      event({ id: "event-unknown", topic: "unknown.topic" }),
    ]);
    const runtime = fakeRuntime();
    const result = await relayKnowledgeOutbox({
      workspace: repository,
      runtime,
      workerId: "relay-1",
    });
    expect(result).toEqual(
      expect.objectContaining({ dead: 1, published: 0, claimed: 1 }),
    );
    expect(result.failures).toEqual([
      {
        eventId: "event-unknown",
        errorCode: "OUTBOX_TOPIC_UNSUPPORTED",
      },
    ]);
    expect(runtime.enqueued).toHaveLength(0);
  });
});

function event(input: { id: string; topic: string }): PersistentOutboxEvent {
  return {
    id: input.id,
    workspaceId: "workspace-1",
    topic: input.topic,
    schemaVersion: 1,
    payload: { entityId: "entity-1", traceId: "trace-1" },
    status: "pending",
    attempts: 0,
    availableAt: new Date().toISOString(),
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };
}

function fakeRepository(
  seed: PersistentOutboxEvent[],
): WorkspaceKnowledgeRepository & { published: string[] } {
  const pending = [...seed];
  const published: string[] = [];
  return {
    workspaceId: "workspace-1",
    published,
    getById: async () => undefined,
    getByExternalKey: async () => undefined,
    resolve: async () => {
      throw new Error("not used");
    },
    resolveAndEnqueue: async () => {
      throw new Error("not used");
    },
    page: async () => ({ items: [] }),
    search: async () => [],
    upsertEmbedding: async () => ({ replayed: false }),
    getEnrichment: async () => undefined,
    upsertEnrichment: async () => ({ replayed: false }),
    getSearchProjection: async () => undefined,
    upsertSearchProjection: async () => ({ replayed: false }),
    semanticSearch: async () => [],
    async claimOutbox() {
      return pending.splice(0).map((item) => ({
        ...item,
        attempts: item.attempts + 1,
      }));
    },
    async markPublished(input) {
      published.push(input.id);
    },
    async releaseOutbox(input) {
      const original = seed.find((item) => item.id === input.id)!;
      original.attempts += 1;
      if (original.attempts >= input.maxAttempts) return "dead";
      pending.push({ ...original });
      return "pending";
    },
  };
}

function fakeRuntime(): BullMqRuntime & { enqueued: BullMqRuntimeJob[] } {
  const enqueued: BullMqRuntimeJob[] = [];
  const ids = new Set<string>();
  return {
    enqueued,
    async enqueue(job) {
      const replayed = ids.has(job.idempotencyKey);
      if (!replayed) {
        ids.add(job.idempotencyKey);
        enqueued.push(job);
      }
      return { bullJobId: job.idempotencyKey, replayed };
    },
    start: async () => undefined,
    waitUntilIdle: async () => undefined,
    health: async () => ({ ready: true, redis: "ready", workers: {} }),
    listDlq: async () => [],
    purge: async () => undefined,
    close: async () => undefined,
  };
}
