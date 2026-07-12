import { createHash } from "node:crypto";
import { DelayedError, Queue, UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import {
  classifyJobFailure,
  createDlqEntry,
  workerProfiles,
  type DlqEntry,
  type JobFailureClass,
  type WorkerProfile,
} from "./worker-profiles";

const MAX_PAYLOAD_BYTES = 65_536;
const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{1,191}$/;
const FORBIDDEN_PAYLOAD_KEY =
  /(?:^|_)(?:authorization|cookie|credential|password|private_?key|secret|session|token)(?:$|_)/i;
const RETRY_POLICY: Readonly<
  Record<WorkerProfile["name"], { attempts: number; backoffMs: number }>
> = {
  "source-connectors": { attempts: 5, backoffMs: 500 },
  "document-ocr": { attempts: 3, backoffMs: 2_000 },
  "knowledge-ai": { attempts: 4, backoffMs: 1_000 },
  "business-notifications": { attempts: 4, backoffMs: 500 },
};

export type BullMqRuntimeJob = {
  id: string;
  workspaceId: string;
  profile: WorkerProfile["name"];
  queue: string;
  idempotencyKey: string;
  schemaVersion: number;
  payload: Readonly<Record<string, unknown>>;
  deadlineMs?: number;
  traceId: string;
};

export type QueueTraceFact = {
  type:
    | "queued"
    | "started"
    | "throttled"
    | "completed"
    | "retrying"
    | "dead-lettered";
  jobId: string;
  workspaceId: string;
  profile: WorkerProfile["name"];
  queue: string;
  traceId: string;
  attempt: number;
  atMs: number;
  errorCode?: string;
};

export class QueueTaskError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(input: { code: string; retryable: boolean; status?: number }) {
    super(input.code);
    this.name = "QueueTaskError";
    this.code = safeErrorCode(input.code);
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

export type BullMqRuntime = {
  enqueue(
    job: BullMqRuntimeJob,
  ): Promise<{ bullJobId: string; replayed: boolean }>;
  start(
    processors: Readonly<
      Partial<
        Record<
          WorkerProfile["name"],
          (job: BullMqRuntimeJob, signal: AbortSignal) => Promise<void>
        >
      >
    >,
  ): Promise<void>;
  waitUntilIdle(timeoutMs?: number): Promise<void>;
  health(): Promise<{
    ready: boolean;
    redis: "ready" | "unavailable";
    workers: Readonly<Record<string, boolean>>;
  }>;
  listDlq(
    profile: WorkerProfile["name"],
    limit?: number,
  ): Promise<readonly DlqEntry[]>;
  redrive(input: {
    profile: WorkerProfile["name"];
    entryAtMs: number;
    job: BullMqRuntimeJob;
  }): Promise<{ bullJobId: string; replayed: boolean }>;
  purge(): Promise<void>;
  close(): Promise<void>;
};

export function createBullMqRuntime(options: {
  redisUrl: string;
  namespace?: string;
  replicaCount?: number;
  trace?: (fact: QueueTraceFact) => void | Promise<void>;
}): BullMqRuntime {
  const redisUrl = validateRedisUrl(options.redisUrl);
  const namespace = options.namespace ?? "bufi-knowledge";
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(namespace))
    throw new Error("BullMQ namespace is invalid");
  const replicaCount = options.replicaCount ?? 1;
  if (!Number.isInteger(replicaCount) || replicaCount < 1)
    throw new Error("BullMQ replica count must be positive");
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  connection.on("error", () => undefined);
  const queues = new Map<WorkerProfile["name"], Queue<BullMqRuntimeJob>>();
  const workers = new Map<WorkerProfile["name"], Worker<BullMqRuntimeJob>>();
  const pendingEffects = new Set<Promise<void>>();
  let closing = false;

  const queueFor = (profile: WorkerProfile["name"]) => {
    const existing = queues.get(profile);
    if (existing) return existing;
    const created = new Queue<BullMqRuntimeJob>(`${namespace}-${profile}`, {
      connection,
      prefix: namespace,
    });
    queues.set(profile, created);
    return created;
  };

  const emit = async (fact: QueueTraceFact) => {
    try {
      await options.trace?.(fact);
    } catch {
      // Telemetry must never change queue semantics.
    }
  };

  const enqueueJob = async (input: BullMqRuntimeJob) => {
    const job = validateJob(input);
    const profile = profileFor(job.profile);
    if (!profile.allowedQueues.includes(job.queue))
      throw new Error("Logical queue is not allowed for worker profile");
    if (replicaCount > profile.maxReplicas)
      throw new Error("Replica count exceeds worker profile budget");
    await ensureConnected(connection);
    const queue = queueFor(job.profile);
    const bullJobId = bullId(job);
    const existing = await queue.getJob(bullJobId);
    if (existing) {
      if (stableJson(existing.data) !== stableJson(job))
        throw new Error("BullMQ job idempotency conflict");
      return { bullJobId, replayed: true };
    }
    const policy = RETRY_POLICY[job.profile];
    const added = await queue.add(job.queue, job, {
      jobId: bullJobId,
      attempts: policy.attempts,
      backoff: { type: "exponential", delay: policy.backoffMs },
      priority: priorityFor(profile.priority),
      removeOnComplete: { count: 1_000 },
      removeOnFail: true,
    });
    if (stableJson(added.data) !== stableJson(job))
      throw new Error("BullMQ job idempotency conflict");
    await emit(traceFact("queued", job, 0));
    return { bullJobId, replayed: false };
  };

  return {
    enqueue: enqueueJob,
    async start(processors) {
      if (workers.size > 0)
        throw new Error("BullMQ runtime is already started");
      await ensureConnected(connection);
      for (const profile of workerProfiles) {
        const processor = processors[profile.name];
        if (!processor) continue;
        const worker = new Worker<BullMqRuntimeJob>(
          `${namespace}-${profile.name}`,
          async (bullJob, token) => {
            const job = validateJob(bullJob.data);
            const slotKey = workspaceSlotKey(namespace, job);
            const slotToken = `${bullJob.id ?? job.id}:${bullJob.attemptsMade + 1}`;
            const acquired = await acquireWorkspaceSlot({
              connection,
              key: slotKey,
              token: slotToken,
              limit: profile.workspaceConcurrency,
              leaseMs: (job.deadlineMs ?? profile.deadlineMs) + 30_000,
            });
            if (!acquired) {
              await bullJob.moveToDelayed(Date.now() + 100, token);
              await emit(traceFact("throttled", job, bullJob.attemptsMade + 1));
              throw new DelayedError();
            }
            await emit(traceFact("started", job, bullJob.attemptsMade + 1));
            try {
              await withDeadline(
                job.deadlineMs ?? profile.deadlineMs,
                (signal) => processor(job, signal),
              );
              await emit(traceFact("completed", job, bullJob.attemptsMade + 1));
            } catch (error) {
              const classified = classifyError(error);
              if (classified.failureClass === "unrecoverable")
                throw new UnrecoverableError(classified.errorCode);
              throw new QueueTaskError({
                code: classified.errorCode,
                retryable: true,
              });
            } finally {
              await releaseWorkspaceSlot(connection, slotKey, slotToken);
            }
          },
          {
            connection,
            prefix: namespace,
            concurrency: profile.concurrencyPerReplica,
            lockDuration: Math.max(profile.deadlineMs + 30_000, 60_000),
            stalledInterval: 30_000,
            maxStalledCount: 1,
          },
        );
        worker.on("error", () => undefined);
        worker.on("failed", (bullJob, error) => {
          if (!bullJob) return;
          const job = validateJob(bullJob.data);
          const policy = RETRY_POLICY[job.profile];
          const finalAttempt =
            error instanceof UnrecoverableError ||
            bullJob.attemptsMade >= policy.attempts;
          const classified = classifyError(error);
          if (!finalAttempt) {
            void emit({
              ...traceFact("retrying", job, bullJob.attemptsMade),
              errorCode: classified.errorCode,
            });
            return;
          }
          const entry = createDlqEntry({
            jobId: job.id,
            workspaceId: job.workspaceId,
            profile: job.profile,
            queue: job.queue,
            failureClass: classified.failureClass,
            errorCode: classified.errorCode,
            attempts: Math.max(1, bullJob.attemptsMade),
            payloadHash: hash(stableJson(job.payload)),
            stackHash: error.stack ? hash(error.stack) : undefined,
            atMs: Date.now(),
          });
          const effect = storeDlq(connection, namespace, profile, entry)
            .then(() =>
              emit({
                ...traceFact("dead-lettered", job, bullJob.attemptsMade),
                errorCode: classified.errorCode,
              }),
            )
            .catch(() => undefined)
            .finally(() => pendingEffects.delete(effect));
          pendingEffects.add(effect);
        });
        workers.set(profile.name, worker);
        await worker.waitUntilReady();
      }
    },
    async waitUntilIdle(timeoutMs = 30_000) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const counts = await Promise.all(
          [...queues.values()].map((queue) =>
            queue.getJobCounts(
              "active",
              "delayed",
              "prioritized",
              "wait",
              "waiting",
            ),
          ),
        );
        if (
          counts.every((count) =>
            Object.values(count).every((value) => value === 0),
          )
        ) {
          await Promise.all(pendingEffects);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("BullMQ runtime did not become idle before the deadline");
    },
    async health() {
      try {
        await ensureConnected(connection);
        const pong = await connection.ping();
        const readiness = Object.fromEntries(
          await Promise.all(
            [...workers.entries()].map(async ([name, worker]) => {
              try {
                await worker.waitUntilReady();
                return [name, !worker.closing] as const;
              } catch {
                return [name, false] as const;
              }
            }),
          ),
        );
        return {
          ready: pong === "PONG" && Object.values(readiness).every(Boolean),
          redis:
            pong === "PONG" ? ("ready" as const) : ("unavailable" as const),
          workers: readiness,
        };
      } catch {
        return { ready: false, redis: "unavailable", workers: {} };
      }
    },
    async listDlq(profile, limit = 100) {
      profileFor(profile);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
        throw new Error("DLQ limit must be between 1 and 1000");
      await ensureConnected(connection);
      const values = await connection.lrange(
        dlqKey(namespace, profile),
        0,
        limit - 1,
      );
      return values.map((value) =>
        createDlqEntry(JSON.parse(value) as DlqEntry),
      );
    },
    async redrive(input) {
      const profile = profileFor(input.profile);
      const job = validateJob(input.job);
      if (job.profile !== profile.name)
        throw new Error("DLQ redrive profile does not match the job");
      if (!Number.isSafeInteger(input.entryAtMs) || input.entryAtMs < 1)
        throw new Error("DLQ redrive timestamp is invalid");
      await ensureConnected(connection);
      const expectedPayloadHash = hash(stableJson(job.payload));
      const markerKey = redriveMarkerKey(
        namespace,
        profile.name,
        input.entryAtMs,
        job.id,
        expectedPayloadHash,
      );
      const previous = await connection.get(markerKey);
      if (previous)
        return { bullJobId: previous, replayed: true };
      const key = dlqKey(namespace, profile.name);
      const values = await connection.lrange(key, 0, -1);
      const serialized = values.find((value) => {
        const entry = createDlqEntry(JSON.parse(value) as DlqEntry);
        return entry.jobId === job.id && entry.atMs === input.entryAtMs;
      });
      if (!serialized) throw new Error("DLQ redrive entry is unavailable");
      const entry = createDlqEntry(JSON.parse(serialized) as DlqEntry);
      if (
        entry.workspaceId !== job.workspaceId ||
        entry.profile !== job.profile ||
        entry.queue !== job.queue
      )
        throw new Error("DLQ redrive identity does not match the job");
      if (entry.payloadHash !== expectedPayloadHash)
        throw new Error("DLQ redrive payload hash does not match");
      const delivery = await enqueueJob(job);
      await connection
        .multi()
        .set(markerKey, delivery.bullJobId, "PX", 7 * 24 * 60 * 60 * 1_000)
        .lrem(key, 1, serialized)
        .exec();
      return delivery;
    },
    async purge() {
      await Promise.all(
        [...queues.values()].map((queue) => queue.obliterate({ force: true })),
      );
      if (connection.status !== "end") {
        await ensureConnected(connection);
        await connection.del(
          ...workerProfiles.map((profile) => dlqKey(namespace, profile.name)),
        );
        const slotKeys = await scanKeys(connection, `${namespace}:slots:*`);
        const redriveKeys = await scanKeys(
          connection,
          `${namespace}:redrive:*`,
        );
        const transientKeys = [...slotKeys, ...redriveKeys];
        if (transientKeys.length > 0) await connection.del(...transientKeys);
      }
    },
    async close() {
      if (closing) return;
      closing = true;
      await Promise.all(pendingEffects);
      await Promise.all([...workers.values()].map((worker) => worker.close()));
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      if (connection.status !== "end") await connection.quit();
    },
  };
}

function validateJob(input: BullMqRuntimeJob): BullMqRuntimeJob {
  for (const [name, value] of [
    ["id", input.id],
    ["workspaceId", input.workspaceId],
    ["queue", input.queue],
    ["idempotencyKey", input.idempotencyKey],
    ["traceId", input.traceId],
  ] as const) {
    if (!JOB_ID.test(value)) throw new Error(`BullMQ ${name} is invalid`);
  }
  profileFor(input.profile);
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1)
    throw new Error("BullMQ schemaVersion must be positive");
  if (
    input.deadlineMs !== undefined &&
    (!Number.isInteger(input.deadlineMs) ||
      input.deadlineMs < 50 ||
      input.deadlineMs > profileFor(input.profile).deadlineMs)
  )
    throw new Error("BullMQ deadline exceeds the profile budget");
  assertSafePayload(input.payload);
  return structuredClone(input);
}

