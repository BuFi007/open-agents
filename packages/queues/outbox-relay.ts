import { createHash } from "node:crypto";
import type {
  PersistentOutboxEvent,
  WorkspaceKnowledgeRepository,
} from "@open-agents/knowledge";
import type { BullMqRuntime, BullMqRuntimeJob } from "./bullmq";
import type { WorkerProfile } from "./worker-profiles";

const ROUTES: Readonly<
  Record<
    string,
    { profile: WorkerProfile["name"]; queue: string; maxAttempts: number }
  >
> = {
  "knowledge.entity.changed": {
    profile: "source-connectors",
    queue: "canonical-write",
    maxAttempts: 5,
  },
  "knowledge.canonical-write": {
    profile: "source-connectors",
    queue: "canonical-write",
    maxAttempts: 5,
  },
  "knowledge.enrichment": {
    profile: "knowledge-ai",
    queue: "enrichment",
    maxAttempts: 4,
  },
  "knowledge.embedding": {
    profile: "knowledge-ai",
    queue: "embedding",
    maxAttempts: 4,
  },
  "knowledge.projection": {
    profile: "knowledge-ai",
    queue: "projection",
    maxAttempts: 5,
  },
  "knowledge.repair": {
    profile: "knowledge-ai",
    queue: "repair",
    maxAttempts: 3,
  },
};

export type KnowledgeOutboxRelayResult = {
  workspaceId: string;
  claimed: number;
  published: number;
  released: number;
  dead: number;
  replays: number;
  failures: readonly { eventId: string; errorCode: string }[];
};

export async function relayKnowledgeOutbox(input: {
  workspace: WorkspaceKnowledgeRepository;
  runtime: BullMqRuntime;
  workerId: string;
  limit?: number;
  leaseMs?: number;
  retryAfterMs?: number;
  onDeliveredBeforeAcknowledge?: (
    event: PersistentOutboxEvent,
  ) => void | Promise<void>;
}): Promise<KnowledgeOutboxRelayResult> {
  const limit = input.limit ?? 100;
  const leaseMs = input.leaseMs ?? 60_000;
  const retryAfterMs = input.retryAfterMs ?? 1_000;
  const events = await input.workspace.claimOutbox({
    workerId: input.workerId,
    limit,
    leaseMs,
  });
  let published = 0;
  let released = 0;
  let dead = 0;
  let replays = 0;
  const failures: Array<{ eventId: string; errorCode: string }> = [];

  for (const event of events) {
    const route = ROUTES[event.topic];
    if (!route) {
      const errorCode = "OUTBOX_TOPIC_UNSUPPORTED";
      const status = await input.workspace.releaseOutbox({
        id: event.id,
        workerId: input.workerId,
        retryAfterMs: 0,
        errorCode,
        maxAttempts: 1,
      });
      if (status === "dead") dead += 1;
      else released += 1;
      failures.push({ eventId: event.id, errorCode });
      continue;
    }
    try {
      const delivery = await input.runtime.enqueue(toQueueJob(event, route));
      if (delivery.replayed) replays += 1;
      await input.onDeliveredBeforeAcknowledge?.(event);
      await input.workspace.markPublished({
        id: event.id,
        workerId: input.workerId,
      });
      published += 1;
    } catch (error) {
      const errorCode = safeErrorCode(error);
      const status = await input.workspace.releaseOutbox({
        id: event.id,
        workerId: input.workerId,
        retryAfterMs,
        errorCode,
        maxAttempts: route.maxAttempts,
      });
      if (status === "dead") dead += 1;
      else released += 1;
      failures.push({ eventId: event.id, errorCode });
    }
  }
  return {
    workspaceId: input.workspace.workspaceId,
    claimed: events.length,
    published,
    released,
    dead,
    replays,
    failures,
  };
}

function toQueueJob(
  event: PersistentOutboxEvent,
  route: { profile: WorkerProfile["name"]; queue: string },
): BullMqRuntimeJob {
  const traceId =
    typeof event.payload.traceId === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/.test(event.payload.traceId)
      ? event.payload.traceId
      : `trace-outbox-${createHash("sha256")
          .update(`${event.workspaceId}:${event.id}`)
          .digest("hex")}`;
  return {
    id: `outbox-${createHash("sha256").update(event.id).digest("hex")}`,
    workspaceId: event.workspaceId,
    profile: route.profile,
    queue: route.queue,
    idempotencyKey: event.id,
    schemaVersion: event.schemaVersion,
    payload: event.payload,
    traceId,
  };
}

function safeErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return "OUTBOX_DELIVERY_FAILED";
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(error.message)
    ? error.message
    : "OUTBOX_DELIVERY_FAILED";
}
