import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import postgres from "postgres";
import { createPostgresKnowledgeRepository } from "@open-agents/knowledge";

type Boundary = "queued-before-claim" | "active-before-effect" | "effect-before-ack";
type Payload = Readonly<{
  workspaceId: string;
  externalKey: string;
  boundary: Boundary;
}>;
type Marker = Readonly<{
  type: "ready" | "started" | "effect";
  boundary: Boundary;
  entityId?: string;
  version?: number;
  atMs: number;
}>;

const redisUrl = required("REDIS_URL");
const databaseUrl = required("DATABASE_URL");

if (process.argv.includes("--worker")) {
  await runWorker();
  process.exit(0);
}

const suffix = crypto.randomUUID().replaceAll("-", "");
const boundaries: readonly Boundary[] = [
  "queued-before-claim",
  "active-before-effect",
  "effect-before-ack",
];
const results = [];

for (const boundary of boundaries) results.push(await certifyBoundary(boundary));

console.log(
  JSON.stringify(
    {
      certified: true,
      provider: "railway-redis",
      boundaries: results,
      guarantees: {
        committedJobLoss: 0,
        duplicateEffects: 0,
        effectStore: "postgres-knowledge-entity-unique-key",
        payloadFreeMarkers: true,
      },
    },
    null,
    2,
  ),
);