async function withDeadline(
  deadlineMs: number,
  operation: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new QueueTaskError({ code: "DEADLINE_EXCEEDED", retryable: true }),
          );
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyError(error: unknown): {
  failureClass: JobFailureClass;
  errorCode: string;
} {
  if (error instanceof QueueTaskError) {
    return {
      failureClass: classifyJobFailure({
        status: error.status,
        retryable: error.retryable,
        timedOut: error.code === "DEADLINE_EXCEEDED",
      }),
      errorCode: error.code,
    };
  }
  if (error instanceof UnrecoverableError)
    return {
      failureClass: "unrecoverable",
      errorCode: safeErrorCode(error.message),
    };
  return { failureClass: "retryable", errorCode: "TASK_FAILED" };
}

async function storeDlq(
  connection: IORedis,
  namespace: string,
  profile: WorkerProfile,
  entry: DlqEntry,
): Promise<void> {
  const key = dlqKey(namespace, profile.name);
  await connection
    .multi()
    .lpush(key, JSON.stringify(entry))
    .ltrim(key, 0, profile.dlqMaxEntries - 1)
    .exec();
}

function dlqKey(namespace: string, profile: WorkerProfile["name"]): string {
  return `${namespace}:dlq:${profile}`;
}

function redriveMarkerKey(
  namespace: string,
  profile: WorkerProfile["name"],
  entryAtMs: number,
  jobId: string,
  payloadHash: string,
): string {
  const identity = createHash("sha256")
    .update(`${profile}:${entryAtMs}:${jobId}:${payloadHash}`)
    .digest("hex");
  return `${namespace}:redrive:${identity}`;
}

