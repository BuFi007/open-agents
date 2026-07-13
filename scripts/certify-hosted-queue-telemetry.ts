import { eq } from "drizzle-orm";
import {
  createQueueTelemetryExport,
  type QueueTraceFact,
} from "@open-agents/queues";
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

const deployment = required("QUEUE_TELEMETRY_DEPLOYMENT");
const secret = required("QUEUE_TELEMETRY_SECRET");
if (!deployment.startsWith("https://"))
  throw new Error("QUEUE_TELEMETRY_DEPLOYMENT must use HTTPS");
if (secret.length < 32)
  throw new Error("QUEUE_TELEMETRY_SECRET must contain at least 32 characters");

const suffix = crypto.randomUUID().replaceAll("-", "");
const userId = `hosted-queue-user-${suffix}`;
const sessionId = `hosted-queue-session-${suffix}`;
const chatId = `hosted-queue-chat-${suffix}`;
const runId = `hosted-queue-run-${suffix}`;
const workspaceId = `hosted-queue-workspace-${suffix}`;
const jobId = `hosted-sensitive-job-${suffix}`;
const errorCode = `HOSTED_PROVIDER_DETAIL_${suffix}`;

try {
  await db.insert(users).values({
    id: userId,
    username: `hosted_queue_${suffix}`,
  });
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    title: "Hosted queue telemetry certification",
  });
  await db.insert(chats).values({
    id: chatId,
    sessionId,
    title: "Hosted queue telemetry certification",
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
    idempotencyKey: `hosted-queue-telemetry:${suffix}`,
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

  const generatedAtMs = Date.now();
  const fact = (
    type: QueueTraceFact["type"],
    atMs: number,
    overrides: Partial<QueueTraceFact> = {},
  ): QueueTraceFact => ({
    type,
    jobId,
    workspaceId,
    profile: "knowledge-ai",
    queue: "semantic-index",
    traceId: runId,
    attempt: 1,
    atMs,
    ...overrides,
  });
  const exported = createQueueTelemetryExport({
    facts: [
      fact("queued", generatedAtMs - 1_000),
      fact("started", generatedAtMs - 700),
      fact("retrying", generatedAtMs - 300, { errorCode }),
    ],
    policy: {
      queueWaitSloMs: 100,
      processingSloMs: 200,
      retryRate: 0.1,
      deadLetters: 0,
      inFlight: 1,
    },
    generatedAtMs,
  });

  const first = await post(exported);
  const replay = await post(exported);
  if (
    first.accepted !== true ||
    first.replayed !== false ||
    !Number.isSafeInteger(first.sequence)
  )
    throw new Error("Hosted queue telemetry first acknowledgement is invalid");
  if (
    replay.accepted !== true ||
    replay.replayed !== true ||
    replay.sequence !== first.sequence
  )
    throw new Error("Hosted queue telemetry replay is not idempotent");

  const rows = await db
    .select({
      id: operatingPackTraces.id,
      type: operatingPackTraces.type,
      sequence: operatingPackTraces.sequence,
      summary: operatingPackTraces.summary,
      data: operatingPackTraces.data,
    })
    .from(operatingPackTraces)
    .where(eq(operatingPackTraces.id, exported.exportId));
  if (rows.length !== 1)
    throw new Error("Expected exactly one persisted export");
  const persisted = rows[0]!;
  if (
    persisted.type !== "queue.telemetry" ||
    persisted.sequence !== first.sequence ||
    !persisted.summary?.includes("SLO alert")
  )
    throw new Error("Persisted queue telemetry trace is incomplete");
  const serialized = JSON.stringify(persisted.data);
  if (serialized.includes(jobId) || serialized.includes(errorCode))
    throw new Error("Payload-free queue telemetry leaked job detail");

  console.log(
    JSON.stringify(
      {
        certified: true,
        deployment,
        workspaceId,
        runId,
        exportId: exported.exportId,
        first,
        replay,
        persisted: {
          type: persisted.type,
          sequence: persisted.sequence,
          summary: persisted.summary,
          payloadFree: true,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await db.delete(users).where(eq(users.id, userId));
}

async function post(payload: unknown): Promise<{
  accepted?: unknown;
  replayed?: unknown;
  sequence?: unknown;
}> {
  const process = Bun.spawn(
    [
      "vercel",
      "curl",
      "/api/internal/queue-telemetry",
      "--deployment",
      deployment,
      "--yes",
      "--",
      "--silent",
      "--show-error",
      "--request",
      "POST",
      "--header",
      `Authorization: Bearer ${secret}`,
      "--header",
      "Content-Type: application/json",
      "--data",
      JSON.stringify(payload),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`vercel curl failed: ${stderr.trim() || exitCode}`);
  try {
    return JSON.parse(stdout) as {
      accepted?: unknown;
      replayed?: unknown;
      sequence?: unknown;
    };
  } catch {
    throw new Error(`Hosted queue telemetry returned non-JSON: ${stdout}`);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
