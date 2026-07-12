import { createHash } from "node:crypto";
import { z } from "zod";
import type { QueueTraceFact } from "./bullmq";
import {
  createQueueTelemetry,
  type QueueTelemetryAlert,
  type QueueTelemetryMetric,
  type QueueTelemetryPolicy,
} from "./observability";

const identifier = z
  .string()
  .min(2)
  .max(191)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:_./-]+$/);
const profile = z.enum([
  "source-connectors",
  "document-ocr",
  "knowledge-ai",
  "business-notifications",
]);
const metricSchema = z
  .object({
    profile,
    queue: identifier,
    queued: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    retrying: z.number().int().nonnegative(),
    deadLettered: z.number().int().nonnegative(),
    throttled: z.number().int().nonnegative(),
    inFlight: z.number().int().nonnegative(),
    p95QueueWaitMs: z.number().int().nonnegative(),
    p95ProcessingMs: z.number().int().nonnegative(),
  })
  .strict();
const alertSchema = z
  .object({
    code: z.enum([
      "QUEUE_WAIT_SLO_EXCEEDED",
      "PROCESSING_SLO_EXCEEDED",
      "RETRY_RATE_EXCEEDED",
      "DEAD_LETTERS_PRESENT",
      "IN_FLIGHT_LIMIT_EXCEEDED",
    ]),
    profile,
    queue: identifier,
    observed: z.number().finite().nonnegative(),
    threshold: z.number().finite().nonnegative(),
  })
  .strict();

const unsignedExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceId: identifier,
    runId: identifier,
    generatedAtMs: z.number().int().positive().safe(),
    firstFactAtMs: z.number().int().positive().safe(),
    lastFactAtMs: z.number().int().positive().safe(),
    factCount: z.number().int().positive().max(10_000),
    trackedJobs: z.number().int().nonnegative().max(10_000),
    evictedJobs: z.number().int().nonnegative(),
    metrics: z.array(metricSchema).max(100),
    alerts: z.array(alertSchema).max(500),
  })
  .strict();

export const QueueTelemetryExportSchema = unsignedExportSchema
  .extend({
    exportId: z.string().regex(/^queue-telemetry:[a-f0-9]{64}$/),
  })
  .strict();

export type QueueTelemetryExport = Readonly<
  z.infer<typeof QueueTelemetryExportSchema>
>;

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type QueueTelemetryExportSink = {
  send(
    exported: QueueTelemetryExport,
  ): Promise<{ replayed: boolean; sequence: number }>;
};

export function createQueueTelemetryHttpSink(options: {
  endpoint: string;
  secret: string;
  fetchImpl?: Fetch;
}): QueueTelemetryExportSink {
  const endpoint = new URL(options.endpoint);
  const localhost =
    endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
  if (
    endpoint.protocol !== "https:" &&
    !(localhost && endpoint.protocol === "http:")
  )
    throw new Error("Queue telemetry endpoint must use HTTPS");
  if (options.secret.length < 32)
    throw new Error("Queue telemetry secret is not configured");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async send(candidate) {
      const exported = parseQueueTelemetryExport(candidate);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(exported),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json().catch(() => null)) as {
        accepted?: unknown;
        replayed?: unknown;
        sequence?: unknown;
      } | null;
      if (
        !response.ok ||
        body?.accepted !== true ||
        typeof body.replayed !== "boolean" ||
        !Number.isSafeInteger(body.sequence) ||
        (body.sequence as number) < 1
      )
        throw new Error(`Queue telemetry export failed (${response.status})`);
      return {
        replayed: body.replayed,
        sequence: body.sequence as number,
      };
    },
  };
}

export function createQueueTelemetryExport(input: {
  facts: readonly QueueTraceFact[];
  policy: QueueTelemetryPolicy;
  generatedAtMs?: number;
}): QueueTelemetryExport {
  if (input.facts.length < 1 || input.facts.length > 10_000)
    throw new Error("Queue telemetry export requires 1 to 10000 facts");
  const first = input.facts[0]!;
  for (const fact of input.facts) {
    if (
      fact.workspaceId !== first.workspaceId ||
      fact.traceId !== first.traceId
    )
      throw new Error("Queue telemetry export cannot cross a workspace or run");
  }
  const generatedAtMs = input.generatedAtMs ?? Date.now();
  if (!Number.isSafeInteger(generatedAtMs) || generatedAtMs < 1)
    throw new Error("Queue telemetry generatedAtMs is invalid");
  const telemetry = createQueueTelemetry({ now: () => generatedAtMs });
  for (const fact of input.facts) telemetry.record(fact);
  const snapshot = telemetry.snapshot(input.policy);
  const factTimes = input.facts.map((fact) => fact.atMs);
  const unsigned = unsignedExportSchema.parse({
    schemaVersion: 1,
    workspaceId: first.workspaceId,
    runId: first.traceId,
    generatedAtMs,
    firstFactAtMs: Math.min(...factTimes),
    lastFactAtMs: Math.max(...factTimes),
    factCount: input.facts.length,
    trackedJobs: snapshot.trackedJobs,
    evictedJobs: snapshot.evictedJobs,
    metrics: snapshot.metrics,
    alerts: snapshot.alerts,
  });
  return QueueTelemetryExportSchema.parse({
    ...unsigned,
    exportId: exportId(unsigned),
  });
}

export function parseQueueTelemetryExport(
  value: unknown,
): QueueTelemetryExport {
  const parsed = QueueTelemetryExportSchema.parse(value);
  const { exportId: claimed, ...unsigned } = parsed;
  if (exportId(unsigned) !== claimed)
    throw new Error("Queue telemetry export integrity check failed");
  return parsed;
}

function exportId(input: {
  schemaVersion: 1;
  workspaceId: string;
  runId: string;
  generatedAtMs: number;
  firstFactAtMs: number;
  lastFactAtMs: number;
  factCount: number;
  trackedJobs: number;
  evictedJobs: number;
  metrics: readonly QueueTelemetryMetric[];
  alerts: readonly QueueTelemetryAlert[];
}): string {
  return `queue-telemetry:${createHash("sha256")
    .update(stableJson(input))
    .digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