function workspaceSlotKey(namespace: string, job: BullMqRuntimeJob): string {
  const workspaceHash = createHash("sha256")
    .update(job.workspaceId)
    .digest("hex")
    .slice(0, 24);
  return `${namespace}:slots:${job.profile}:${workspaceHash}`;
}

async function acquireWorkspaceSlot(input: {
  connection: IORedis;
  key: string;
  token: string;
  limit: number;
  leaseMs: number;
}): Promise<boolean> {
  const now = Date.now();
  const result = await input.connection.eval(
    `
      redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
      if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
        return 0
      end
      redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[3]), ARGV[4])
      redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
      return 1
    `,
    1,
    input.key,
    now,
    input.limit,
    input.leaseMs,
    input.token,
  );
  return Number(result) === 1;
}

async function releaseWorkspaceSlot(
  connection: IORedis,
  key: string,
  token: string,
): Promise<void> {
  await connection.zrem(key, token);
}

async function scanKeys(
  connection: IORedis,
  pattern: string,
): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, page] = await connection.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== "0");
  return keys;
}

function bullId(job: BullMqRuntimeJob): string {
  return createHash("sha256")
    .update(`${job.workspaceId}:${job.profile}:${job.idempotencyKey}`)
    .digest("hex");
}

function traceFact(
  type: QueueTraceFact["type"],
  job: BullMqRuntimeJob,
  attempt: number,
): QueueTraceFact {
  return {
    type,
    jobId: job.id,
    workspaceId: job.workspaceId,
    profile: job.profile,
    queue: job.queue,
    traceId: job.traceId,
    attempt,
    atMs: Date.now(),
  };
}