async function certifyBoundary(boundary: Boundary) {
  const namespace = `bufi-kill-${suffix}-${boundary.replaceAll("-", "_")}`;
  const queueName = "knowledge-boundary";
  const markerKey = `${namespace}:markers`;
  const workspaceId = `kill-cert-workspace-${suffix}-${boundary}`;
  const externalKey = `kill-cert:${suffix}:${boundary}`;
  const connection = redis();
  const queue = new Queue<Payload>(queueName, { connection, prefix: namespace });
  const eventsConnection = redis();
  const queueEvents = new QueueEvents(queueName, {
    connection: eventsConnection,
    prefix: namespace,
  });
  const markerConnection = redis();
  let initial: ReturnType<typeof spawnWorker> | null = null;
  let recovery: ReturnType<typeof spawnWorker> | null = null;
  let effectBeforeKill: Marker | null = null;

  try {
    await Promise.all([queue.waitUntilReady(), queueEvents.waitUntilReady()]);
    if (boundary !== "queued-before-claim") {
      initial = spawnWorker({
        namespace,
        queueName,
        markerKey,
        pauseAt:
          boundary === "active-before-effect" ? "before-effect" : "after-effect",
      });
      await waitForMarker(markerConnection, markerKey, "ready", boundary);
    }

    const job = await queue.add(
      boundary,
      { workspaceId, externalKey, boundary },
      {
        jobId: `job-${boundary}`,
        attempts: 3,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    if (initial) {
      await waitForMarker(markerConnection, markerKey, "started", boundary);
      if (boundary === "effect-before-ack") {
        effectBeforeKill = await waitForMarker(
          markerConnection,
          markerKey,
          "effect",
          boundary,
        );
      }
      initial.kill(9);
      await initial.exited;
      initial = null;
    }

    recovery = spawnWorker({ namespace, queueName, markerKey, pauseAt: "none" });
    await waitForMarker(markerConnection, markerKey, "ready", boundary);
    await job.waitUntilFinished(queueEvents, 30_000);

    const recoveredEffect = await waitForMarker(
      markerConnection,
      markerKey,
      "effect",
      boundary,
    );
    const persisted = await readEntity(workspaceId, externalKey);
    if (!persisted) throw new Error(`${boundary}: committed effect is missing`);
    if (persisted.version !== 1)
      throw new Error(`${boundary}: idempotent replay changed entity version`);
    if (
      effectBeforeKill?.entityId &&
      effectBeforeKill.entityId !== recoveredEffect.entityId
    )
      throw new Error(`${boundary}: recovery created a duplicate effect`);
    if (persisted.id !== recoveredEffect.entityId)
      throw new Error(`${boundary}: marker does not bind to persisted effect`);

    const finalJob = await queue.getJob(job.id!);
    return {
      boundary,
      completed: (await finalJob?.getState()) === "completed",
      recoveredAfterKill: boundary !== "queued-before-claim",
      effectReplayed:
        boundary === "effect-before-ack" && Boolean(effectBeforeKill),
      entityVersion: persisted.version,
      entityIdentityStable:
        !effectBeforeKill || effectBeforeKill.entityId === persisted.id,
    };
  } finally {
    initial?.kill(9);
    recovery?.kill(9);
    await Promise.allSettled([
      initial?.exited ?? Promise.resolve(),
      recovery?.exited ?? Promise.resolve(),
    ]);
    await deleteEntity(workspaceId, externalKey);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await markerConnection.del(markerKey).catch(() => undefined);
    await Promise.allSettled([
      queueEvents.close(),
      queue.close(),
      markerConnection.quit(),
      eventsConnection.quit(),
      connection.quit(),
    ]);
  }
}

function spawnWorker(input: {
  namespace: string;
  queueName: string;
  markerKey: string;
  pauseAt: "before-effect" | "after-effect" | "none";
}) {
  return Bun.spawn([process.execPath, import.meta.path, "--worker"], {
    env: {
      ...process.env,
      QUEUE_KILL_NAMESPACE: input.namespace,
      QUEUE_KILL_QUEUE: input.queueName,
      QUEUE_KILL_MARKER_KEY: input.markerKey,
      QUEUE_KILL_PAUSE_AT: input.pauseAt,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
}

async function runWorker(): Promise<never> {
  const namespace = required("QUEUE_KILL_NAMESPACE");
  const queueName = required("QUEUE_KILL_QUEUE");
  const markerKey = required("QUEUE_KILL_MARKER_KEY");
  const pauseAt = required("QUEUE_KILL_PAUSE_AT");
  const connection = redis();
  const markers = redis();
  const knowledge = createPostgresKnowledgeRepository({
    connectionString: databaseUrl,
    maxConnections: 1,
  });
  const worker = new Worker<Payload>(
    queueName,
    async (job: Job<Payload>) => {
      const { boundary, workspaceId, externalKey } = job.data;
      await mark(markers, markerKey, { type: "started", boundary, atMs: Date.now() });
      if (pauseAt === "before-effect") await Bun.sleep(60_000);
      const entity = await knowledge.forWorkspace(workspaceId).resolve({
        externalKey,
        kind: "QueueKillCertification",
        name: `Queue kill boundary ${boundary}`,
      });
      await mark(markers, markerKey, {
        type: "effect",
        boundary,
        entityId: entity.id,
        version: entity.version,
        atMs: Date.now(),
      });
      if (pauseAt === "after-effect") await Bun.sleep(60_000);
    },
    {
      connection,
      prefix: namespace,
      concurrency: 1,
      lockDuration: 1_500,
      stalledInterval: 500,
      maxStalledCount: 2,
    },
  );
  worker.on("error", () => undefined);
  await worker.waitUntilReady();
  const boundary = namespace.split("-").slice(-3).join("-") as Boundary;
  await mark(markers, markerKey, { type: "ready", boundary, atMs: Date.now() });
  await new Promise<never>(() => undefined);
  throw new Error("unreachable");
}

async function waitForMarker(
  connection: IORedis,
  key: string,
  type: Marker["type"],
  boundary: Boundary,
): Promise<Marker> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await connection.blpop(key, 1);
    if (!result) continue;
    const marker = JSON.parse(result[1]!) as Marker;
    if (marker.type === type) return marker;
  }
  throw new Error(`${boundary}: timed out waiting for ${type}`);
}

async function mark(connection: IORedis, key: string, marker: Marker) {
  await connection.rpush(key, JSON.stringify(marker));
}

async function readEntity(workspaceId: string, externalKey: string) {
  const knowledge = createPostgresKnowledgeRepository({
    connectionString: databaseUrl,
    maxConnections: 1,
  });
  try {
    return await knowledge
      .forWorkspace(workspaceId)
      .getByExternalKey("QueueKillCertification", externalKey);
  } finally {
    await knowledge.close();
  }
}

async function deleteEntity(workspaceId: string, externalKey: string) {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
  try {
    await sql.begin(async (transaction) => {
      await transaction`SET LOCAL ROLE open_agents_knowledge_runtime`;
      await transaction`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
      await transaction`DELETE FROM knowledge_entities
        WHERE workspace_id = ${workspaceId}
          AND kind = 'QueueKillCertification'
          AND external_key = ${externalKey}`;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function redis() {
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  connection.on("error", () => undefined);
  return connection;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
