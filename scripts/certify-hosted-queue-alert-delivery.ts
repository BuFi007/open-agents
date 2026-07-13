import { eq } from "drizzle-orm";
import IORedis from "ioredis";
import postgres from "postgres";
import { createPostgresKnowledgeRepository } from "@open-agents/knowledge";
import { db } from "../apps/web/lib/db/client";
import {
  appendOperatingPackTrace,
  createOperatingPackRun,
} from "../apps/web/lib/db/operating-pack-runs";
import {
  chats,
  operatingPackTraces,
  sessions,
  users,
} from "../apps/web/lib/db/schema";

const databaseUrl = required("DATABASE_URL");
const redisUrl = required("REDIS_URL");
const namespace = required("BULLMQ_NAMESPACE");
const workspaceId = "worker-certification-workspace";
const suffix = crypto.randomUUID().replaceAll("-", "");
const userId = `alert-cert-user-${suffix}`;
const sessionId = `alert-cert-session-${suffix}`;
const chatId = `alert-cert-chat-${suffix}`;
const runId = `alert-cert-run-${suffix}`;
const outboxId = `alert-cert-outbox-${suffix}`;
const artifactKey = `artifact:alert-cert-${suffix}`;
const startedAtMs = Date.now();
const knowledge = createPostgresKnowledgeRepository({
  connectionString: databaseUrl,
  maxConnections: 1,
});
const inspection = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
redis.on("error", () => undefined);
let failure: unknown = null;

try {
  await db.insert(users).values({
    id: userId,
    username: `alert_cert_${suffix}`,
  });
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    title: "Hosted queue alert certification",
  });
  await db.insert(chats).values({
    id: chatId,
    sessionId,
    title: "Hosted queue alert certification",
    harnessId: "pi",
  });
  await createOperatingPackRun({
    id: runId,
    workspaceId,
    sessionId,
    chatId,
    userId,
    packId: "finance_ops",
    workflowId: "queue_alert_certification",
    harnessId: "pi",
    idempotencyKey: `hosted-queue-alert:${suffix}`,
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

  await knowledge.forWorkspace(workspaceId).resolveAndEnqueue({
    externalKey: artifactKey,
    kind: "SourceArtifact",
    name: "Missing source artifact alert certification",
    outbox: {
      id: outboxId,
      topic: "knowledge.repair",
      schemaVersion: 1,
      payload: {
        artifactKey,
        sourceRevision: `revision-${suffix}`,
        connectionId: `connection-${suffix}`,
        traceId: runId,
        stage: "repair",
      },
    },
  });

  const alertTrace = await waitFor(async () => {
    const traces = await db
      .select({
        id: operatingPackTraces.id,
        type: operatingPackTraces.type,
        sequence: operatingPackTraces.sequence,
        data: operatingPackTraces.data,
      })
      .from(operatingPackTraces)
      .where(eq(operatingPackTraces.runId, runId));
    return traces.find((trace) => trace.type === "queue.alert") ?? null;
  }, 90_000);
  const serialized = JSON.stringify(alertTrace.data);
  if (!serialized.includes("DEAD_LETTERS_PRESENT"))
    throw new Error("Hosted alert trace does not contain the DLQ SLO code");
  if (serialized.includes(artifactKey) || serialized.includes(outboxId))
    throw new Error("Hosted alert trace leaked queue payload identity");

  console.log(
    JSON.stringify(
      {
        certified: true,
        workspaceId,
        runId,
        alertTrace: {
          id: alertTrace.id,
          sequence: alertTrace.sequence,
          code: "DEAD_LETTERS_PRESENT",
          payloadFree: true,
        },
        delivery: {
          deployedWorker: true,
          protectedWebhook: true,
          idempotentTrace: true,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  failure = error;
} finally {
  await removeFixtureDlqEntries();
  await inspection.begin(async (transaction) => {
    await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
    await transaction`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
    await transaction`DELETE FROM knowledge_outbox WHERE id = ${outboxId}`;
    await transaction`DELETE FROM knowledge_entities
      WHERE workspace_id = ${workspaceId}
        AND kind = 'SourceArtifact'
        AND external_key = ${artifactKey}`;
  });
  await db.delete(users).where(eq(users.id, userId));
  await Promise.all([
    knowledge.close(),
    inspection.end({ timeout: 5 }),
    redis.quit(),
  ]);
}

if (failure) {
  console.error(
    failure instanceof Error
      ? failure.message
      : "Hosted queue alert certification failed",
  );
  process.exit(1);
}
process.exit(0);

async function removeFixtureDlqEntries(): Promise<void> {
  const key = `${namespace}:dlq:knowledge-ai`;
  const rows = await redis.lrange(key, 0, -1);
  for (const row of rows) {
    const entry = JSON.parse(row) as {
      workspaceId?: unknown;
      queue?: unknown;
      errorCode?: unknown;
      atMs?: unknown;
    };
    if (
      entry.workspaceId === workspaceId &&
      entry.queue === "repair" &&
      entry.errorCode === "SOURCE_ARTIFACT_NOT_FOUND" &&
      typeof entry.atMs === "number" &&
      entry.atMs >= startedAtMs
    )
      await redis.lrem(key, 0, row);
  }
}

async function waitFor<T>(
  inspect: () => Promise<T | null>,
  timeoutMs: number,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await inspect();
    if (result) return result;
    await Bun.sleep(1_000);
  }
  throw new Error("Hosted queue alert did not arrive before the deadline");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
