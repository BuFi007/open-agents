import type { QueueTraceFact } from "./bullmq";
import type { QueueTelemetryPolicy } from "./observability";
import {
  createQueueTelemetryExport,
  type QueueTelemetryExport,
  type QueueTelemetryExportSink,
} from "./telemetry-export";

export type QueueTelemetryReport = Readonly<{
  attempted: number;
  delivered: number;
  replayed: number;
  failed: number;
  droppedFacts: number;
}>;

export type QueueTelemetryReporter = {
  record(fact: QueueTraceFact): void;
  flush(): Promise<QueueTelemetryReport>;
  close(): Promise<QueueTelemetryReport>;
  pending(): Readonly<{ groups: number; facts: number; droppedFacts: number }>;
};

export function createQueueTelemetryReporter(input: {
  sink: QueueTelemetryExportSink;
  policy: QueueTelemetryPolicy;
  maxGroups?: number;
  maxFactsPerGroup?: number;
  maxConcurrentSends?: number;
  onDelivered?: (
    exported: QueueTelemetryExport,
    acknowledgement: { replayed: boolean; sequence: number },
  ) => void | Promise<void>;
  onDeliveryFailed?: (failure: {
    workspaceId: string;
    runId: string;
    factCount: number;
    errorCode: "QUEUE_TELEMETRY_DELIVERY_FAILED";
  }) => void | Promise<void>;
}): QueueTelemetryReporter {
  const maxGroups = input.maxGroups ?? 100;
  const maxFactsPerGroup = input.maxFactsPerGroup ?? 1_000;
  const maxConcurrentSends = input.maxConcurrentSends ?? 4;
  if (!Number.isInteger(maxGroups) || maxGroups < 1 || maxGroups > 1_000)
    throw new Error("Queue telemetry maxGroups must be between 1 and 1000");
  if (
    !Number.isInteger(maxFactsPerGroup) ||
    maxFactsPerGroup < 1 ||
    maxFactsPerGroup > 10_000
  )
    throw new Error(
      "Queue telemetry maxFactsPerGroup must be between 1 and 10000",
    );
  if (
    !Number.isInteger(maxConcurrentSends) ||
    maxConcurrentSends < 1 ||
    maxConcurrentSends > 32
  )
    throw new Error(
      "Queue telemetry maxConcurrentSends must be between 1 and 32",
    );

  const groups = new Map<string, QueueTraceFact[]>();
  let droppedFacts = 0;
  let closed = false;
  let activeFlush: Promise<QueueTelemetryReport> | null = null;

  const flush = (): Promise<QueueTelemetryReport> => {
    if (activeFlush) return activeFlush;
    const snapshot = [...groups.entries()];
    groups.clear();
    const droppedAtStart = droppedFacts;
    droppedFacts = 0;
    activeFlush = deliver(snapshot, droppedAtStart).finally(() => {
      activeFlush = null;
    });
    return activeFlush;
  };

  return {
    record(fact) {
      if (closed) throw new Error("Queue telemetry reporter is closed");
      const key = groupKey(fact);
      const existing = groups.get(key);
      if (!existing) {
        if (groups.size >= maxGroups) {
          droppedFacts += 1;
          return;
        }
        groups.set(key, [fact]);
        return;
      }
      if (existing.length >= maxFactsPerGroup) {
        existing.shift();
        droppedFacts += 1;
      }
      existing.push(fact);
    },
    flush,
    async close() {
      if (closed) return emptyReport(droppedFacts);
      closed = true;
      if (activeFlush) await activeFlush;
      return flush();
    },
    pending() {
      return {
        groups: groups.size,
        facts: [...groups.values()].reduce(
          (total, facts) => total + facts.length,
          0,
        ),
        droppedFacts,
      };
    },
  };

  async function deliver(
    snapshot: readonly (readonly [string, QueueTraceFact[]])[],
    dropped: number,
  ): Promise<QueueTelemetryReport> {
    let delivered = 0;
    let replayed = 0;
    let failed = 0;
    let nextIndex = 0;
    const deliverOne = async (entry: readonly [string, QueueTraceFact[]]) => {
      const [key, facts] = entry;
      if (facts.length === 0) return;
      const exported = createQueueTelemetryExport({
        facts,
        policy: input.policy,
      });
      let acknowledgement: { replayed: boolean; sequence: number };
      try {
        acknowledgement = await input.sink.send(exported);
      } catch {
        failed += 1;
        await input.onDeliveryFailed?.({
          workspaceId: exported.workspaceId,
          runId: exported.runId,
          factCount: exported.factCount,
          errorCode: "QUEUE_TELEMETRY_DELIVERY_FAILED",
        });
        const key = groupKey(facts[0]!);
        const pending = groups.get(key) ?? [];
        const available = Math.max(0, maxFactsPerGroup - pending.length);
        const retry = facts.slice(-available);
        const rejected = facts.length - retry.length;
        droppedFacts += rejected;
        groups.set(key, [...retry, ...pending]);
        return;
      }
      delivered += 1;
      if (acknowledgement.replayed) replayed += 1;
      try {
        await input.onDelivered?.(exported, acknowledgement);
      } catch {
        // An observer such as an alert webhook cannot change telemetry delivery.
      }
    };
    const sendBatch = async () => {
      while (true) {
        const index = nextIndex++;
        const entry = snapshot[index];
        if (!entry) return;
        await deliverOne(entry);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(maxConcurrentSends, snapshot.length) },
        () => sendBatch(),
      ),
    );
    return {
      attempted: snapshot.length,
      delivered,
      replayed,
      failed,
      droppedFacts: dropped,
    };
  }
}

function groupKey(fact: QueueTraceFact): string {
  return `${fact.workspaceId.length}:${fact.workspaceId}${fact.traceId}`;
}

function emptyReport(droppedFacts: number): QueueTelemetryReport {
  return {
    attempted: 0,
    delivered: 0,
    replayed: 0,
    failed: 0,
    droppedFacts,
  };
}