function profileFor(name: WorkerProfile["name"]): WorkerProfile {
  const profile = workerProfiles.find((candidate) => candidate.name === name);
  if (!profile) throw new Error("Unknown worker profile");
  return profile;
}

function priorityFor(priority: WorkerProfile["priority"]): number {
  return priority === "high" ? 1 : priority === "normal" ? 5 : 10;
}

function validateRedisUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:")
    throw new Error("BullMQ requires a redis:// or rediss:// URL");
  return value;
}

async function ensureConnected(connection: IORedis): Promise<void> {
  if (connection.status === "wait") await connection.connect();
  if (connection.status === "end")
    throw new Error("Redis connection is closed");
}

function safeErrorCode(value: string): string {
  const code = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 120);
  return code || "TASK_FAILED";
}

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertSafePayload(payload: Readonly<Record<string, unknown>>): void {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 12) throw new Error("BullMQ payload is too deep");
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return;
    if (typeof value !== "object")
      throw new Error("BullMQ payload is not JSON-safe");
    if (seen.has(value)) throw new Error("BullMQ payload contains a cycle");
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 2_000)
        throw new Error("BullMQ payload array is too large");
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error("BullMQ payload has an unsafe prototype");
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_PAYLOAD_KEY.test(key))
        throw new Error(`BullMQ payload contains forbidden key: ${key}`);
      visit(item, depth + 1);
    }
  };
  visit(payload, 0);
  if (Buffer.byteLength(stableJson(payload)) > MAX_PAYLOAD_BYTES)
    throw new Error("BullMQ payload exceeds 64 KiB");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
