import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "./client";
import {
  appendOperatingPackTrace,
  appendOperatingPackTraceNext,
  createOperatingPackRun,
} from "./operating-pack-runs";
import { chats, operatingPackTraces, sessions, users } from "./schema";

const liveTest =
  process.env.RUN_LIVE_INFRA_TESTS === "1" && process.env.DATABASE_URL
    ? test
    : test.skip;

describe("operating-pack queue telemetry sequencing (live Postgres)", () => {
  liveTest(
    "serializes concurrent snapshots and replays by export id",
    async () => {
      const suffix = crypto.randomUUID().replaceAll("-", "");
      const userId = `queue-user-${suffix}`;
      const sessionId = `queue-session-${suffix}`;
      const chatId = `queue-chat-${suffix}`;
      const runId = `queue-run-${suffix}`;
      const workspaceId = `queue-workspace-${suffix}`;
      try {
        await db.insert(users).values({
          id: userId,
          username: `queue_${suffix}`,
        });
        await db.insert(sessions).values({
          id: sessionId,
          userId,
          title: "Queue telemetry certification",
        });
        await db.insert(chats).values({
          id: chatId,
          sessionId,
          title: "Queue telemetry certification",
          harnessId: "pi",
        });
        await createOperatingPackRun({
          id: runId,
          workspaceId,
          sessionId,
          chatId,
          userId,
          packId: "finance_ops",
          workflowId: "queue_telemetry_certification",
          harnessId: "pi",
          idempotencyKey: `queue-telemetry:${suffix}`,
          requestHash: "a".repeat(64),
          status: "running",
        });
        await appendOperatingPackTrace({
          id: `${runId}:start`,
          runId,
          workspaceId,
          sequence: 1,
          type: "workflow.started",
        });

        const [left, right] = await Promise.all([
          appendOperatingPackTraceNext({
            id: `queue-telemetry:${"b".repeat(64)}`,
            runId,
            workspaceId,
            type: "queue.telemetry",
          }),
          appendOperatingPackTraceNext({
            id: `queue-telemetry:${"c".repeat(64)}`,
            runId,
            workspaceId,
            type: "queue.telemetry",
          }),
        ]);
        expect([left.sequence, right.sequence].sort()).toEqual([2, 3]);
        const replay = await appendOperatingPackTraceNext({
          id: `queue-telemetry:${"b".repeat(64)}`,
          runId,
          workspaceId,
          type: "queue.telemetry",
        });
        expect(replay).toEqual({ replayed: true, sequence: left.sequence });
        await expect(
          appendOperatingPackTraceNext({
            id: `queue-telemetry:${"d".repeat(64)}`,
            runId,
            workspaceId: "another-workspace",
            type: "queue.telemetry",
          }),
        ).rejects.toThrow("outside the workspace");
        const persisted = await db
          .select({ sequence: operatingPackTraces.sequence })
          .from(operatingPackTraces)
          .where(eq(operatingPackTraces.runId, runId));
        expect(persisted.map((row) => row.sequence).sort()).toEqual([1, 2, 3]);
      } finally {
        await db.delete(users).where(eq(users.id, userId));
      }
    },
    30_000,
  );
});
